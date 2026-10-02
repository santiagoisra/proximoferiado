import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTHS,
  MONTHS_SHORT,
  WEEKDAYS,
  addDays,
  day,
  daysInMonth,
  diffDays,
  dow,
  fmtDayMonth,
  fmtLong,
  fromUTC,
  isISO,
  isWeekend,
  month,
  todayAR,
  toISO,
  toUTC,
  year,
} from '../js/dates.js';

test('toISO zero-pads year, month and day', () => {
  assert.equal(toISO(2026, 3, 7), '2026-03-07');
  assert.equal(toISO(999, 12, 31), '0999-12-31');
});

test('year, month and day read the ISO parts as numbers', () => {
  assert.equal(year('2026-10-02'), 2026);
  assert.equal(month('2026-10-02'), 10);
  assert.equal(day('2026-10-02'), 2);
});

test('dow returns 0 for Sunday through 6 for Saturday', () => {
  assert.equal(dow('2026-10-04'), 0); // Sunday
  assert.equal(dow('2026-10-02'), 5); // Friday
  assert.equal(dow('2026-10-03'), 6); // Saturday
});

test('isWeekend is true only for Saturday and Sunday', () => {
  assert.equal(isWeekend('2026-10-03'), true);
  assert.equal(isWeekend('2026-10-04'), true);
  assert.equal(isWeekend('2026-10-05'), false);
});

test('addDays crosses month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-10-02', 0), '2026-10-02');
});

test('diffDays is b minus a, signed', () => {
  assert.equal(diffDays('2026-10-02', '2026-10-12'), 10);
  assert.equal(diffDays('2026-10-12', '2026-10-02'), -10);
  assert.equal(diffDays('2025-12-31', '2026-01-01'), 1);
});

test('toUTC and fromUTC round-trip', () => {
  for (const iso of ['2026-10-02', '2024-02-29', '1999-12-31', '2100-03-01']) {
    assert.equal(fromUTC(toUTC(iso)), iso);
  }
});

test('daysInMonth handles leap years', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
});

test('isISO accepts real dates only', () => {
  assert.equal(isISO('2026-10-02'), true);
  assert.equal(isISO('2026-02-30'), false);
  assert.equal(isISO('2026-2-3'), false);
  assert.equal(isISO('hello'), false);
  assert.equal(isISO(null), false);
  assert.equal(isISO(undefined), false);
});

test('todayAR uses UTC-3 regardless of the host timezone', () => {
  // 2026-10-02T02:30:00Z is still 2026-10-01 23:30 in Argentina.
  assert.equal(todayAR(Date.UTC(2026, 9, 2, 2, 30)), '2026-10-01');
  // 2026-10-02T03:00:00Z is exactly midnight in Argentina.
  assert.equal(todayAR(Date.UTC(2026, 9, 2, 3, 0)), '2026-10-02');
  assert.equal(todayAR(Date.UTC(2026, 9, 2, 23, 59)), '2026-10-02');
});

test('todayAR defaults to the current time', () => {
  assert.match(todayAR(), /^\d{4}-\d{2}-\d{2}$/);
});

test('name tables are lowercase Spanish, Sunday first for weekdays', () => {
  assert.equal(WEEKDAYS.length, 7);
  assert.equal(WEEKDAYS[0], 'domingo');
  assert.equal(WEEKDAYS[3], 'miércoles');
  assert.equal(MONTHS.length, 12);
  assert.equal(MONTHS[0], 'enero');
  assert.equal(MONTHS[8], 'septiembre');
  assert.equal(MONTHS_SHORT.length, 12);
  assert.equal(MONTHS_SHORT[9], 'oct');
});

test('fmtLong formats weekday, day, month and year', () => {
  assert.equal(fmtLong('2026-10-02'), 'viernes 2 de octubre de 2026');
  assert.equal(fmtLong('2026-12-25'), 'viernes 25 de diciembre de 2026');
});

test('fmtDayMonth formats day and month only', () => {
  assert.equal(fmtDayMonth('2026-10-02'), '2 de octubre');
  assert.equal(fmtDayMonth('2026-01-01'), '1 de enero');
});
