import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryChoices, unitChoices, countInCategory, categoryValue, isBlankNewChoice, DEFAULT_CATEGORIES, DEFAULT_UNITS,
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

test('categories in use are added; a suggestion gives way to an in-use spelling, two in-use spellings both stay', () => {
  const ingredients = [{ category: 'dairy' }, { category: ' Dairy ' }, { category: 'Other' }, { category: '' }, {}, null, { category: 'Eggs' }];
  assert.deepEqual(
    categoryChoices({ stored: ['Dairy', ' Flour '], ingredients, language: 'en' }),
    ['dairy', 'Dairy', 'Eggs', 'Flour'],
  );
  // The stored list's «Dairy» is only a suggestion: the in-use «dairy» replaces it.
  assert.deepEqual(categoryChoices({ stored: ['Dairy'], ingredients: [{ category: 'dairy' }] }), ['dairy']);
});

test('the current category keeps its exact spelling even when a suggestion differs in case', () => {
  assert.deepEqual(categoryChoices({ stored: ['Farine'], current: 'farine', ingredients: [] }), ['farine']);
  assert.deepEqual(categoryChoices({ stored: ['a'], current: 'A' }), ['A']);
  const both = categoryChoices({ stored: [], current: 'farine', ingredients: [{ category: 'Farine' }] });
  assert.deepEqual(both, ['farine', 'Farine']);
});

test('the current category is always offered; "Other" is none and never offered', () => {
  assert.deepEqual(categoryChoices({ stored: ['A'], current: 'Zeta' }), ['A', 'Zeta']);
  assert.deepEqual(categoryChoices({ stored: ['A'], current: 'Other' }), ['A']);
  assert.equal(categoryValue('Other'), '');
});

test('non-string stored entries are ignored', () => {
  assert.deepEqual(categoryChoices({ stored: ['A', 3, null, ''] }), ['A']);
});

test('units: defaults by language, plus those in use, sorted and deduplicated', () => {
  const it = unitChoices({ ingredients: [{ unit: 'PZ' }, { unit: 'scatola' }, { unit: ' ' }], language: 'it' });
  // «PZ» is in use, so the default «pz» gives way to it and the stored spelling survives.
  const expected = [...DEFAULT_UNITS.it.filter(u => u !== 'pz'), 'PZ', 'scatola'].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(it, expected);
  assert.ok(!it.includes('pz'));
  assert.ok(unitChoices({ language: 'it', current: 'PZ' }).includes('PZ'));
  assert.deepEqual(unitChoices({ language: 'en', current: 'tub' }), [...DEFAULT_UNITS.en, 'tub'].sort((a, b) => a.localeCompare(b)));
});

test('countInCategory matches ignoring case and spaces', () => {
  const list = [{ category: 'Dairy' }, { category: ' dairy ' }, { category: 'Eggs' }, { category: 'Other' }];
  assert.equal(countInCategory(list, 'DAIRY'), 2);
  assert.equal(countInCategory(list, 'Nothing'), 0);
  assert.equal(countInCategory(list, ''), 0);
  assert.equal(DEFAULT_CATEGORIES.it.length, 3);
});

test('isBlankNewChoice: «+ New …» with nothing typed is refused; a real menu choice never is', () => {
  assert.equal(isBlankNewChoice(true, ''), true);
  assert.equal(isBlankNewChoice(true, '   '), true);
  assert.equal(isBlankNewChoice(true, undefined), true);
  assert.equal(isBlankNewChoice(true, 'Tray'), false);
  assert.equal(isBlankNewChoice(false, ''), false);
});
