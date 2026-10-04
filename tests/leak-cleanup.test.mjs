// Things a screen starts when it opens must be stopped when it closes — on a tablet left
// open for days the leftovers pile up (a language listener per opening, a 120-document
// live query nobody is looking at, a Sortable bound to a dead list).
//
// Source-level on purpose: these modules import the Firebase SDK from a CDN, so they
// cannot be loaded under node. Each test names the call that was missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('catalogue settings releases both language listeners and hands dispose to its caller', () => {
  const src = read('js/catalogue/catalogue-settings.js');
  assert.match(src, /const stopPaintOnLanguage = onLanguageChange\(/);
  assert.match(src, /const stopLabelOnLanguage = onLanguageChange\(/);
  assert.match(src, /const dispose = \(\) => \{ stopPaintOnLanguage\(\); stopLabelOnLanguage\(\); \};/);
  assert.match(src, /return \{ root, refresh: paint, dispose \};/);
});

test('catalogue-main clears Settings only through the helper that disposes it', () => {
  const src = read('js/catalogue/catalogue-main.js');
  assert.match(src, /function setActiveSettings\(next\) \{\r?\n\s*activeSettings\?\.dispose\?\.\(\);/);
  // No bare assignment may remain outside the helper: it would skip the dispose.
  const bare = src.split(/\r?\n/).filter((line) => /^\s*activeSettings = /.test(line));
  assert.deepEqual(bare.map((l) => l.trim()), ['activeSettings = next;']);
});

test('the catalogue photo screen is disposed by the next swap()', () => {
  const main = read('js/catalogue/catalogue-main.js');
  assert.match(main, /function swap\(node, dispose = null\) \{\r?\n\s*disposeScreen\?\.\(\);\r?\n\s*disposeScreen = dispose;/);
  assert.match(main, /swap\(capture\.root, capture\.dispose\);/);
});

for (const file of ['js/catalogue/photo-capture.js', 'js/orders/photo-capture.js']) {
  test(`${file} unsubscribes its language listener and drops its photographs`, () => {
    const src = read(file);
    assert.match(src, /const stopPaintOnLanguage = onLanguageChange\(/);
    assert.match(src, /const dispose = \(\) => \{\r?\n\s*closed = true;\r?\n\s*stopPaintOnLanguage\(\);\r?\n\s*photos\.length = 0;\r?\n\s*\};/);
    assert.match(src, /return \{ root, dispose \};/);
    assert.match(src, /if \(!closed\) photos\.push\(/);
  });
}

test('the Orders pack-photo overlay disposes the screen on every way out', () => {
  const src = read('js/orders/registry.js');
  // settle() is the one funnel: the answer, Back and the pane being cleared all end there.
  assert.match(src, /popEntry\(mine\);\r?\n\s*disposeCapture\?\.\(\);\r?\n\s*resolve\(value\);/);
  assert.match(src, /const \{ root, dispose \} = renderPackPhotoCapture\(/);
  assert.match(src, /disposeCapture = dispose;/);
});

test('the client list Sortable is destroyed before the client detail replaces the content', () => {
  const src = read('js/calculator-settings.js');
  const detail = src.slice(src.indexOf('function renderClientDetail'));
  const before = detail.slice(0, detail.indexOf("content.textContent = ''"));
  assert.match(before, /if \(clientSortable\) \{ clientSortable\.destroy\(\); clientSortable = null; \}/);
});

test('pastry records listener is stopped on leaving Records and restarted on return', () => {
  const store = read('js/pastries/pastries-logs-store.js');
  assert.match(store, /export function stopPastryLogs\(\) \{[^}]*unsubLogs\(\)/);
  assert.match(store, /\.then\(unsub => \{\r?\n\s*if \(mine !== logsWatchSeq\)/);
  assert.match(store, /stopPastryLogs\(\);[^\n]*\r?\n\s*const mine = logsWatchSeq;/);

  const main = read('js/pastries/pastries-main.js');
  const showDay = main.slice(main.indexOf('function showDay'), main.indexOf('function openEditor'));
  assert.match(showDay, /stopPastryLogs\(\);\r?\n\s*logsStarted = false;/);
});

test('watchConfirmations never orphans the listener of an earlier, slower call', () => {
  const store = read('js/pastries/pastries-logs-store.js');
  const body = store.slice(store.indexOf('export async function watchConfirmations'));
  assert.match(body, /confirmationsSeq \+= 1;\r?\n\s*const mine = confirmationsSeq;/);
  assert.match(body, /if \(mine !== confirmationsSeq\) \{\r?\n\s*try \{ unsub\(\); \}/);
  // The previous subscription is dropped BEFORE the await.
  assert.ok(body.indexOf('unsubConfirmed()') < body.indexOf('await watchPastryLogsForDate'));
});
