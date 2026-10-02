// Static pages served outside the app: the offline fallback, the 404 page and the SEO files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

for (const file of ['offline.html', '404.html']) {
  const html = read(file);

  test(`${file}: Spanish document that shares the app stylesheet and tokens`, () => {
    assert.match(html, /<html lang="es-AR">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1(?:\.0)?">/);
    assert.match(html, /<link rel="stylesheet" href="\/css\/app\.css">/);
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.match(html, /<h1[ >]/, 'one visible h1');
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.match(html, /<main[ >]/);
  });

  test(`${file}: every local asset uses an absolute path that exists (it can be served at any URL)`, () => {
    const refs = [...html.matchAll(/<(?:link|script|img)\b[^>]*?\s(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1]);
    assert.ok(refs.length > 0);
    for (const ref of refs.filter((r) => !/^(?:https?:)?\/\//.test(r))) {
      assert.ok(ref.startsWith('/'), `${file} references "${ref}" with a relative path`);
      assert.ok(existsSync(join(ROOT, ref.slice(1))), `${file} references ${ref}, which does not exist`);
    }
  });

  test(`${file}: no legacy stylesheet, data file or inline script left behind`, () => {
    for (const legacy of ['styles.css', 'styles_new.css', 'feriados.txt', 'localStorage', 'moment']) {
      assert.ok(!html.includes(legacy), `${file} still mentions ${legacy}`);
    }
    assert.ok(!/<script\b/i.test(html), `${file} should not need any script`);
  });

  test(`${file}: offers a way back to the app`, () => {
    assert.match(html, /<a [^>]*href="\/"[^>]*>/);
  });
}

test('offline.html: explains that the data may be the last saved and offers Reintentar', () => {
  const html = read('offline.html');
  assert.match(html, /Reintentar/);
  assert.match(html, /últimos datos guardados|última vez/i);
});

test('404.html: states the error and links back to the calendar and home', () => {
  const html = read('404.html');
  assert.match(html, /404/);
  assert.match(html, /href="\/\?v=calendario"/);
});

test('sitemap.xml: lists only the real home page, last modified 2026-10-02', () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ['https://proximoferiado.com.ar/']);
  assert.deepEqual([...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]), ['2026-10-02']);
});

test('robots.txt points at the sitemap', () => {
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/proximoferiado\.com\.ar\/sitemap\.xml$/m);
});
