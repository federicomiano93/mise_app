// Unit tests for the read-only "what this supplier sells" screen (P15).
//
// Only the ordering decision is tested — that is the part with rules in it.
// The screen itself needs a real document and is checked by driving the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemRows, countLabel } from '../js/orders/supplier-items.js';

const ing = (id, name, extra = {}) => ({ id, name, active: true, ...extra });

test('an empty supplier yields no rows at all', () => {
  assert.deepEqual(itemRows([]), []);
  assert.deepEqual(itemRows(null), []);
});

test('rows are ONE flat list — no category headings, whatever the categories', () => {
  const rows = itemRows([ing('a', 'Olive oil', { category: 'Other' })]);
  assert.deepEqual(rows, [{ id: 'a', label: 'Olive oil', unit: '' }]);
  const src = readFileSync(new URL('../js/orders/supplier-items.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ing-category/);
  assert.doesNotMatch(src, /ingredient-category/);
});

test('rows run A-Z across categories, as one list', () => {
  const rows = itemRows([
    ing('c', 'Milk', { category: 'Fresh' }),
    ing('a', 'Flour', { category: 'Dry' }),
    ing('d', 'Cling film'),
    ing('b', 'Butter', { category: 'Fresh' }),
  ]);
  assert.deepEqual(rows.map(r => r.label), ['Butter', 'Cling film', 'Flour', 'Milk']);
});

test('rows sort by the label a person reads, not by the name alone', () => {
  const rows = itemRows([
    ing('a', 'Flour', { weight: '25kg' }),
    ing('b', 'Flour', { weight: '1kg' }),
  ]);
  assert.deepEqual(rows.map(r => r.label), ['Flour 1kg', 'Flour 25kg']);
});

// Without the tie-break, two identical labels can swap places between repaints and
// the rows jump under the eye reading them.
test('identical labels keep a stable order, broken by id', () => {
  const forwards = itemRows([ing('z', 'Salt'), ing('a', 'Salt')]);
  const backwards = itemRows([ing('a', 'Salt'), ing('z', 'Salt')]);
  assert.deepEqual(forwards.map(i => i.id), ['a', 'z']);
  assert.deepEqual(backwards.map(i => i.id), ['a', 'z']);
});

test('a missing weight leaves no trailing space in the label', () => {
  assert.equal(itemRows([ing('a', 'Semolina')])[0].label, 'Semolina');
});

test('a nameless product is named honestly, never by its document id', () => {
  const label = itemRows([{ id: 'Fdx92kQ1' }])[0].label;
  assert.equal(label, 'Unnamed product');
  assert.ok(!label.includes('Fdx92kQ1'));
});

test('a missing unit is an empty string, so the screen can leave it out', () => {
  assert.equal(itemRows([ing('a', 'Semolina')])[0].unit, '');
  assert.equal(itemRows([ing('a', 'Semolina', { unit: 'bag' })])[0].unit, 'bag');
});

test('nothing real in the list is dropped, and the input is not reordered', () => {
  const input = [ing('b', 'Salt'), null, ing('a', 'Flour')];
  assert.equal(itemRows(input).length, 2);
  assert.deepEqual(input.map(i => i?.id), ['b', undefined, 'a']);
});

test('the count reads as English, singular and plural', () => {
  assert.equal(countLabel(1), '1 ingredient');
  assert.equal(countLabel(12), '12 ingredients');
  assert.equal(countLabel(0), '0 ingredients');
});
