import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUrlState } from '../js/view-state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pathOf = (src) => join(ROOT, new URL(src, 'https://proximoferiado.com.ar/').pathname);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', `${file} is not a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('manifest: identity, scope and display', () => {
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'es-AR');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(['undefined', 'string'].includes(typeof manifest.orientation));
  if (manifest.orientation !== undefined) assert.equal(manifest.orientation, 'any');
});

test('manifest: description is a short Spanish sentence', () => {
  assert.equal(typeof manifest.description, 'string');
  assert.ok(manifest.description.length > 20 && manifest.description.length <= 160, `length ${manifest.description.length}`);
  assert.match(manifest.description, /feriado/i);
  assert.ok(!manifest.description.includes('oficial'), 'the site is not an official government source');
});

test('manifest: every icon and screenshot exists and its declared size matches the PNG', () => {
  for (const entry of [...manifest.icons, ...manifest.screenshots]) {
    const file = pathOf(entry.src);
    assert.ok(existsSync(file), `${entry.src} does not exist`);
    assert.equal(entry.type, 'image/png');
    assert.equal(pngSize(file), entry.sizes, `${entry.src} declares ${entry.sizes}`);
  }
});

test('manifest: has a 192 and a 512 icon, plus maskable variants', () => {
  const sizes = (purpose) => manifest.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
  assert.ok(sizes('any').includes('192x192') && sizes('any').includes('512x512'));
  assert.ok(sizes('maskable').includes('192x192') && sizes('maskable').includes('512x512'));
});

test('manifest: colors match the light theme-color meta and the light page background', () => {
  const html = read('index.html');
  const meta = html.match(/<meta\s+name="theme-color"\s+content="(#[0-9a-fA-F]{6})"\s+media="\(prefers-color-scheme: light\)"/);
  assert.ok(meta, 'index.html must declare a light theme-color meta');
  assert.equal(manifest.theme_color.toLowerCase(), meta[1].toLowerCase());

  const css = read('css/app.css');
  const bg = css.match(/:root\s*\{[^}]*?(?<![\w-])--bg:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(bg, 'css/app.css must define --bg in the first :root block');
  assert.equal(manifest.background_color.toLowerCase(), bg[1].toLowerCase());
});

test('manifest: shortcuts open the intended app views', () => {
  const byName = Object.fromEntries(manifest.shortcuts.map((s) => [s.short_name, s]));
  assert.deepEqual(Object.keys(byName).sort(), ['Calendario', 'Fines largos']);
  const base = 'https://proximoferiado.com.ar';
  assert.equal(parseUrlState(new URL(byName.Calendario.url, base).search, 2026).view, 'calendario');
  assert.equal(parseUrlState(new URL(byName['Fines largos'].url, base).search, 2026).view, 'largos');
  assert.equal(byName.Calendario.url, '/?v=calendario');
  assert.equal(byName['Fines largos'].url, '/?v=largos');
  for (const shortcut of manifest.shortcuts) {
    assert.ok(shortcut.name && shortcut.description);
    for (const icon of shortcut.icons) assert.ok(existsSync(pathOf(icon.src)), `${icon.src} does not exist`);
  }
});

test('manifest: index.html links it and the file parses as JSON with no legacy shortcut URL', () => {
  assert.match(read('index.html'), /<link\s+rel="manifest"\s+href="manifest\.json"/);
  assert.ok(!read('manifest.json').includes('action=calendario'));
});
