// Routing probe: pins the default-ON direction documented at the top of
// js/venue-features.js — `!== false` means a location document that has never
// heard of these keys, one that failed to load, and one carrying a corrupt
// value all answer ON. Only the literal boolean `false` turns a panel off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allergensOn, nutritionOn } from '../js/venue-features.js';

test('allergensOn: an empty document, null, and a corrupt value all answer true', () => {
  for (const doc of [{}, null, undefined, 'nonsense', 42, [], { showAllergens: 'false' },
    { showAllergens: 0 }, { showAllergens: '' }, { showAllergens: null }]) {
    assert.equal(allergensOn(doc), true, `${JSON.stringify(doc)} must not hide allergens`);
  }
});

test('allergensOn: only an explicit false turns it off', () => {
  assert.equal(allergensOn({ showAllergens: false }), false);
});

test('nutritionOn: an empty document, null, and a corrupt value all answer true', () => {
  for (const doc of [{}, null, undefined, 'nonsense', 42, [], { showNutrition: 'false' },
    { showNutrition: 0 }, { showNutrition: '' }, { showNutrition: null }]) {
    assert.equal(nutritionOn(doc), true, `${JSON.stringify(doc)} must not hide nutrition`);
  }
});

test('nutritionOn: only an explicit false turns it off', () => {
  assert.equal(nutritionOn({ showNutrition: false }), false);
});
