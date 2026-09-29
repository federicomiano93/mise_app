// Source-level check (P15, P20): on «Ingredienti e fornitori» a card's own Back and Cancel ask
// before throwing typing away — on a PHONE too (Federico, 30 Sep 2026: the phone discarded a
// half-typed record in silence; only the tablet asked). Driven in a browser at 390px.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../js/orders/registry.js', import.meta.url), 'utf8');

test('the header Back of every level goes through guardedLeave', () => {
  assert.match(js, /onClick: \(\) => guardedLeave\(entry, onBack\)/);
});

test('the ingredient and supplier forms\' Cancel go through guardedLeave', () => {
  assert.match(js, /onCancel: \(\) => guardedLeave\(entry, \(\) => popEntry\(entry\)\)/);
  assert.match(js, /onCancel: \(\) => guardedLeave\(entry, close\)/);
});

test('guardedLeave asks only when the level holds unsaved typing, and the pane keeps the unguarded close', () => {
  assert.match(js, /async function guardedLeave\(entry, close\) \{\s*if \(entryDirty\(entry\) && !\(await confirmDiscard\(\)\)\) return;\s*close\(\);/);
  assert.match(js, /backOf\.set\(node, onBack\)/);
});
