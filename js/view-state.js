// UI state helpers that need no DOM: URL <-> state, tab keyboard navigation, the Argentine clock and the
// data-status wording. Pure functions, covered by tests/render.test.js.

export const VIEWS = ['inicio', 'calendario', 'largos'];

/** First year the calendar can show. */
export const MIN_YEAR = 2023;

/** Years ahead of the current one that the calendar can show. */
export const YEARS_AHEAD = 2;

const AR_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

export const LEGAL_NOTE =
  'Feriados nacionales según la Ley 27.399 y decretos vigentes. Las provincias y municipios pueden tener feriados propios.';

export const clampYear = (y, thisYear) => Math.min(Math.max(y, MIN_YEAR), thisYear + YEARS_AHEAD);

/** Year after moving `step` years, kept inside the supported range. */
export const yearStep = (y, step, thisYear) => clampYear(y + step, thisYear);

const inRange = (y, thisYear) => y >= MIN_YEAR && y <= thisYear + YEARS_AHEAD;

/**
 * Reads `?v=calendario|largos` and `?a=YYYY` (legacy `?action=calendario` still works).
 * Invalid values are ignored and fall back to the inicio view of the current year.
 * @param {string} search location.search, with or without the leading "?"
 * @param {number} thisYear
 * @returns {{view: 'inicio'|'calendario'|'largos', year: number}}
 */
export function parseUrlState(search, thisYear) {
  const params = new URLSearchParams(search);
  let view = 'inicio';
  const v = params.get('v');
  if (VIEWS.includes(v)) view = v;
  else if (params.get('action') === 'calendario') view = 'calendario';

  let year = thisYear;
  const a = params.get('a');
  if (a !== null && /^\d{4}$/.test(a) && inRange(Number(a), thisYear)) year = Number(a);
  return { view, year };
}

/** Inverse of parseUrlState: '' for the defaults, otherwise a query string starting with "?". */
export function serializeUrlState({ view, year }, thisYear) {
  const params = [];
  if (view !== 'inicio') {
    params.push(`v=${view}`);
    if (year !== thisYear) params.push(`a=${year}`);
  }
  return params.length ? `?${params.join('&')}` : '';
}

/** Roving-tabindex target for a key press, or null when the key is not a tab-navigation key. */
export function nextTabIndex(key, index, count) {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Milliseconds until the next 00:00 in Argentina (UTC-3). A full day when it is exactly midnight. */
export function msUntilNextArgentineMidnight(nowMs) {
  const sinceMidnight = (((nowMs - AR_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - sinceMidnight;
}

/** "dd/mm/aaaa hh:mm" in Argentina time, without depending on the browser timezone or any library. */
export function formatUpdatedAt(ms) {
  const d = new Date(ms - AR_OFFSET_MS);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Footer wording for the state of the online data.
 * @param {{status: 'ok'|'partial'|'offline'|'pending', updatedAt: number|null}} s
 */
export function statusMessage({ status, updatedAt }) {
  if (status === 'ok') {
    return updatedAt === null
      ? 'Datos verificados con ArgentinaDatos.'
      : `Datos verificados con ArgentinaDatos, actualizado el ${formatUpdatedAt(updatedAt)}`;
  }
  if (status === 'offline' || status === 'partial') {
    return updatedAt === null && status === 'offline'
      ? 'Sin conexión: se muestran los feriados calculados en este dispositivo.'
      : 'Sin conexión: se muestran los últimos datos guardados.';
  }
  return 'Verificando datos con ArgentinaDatos…';
}
