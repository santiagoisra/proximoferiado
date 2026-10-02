import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { feriadosDelAnio, setExtras, setPuentes } from '../js/feriados.js';
import { TIMEOUT_MS, TTL_MS, apiUrl, applyCached, parseApiRows, refresh } from '../js/data-source.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 2, 15, 0, 0); // 2026-10-02 12:00 in Argentina
const THIS_YEAR = 2026;

const resetHooks = () => {
  for (let y = 2023; y <= 2031; y++) {
    setPuentes(y, null);
    setExtras(y, []);
  }
};
beforeEach(resetHooks);
afterEach(resetHooks);

// ---------- Test doubles ----------

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
    },
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('SecurityError: storage disabled');
  },
  setItem() {
    throw new Error('SecurityError: storage disabled');
  },
};

const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** fetch stub: `routes` maps a URL to a response, or to a function returning one (or a promise). */
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, signal: init?.signal });
    const route = routes[url];
    if (route === undefined) return jsonResponse({ error: 'Not found' }, 404);
    return typeof route === 'function' ? route(init) : route;
  };
  return { fetchImpl, calls };
}

const row = (fecha, tipo = 'inamovible', nombre = 'Test') => ({ fecha, tipo, nombre });
const puentesDe = (y) => feriadosDelAnio(y).filter((f) => f.tipo === 'puente').map((f) => f.fecha);
const storedRows = (storage, y) => JSON.parse(storage.data.get(`pf.api.v1.${y}`)).rows;

/** A realistic year payload: national holidays plus the given bridges and extra rows. */
const apiYear = (y, puentes = [], extraRows = []) => [
  row(`${y}-01-01`, 'inamovible', 'Año nuevo'),
  row(`${y}-12-25`, 'inamovible', 'Navidad'),
  ...puentes.map((f) => row(f, 'puente', 'Puente turístico no laborable')),
  ...extraRows,
];

// ---------- Constants and URL ----------

test('apiUrl builds the ArgentinaDatos endpoint for a year', () => {
  assert.equal(apiUrl(2026), 'https://api.argentinadatos.com/v1/feriados/2026');
});

test('timeout is 5 s and TTL is 1 h', () => {
  assert.equal(TIMEOUT_MS, 5000);
  assert.equal(TTL_MS, HOUR);
});

// ---------- parseApiRows ----------

test('parseApiRows splits bridges from extra holidays and tags them as api', () => {
  const { puentes, extras } = parseApiRows(2026, [row('2026-07-10', 'puente', 'P'), row('2026-09-21', 'inamovible', 'Extra')], THIS_YEAR);
  assert.deepEqual(puentes, [{ fecha: '2026-07-10', nombre: 'P', tipo: 'puente', fuente: 'api' }]);
  assert.deepEqual(extras, [{ fecha: '2026-09-21', nombre: 'Extra', tipo: 'inamovible', fuente: 'api' }]);
});

test('parseApiRows silently ignores malformed rows and unknown types', () => {
  const rows = [
    null,
    'text',
    42,
    {},
    { fecha: '2026-07-10', tipo: 'puente' }, // no nombre
    { fecha: 20260710, tipo: 'puente', nombre: 'x' }, // fecha not a string
    { fecha: '2026-7-10', tipo: 'puente', nombre: 'x' }, // bad format
    { fecha: '2025-07-10', tipo: 'puente', nombre: 'x' }, // wrong year
    { fecha: '2026-07-10', tipo: 'otro', nombre: 'x' }, // unknown type
    { fecha: '2026-07-10', tipo: 'no_laborable', nombre: 'x' }, // not accepted from the API
    row('2026-12-07', 'puente', 'valid'),
  ];
  const { puentes, extras } = parseApiRows(2026, rows, THIS_YEAR);
  assert.deepEqual(puentes.map((p) => p.fecha), ['2026-12-07']);
  assert.deepEqual(extras, []);
});

test('parseApiRows returns empty lists for a non-array payload', () => {
  assert.deepEqual(parseApiRows(2026, { error: 'Not found' }, THIS_YEAR), { puentes: [], extras: [] });
  assert.deepEqual(parseApiRows(2026, null, THIS_YEAR), { puentes: [], extras: [] });
});

test('parseApiRows accepts bridges up to thisYear+1 but never beyond', () => {
  const rows = [row('2027-08-16', 'puente')];
  assert.equal(parseApiRows(2027, rows, THIS_YEAR).puentes.length, 1);
  assert.equal(parseApiRows(2028, [row('2028-08-16', 'puente')], THIS_YEAR).puentes.length, 0);
});

test('parseApiRows takes extra holidays only for years up to the current one', () => {
  const rows = [row('2027-09-20', 'inamovible', 'Extra')];
  assert.deepEqual(parseApiRows(2027, rows, THIS_YEAR).extras, []);
  assert.equal(parseApiRows(2027, rows, 2027).extras.length, 1);
  assert.equal(parseApiRows(2025, [row('2025-09-20', 'trasladable', 'Old')], THIS_YEAR).extras.length, 1);
});

test('parseApiRows drops extras that the engine already produces for that date and class', () => {
  const rows = [row('2026-05-01', 'inamovible', 'Día del Trabajador (api)'), row('2026-06-15', 'trasladable', 'Güemes (api)')];
  assert.deepEqual(parseApiRows(2026, rows, THIS_YEAR).extras, []);
});

test('parseApiRows dedupes repeated rows', () => {
  const rows = [row('2026-07-10', 'puente'), row('2026-07-10', 'puente'), row('2026-09-21'), row('2026-09-21', 'trasladable')];
  const { puentes, extras } = parseApiRows(2026, rows, THIS_YEAR);
  assert.equal(puentes.length, 1);
  assert.equal(extras.length, 1);
});

test('parseApiRows is stable after its own output has been applied to the engine', () => {
  const rows = [row('2026-09-21', 'inamovible', 'Extra')];
  const first = parseApiRows(2026, rows, THIS_YEAR);
  setExtras(2026, first.extras);
  assert.deepEqual(parseApiRows(2026, rows, THIS_YEAR), first);
});

// ---------- refresh: bridges ----------

test('refresh replaces the seed bridges: a cancelled one disappears and a new one appears', async () => {
  assert.deepEqual(puentesDe(2026), ['2026-03-23', '2026-07-10', '2026-12-07']); // seed
  const storage = memoryStorage();
  const { fetchImpl } = stubFetch({
    [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-07-10', '2026-09-18'])),
    [apiUrl(2027)]: jsonResponse(apiYear(2027)),
  });
  const result = await refresh(THIS_YEAR, { fetchImpl, storage, now: NOW });
  assert.deepEqual(puentesDe(2026), ['2026-07-10', '2026-09-18']);
  assert.deepEqual(result, { changed: true, status: 'ok', updatedAt: NOW });
});

test('refresh persists only small normalized rows under pf.api.v1.<year>', async () => {
  const storage = memoryStorage();
  const { fetchImpl } = stubFetch({
    [apiUrl(2026)]: jsonResponse([...apiYear(2026, ['2026-07-10']), { fecha: '2026-09-21', tipo: 'inamovible', nombre: 'Extra', extra: 'noise' }]),
    [apiUrl(2027)]: jsonResponse(apiYear(2027)),
  });
  await refresh(THIS_YEAR, { fetchImpl, storage, now: NOW });
  const entry = JSON.parse(storage.data.get('pf.api.v1.2026'));
  assert.equal(entry.at, NOW);
  assert.deepEqual(entry.rows, [
    { fecha: '2026-07-10', tipo: 'puente', nombre: 'Puente turístico no laborable' },
    { fecha: '2026-09-21', tipo: 'inamovible', nombre: 'Extra' },
  ]);
  assert.ok(storage.data.has('pf.api.v1.2027'));
  assert.equal(storage.data.size, 2);
});

// Decision (documented): a valid API response with no bridges is authoritative. For a year that has seed
// entries the empty list REPLACES the seed (government decrees are the truth, the seed is only an
// offline fallback); for a year without a seed there is nothing to replace.
test('a valid API response without bridges replaces the seed bridges of that year', async () => {
  assert.equal(puentesDe(2026).length, 3);
  const { fetchImpl } = stubFetch({
    [apiUrl(2026)]: jsonResponse(apiYear(2026)),
    [apiUrl(2027)]: jsonResponse(apiYear(2027)),
  });
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.deepEqual(puentesDe(2026), []);
  assert.equal(result.changed, true);
});

test('a bare empty array is not a valid API response and never wipes the seed', async () => {
  const { fetchImpl } = stubFetch({ [apiUrl(2026)]: jsonResponse([]), [apiUrl(2027)]: jsonResponse([]) });
  const storage = memoryStorage();
  const result = await refresh(THIS_YEAR, { fetchImpl, storage, now: NOW });
  assert.equal(result.status, 'offline');
  assert.equal(result.changed, false);
  assert.equal(puentesDe(2026).length, 3);
  assert.equal(storage.data.size, 0);
});

test('2027 without bridges in the API and without seed: no bridges, no error', async () => {
  const { fetchImpl } = stubFetch({
    [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-07-10'])),
    [apiUrl(2027)]: jsonResponse(apiYear(2027)),
  });
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.equal(result.status, 'ok');
  assert.deepEqual(puentesDe(2027), []);
});

// ---------- refresh: extras ----------

test('extra holidays are applied only for the current year; next year keeps engine dates', async () => {
  const { fetchImpl } = stubFetch({
    [apiUrl(2026)]: jsonResponse(apiYear(2026, [], [row('2026-09-21', 'inamovible', 'Feriado extraordinario')])),
    [apiUrl(2027)]: jsonResponse(apiYear(2027, [], [row('2027-06-17', 'trasladable', 'Güemes nominal'), row('2027-09-20', 'inamovible', 'Extra futuro')])),
  });
  await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW });
  const extra = feriadosDelAnio(2026).find((f) => f.fecha === '2026-09-21');
  assert.equal(extra.fuente, 'api');
  assert.equal(feriadosDelAnio(2027).some((f) => f.fecha === '2027-06-17' || f.fecha === '2027-09-20'), false);
  // The engine keeps its art. 6 traslado for 2027.
  assert.ok(feriadosDelAnio(2027).some((f) => f.fecha === '2027-06-21'));
});

// ---------- refresh: request scope ----------

test('refresh requests only thisYear and thisYear+1, never thisYear+2', async () => {
  const { fetchImpl, calls } = stubFetch({
    [apiUrl(2026)]: jsonResponse(apiYear(2026)),
    [apiUrl(2027)]: jsonResponse(apiYear(2027)),
    [apiUrl(2028)]: jsonResponse(apiYear(2028)),
  });
  await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.deepEqual(calls.map((c) => c.url).sort(), [apiUrl(2026), apiUrl(2027)]);
});

test('a 404 for next year is not an error: status ok and seed bridges stay', async () => {
  const { fetchImpl, calls } = stubFetch({ [apiUrl(2025)]: jsonResponse(apiYear(2025, ['2025-05-02'])) }); // 2026 -> 404
  const result = await refresh(2025, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.equal(calls.length, 2);
  assert.equal(result.status, 'ok');
  assert.deepEqual(puentesDe(2026), ['2026-03-23', '2026-07-10', '2026-12-07']);
});

test('the year 2028 answering 404 once 2027 is the current year is not an error either', async () => {
  const { fetchImpl } = stubFetch({ [apiUrl(2027)]: jsonResponse(apiYear(2027)) });
  const result = await refresh(2027, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.equal(result.status, 'ok');
});

test('a 404 is remembered so the next call within the TTL does not hit the network again', async () => {
  const storage = memoryStorage();
  const { fetchImpl, calls } = stubFetch({ [apiUrl(2027)]: jsonResponse(apiYear(2027)) }); // 2028 -> 404
  await refresh(2027, { fetchImpl, storage, now: NOW });
  assert.equal(calls.length, 2);
  await refresh(2027, { fetchImpl, storage, now: NOW + 10 * 60_000 });
  assert.equal(calls.length, 2);
});

test('a 404 for the current year is a failure (partial)', async () => {
  const { fetchImpl } = stubFetch({ [apiUrl(2027)]: jsonResponse(apiYear(2027)) }); // 2026 -> 404
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.equal(result.status, 'partial');
});

// ---------- refresh: failures ----------

test('a request that never answers is aborted at the timeout and reports offline', async () => {
  const signals = [];
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => {
      signals.push(init.signal);
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW, timeoutMs: 20 });
  assert.equal(result.status, 'offline');
  assert.equal(result.changed, false);
  assert.equal(result.updatedAt, null);
  assert.equal(signals.length, 2);
  assert.ok(signals.every((s) => s.aborted));
  assert.equal(puentesDe(2026).length, 3); // seed untouched
});

test('a fetch that ignores the abort signal still times out', async () => {
  const fetchImpl = () => new Promise(() => {});
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW, timeoutMs: 20 });
  assert.equal(result.status, 'offline');
});

test('after a timeout the previously applied data stays intact', async () => {
  const storage = memoryStorage();
  const ok = stubFetch({ [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-09-18'])), [apiUrl(2027)]: jsonResponse(apiYear(2027)) });
  await refresh(THIS_YEAR, { fetchImpl: ok.fetchImpl, storage, now: NOW });
  const hang = () => new Promise(() => {});
  const later = NOW + 2 * HOUR; // stale: forces a network attempt
  const result = await refresh(THIS_YEAR, { fetchImpl: hang, storage, now: later, timeoutMs: 20 });
  assert.equal(result.status, 'offline');
  assert.equal(result.changed, false);
  assert.equal(result.updatedAt, NOW); // data in use is still the old fetch
  assert.deepEqual(puentesDe(2026), ['2026-09-18']);
});

test('one year failing and the other succeeding reports partial and keeps last-good for the failed year', async () => {
  const storage = memoryStorage();
  const first = stubFetch({ [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-09-18'])), [apiUrl(2027)]: jsonResponse(apiYear(2027, ['2027-08-16'])) });
  await refresh(THIS_YEAR, { fetchImpl: first.fetchImpl, storage, now: NOW });
  const second = stubFetch({ [apiUrl(2026)]: jsonResponse({}, 500), [apiUrl(2027)]: jsonResponse(apiYear(2027, ['2027-08-16', '2027-12-10'])) });
  const result = await refresh(THIS_YEAR, { fetchImpl: second.fetchImpl, storage, now: NOW + 2 * HOUR });
  assert.equal(result.status, 'partial');
  assert.equal(result.changed, true);
  assert.deepEqual(puentesDe(2026), ['2026-09-18']);
  assert.deepEqual(puentesDe(2027), ['2027-08-16', '2027-12-10']);
});

test('network errors report offline without throwing', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.deepEqual(result, { changed: false, status: 'offline', updatedAt: null });
});

test('a missing fetch implementation is treated as offline', async () => {
  const result = await refresh(THIS_YEAR, { fetchImpl: null, storage: memoryStorage(), now: NOW });
  assert.equal(result.status, 'offline');
});

test('malformed payloads are ignored and never overwrite last-good data', async () => {
  const storage = memoryStorage();
  const good = stubFetch({ [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-09-18'])), [apiUrl(2027)]: jsonResponse(apiYear(2027)) });
  await refresh(THIS_YEAR, { fetchImpl: good.fetchImpl, storage, now: NOW });
  const before = storage.data.get('pf.api.v1.2026');

  const payloads = [{ error: 'Not found' }, 'oops', null, [1, 2, 3], [{ fecha: 'x' }], [{ nope: true }]];
  for (const body of payloads) {
    const bad = stubFetch({ [apiUrl(2026)]: jsonResponse(body), [apiUrl(2027)]: jsonResponse(body) });
    const result = await refresh(THIS_YEAR, { fetchImpl: bad.fetchImpl, storage, now: NOW + 2 * HOUR });
    assert.equal(result.status, 'offline', `payload ${JSON.stringify(body)}`);
    assert.equal(result.changed, false);
    assert.deepEqual(puentesDe(2026), ['2026-09-18']);
    assert.equal(storage.data.get('pf.api.v1.2026'), before);
  }
});

test('invalid JSON from the server is a failure', async () => {
  const broken = { ok: true, status: 200, json: async () => JSON.parse('{not json') };
  const { fetchImpl } = stubFetch({ [apiUrl(2026)]: broken, [apiUrl(2027)]: broken });
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: memoryStorage(), now: NOW });
  assert.equal(result.status, 'offline');
});

// ---------- refresh: TTL ----------

test('a fresh cache entry skips the network and is still applied', async () => {
  const storage = memoryStorage({
    'pf.api.v1.2026': JSON.stringify({ at: NOW - 10 * 60_000, rows: [row('2026-09-18', 'puente', 'P')] }),
    'pf.api.v1.2027': JSON.stringify({ at: NOW - 10 * 60_000, rows: [] }),
  });
  const { fetchImpl, calls } = stubFetch({});
  const result = await refresh(THIS_YEAR, { fetchImpl, storage, now: NOW });
  assert.equal(calls.length, 0);
  assert.equal(result.status, 'ok');
  assert.equal(result.updatedAt, NOW - 10 * 60_000);
  assert.deepEqual(puentesDe(2026), ['2026-09-18']);
});

test('a stale cache entry (older than the TTL) triggers a network request', async () => {
  const storage = memoryStorage({
    'pf.api.v1.2026': JSON.stringify({ at: NOW - HOUR - 1, rows: [row('2026-09-18', 'puente', 'P')] }),
    'pf.api.v1.2027': JSON.stringify({ at: NOW - 10 * 60_000, rows: [] }),
  });
  const { fetchImpl, calls } = stubFetch({ [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-10-09'])) });
  const result = await refresh(THIS_YEAR, { fetchImpl, storage, now: NOW });
  assert.deepEqual(calls.map((c) => c.url), [apiUrl(2026)]); // 2027 was fresh
  assert.equal(result.changed, true);
  assert.deepEqual(puentesDe(2026), ['2026-10-09']);
});

test('an unchanged response reports changed=false', async () => {
  const storage = memoryStorage();
  const routes = { [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-09-18'])), [apiUrl(2027)]: jsonResponse(apiYear(2027)) };
  const first = await refresh(THIS_YEAR, { fetchImpl: stubFetch(routes).fetchImpl, storage, now: NOW });
  assert.equal(first.changed, true);
  const second = await refresh(THIS_YEAR, { fetchImpl: stubFetch(routes).fetchImpl, storage, now: NOW + 2 * HOUR });
  assert.equal(second.changed, false);
  assert.equal(second.status, 'ok');
  assert.equal(second.updatedAt, NOW + 2 * HOUR);
});

test('refresh after applyCached with identical data reports changed=false', async () => {
  const storage = memoryStorage();
  const routes = { [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-09-18'])), [apiUrl(2027)]: jsonResponse(apiYear(2027)) };
  await refresh(THIS_YEAR, { fetchImpl: stubFetch(routes).fetchImpl, storage, now: NOW });
  resetHooks();
  applyCached(THIS_YEAR, { storage, now: NOW + 2 * HOUR });
  const result = await refresh(THIS_YEAR, { fetchImpl: stubFetch(routes).fetchImpl, storage, now: NOW + 2 * HOUR });
  assert.equal(result.changed, false);
});

// ---------- applyCached ----------

test('applyCached applies last-good data with zero network and reports years and timestamps', () => {
  const storage = memoryStorage({
    'pf.api.v1.2026': JSON.stringify({ at: 111, rows: [row('2026-09-18', 'puente', 'P'), row('2026-09-21', 'inamovible', 'Extra')] }),
    'pf.api.v1.2027': JSON.stringify({ at: 222, rows: [row('2027-08-16', 'puente', 'P')] }),
    'pf.api.v1.2028': JSON.stringify({ at: 333, rows: [row('2028-05-05', 'puente', 'P')] }),
  });
  const fetchImpl = () => assert.fail('applyCached must not use the network');
  const applied = applyCached(THIS_YEAR, { fetchImpl, storage, now: NOW });
  assert.deepEqual(applied, [
    { year: 2026, at: 111 },
    { year: 2027, at: 222 },
  ]);
  assert.deepEqual(puentesDe(2026), ['2026-09-18']);
  assert.ok(feriadosDelAnio(2026).some((f) => f.fecha === '2026-09-21' && f.fuente === 'api'));
  assert.deepEqual(puentesDe(2027), ['2027-08-16']);
  assert.deepEqual(puentesDe(2028), []); // thisYear+2 is never applied
});

test('applyCached with an empty storage applies nothing and keeps the seed', () => {
  assert.deepEqual(applyCached(THIS_YEAR, { storage: memoryStorage(), now: NOW }), []);
  assert.equal(puentesDe(2026).length, 3);
});

test('applyCached ignores corrupted entries', () => {
  const storage = memoryStorage({
    'pf.api.v1.2026': '{not json',
    'pf.api.v1.2027': JSON.stringify({ at: 'yesterday', rows: 'nope' }),
  });
  assert.deepEqual(applyCached(THIS_YEAR, { storage, now: NOW }), []);
  assert.equal(puentesDe(2026).length, 3);
});

// ---------- Storage failures ----------

test('storage that throws (private mode) does not crash applyCached', () => {
  assert.deepEqual(applyCached(THIS_YEAR, { storage: throwingStorage, now: NOW }), []);
});

test('storage that throws does not stop refresh from applying network data', async () => {
  const { fetchImpl } = stubFetch({
    [apiUrl(2026)]: jsonResponse(apiYear(2026, ['2026-09-18'])),
    [apiUrl(2027)]: jsonResponse(apiYear(2027)),
  });
  const result = await refresh(THIS_YEAR, { fetchImpl, storage: throwingStorage, now: NOW });
  assert.equal(result.status, 'ok');
  assert.deepEqual(puentesDe(2026), ['2026-09-18']);
});
