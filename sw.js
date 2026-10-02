/**
 * Próximo Feriado - service worker.
 *
 * The site deploys straight from `main` with no build step, so shipped code must never go stale:
 *  - HTML, JS, CSS and JSON are network-first and revalidated (the CDN's HTTP cache would otherwise serve
 *    old code for up to 10 minutes); the saved copy is only the offline fallback.
 *  - Images are cache-first with a background refresh.
 *  - Cross-origin requests (ArgentinaDatos, Cafecito) and non-GET requests are never intercepted: the app
 *    keeps its own localStorage cache for the data.
 * Bump VERSION to drop every cached file on the next activation.
 */
'use strict';

const VERSION = 'v3';
const CACHE = `proximoferiado-${VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

// The app shell. Installing fails if any of these fails, so every entry must exist in the repo
// (tests/sw.test.js checks the list against the disk and against the module graph).
const REQUIRED = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/app.css',
  '/js/app.js',
  '/js/data-source.js',
  '/js/dates.js',
  '/js/feriados.js',
  '/js/puentes-seed.js',
  '/js/register-sw.js',
  '/js/render.js',
  '/js/view-state.js',
  '/manifest.json',
];

// Nice to have: a missing or failing image must not abort the install.
const OPTIONAL = [
  '/images/favicon.png',
  '/images/apple-touch-icon.png',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png',
];

// `reload` skips the HTTP cache so a fresh install never mixes files from two deploys.
const fresh = (path) => new Request(path, { cache: 'reload' });

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(REQUIRED.map(fresh));
  await Promise.allSettled(OPTIONAL.map((path) => cache.add(fresh(path))));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------- fetch

const REVALIDATED = /\.(?:html|js|css|json)$/;

const isDocument = (request, url) => request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');

const isCacheable = (response) => response.status === 200 && response.type === 'basic';

function remember(event, cache, key, response) {
  if (isCacheable(response)) event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
}

/** Network request that bypasses the HTTP cache and gives up after NETWORK_TIMEOUT_MS. */
async function fetchFresh(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { cache: 'no-cache', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(event, request, url) {
  const cache = await caches.open(CACHE);
  // Pages are stored by pathname so "/?v=largos&a=2027" and friends all share the "/" entry.
  const key = isDocument(request, url) ? url.pathname : request;
  let serverError;
  try {
    const response = await fetchFresh(request);
    if (isCacheable(response)) {
      remember(event, cache, key, response);
      return response;
    }
    // 404s and redirects reach the browser untouched; only 5xx prefers the saved copy.
    if (response.status < 500) return response;
    serverError = response;
  } catch {
    // Offline, DNS failure or timeout: fall through to the saved copy.
  }

  const saved = (await cache.match(key)) ?? (await cache.match(request, { ignoreSearch: true }));
  if (saved) return saved;
  if (request.mode === 'navigate') {
    // The app computes holidays on-device, so the cached shell beats the generic offline page.
    const shell = (await cache.match('/index.html')) ?? (await cache.match('/offline.html'));
    if (shell) return shell;
  }
  return serverError ?? Response.error();
}

async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  const fill = () =>
    fetch(request).then((response) => {
      remember(event, cache, request, response);
      return response;
    });
  if (saved) {
    event.waitUntil(fill().catch(() => {}));
    return saved;
  }
  try {
    return await fill();
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/images/')) {
    event.respondWith(cacheFirst(event, request));
  } else if (request.mode === 'navigate' || url.pathname === '/' || REVALIDATED.test(url.pathname)) {
    event.respondWith(networkFirst(event, request, url));
  }
});
