// Date helpers without time or timezone: everything works on ISO "yyyy-mm-dd" strings and UTC
// integer arithmetic, so results never depend on the browser timezone (Argentina is UTC-3, no DST).
// Pure module: no DOM, no network.

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const DAY_MS = 86_400_000;
const AR_OFFSET_MS = 3 * 3_600_000;
const pad = (n, len = 2) => String(n).padStart(len, '0');

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days in month `m` (1-12) of year `y`. */
export const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export const toISO = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Returns `{y, m, d}` or null when the text is not a real ISO date (rejects 2026-02-30). */
export function parseISO(s) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export const isISO = (s) => parseISO(s) !== null;

/** Milliseconds at UTC midnight of the ISO date (NaN if invalid). */
export function toUTC(iso) {
  const p = parseISO(iso);
  if (!p) return NaN;
  // Date.UTC maps years 0-99 to 1900-1999, so the year is set separately.
  const dt = new Date(Date.UTC(2000, p.m - 1, p.d));
  dt.setUTCFullYear(p.y);
  return dt.getTime();
}

export function fromUTC(ms) {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY_MS);

/** Calendar days from `a` to `b` (b - a). */
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);

/** 0 = Sunday ... 6 = Saturday. */
export const dow = (iso) => new Date(toUTC(iso)).getUTCDay();

export const isWeekend = (iso) => {
  const d = dow(iso);
  return d === 0 || d === 6;
};

export const year = (iso) => Number(iso.slice(0, 4));
export const month = (iso) => Number(iso.slice(5, 7));
export const day = (iso) => Number(iso.slice(8, 10));

/** Today's date in Argentina (UTC-3) as ISO, independent of the browser timezone. */
export const todayAR = (nowMs = Date.now()) => fromUTC(nowMs - AR_OFFSET_MS);

export const weekdayName = (iso) => WEEKDAYS[dow(iso)];

/** "viernes 2 de octubre de 2026". */
export function fmtLong(iso) {
  const p = parseISO(iso);
  return p ? `${weekdayName(iso)} ${p.d} de ${MONTHS[p.m - 1]} de ${p.y}` : '';
}

/** "2 de octubre". */
export function fmtDayMonth(iso) {
  const p = parseISO(iso);
  return p ? `${p.d} de ${MONTHS[p.m - 1]}` : '';
}
