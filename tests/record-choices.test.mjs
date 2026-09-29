import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryChoices, unitChoices, countInCategory, categoryValue, DEFAULT_CATEGORIES, DEFAULT_UNITS,
} from '../js/record-choices.js';

test('a venue that never saved a list gets the defaults of its language', () => {
  for (const stored of [undefined, null, 'x', {}]) {
    assert.deepEqual(categoryChoices({ stored, ingredients: [], language: 'it' }), ['Panetteria', 'Pasticceria', 'Vendita']);
  }
  assert.deepEqual(categoryChoices({ stored: null, ingredients: [], language: 'en' }), ['Bakery', 'Pastry', 'Retail']);
});

test('an unknown or missing language falls back to English', () => {
  assert.deepEqual(categoryChoices({ stored: null, language: null }), ['Bakery', 'Pastry', 'Retail']);
  assert.ok(unitChoices({ language: undefined }).includes('case'));
});

test('an empty stored list is used as-is: no defaults come back', () => {
  assert.deepEqual(categoryChoices({ stored: [], ingredients: [], language: 'it' }), []);
});

test('categories in use are added, deduplicated ignoring case, stored spelling wins', () => {
  const ingredients = [{ category: 'dairy' }, { category: ' Dairy ' }, { category: 'Other' }, { category: '' }, {}, null, { category: 'Eggs' }];
  assert.deepEqual(
    categoryChoices({ stored: ['Dairy', ' Flour '], ingredients, language: 'en' }),
    ['Dairy', 'Eggs', 'Flour'],
  );
});

test('the current category is always offered; "Other" is none and never offered', () => {
  assert.deepEqual(categoryChoices({ stored: ['A'], current: 'Zeta' }), ['A', 'Zeta']);
  assert.deepEqual(categoryChoices({ stored: ['A'], current: 'Other' }), ['A']);
  assert.deepEqual(categoryChoices({ stored: ['a'], current: 'A' }), ['a']);
  assert.equal(categoryValue('Other'), '');
});

test('non-string stored entries are ignored', () => {
  assert.deepEqual(categoryChoices({ stored: ['A', 3, null, ''] }), ['A']);
});

test('units: defaults by language, plus those in use, sorted and deduplicated', () => {
  const it = unitChoices({ ingredients: [{ unit: 'PZ' }, { unit: 'scatola' }, { unit: ' ' }], language: 'it' });
  assert.deepEqual(it, [...DEFAULT_UNITS.it, 'scatola'].sort((a, b) => a.localeCompare(b)));
  assert.ok(!it.includes('PZ'));
  assert.deepEqual(unitChoices({ language: 'en', current: 'tub' }), [...DEFAULT_UNITS.en, 'tub'].sort((a, b) => a.localeCompare(b)));
});

test('countInCategory matches ignoring case and spaces', () => {
  const list = [{ category: 'Dairy' }, { category: ' dairy ' }, { category: 'Eggs' }, { category: 'Other' }];
  assert.equal(countInCategory(list, 'DAIRY'), 2);
  assert.equal(countInCategory(list, 'Nothing'), 0);
  assert.equal(countInCategory(list, ''), 0);
  assert.equal(DEFAULT_CATEGORIES.it.length, 3);
});
