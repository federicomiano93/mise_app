// A live snapshot calls registry.js refresh() from any device. While the pack-photo screen is
// open, refresh() must not rebuild it: the photos taken and the .alg-photo-busy marker (which
// js/update-gate.js watches) live only in that node. One redraw is owed and runs once when the
// level closes — every close goes through settle() -> popEntry().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/orders/registry.js', import.meta.url), 'utf8');

test('the photo screen entry is flagged keepAlive when it is built', () => {
  assert.match(src, /function capturePackPhoto\(\) \{[\s\S]*?mine = entry;\r?\n\s*entry\.keepAlive = true;[\s\S]*?renderPackPhotoCapture/);
});

test('refresh() skips a keepAlive top level and remembers a redraw is owed', () => {
  assert.match(src, /function refresh\(\) \{[\s\S]*?if \(top\.keepAlive\) \{ redrawOwed = true; return; \}[\s\S]*?top\.build\(top\)/);
});

test('closing a keepAlive level runs the owed redraw exactly once', () => {
  assert.match(src, /function popEntry\(entry\) \{[\s\S]*?if \(removed\.keepAlive && redrawOwed\) \{ redrawOwed = false; refresh\(\); \}/);
});

test('every way out of the photo screen goes through settle(), which pops its own entry', () => {
  assert.match(src, /const settle = \(value\) => \{\r?\n\s*if \(settled\) return;\r?\n\s*settled = true;\r?\n\s*popEntry\(mine\);/);
  assert.match(src, /onText: \(text, notes\) => settle\(\{ text, notes \}\)/);
  assert.match(src, /\(\) => settle\(null\),/);
});
