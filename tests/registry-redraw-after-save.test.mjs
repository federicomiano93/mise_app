// After a supplier or an ingredient is saved, the screen underneath the form is redrawn.
// Why (29 Sep 2026): the saved document's snapshot arrives while the form is still on top, and
// refresh() leaves a form alone — so saving a supplier's «name to show» returned to its screen
// with the OLD title. Pinned as a shape: the call must EXIST on both forms' onDone, and a plain
// Back must stay a plain pop (redrawing it would throw away the scroll position).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/orders/registry.js', import.meta.url), 'utf8');

test('popAfterSave pops the level and then redraws the one it uncovers', () => {
  assert.match(src, /function popAfterSave\(entry\) \{[\s\S]*?if \(!stack\.includes\(entry\)\) return;\s*popEntry\(entry\);\s*refresh\(\);\s*\}/);
});

test('the supplier form and the ingredient form both use it when a save is done', () => {
  assert.match(src, /onDone: \(saved\) => \{\s*globalThis\.window\?\.dispatchEvent\(new CustomEvent\('mise:action', \{ detail: 'supplier-saved' \}\)\);\s*popAfterSave\(entry\);\s*onSaved\?\.\(saved\);\s*\}/);
  assert.match(src, /onDone: \(\) => popAfterSave\(entry\),/);
});

test('backing out without saving is still a plain pop', () => {
  assert.match(src, /function overlay\(entry, title, body, onBack = \(\) => popEntry\(entry\)/);
  assert.match(src, /const close = \(\) => \{ popEntry\(entry\); onClosed\?\.\(\); \};/);
});
