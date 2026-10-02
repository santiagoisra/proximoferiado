// Argentine national holidays (Ley 27.399) computed by rule, plus the tourist bridges ("puentes").
// Pure module: no DOM, no network. Bridges come from a seed (offline fallback) and can be replaced at
// runtime by data-source.js through setPuentes / setExtras.
import { PUENTES_SEED } from './puentes-seed.js';
import { addDays, dow, fmtDayMonth, fromUTC, isWeekend, toISO, toUTC, year as yearOf } from './dates.js';

/**
 * @typedef {'inamovible'|'trasladable'|'no_laborable'|'puente'} Tipo
 * @typedef {{fecha: string, nombre: string, tipo: Tipo, origen?: string, fuente?: 'api'}} Feriado
 * @typedef {{desde: string, hasta: string, dias: number, motivos: string[], incluyePuente: boolean}} FinDeSemanaLargo
 */

/** Display labels (UI copy, Spanish). */
export const TIPO_LABEL = {
  inamovible: 'Feriado',
  trasladable: 'Feriado trasladable',
  no_laborable: 'Día no laborable',
  puente: 'Puente turístico',
};

const NOMBRE_PUENTE = 'Día no laborable con fines turísticos';
const DAY_MS = 86_400_000;

/** Easter Sunday (Meeus/Jones/Butcher algorithm) as ISO. */
export function pascua(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return toISO(y, Math.floor(n / 31), (n % 31) + 1);
}

/** Ley 27.399, art. 6: Tuesday/Wednesday move to the previous Monday; Thursday/Friday to the next Monday. */
export function trasladar(iso) {
  const d = dow(iso);
  if (d === 2 || d === 3) return addDays(iso, -(d - 1));
  if (d === 4 || d === 5) return addDays(iso, 8 - d);
  return iso;
}

// [month, day, name]
const INAMOVIBLES = [
  [1, 1, 'Año Nuevo'],
  [3, 24, 'Día Nacional de la Memoria por la Verdad y la Justicia'],
  [4, 2, 'Día del Veterano y de los Caídos en la Guerra de Malvinas'],
  [5, 1, 'Día del Trabajador'],
  [5, 25, 'Día de la Revolución de Mayo'],
  [6, 20, 'Paso a la Inmortalidad del General Manuel Belgrano'],
  [7, 9, 'Día de la Independencia'],
  [12, 8, 'Inmaculada Concepción de María'],
  [12, 25, 'Navidad'],
];

const TRASLADABLES = [
  [6, 17, 'Paso a la Inmortalidad del General Martín Miguel de Güemes'],
  [8, 17, 'Paso a la Inmortalidad del General José de San Martín'],
  [10, 12, 'Día del Respeto a la Diversidad Cultural'],
  [11, 20, 'Día de la Soberanía Nacional'],
];

// ---------- Runtime hooks (fed by data-source.js) ----------

const memo = new Map();
const puenteOverrides = new Map();
const extras = new Map();

/**
 * Replaces the seed bridges of year `y` with `list` (the API is authoritative, so a cancelled bridge
 * disappears). `null` restores the seed.
 * @param {number} y
 * @param {Feriado[]|null} list
 */
export function setPuentes(y, list) {
  if (list === null) puenteOverrides.delete(y);
  else puenteOverrides.set(y, list);
  memo.delete(y);
}

/**
 * Adds non-bridge holidays reported by an online source. Additive only: never removes engine entries.
 * @param {number} y
 * @param {Feriado[]} list
 */
export function setExtras(y, list) {
  extras.set(y, list);
  memo.delete(y);
}

const classOf = (t) => (t === 'puente' ? 'p' : t === 'no_laborable' ? 'n' : 'f');
const byFecha = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.tipo.localeCompare(b.tipo));

const seedPuentes = (y) => (PUENTES_SEED[y] ?? []).map((fecha) => ({ fecha, nombre: NOMBRE_PUENTE, tipo: 'puente' }));

/**
 * Every holiday, non-working day and bridge of a year, sorted by date. Memoized: callers must not mutate it.
 * @param {number} y
 * @returns {Feriado[]}
 */
export function feriadosDelAnio(y) {
  const cached = memo.get(y);
  if (cached) return cached;

  const out = [];
  for (const [m, d, nombre] of INAMOVIBLES) out.push({ fecha: toISO(y, m, d), nombre, tipo: 'inamovible' });
  for (const [m, d, nombre] of TRASLADABLES) {
    const nominal = toISO(y, m, d);
    const fecha = trasladar(nominal);
    out.push({ fecha, nombre, tipo: 'trasladable', ...(fecha !== nominal ? { origen: nominal } : {}) });
  }
  const p = pascua(y);
  out.push({ fecha: addDays(p, -48), nombre: 'Lunes de Carnaval', tipo: 'inamovible' });
  out.push({ fecha: addDays(p, -47), nombre: 'Martes de Carnaval', tipo: 'inamovible' });
  out.push({ fecha: addDays(p, -3), nombre: 'Jueves Santo', tipo: 'no_laborable' });
  out.push({ fecha: addDays(p, -2), nombre: 'Viernes Santo', tipo: 'inamovible' });

  const seen = new Set();
  for (const b of puenteOverrides.get(y) ?? seedPuentes(y)) {
    if (seen.has(b.fecha)) continue;
    seen.add(b.fecha);
    out.push(b);
  }
  for (const e of extras.get(y) ?? []) {
    if (!out.some((o) => o.fecha === e.fecha && classOf(o.tipo) === classOf(e.tipo))) out.push(e);
  }

  out.sort(byFecha);
  Object.freeze(out);
  memo.set(y, out);
  return out;
}

/** National holidays only (inamovible and trasladable): no bridges, no Holy Thursday. */
export const soloFeriados = (list) => list.filter((f) => f.tipo === 'inamovible' || f.tipo === 'trasladable');

export const feriadosEn = (iso) => feriadosDelAnio(yearOf(iso)).filter((f) => f.fecha === iso);

export const esFeriado = (iso) => feriadosEn(iso).some((f) => f.tipo === 'inamovible' || f.tipo === 'trasladable');

// ---------- Next holiday ----------

/** National holidays from `desdeIso` (inclusive), looking at its year and the next one. */
function* nacionalesDesde(desdeIso) {
  const y = yearOf(desdeIso);
  for (const yy of [y, y + 1]) {
    for (const f of soloFeriados(feriadosDelAnio(yy))) if (f.fecha >= desdeIso) yield f;
  }
}

/**
 * First national holiday on or after `desdeIso`. A holiday that falls on a weekend is returned as is.
 * @returns {Feriado|null}
 */
export function proximoFeriado(desdeIso) {
  for (const f of nacionalesDesde(desdeIso)) return f;
  return null;
}

/** The next `n` national holidays from `desdeIso` (inclusive). */
export function proximosFeriados(desdeIso, n) {
  const out = [];
  if (n <= 0) return out;
  for (const f of nacionalesDesde(desdeIso)) {
    out.push(f);
    if (out.length === n) break;
  }
  return out;
}

// ---------- Long weekends ----------

/**
 * Long weekends of a year: three or more consecutive days off that include at least one holiday or bridge.
 * Bridges count as days off (non-working by decree); Holy Thursday does not.
 * A weekend that spans New Year is listed in both adjacent years.
 * @returns {FinDeSemanaLargo[]}
 */
export function finesDeSemanaLargos(y) {
  const libre = (iso) => isWeekend(iso) || feriadosEn(iso).some((f) => f.tipo !== 'no_laborable');
  const primero = toISO(y, 1, 1);
  const ultimo = toISO(y, 12, 31);
  const out = [];
  let cur = addDays(primero, -7);
  const fin = addDays(ultimo, 7);

  while (cur <= fin) {
    if (!libre(cur)) {
      cur = addDays(cur, 1);
      continue;
    }
    let hasta = cur;
    while (libre(addDays(hasta, 1))) hasta = addDays(hasta, 1);
    const desde = cur;
    cur = addDays(hasta, 1);

    if (hasta < primero || desde > ultimo) continue;
    const dias = Math.round((toUTC(hasta) - toUTC(desde)) / DAY_MS) + 1;
    if (dias < 3) continue;

    const motivosList = [];
    for (let t = toUTC(desde); t <= toUTC(hasta); t += DAY_MS) {
      motivosList.push(...feriadosEn(fromUTC(t)).filter((f) => f.tipo !== 'no_laborable'));
    }
    if (!motivosList.length) continue;
    out.push({
      desde,
      hasta,
      dias,
      motivos: [...new Set(motivosList.map((f) => f.nombre))],
      incluyePuente: motivosList.some((f) => f.tipo === 'puente'),
    });
  }
  return out;
}

/**
 * First long weekend that has not ended before `desdeIso` (one in progress still counts).
 * @returns {FinDeSemanaLargo|null}
 */
export function proximoFinDeSemanaLargo(desdeIso) {
  const y = yearOf(desdeIso);
  for (const yy of [y, y + 1]) {
    const w = finesDeSemanaLargos(yy).find((x) => x.hasta >= desdeIso);
    if (w) return w;
  }
  return null;
}

// ---------- iCalendar export ----------

const icsEscape = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = (iso) => iso.replace(/-/g, '');
const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const UTF8 = new TextEncoder(); // available in browsers and Node, unlike Buffer

/** RFC 5545 line folding: at most 75 octets per line, never splitting a multi-byte character. */
function icsFold(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = UTF8.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * iCalendar file with all-day events, ready to import into Google Calendar, Outlook or Apple Calendar.
 * @param {Feriado[]} list
 * @param {string} calName
 * @param {number} [now] clock used for DTSTAMP (injectable for deterministic output)
 */
export function toIcs(list, calName, now = Date.now()) {
  const stamp = icsStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Proximo Feriado//Feriados Argentina//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calName)}`,
    'X-WR-TIMEZONE:America/Argentina/Buenos_Aires',
  ];
  const counts = new Map();
  for (const f of list) {
    const key = `${icsDate(f.fecha)}-${f.tipo}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${key}${n ? `-${n}` : ''}@proximoferiado.com.ar`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(f.fecha)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(f.fecha, 1))}`,
      `SUMMARY:${icsEscape(f.nombre)}`,
      `DESCRIPTION:${icsEscape(TIPO_LABEL[f.tipo] ?? '')}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
