// The Orders page memoises its derived lists by their inputs (js/orders/memo.js). A stale
// list there would put the wrong rows on a screen that drives real orders, so the memo
// itself and the keys it is given in orders-main.js are both pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { memoLast } from '../js/orders/memo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(ROOT, 'js/orders/orders-main.js'), 'utf8').replace(/\r\n/g, '\n');

test('memoLast answers the same object while every argument is the same', () => {
  let calls = 0;
  const f = memoLast((a, b) => { calls += 1; return { a, b }; });
  const list = [1];
  const first = f(list, 'x');
  assert.equal(f(list, 'x'), first);
  assert.equal(calls, 1);
});

test('memoLast recomputes when any single argument changes, and when the count changes', () => {
  let calls = 0;
  const f = memoLast((...args) => { calls += 1; return args.length; });
  const list = [1];
  f(list, 'x');
  f([1], 'x');              // an equal but NEW array is a different input
  f(list, 'y');
  f(list);
  assert.equal(calls, 4);
});

test('memoLast keeps only the last answer', () => {
  const f = memoLast(n => ({ n }));
  const a = f(1);
  const b = f(2);
  assert.notEqual(a, b);
  assert.equal(f(2), b);
  assert.notEqual(f(1), a);
});

test('the supplier lens is keyed on the ingredients, suppliers, loaded flag and override signature', () => {
  const start = main.indexOf('const resolveLens = memoLast(resolveSuppliers)');
  assert.ok(start >= 0);
  const fn = main.slice(start, main.indexOf('\n}\n', start));
  assert.match(fn, /resolveLens\(state\.ingredients, state\.suppliers, state\.loaded\.suppliers, state\.entries,\s*overrideSignature\(state\.entries\)\)/);
});

test('the catalogue lens, the grouping and the supplier list are memoised on their inputs', () => {
  assert.match(main, /resolveCatalogue\(state\.ingredients, state\.suppliers, state\.loaded\.suppliers\)/);
  assert.match(main, /groupLensBySupplier\(orderIngredients\(\)\)/);
  assert.match(main, /buildSupplierList\(activeSuppliers\(\), orderIngredients\(\), t\('orders\.noSupplier'\)\)/);
  assert.match(main, /sortActiveSuppliers\(state\.suppliers, ordersConfig\.supplierOrder\)/);
  assert.match(main, /findOrderSupplier\(supplierId\) \{\s*return orderSupplierEntry\(\)\.byId\.get\(supplierId\)/);
});

test('the memoised sources are only ever replaced, never edited in place', () => {
  // The keys are references, so an in-place edit would be invisible to them.
  assert.doesNotMatch(main, /state\.(suppliers|ingredients|history)\.(push|splice|sort|reverse|pop|shift|unshift)\(/);
  assert.doesNotMatch(main, /ordersConfig\.supplierOrder\.(push|splice|sort|reverse)\(/);
});

test('suggestFor reads the history through the per-ingredient index, memoised on its source', () => {
  assert.match(main, /const historyIndex = memoLast\(indexHistoryByIngredient\)/);
  assert.match(main, /computeSuggestion\(id, stock, historyIndex\(state\.history\)\.get\(id\) \|\| \[\], ing\)/);
  assert.match(main, /ingredientMap\(state\.ingredients\)\.get\(id\)/);
});
