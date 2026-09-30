// The one order every supplier's product list is read in (P15): A-Z by the label a
// person reads, ties broken by id. The order screen and the read-only items screen both
// go through sortByLabel; the order screen no longer draws category headings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareByLabel, sortByLabel } from '../js/orders/archive.js';
import { sortItems } from '../js/orders/order-text.js';

const ing = (id, name, weight) => ({ id, name, weight });

test('sorts by name and weight, across categories', () => {
  const list = [
    { ...ing('1', 'Flour', '25kg'), category: 'Dry' },
    { ...ing('2', 'Butter'), category: 'Fresh' },
    { ...ing('3', 'Flour', '1kg'), category: 'Other' },
  ];
  assert.deepEqual(sortByLabel(list).map(i => i.id), ['2', '3', '1']);
});

test('numbers in a label sort as numbers: 5kg before 25kg, 2.5kg before 25kg', () => {
  const sorted = sortByLabel([ing('a', 'Flour', '25kg'), ing('b', 'Flour', '5kg'), ing('c', 'Flour', '2.5kg')]);
  assert.deepEqual(sorted.map(i => i.weight), ['2.5kg', '5kg', '25kg']);
});

test('the order screen and the message to the supplier read the products in the SAME order', () => {
  const items = [ing('a', 'Flour', '25kg'), ing('b', 'Flour', '5kg'), ing('c', 'Butter'), ing('d', 'flour', '1kg')];
  const screen = sortByLabel(items).map(i => `${i.name} ${i.weight || ''}`.trim());
  const message = sortItems(items.map(i => ({ ...i, qty: 1 }))).map(i => `${i.name} ${i.weight || ''}`.trim());
  assert.deepEqual(screen, message);
});

test('identical labels are ordered by id, whichever way they arrive', () => {
  assert.deepEqual(sortByLabel([ing('z', 'Salt'), ing('a', 'Salt')]).map(i => i.id), ['a', 'z']);
  assert.deepEqual(sortByLabel([ing('a', 'Salt'), ing('z', 'Salt')]).map(i => i.id), ['a', 'z']);
  assert.equal(compareByLabel(ing('a', 'Salt'), ing('a', 'Salt')), 0);
});

test('a nameless item has an empty label and sorts first, still present', () => {
  const sorted = sortByLabel([ing('b', 'Yeast'), { id: 'x' }]);
  assert.deepEqual(sorted.map(i => i.id), ['x', 'b']);
});

test('returns a COPY: the input keeps its order; null and holes are tolerated', () => {
  const input = [ing('b', 'Yeast'), ing('a', 'Flour')];
  const sorted = sortByLabel(input);
  assert.notEqual(sorted, input);
  assert.deepEqual(input.map(i => i.id), ['b', 'a']);
  assert.deepEqual(sortByLabel(null), []);
  assert.deepEqual(sortByLabel([null, ing('a', 'Flour')]).map(i => i.id), ['a']);
});

test('the order screen draws no category headings and uses sortByLabel', () => {
  const src = readFileSync(new URL('../js/orders/ingredients.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ing-category/);
  assert.doesNotMatch(src, /groupByCategory|ingredient-category/);
  assert.match(src, /sortByLabel\(ingredients\)/);
});
