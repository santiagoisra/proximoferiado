// Service worker tests. sw.js is a classic script, so it is evaluated inside a node:vm context with fakes for
// the worker globals (self, caches, fetch, Request, setTimeout). This covers the routing, caching and lifecycle
// logic; it does NOT replace a check in a real browser (registration, update flow, HTTP cache interplay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://proximoferiado.com.ar';
const SW_SOURCE = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const LEGACY_CACHES = ['proximoferiado-v1', 'proximoferiado-v2'];

// ---------------------------------------------------------------- harness

class FakeRequest {
  constructor(input, init = {}) {
    const base = typeof input === 'string' ? null : input;
    this.url = new URL(base ? base.url : input, ORIGIN).href;
    this.method = init.method ?? base?.method ?? 'GET';
    this.mode = init.mode ?? base?.mode ?? 'cors';
    this.destination = init.destination ?? base?.destination ?? '';
    this.cache = init.cache ?? base?.cache ?? 'default';
  }
}

/** A same-origin 200-style response: Node reports `type: "default"`, browsers report "basic" for these. */
function basic(body, init = {}) {
  const response = new Response(body, init);
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

const keyOf = (input, ignoreSearch = false) => {
  const u = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
  if (ignoreSearch) u.search = '';
  return u.href;
};

function createEnv(fetchImpl) {
  const listeners = {};
  const stores = new Map();
  const timers = [];
  const calls = { fetch: [], precache: [], deleted: [], skipWaiting: 0, claim: 0 };
  const env = { fetchImpl, listeners, stores, timers, calls };

  const makeCache = (store) => ({
    async match(input, options = {}) {
      const wanted = keyOf(input, options.ignoreSearch);
      for (const [key, value] of store) {
        if (keyOf(key, options.ignoreSearch) === wanted) return value.clone();
      }
      return undefined;
    },
    async put(input, response) {
      store.set(keyOf(input), response);
    },
    async add(input) {
      const request = typeof input === 'string' ? new FakeRequest(input) : input;
      const response = await env.fetchImpl(request, {});
      calls.precache.push({ url: request.url, status: response.status });
      if (!response.ok) throw new TypeError(`Bad response ${response.status} for ${request.url}`);
      store.set(keyOf(request), response);
    },
    async addAll(list) {
      await Promise.all(list.map((item) => this.add(item)));
    },
  });

  const cachesApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return makeCache(stores.get(name));
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      calls.deleted.push(name);
      return stores.delete(name);
    },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting() {
      calls.skipWaiting += 1;
      return Promise.resolve();
    },
    clients: {
      claim() {
        calls.claim += 1;
        return Promise.resolve();
      },
    },
  };

  const context = vm.createContext({
    self,
    clients: self.clients,
    caches: cachesApi,
    fetch: (request, init = {}) => {
      const req = typeof request === 'string' ? new FakeRequest(request) : request;
      calls.fetch.push({ url: req.url, init });
      return env.fetchImpl(req, init);
    },
    Request: FakeRequest,
    Response,
    URL,
    AbortController,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
  });
  vm.runInContext(SW_SOURCE, context, { filename: 'sw.js' });

  /** Dispatches an event; `done()` waits for every waitUntil promise (and rethrows the first failure). */
  env.dispatch = async (type, extra = {}) => {
    const waits = [];
    let respondWith;
    const event = {
      ...extra,
      waitUntil: (promise) => waits.push(Promise.resolve(promise)),
      respondWith: (promise) => {
        respondWith = promise;
      },
    };
    for (const fn of listeners[type] ?? []) fn(event);
    const responded = respondWith !== undefined;
    const response = responded ? await respondWith : undefined;
    const done = async () => {
      const settled = await Promise.allSettled(waits);
      const failed = settled.find((s) => s.status === 'rejected');
      if (failed) throw failed.reason;
    };
    return { responded, response, done };
  };

  env.install = async () => {
    const { done } = await env.dispatch('install');
    await done();
  };
  env.get = (request) => env.dispatch('fetch', { request });
  env.currentStore = () => {
    assert.equal(stores.size, 1, 'expected exactly one cache after install');
    return [...stores.values()][0];
  };
  env.currentName = () => [...stores.keys()][0];
  env.cachedText = async (path) => {
    const hit = [...env.currentStore()].find(([key]) => keyOf(key) === keyOf(path));
    return hit ? hit[1].clone().text() : undefined;
  };
  env.dropCached = (path) => env.currentStore().delete(keyOf(path));
  env.flush = () => new Promise((resolve) => setImmediate(resolve));
  return env;
}

const req = (path, init) => new FakeRequest(path, init);
const nav = (path) => req(path, { mode: 'navigate', destination: 'document' });
const offlineFetch = () => Promise.reject(new TypeError('Failed to fetch'));
/** Fake network where every URL answers 200 with a body that names the URL. */
const echoFetch = (request) => Promise.resolve(basic(`net:${new URL(request.url).pathname}`));

/** Fake network backed by the real files on disk; anything missing answers 404 like GitHub Pages. */
function diskFetch(request) {
  const { pathname } = new URL(request.url);
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = join(ROOT, file);
  if (!existsSync(full)) return Promise.resolve(basic('Not found', { status: 404 }));
  return Promise.resolve(basic(readFileSync(full), { status: 200 }));
}

/** An env whose install already ran against a fake network that answers "pre:<path>" (so cached ≠ fresh). */
async function installedEnv() {
  const env = createEnv((request) => Promise.resolve(basic(`pre:${new URL(request.url).pathname}`)));
  await env.install();
  env.fetchImpl = echoFetch;
  return env;
}

// ---------------------------------------------------------------- static helpers

const importsOf = (source) => {
  const specs = new Set();
  for (const re of [
    /\b(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(re)) specs.add(match[1]);
  }
  return [...specs];
};

function moduleGraph(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(readFileSync(join(ROOT, file), 'utf8'))) {
      assert.ok(spec.startsWith('.'), `${file} imports a bare specifier "${spec}": the site has no runtime deps`);
      queue.push(posix.normalize(posix.join(posix.dirname(file), spec)));
    }
  }
  return [...seen].sort();
}

/** Local assets (stylesheets, scripts, images, manifest) a page references, as absolute pathnames. */
function localAssets(htmlFile) {
  const html = readFileSync(join(ROOT, htmlFile), 'utf8');
  const out = new Set();
  for (const match of html.matchAll(/<(?:link|script|img)\b[^>]*?\s(?:href|src)=["']([^"']+)["']/g)) {
    const ref = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
    out.add(new URL(ref, `${ORIGIN}/`).pathname);
  }
  return [...out].sort();
}

async function precachedPaths() {
  const env = createEnv(diskFetch);
  await env.install();
  return [...env.currentStore().keys()].map((key) => new URL(key).pathname).sort();
}

// ---------------------------------------------------------------- (a) precache list vs disk and module graph

test('precache: every precached URL exists on disk and answers 200 during install', async () => {
  const env = createEnv(diskFetch);
  await env.install();
  assert.deepEqual(
    env.calls.precache.filter((p) => p.status !== 200),
    [],
    'a precache entry that 404s would make cache.addAll reject and abort the whole install',
  );
  for (const key of env.currentStore().keys()) {
    const { pathname } = new URL(key);
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    assert.ok(existsSync(join(ROOT, file)), `${pathname} is precached but ${file} does not exist`);
  }
});

test('precache: covers the whole module graph reachable from app.js and register-sw.js', async () => {
  const cached = await precachedPaths();
  const graph = moduleGraph(['js/app.js', 'js/register-sw.js']);
  assert.ok(graph.length >= 8, `unexpectedly small module graph: ${graph.join(', ')}`);
  for (const file of graph) assert.ok(cached.includes(`/${file}`), `/${file} is reachable but not precached`);
});

test('precache: includes the shell, offline page, manifest and every asset index.html / offline.html load', async () => {
  const cached = await precachedPaths();
  for (const path of ['/', '/index.html', '/offline.html', '/css/app.css', '/manifest.json']) {
    assert.ok(cached.includes(path), `${path} must be precached`);
  }
  for (const page of ['index.html', 'offline.html']) {
    for (const asset of localAssets(page)) assert.ok(cached.includes(asset), `${page} loads ${asset}, which is not precached`);
  }
});

test('precache: legacy files are gone from the list', async () => {
  const cached = await precachedPaths();
  for (const legacy of ['/script.js', '/calendario.js', '/feriados.txt', '/styles.css', '/styles_new.css']) {
    assert.ok(!cached.includes(legacy), `${legacy} must not be precached`);
  }
});

// ---------------------------------------------------------------- (b) install

test('install: an optional asset that 404s does not fail the install, and skipWaiting runs', async () => {
  const env = createEnv((request) =>
    new URL(request.url).pathname === '/images/apple-touch-icon.png' ? Promise.resolve(basic('nope', { status: 404 })) : diskFetch(request),
  );
  await env.install();
  assert.equal(env.calls.skipWaiting, 1);
  assert.ok(await env.cachedText('/index.html'), 'the shell is precached');
  assert.equal(await env.cachedText('/images/apple-touch-icon.png'), undefined);
  assert.ok(await env.cachedText('/images/icon-512x512.png'), 'the other optional images are still cached');
});

test('install: a required asset that fails rejects the install and never skips waiting', async () => {
  const env = createEnv((request) =>
    new URL(request.url).pathname === '/css/app.css' ? Promise.resolve(basic('nope', { status: 404 })) : diskFetch(request),
  );
  await assert.rejects(env.install());
  assert.equal(env.calls.skipWaiting, 0);
});

test('install: precache requests bypass the HTTP cache so a fresh deploy is never half-stale', async () => {
  const requests = [];
  const env = createEnv((request) => {
    requests.push(request);
    return diskFetch(request);
  });
  await env.install();
  assert.ok(requests.length > 0);
  for (const request of requests) assert.equal(request.cache, 'reload', `${request.url} should be fetched with cache: "reload"`);
});

// ---------------------------------------------------------------- (c) activate

test('activate: deletes legacy and foreign caches, keeps the current one, claims clients', async () => {
  const env = createEnv(echoFetch);
  await env.install();
  const current = env.currentName();
  assert.ok(!LEGACY_CACHES.includes(current), 'the cache name must differ from the legacy names');
  for (const name of [...LEGACY_CACHES, 'workbox-precache-v2', 'something-else']) env.stores.set(name, new Map());

  const { done } = await env.dispatch('activate');
  await done();

  assert.deepEqual([...env.stores.keys()], [current]);
  assert.ok(env.stores.get(current).size > 0, 'the current cache keeps its content');
  assert.equal(env.calls.claim, 1);
});

// ---------------------------------------------------------------- (d)(e) network-first

for (const [label, path, mode] of [
  ['javascript', '/js/app.js', {}],
  ['stylesheet', '/css/app.css', {}],
  ['manifest', '/manifest.json', {}],
  ['html page', '/offline.html', {}],
  ['navigation', '/', { mode: 'navigate', destination: 'document' }],
]) {
  test(`network-first (${label}): fresh body wins, bypasses the HTTP cache with a timeout, and refreshes the cache`, async () => {
    const env = await installedEnv();
    assert.equal(await env.cachedText(path), `pre:${path}`);
    const { responded, response, done } = await env.get(req(path, mode));
    await done();
    assert.ok(responded);
    assert.equal(await response.text(), `net:${path}`);

    const network = env.calls.fetch.at(-1);
    assert.equal(network.init.cache, 'no-cache');
    assert.ok(network.init.signal, 'an AbortSignal enforces the timeout');
    assert.equal(env.timers.at(-1).ms, 4000);
    assert.equal(env.timers.at(-1).cleared, true, 'the timeout is cleared once the headers arrive');
    assert.equal(await env.cachedText(path), `net:${path}`);
  });
}

test('network-first: a failed network falls back to the cached copy', async () => {
  const env = await installedEnv();
  env.fetchImpl = offlineFetch;
  const { response } = await env.get(req('/js/app.js'));
  assert.equal(await response.text(), 'pre:/js/app.js');
});

test('network-first: a server error (5xx) falls back to the cached copy', async () => {
  const env = await installedEnv();
  env.fetchImpl = () => Promise.resolve(basic('boom', { status: 503 }));
  const { response, done } = await env.get(req('/css/app.css'));
  await done();
  assert.equal(await response.text(), 'pre:/css/app.css');
  assert.equal(await env.cachedText('/css/app.css'), 'pre:/css/app.css', 'an error body is never cached');
});

test('network-first: a 4 s timeout aborts the request and serves the cached copy', async () => {
  const env = await installedEnv();
  env.fetchImpl = (_request, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  const pending = env.get(req('/js/render.js'));
  await env.flush();
  const timer = env.timers.at(-1);
  assert.equal(timer.ms, 4000);
  timer.fn();
  const { response } = await pending;
  assert.equal(await response.text(), 'pre:/js/render.js');
});

test('network-first: a 404 is passed through untouched and never cached', async () => {
  const env = await installedEnv();
  env.fetchImpl = () => Promise.resolve(basic('missing', { status: 404 }));
  const { response, done } = await env.get(nav('/no-existe'));
  await done();
  assert.equal(response.status, 404);
  assert.equal(await env.cachedText('/no-existe'), undefined);
});

test('network-first: with nothing cached and no network, a non-navigation request fails like the network did', async () => {
  const env = createEnv(offlineFetch);
  const { response } = await env.get(req('/js/never-seen.js'));
  assert.equal(response.type, 'error');
});

// ---------------------------------------------------------------- (f)(g) navigation fallbacks

test('navigation: no network and no cached page falls back to offline.html', async () => {
  const env = await installedEnv();
  env.dropCached('/');
  env.dropCached('/index.html');
  env.fetchImpl = offlineFetch;
  const { response } = await env.get(nav('/algo-que-no-esta-cacheado'));
  assert.equal(await response.text(), 'pre:/offline.html');
});

test('navigation: /?v=calendario&a=2027 offline is served from the cached index, ignoring the query', async () => {
  const env = await installedEnv();
  env.fetchImpl = offlineFetch;
  const { response } = await env.get(nav('/?v=calendario&a=2027'));
  assert.match(await response.text(), /^pre:\/(index\.html)?$/);
});

test('navigation: when only /index.html is cached it still serves the app for any query string', async () => {
  const env = await installedEnv();
  env.dropCached('/');
  env.fetchImpl = offlineFetch;
  const { response } = await env.get(nav('/?v=largos'));
  assert.equal(await response.text(), 'pre:/index.html');
});

test('navigation: online visits are cached by pathname so query strings do not pile up entries', async () => {
  const env = await installedEnv();
  for (const search of ['?v=calendario&a=2027', '?v=largos', '?v=calendario&a=2026']) {
    const { done } = await env.get(nav(`/${search}`));
    await done();
  }
  const keys = [...env.currentStore().keys()];
  assert.ok(keys.every((key) => !key.includes('?')), `unexpected query-string keys: ${keys.filter((k) => k.includes('?'))}`);
  assert.equal(await env.cachedText('/'), 'net:/');
});

// ---------------------------------------------------------------- (h) what is not intercepted

for (const [label, request] of [
  ['POST to the same origin', req('/js/app.js', { method: 'POST' })],
  ['the ArgentinaDatos API', new FakeRequest('https://api.argentinadatos.com/v1/feriados/2027')],
  ['Cafecito images', new FakeRequest('https://cdn.cafecito.app/imgs/buttons/button_5.png')],
  ['a cross-origin script', new FakeRequest('https://cdnjs.cloudflare.com/ajax/libs/x/1.0.0/x.min.js')],
  ['the service worker script itself', req('/sw.js')],
  ['other same-origin files (sitemap)', req('/sitemap.xml')],
]) {
  test(`fetch: ${label} is not intercepted`, async () => {
    const env = await installedEnv();
    const before = env.calls.fetch.length;
    const { responded } = await env.get(request);
    assert.equal(responded, false, 'respondWith must not be called');
    assert.equal(env.calls.fetch.length, before, 'the worker must not touch the network on its own');
  });
}

// ---------------------------------------------------------------- (i) images

test('images: cache-first, answered from the cache even when the network never replies', async () => {
  const env = await installedEnv();
  env.fetchImpl = () => new Promise(() => {});
  const { response } = await env.get(req('/images/favicon.png'));
  assert.equal(await response.text(), 'pre:/images/favicon.png');
});

test('images: a cache hit is refreshed in the background', async () => {
  const env = await installedEnv();
  const { response, done } = await env.get(req('/images/icon-192x192.png'));
  assert.equal(await response.text(), 'pre:/images/icon-192x192.png');
  await done();
  assert.equal(await env.cachedText('/images/icon-192x192.png'), 'net:/images/icon-192x192.png');
});

test('images: a miss goes to the network and is saved', async () => {
  const env = await installedEnv();
  const { response, done } = await env.get(req('/images/nuevo.png'));
  await done();
  assert.equal(await response.text(), 'net:/images/nuevo.png');
  assert.equal(await env.cachedText('/images/nuevo.png'), 'net:/images/nuevo.png');
});

test('images: a miss with no network fails like the network did, and an offline refresh stays silent', async () => {
  const env = await installedEnv();
  env.fetchImpl = offlineFetch;
  const miss = await env.get(req('/images/nuevo.png'));
  assert.equal(miss.response.type, 'error');
  const hit = await env.get(req('/images/favicon.png'));
  assert.equal(await hit.response.text(), 'pre:/images/favicon.png');
  await hit.done();
});

// ---------------------------------------------------------------- (j) dead code is gone

test('lifecycle: only install, activate and fetch listeners are registered (no push, sync, notificationclick)', async () => {
  const env = createEnv(echoFetch);
  assert.deepEqual(Object.keys(env.listeners).sort(), ['activate', 'fetch', 'install']);
});

test('source hygiene: no console noise, no legacy data file, no CDN or model-endpoint special cases', () => {
  for (const forbidden of ['console.', 'feriados.txt', 'moment', '/v1/models', 'showNotification', 'event.data.json']) {
    assert.ok(!SW_SOURCE.includes(forbidden), `sw.js must not contain "${forbidden}"`);
  }
});
