// Fetches fresh holiday data from the public ArgentinaDatos API and feeds it into the rule engine.
// The engine (feriados.js) stays the source of truth for the base calendar; the API adds the bridges
// ("puentes", decrees published during the year) and, for the current year only, extra holidays.
//
// Rules: only the current and the next year are ever requested, 5 s timeout per request, 1 h TTL with
// last-good data kept in localStorage, and any failure leaves whatever is already applied untouched.
// No DOM access: fetch, storage and clock are injectable so everything is testable offline.
import { feriadosDelAnio, setExtras, setPuentes } from './feriados.js';

export const API_BASE = 'https://api.argentinadatos.com/v1/feriados';
export const TTL_MS = 3_600_000;
export const TIMEOUT_MS = 5000;

const STORAGE_PREFIX = 'pf.api.v1.';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Endpoint for one year. Plain GET without custom headers, so the browser sends no CORS preflight. */
export const apiUrl = (y) => `${API_BASE}/${y}`;

// ---------- Parsing ----------

const isRow = (y, r) =>
  r !== null && typeof r === 'object' && typeof r.fecha === 'string' && ISO_RE.test(r.fecha) && r.fecha.startsWith(`${y}-`) && typeof r.nombre === 'string';

/**
 * Validates and splits an API payload. Malformed rows and unknown types are ignored silently.
 * - Bridges are accepted for any year up to `thisYear + 1`.
 * - Extra holidays (inamovible/trasladable the engine does not already have for that date) are accepted
 *   only for years up to `thisYear`: the API publishes future years with nominal dates (no art. 6 traslado).
 * @param {number} y
 * @param {unknown} rows
 * @param {number} thisYear
 * @returns {{puentes: import('./feriados.js').Feriado[], extras: import('./feriados.js').Feriado[]}}
 */
export function parseApiRows(y, rows, thisYear) {
  const out = { puentes: [], extras: [] };
  if (!Array.isArray(rows) || y > thisYear + 1) return out;

  // Engine entries only: extras applied earlier from the API must not hide themselves on re-parse.
  const base = feriadosDelAnio(y).filter((f) => f.fuente !== 'api');
  const puenteDates = new Set();
  const extraDates = new Set();

  for (const r of rows) {
    if (!isRow(y, r)) continue;
    if (r.tipo === 'puente') {
      if (puenteDates.has(r.fecha)) continue;
      puenteDates.add(r.fecha);
      out.puentes.push({ fecha: r.fecha, nombre: r.nombre, tipo: 'puente', fuente: 'api' });
    } else if ((r.tipo === 'inamovible' || r.tipo === 'trasladable') && y <= thisYear) {
      const known = base.some((f) => f.fecha === r.fecha && (f.tipo === 'inamovible' || f.tipo === 'trasladable'));
      if (known || extraDates.has(r.fecha)) continue;
      extraDates.add(r.fecha);
      out.extras.push({ fecha: r.fecha, nombre: r.nombre, tipo: r.tipo, fuente: 'api' });
    }
  }
  return out;
}

/** A real API answer has at least one well-formed row; `[]`, objects and garbage are treated as failures. */
const isUsablePayload = (y, body) => Array.isArray(body) && body.some((r) => isRow(y, r));

// ---------- Dependencies and storage ----------

function resolveDeps(deps = {}) {
  const nowMs = () => (typeof deps.now === 'function' ? deps.now() : (deps.now ?? Date.now()));
  let storage = deps.storage;
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage ?? null;
    } catch {
      storage = null; // access itself can throw (blocked site data)
    }
  }
  const fetchImpl = deps.fetchImpl === undefined ? globalThis.fetch?.bind(globalThis) : deps.fetchImpl;
  return { nowMs, storage, fetchImpl, timeoutMs: deps.timeoutMs ?? TIMEOUT_MS };
}

/** Stored entry `{at, rows}`; `rows` is null for "the API answered 404 for this year". */
function readEntry(storage, y) {
  try {
    const entry = JSON.parse(storage?.getItem(STORAGE_PREFIX + y) ?? 'null');
    const valid = entry && typeof entry === 'object' && Number.isFinite(entry.at) && (entry.rows === null || Array.isArray(entry.rows));
    return valid ? entry : null;
  } catch {
    return null;
  }
}

function writeEntry(storage, y, entry) {
  try {
    storage?.setItem(STORAGE_PREFIX + y, JSON.stringify(entry));
  } catch {
    /* storage unavailable or full: keep working without persistence */
  }
}

/** Pushes a stored entry into the engine. Returns false when it carries no rows (404 marker). */
function applyEntry(y, entry, thisYear) {
  if (!Array.isArray(entry?.rows)) return false;
  const { puentes, extras } = parseApiRows(y, entry.rows, thisYear);
  setPuentes(y, puentes);
  setExtras(y, extras);
  return true;
}

const yearsOf = (thisYear) => [thisYear, thisYear + 1];

/**
 * Synchronously applies the last-good data from storage (no network). Meant to run at startup.
 * @returns {{year: number, at: number}[]} the years that were applied with their fetch timestamps
 */
export function applyCached(thisYear, deps = {}) {
  const { storage } = resolveDeps(deps);
  const applied = [];
  for (const y of yearsOf(thisYear)) {
    const entry = readEntry(storage, y);
    if (entry && applyEntry(y, entry, thisYear)) applied.push({ year: y, at: entry.at });
  }
  return applied;
}

// ---------- Refresh ----------

async function withTimeout(ms, work) {
  const ctl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error('timeout'));
    }, ms);
  });
  try {
    // Racing guards against fetch implementations that ignore the abort signal.
    return await Promise.race([work(ctl.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Requests one year. Resolves `{notFound: true}` on 404, `{body}` on success, throws on any other failure. */
function requestYear(y, d) {
  return withTimeout(d.timeoutMs, async (signal) => {
    if (typeof d.fetchImpl !== 'function') throw new Error('fetch unavailable');
    const res = await d.fetchImpl(apiUrl(y), { signal });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { body: await res.json() };
  });
}

/** Result per year: `ok` (data is current or legitimately absent) and `at` (timestamp of the data in use). */
async function refreshYear(y, thisYear, d) {
  const cached = readEntry(d.storage, y);
  const now = d.nowMs();
  const age = cached ? now - cached.at : Infinity;

  if (cached && age >= 0 && age < TTL_MS) {
    applyEntry(y, cached, thisYear);
    return { ok: true, at: cached.at };
  }

  try {
    const res = await requestYear(y, d);
    if (res.notFound) {
      // The next year may simply not be published yet: not an error. Never wipe last-good rows for it.
      if (y !== thisYear + 1) throw new Error('HTTP 404');
      if (!Array.isArray(cached?.rows)) writeEntry(d.storage, y, { at: d.nowMs(), rows: null });
      return { ok: true, at: Array.isArray(cached?.rows) ? cached.at : d.nowMs() };
    }
    if (!isUsablePayload(y, res.body)) throw new Error('unexpected payload');

    const { puentes, extras } = parseApiRows(y, res.body, thisYear);
    const at = d.nowMs();
    // Persist only what the engine will use: small, normalized rows.
    const rows = [...puentes, ...extras].map(({ fecha, tipo, nombre }) => ({ fecha, tipo, nombre }));
    writeEntry(d.storage, y, { at, rows });
    applyEntry(y, { at, rows }, thisYear);
    return { ok: true, at };
  } catch {
    // Keep serving the last-good data (stale-while-revalidate): make sure it is applied.
    if (cached) applyEntry(y, cached, thisYear);
    return { ok: false, at: cached && Array.isArray(cached.rows) ? cached.at : null };
  }
}

const signature = (years) => JSON.stringify(years.map((y) => feriadosDelAnio(y)));

/**
 * Refreshes the current and the next year from the API (never any other year).
 * - `ok`: every year is current or absent (404 for next year); `partial`: some failed; `offline`: all failed.
 * - `changed`: the resulting calendar differs from what was applied when the call started.
 * - `updatedAt`: timestamp of the oldest data in use (null if none), so the UI never overstates freshness.
 * @returns {Promise<{changed: boolean, status: 'ok'|'partial'|'offline', updatedAt: number|null}>}
 */
export async function refresh(thisYear, deps = {}) {
  const d = resolveDeps(deps);
  const years = yearsOf(thisYear);
  const before = signature(years);

  const results = await Promise.all(years.map((y) => refreshYear(y, thisYear, d)));

  const okCount = results.filter((r) => r.ok).length;
  const ats = results.map((r) => r.at).filter((at) => at !== null);
  return {
    changed: signature(years) !== before,
    status: okCount === years.length ? 'ok' : okCount === 0 ? 'offline' : 'partial',
    updatedAt: ats.length ? Math.min(...ats) : null,
  };
}
