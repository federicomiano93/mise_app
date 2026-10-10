// A non-passive touch/wheel listener on the document makes EVERY one-finger scroll wait
// for the main thread before the browser may move the page — on a weak Android tablet
// that is visible stutter. js/hold-to-zoom.js used to be that listener; its pinch is now
// kept off the browser by `touch-action: pan-x pan-y` that file sets on <html> itself, and its
// listeners are passive. This pins both halves so the shape cannot come back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageScripts } from './helpers/page-scripts.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function everyJsFile(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return entry === 'vendor' ? [] : everyJsFile(abs);
    return entry.endsWith('.js') ? [abs] : [];
  });
}

test('no page-wide touchstart / touchmove / wheel listener is passive:false', () => {
  // A top-level statement starts at a non-indented line, so one listener is scanned
  // at a time and a passive:false further down is never blamed on another.
  const call = /(?:document|window|body)\.addEventListener\(\s*['"](?:touchstart|touchmove|wheel)['"][\s\S]*?passive\s*:\s*false/;
  const offenders = [];
  for (const file of everyJsFile(join(ROOT, 'js'))) {
    const src = readFileSync(file, 'utf8');
    for (const statement of src.split(/\r?\n(?=\S)/)) {
      if (call.test(statement)) offenders.push(relative(ROOT, file).split(sep).join('/'));
    }
  }
  assert.deepEqual(offenders, []);
});

test('the guard really sees a passive:false listener', () => {
  const call = /(?:document|window|body)\.addEventListener\(\s*['"](?:touchstart|touchmove|wheel)['"][\s\S]*?passive\s*:\s*false/;
  assert.ok(call.test("document.addEventListener('touchmove', (e) => {\n  x();\n}, { passive: false });"));
});

test('hold-to-zoom registers its touch listeners as passive and never preventDefaults them', () => {
  const src = readFileSync(join(ROOT, 'js', 'hold-to-zoom.js'), 'utf8');
  assert.match(src, /addEventListener\('touchstart'[\s\S]*?\}, \{ passive: true \}\)/);
  assert.match(src, /addEventListener\('touchmove'[\s\S]*?\}, \{ passive: true \}\)/);
  const touchBlock = src.slice(src.indexOf("addEventListener('touchstart'"), src.indexOf('function release'));
  assert.doesNotMatch(touchBlock, /preventDefault/);
});

test('hold-to-zoom switches the browser pinch off itself, on its own pages only', () => {
  const src = readFileSync(join(ROOT, 'js', 'hold-to-zoom.js'), 'utf8');
  assert.match(src, /document\.documentElement\.style\.touchAction\s*=\s*'pan-x pan-y'/);
});

test('no stylesheet sets touch-action: pan-x pan-y on html (it would reach pages without the magnifier)', () => {
  const offenders = readdirSync(ROOT)
    .filter((f) => f.endsWith('.css'))
    .filter((f) => /(^|\n)\s*html\s*\{[^}]*touch-action:\s*pan-x pan-y/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('pages without the magnifier keep the browser pinch-zoom', () => {
  const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const withZoom = pages
    .filter((f) => pageScripts(readFileSync(join(ROOT, f), 'utf8')).includes('js/hold-to-zoom.js'))
    .sort();
  assert.deepEqual(withZoom, [
    'calculator.html', 'catalogue.html', 'index.html', 'orders.html', 'pastries.html', 'suppliers.html',
  ]);
  for (const page of ['foodcost.html', 'inventory.html', 'order.html']) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    assert.doesNotMatch(html, /hold-to-zoom/);
    assert.ok(!pageScripts(html).includes('js/hold-to-zoom.js'), `${page}'s bundle must not run the magnifier`);
    assert.doesNotMatch(html, /touch-action/);
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)[1];
    assert.doesNotMatch(viewport, /user-scalable\s*=\s*(no|0)|maximum-scale/);
  }
});

