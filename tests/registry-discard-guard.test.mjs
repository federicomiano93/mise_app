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

test('the forms have no Cancel any more: Back (guardedLeave) closes them, the ingredient by popEntry and the supplier by close', () => {
  assert.doesNotMatch(js, /onCancel/);
  assert.match(js, /function overlay\(entry, title, body, onBack = \(\) => popEntry\(entry\), headerAction = null\)/);
  assert.match(js, /body, close, form\.headerSave\)/);
});

test('guardedLeave asks only when the level holds unsaved typing, and the pane keeps the unguarded close', () => {
  assert.match(js, /async function guardedLeave\(entry, close\) \{\s*if \(entryDirty\(entry\) && !\(await confirmDiscard\(\)\)\) return;\s*close\(\);/);
  assert.match(js, /backOf\.set\(node, onBack\)/);
});
