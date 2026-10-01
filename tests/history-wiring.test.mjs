// Source-shape pins for how «Load older orders» is wired into the Orders screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('orders-main gives renderHistory its onLoadOlder callback', () => {
  assert.match(read('js/orders/orders-main.js'), /onLoadOlder:\s*loadOlderHistory/);
});

test('both the save and the delete of the History editor patch a loaded older record', () => {
  const main = read('js/orders/orders-main.js');
  const start = main.indexOf('function openHistoryEditor(');
  assert.ok(start >= 0);
  const editor = main.slice(start, main.indexOf('\n}\n', start));
  assert.match(editor, /saveHistoryRecord\([^)]*\);\s*patchOlderRecord\(id, next\)/);
  assert.match(editor, /deleteHistoryRecord\([^)]*\);\s*patchOlderRecord\(id, null\)/);
});

test('the load button turns showingOlder on before it asks for the page', () => {
  assert.match(read('js/orders/history.js'), /showingOlder = true;[\s\S]{0,200}callbacks\.onLoadOlder/);
});
