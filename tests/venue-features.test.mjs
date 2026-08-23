// ⚠️⚠️ THE DIRECTION IS THE SAFETY ARGUMENT, AND THIS IS WHERE IT IS PINNED.
// js/venue-features.js reads both switches as `!== false`, so a location document
// that has never heard of these keys, one that failed to load, and one carrying a
// corrupt value ALL ANSWER ON. Only the literal boolean `false` turns a panel off.
//
// Written the other way round — `=== true` — a venue would lose its allergen panels
// the moment its document was incomplete, unread or malformed, and nothing on any
// screen would say why: the section would simply not be drawn. Allergens are the one
// part of this app that can send somebody to hospital, so an accident must fail
// towards showing them. `showStock` runs the same direction; `recipePhoto` runs the
// OPPOSITE one, deliberately, because it spends money.
//
// These four tests were proved able to fail before they were trusted: inverting the
// comparison in js/venue-features.js turns them red.

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
