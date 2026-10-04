// A non-passive touch/wheel listener on the document makes EVERY one-finger scroll wait
// for the main thread before the browser may move the page — on a weak Android tablet
// that is visible stutter. js/hold-to-zoom.js used to be that listener; its pinch is now
// kept off the browser by `touch-action: pan-x pan-y` on <html> (tokens.css) and its
// listeners are passive. This pins both halves so the shape cannot come back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('tokens.css keeps the browser pinch-zoom off with touch-action on html', () => {
  const css = readFileSync(join(ROOT, 'tokens.css'), 'utf8');
  assert.match(css, /(^|\n)html\s*\{[^}]*touch-action:\s*pan-x pan-y/);
});
