import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIPO_LABEL,
  esFeriado,
  feriadosDelAnio,
  feriadosEn,
  finesDeSemanaLargos,
  pascua,
  proximoFeriado,
  proximoFinDeSemanaLargo,
  proximosFeriados,
  setExtras,
  setPuentes,
  soloFeriados,
  toIcs,
  trasladar,
} from '../js/feriados.js';

// Reset the injectable hooks so tests never leak state into each other.
const resetHooks = () => {
  for (let y = 2023; y <= 2031; y++) {
    setPuentes(y, null);
    setExtras(y, []);
  }
};
beforeEach(resetHooks);
afterEach(resetHooks);

const bridge = (fecha) => ({ fecha, nombre: 'Puente de prueba', tipo: 'puente' });

// ---------- Easter ----------

test('pascua matches the known Easter Sundays for 2023-2030', () => {
  const known = {
    2023: '2023-04-09',
    2024: '2024-03-31',
    2025: '2025-04-20',
    2026: '2026-04-05',
    2027: '2027-03-28',
    2028: '2028-04-16',
    2029: '2029-04-01',
    2030: '2030-04-21',
  };
  for (const [y, iso] of Object.entries(known)) assert.equal(pascua(Number(y)), iso, `Easter ${y}`);
});

// ---------- Art. 6 of Ley 27.399 ----------

test('trasladar moves Tue/Wed back to Monday and Thu/Fri forward to Monday', () => {
  assert.equal(trasladar('2026-06-16'), '2026-06-15'); // Tuesday
  assert.equal(trasladar('2026-06-17'), '2026-06-15'); // Wednesday (real Guemes case)
  assert.equal(trasladar('2026-06-18'), '2026-06-22'); // Thursday
  assert.equal(trasladar('2026-06-19'), '2026-06-22'); // Friday
  assert.equal(trasladar('2026-11-20'), '2026-11-23'); // Friday (real Soberania case)
});

test('trasladar leaves Monday, Saturday and Sunday unchanged', () => {
  assert.equal(trasladar('2026-06-15'), '2026-06-15'); // Monday
  assert.equal(trasladar('2026-06-20'), '2026-06-20'); // Saturday
  assert.equal(trasladar('2026-06-21'), '2026-06-21'); // Sunday
});

// ---------- Year engine ----------

// Dates of `inamovible|trasladable` entries returned by
// https://api.argentinadatos.com/v1/feriados/<year> on 2026-10-02 (fixtures, no network in tests).
const API_NATIONAL = {
  2024: ['2024-01-01', '2024-02-12', '2024-02-13', '2024-03-24', '2024-03-29', '2024-04-02', '2024-05-01', '2024-05-25', '2024-06-17', '2024-06-20', '2024-07-09', '2024-08-17', '2024-10-12', '2024-11-18', '2024-12-08', '2024-12-25'],
  2025: ['2025-01-01', '2025-03-03', '2025-03-04', '2025-03-24', '2025-04-02', '2025-04-18', '2025-05-01', '2025-05-25', '2025-06-16', '2025-06-20', '2025-07-09', '2025-08-17', '2025-10-12', '2025-11-24', '2025-12-08', '2025-12-25'],
  2026: ['2026-01-01', '2026-02-16', '2026-02-17', '2026-03-24', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-25', '2026-06-15', '2026-06-20', '2026-07-09', '2026-08-17', '2026-10-12', '2026-11-23', '2026-12-08', '2026-12-25'],
};

for (const [y, dates] of Object.entries(API_NATIONAL)) {
  test(`national holiday dates for ${y} equal the live API (inamovible + trasladable)`, () => {
    const engine = soloFeriados(feriadosDelAnio(Number(y))).map((f) => f.fecha);
    assert.deepEqual(engine, dates);
  });
}

test('feriadosDelAnio is sorted by date and has the documented shape', () => {
  const list = feriadosDelAnio(2026);
  const dates = list.map((f) => f.fecha);
  assert.deepEqual(dates, [...dates].sort());
  for (const f of list) {
    assert.match(f.fecha, /^2026-\d{2}-\d{2}$/);
    assert.equal(typeof f.nombre, 'string');
    assert.ok(f.tipo in TIPO_LABEL, `unknown tipo ${f.tipo}`);
  }
});

test('feriadosDelAnio is memoized and recomputed after a hook invalidates it', () => {
  const first = feriadosDelAnio(2026);
  assert.equal(feriadosDelAnio(2026), first);
  setExtras(2026, []);
  assert.notEqual(feriadosDelAnio(2026), first);
});

test('traslado is recorded in origen only when the date actually moved', () => {
  const guemes = feriadosDelAnio(2026).find((f) => f.fecha === '2026-06-15');
  assert.equal(guemes.tipo, 'trasladable');
  assert.equal(guemes.origen, '2026-06-17');
  const soberania = feriadosDelAnio(2026).find((f) => f.fecha === '2026-11-23');
  assert.equal(soberania.origen, '2026-11-20');
  const diversidad = feriadosDelAnio(2026).find((f) => f.fecha === '2026-10-12');
  assert.equal('origen' in diversidad, false);
});

test('art. 6 is applied to future years too (2027 Guemes moves to Monday 21)', () => {
  const guemes = feriadosDelAnio(2027).find((f) => f.tipo === 'trasladable' && f.origen === '2027-06-17');
  assert.equal(guemes.fecha, '2027-06-21');
});

test('Carnaval, Jueves Santo and Viernes Santo derive from Easter', () => {
  const byName = (y, nombre) => feriadosDelAnio(y).filter((f) => f.nombre === nombre);
  for (const y of [2024, 2025, 2026, 2027, 2028]) {
    const p = pascua(y);
    const dayShift = (n) => {
      const [yy, mm, dd] = p.split('-').map(Number);
      return new Date(Date.UTC(yy, mm - 1, dd + n)).toISOString().slice(0, 10);
    };
    assert.equal(byName(y, 'Lunes de Carnaval')[0].fecha, dayShift(-48));
    assert.equal(byName(y, 'Martes de Carnaval')[0].fecha, dayShift(-47));
    assert.equal(byName(y, 'Viernes Santo')[0].fecha, dayShift(-2));
    const jueves = byName(y, 'Jueves Santo')[0];
    assert.equal(jueves.fecha, dayShift(-3));
    assert.equal(jueves.tipo, 'no_laborable');
  }
});

test('TIPO_LABEL has the Spanish display labels', () => {
  assert.deepEqual(TIPO_LABEL, {
    inamovible: 'Feriado',
    trasladable: 'Feriado trasladable',
    no_laborable: 'Día no laborable',
    puente: 'Puente turístico',
  });
});

test('soloFeriados keeps only inamovible and trasladable entries', () => {
  setPuentes(2026, [bridge('2026-07-10')]);
  const only = soloFeriados(feriadosDelAnio(2026));
  assert.ok(only.length > 0);
  assert.ok(only.every((f) => f.tipo === 'inamovible' || f.tipo === 'trasladable'));
});

test('feriadosEn and esFeriado look up a single date', () => {
  assert.equal(esFeriado('2026-10-12'), true);
  assert.equal(esFeriado('2026-10-13'), false);
  assert.equal(feriadosEn('2026-10-13').length, 0);
  // Holy Thursday 2026 is also Malvinas day: both entries are reported.
  assert.deepEqual(feriadosEn('2026-04-02').map((f) => f.tipo).sort(), ['inamovible', 'no_laborable']);
  // A bridge alone is not a holiday.
  setPuentes(2026, [bridge('2026-07-10')]);
  assert.equal(feriadosEn('2026-07-10')[0].tipo, 'puente');
  assert.equal(esFeriado('2026-07-10'), false);
});

// ---------- Bridge and extras hooks ----------

test('seed bridges for 2026 are present by default', () => {
  const dates = feriadosDelAnio(2026).filter((f) => f.tipo === 'puente').map((f) => f.fecha);
  assert.deepEqual(dates, ['2026-03-23', '2026-07-10', '2026-12-07']);
  assert.equal(feriadosDelAnio(2026).find((f) => f.fecha === '2026-07-10').nombre, 'Día no laborable con fines turísticos');
});

test('setPuentes with a list replaces the seed bridges (a cancelled bridge disappears)', () => {
  setPuentes(2026, [bridge('2026-07-10'), bridge('2026-09-18')]);
  const dates = feriadosDelAnio(2026).filter((f) => f.tipo === 'puente').map((f) => f.fecha);
  assert.deepEqual(dates, ['2026-07-10', '2026-09-18']);
});

test('setPuentes with an empty list removes every bridge and null restores the seed', () => {
  setPuentes(2026, []);
  assert.equal(feriadosDelAnio(2026).filter((f) => f.tipo === 'puente').length, 0);
  setPuentes(2026, null);
  assert.equal(feriadosDelAnio(2026).filter((f) => f.tipo === 'puente').length, 3);
});

test('setPuentes works for years without a seed and does not touch other years', () => {
  assert.equal(feriadosDelAnio(2027).filter((f) => f.tipo === 'puente').length, 0);
  setPuentes(2027, [bridge('2027-08-16')]);
  assert.equal(feriadosDelAnio(2027).filter((f) => f.tipo === 'puente').length, 1);
  assert.equal(feriadosDelAnio(2026).filter((f) => f.tipo === 'puente').length, 3);
});

test('setExtras adds holidays, skips duplicates of the same date and class, and invalidates the memo', () => {
  const before = feriadosDelAnio(2026);
  setExtras(2026, [
    { fecha: '2026-09-21', nombre: 'Extra', tipo: 'inamovible', fuente: 'api' },
    { fecha: '2026-10-12', nombre: 'Duplicate of an engine holiday', tipo: 'trasladable', fuente: 'api' },
  ]);
  const after = feriadosDelAnio(2026);
  assert.notEqual(after, before);
  assert.equal(after.length, before.length + 1);
  assert.equal(after.find((f) => f.fecha === '2026-09-21').fuente, 'api');
  assert.equal(after.filter((f) => f.fecha === '2026-10-12').length, 1);
});

// ---------- proximoFeriado ----------

test('proximoFeriado returns the same day when today is a holiday', () => {
  assert.equal(proximoFeriado('2026-10-12').fecha, '2026-10-12');
});

test('proximoFeriado returns the next national holiday', () => {
  assert.equal(proximoFeriado('2026-10-02').fecha, '2026-10-12');
  assert.equal(proximoFeriado('2026-10-13').fecha, '2026-11-23');
});

test('on Dec 26 proximoFeriado rolls over to the first holiday of next year', () => {
  assert.equal(proximoFeriado('2026-12-26').fecha, '2027-01-01');
});

test('a holiday on a weekend is returned as is, never replaced by another one', () => {
  const f = proximoFeriado('2026-06-16');
  assert.equal(f.fecha, '2026-06-20'); // Saturday, Belgrano
  assert.equal(f.nombre, 'Paso a la Inmortalidad del General Manuel Belgrano');
});

test('proximoFeriado skips bridges and Holy Thursday', () => {
  setPuentes(2026, [bridge('2026-03-23')]);
  assert.equal(proximoFeriado('2026-03-23').fecha, '2026-03-24');
  assert.equal(proximoFeriado('2027-03-25').fecha, '2027-03-26');
});

test('proximosFeriados returns n holidays in order across the year boundary', () => {
  const list = proximosFeriados('2026-12-20', 3);
  assert.deepEqual(list.map((f) => f.fecha), ['2026-12-25', '2027-01-01', '2027-02-08']);
  assert.deepEqual(proximosFeriados('2026-10-02', 0), []);
});

// ---------- Long weekends ----------

test('finesDeSemanaLargos(2026) finds Carnaval as a 4-day Saturday-to-Tuesday weekend', () => {
  const carnaval = finesDeSemanaLargos(2026).find((w) => w.desde === '2026-02-14');
  assert.ok(carnaval, 'Carnaval weekend not found');
  assert.equal(carnaval.hasta, '2026-02-17');
  assert.equal(carnaval.dias, 4);
  assert.deepEqual(carnaval.motivos, ['Lunes de Carnaval', 'Martes de Carnaval']);
  assert.equal(carnaval.incluyePuente, false);
});

test('finesDeSemanaLargos(2026) finds the Jul 9 + Jul 10 bridge weekend (4 days)', () => {
  const julio = finesDeSemanaLargos(2026).find((w) => w.desde === '2026-07-09');
  assert.ok(julio, 'July weekend not found');
  assert.equal(julio.hasta, '2026-07-12');
  assert.equal(julio.dias, 4);
  assert.equal(julio.incluyePuente, true);
  assert.deepEqual(julio.motivos, ['Día de la Independencia', 'Día no laborable con fines turísticos']);
});

test('finesDeSemanaLargos handles Friday-to-Sunday and Saturday-to-Monday holidays', () => {
  const weekends = finesDeSemanaLargos(2026);
  const may1 = weekends.find((w) => w.desde === '2026-05-01'); // Friday
  assert.equal(may1.hasta, '2026-05-03');
  assert.equal(may1.dias, 3);
  const may25 = weekends.find((w) => w.desde === '2026-05-23'); // Monday
  assert.equal(may25.hasta, '2026-05-25');
  assert.equal(may25.dias, 3);
});

test('a lone Thursday holiday is not a long weekend (Jan 1 2026)', () => {
  const weekends = finesDeSemanaLargos(2026);
  assert.equal(weekends.some((w) => w.desde <= '2026-01-01' && w.hasta >= '2026-01-01'), false);
});

test('Holy Thursday alone does not extend a weekend but Holy Friday does', () => {
  // 2027: Thursday Mar 25 is no laborable, Friday Mar 26 is the holiday -> Fri-Sun, 3 days.
  const semanaSanta = finesDeSemanaLargos(2027).find((w) => w.desde === '2027-03-26');
  assert.ok(semanaSanta);
  assert.equal(semanaSanta.dias, 3);
});

test('finesDeSemanaLargos lists a weekend spanning New Year in both adjacent years', () => {
  // Fri Jan 1 2027 + Sat + Sun
  const y2027 = finesDeSemanaLargos(2027).find((w) => w.desde === '2027-01-01');
  assert.ok(y2027);
  assert.equal(y2027.hasta, '2027-01-03');
});

test('finesDeSemanaLargos is sorted by start date', () => {
  const starts = finesDeSemanaLargos(2026).map((w) => w.desde);
  assert.deepEqual(starts, [...starts].sort());
});

test('proximoFinDeSemanaLargo returns the first weekend that has not ended yet', () => {
  assert.equal(proximoFinDeSemanaLargo('2026-10-02').desde, '2026-10-10');
  // In the middle of the weekend it is still the "next" one.
  assert.equal(proximoFinDeSemanaLargo('2026-10-11').desde, '2026-10-10');
  assert.equal(proximoFinDeSemanaLargo('2026-10-13').desde, '2026-11-21');
});

test('proximoFinDeSemanaLargo rolls over to next year', () => {
  assert.equal(proximoFinDeSemanaLargo('2026-12-28').desde, '2027-01-01');
});

// ---------- iCalendar export ----------

const NOW = Date.UTC(2026, 9, 2, 15, 4, 5);
const sample = [
  { fecha: '2026-05-01', nombre: 'Día del Trabajador', tipo: 'inamovible' },
  { fecha: '2026-12-07', nombre: 'Puente, con coma; y punto y coma', tipo: 'puente' },
];

test('toIcs emits a CRLF-delimited VCALENDAR with all-day events', () => {
  const ics = toIcs(sample, 'Feriados 2026', NOW);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(/(^|[^\r])\n/.test(ics), false, 'bare LF found');
  assert.ok(ics.includes('PRODID:-//Proximo Feriado//Feriados Argentina//ES\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260501\r\n'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260502\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
});

test('toIcs escapes commas and semicolons and keeps UIDs on the project domain', () => {
  const ics = toIcs(sample, 'Feriados, 2026', NOW);
  assert.ok(ics.includes('SUMMARY:Puente\\, con coma\\; y punto y coma\r\n'));
  assert.ok(ics.includes('X-WR-CALNAME:Feriados\\, 2026\r\n'));
  const uids = ics.match(/^UID:.*$/gm);
  assert.equal(uids.length, 2);
  for (const uid of uids) assert.match(uid, /@proximoferiado\.com\.ar\r?$/);
  assert.equal(new Set(uids).size, 2);
});

test('toIcs DTSTAMP comes from the injected clock, not a constant', () => {
  assert.ok(toIcs(sample, 'x', NOW).includes('DTSTAMP:20261002T150405Z'));
  assert.ok(toIcs(sample, 'x', Date.UTC(2027, 0, 5, 1, 2, 3)).includes('DTSTAMP:20270105T010203Z'));
});

test('toIcs is deterministic for the same inputs and clock', () => {
  assert.equal(toIcs(sample, 'x', NOW), toIcs(sample, 'x', NOW));
});

test('toIcs describes each event with its type label', () => {
  const ics = toIcs(sample, 'x', NOW);
  assert.ok(ics.includes('DESCRIPTION:Feriado\r\n'));
  assert.ok(ics.includes('DESCRIPTION:Puente turístico\r\n'));
});

test('toIcs folds long lines at 75 octets without breaking characters', () => {
  const long = [{ fecha: '2026-05-01', nombre: 'Paso a la Inmortalidad del General Martín Miguel de Güemes y otras celebraciones muy extensas', tipo: 'inamovible' }];
  const ics = toIcs(long, 'x', NOW);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
  assert.ok(ics.replace(/\r\n /g, '').includes('Güemes y otras celebraciones muy extensas'));
});
