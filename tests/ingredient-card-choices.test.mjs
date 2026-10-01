// The ingredient card's choice menus: pins the wiring no DOM-less test can drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FORM = read('js/ingredient-record-form.js');

test('an empty category is still saved as "Other", and the weight comes from its control', () => {
  assert.match(FORM, /category: category\.read\(\) \|\| 'Other'/);
  assert.match(FORM, /weight: weight\.read\(\)/);
});

test('there is no «Unità d\'ordine» menu: the unit is written by the format, or left alone', () => {
  assert.doesNotMatch(FORM, /const unit = choiceControl|unit\.read\(\)|unit\.node|orderUnits/);
  // a NEW item gets an empty unit (or its loose-price word); an existing one sends none unless touched
  assert.match(FORM, /\.\.\.\(item \? \{\} : \{ unit: looseWord \}\),\s*\.\.\.formatKeys,/);
  assert.doesNotMatch(FORM, /^\s*unit: [a-z]+\.read\(\),$/m);
});

test('the card imports no feature folder, and receives its lists as parameters', () => {
  assert.doesNotMatch(FORM, /from '\.\/(orders|catalogue|foodcost|inventory)\//);
  assert.match(FORM, /categories = \[\], packs = \[\]/);
});

test('both callers hand the lists in', () => {
  assert.match(read('js/orders/registry.js'), /categories: data\.categories\?\.\(item\?\.category\)/);
  assert.match(read('js/ingredient-create.js'), /categories: categoryChoices\(\{ stored: storedCategories/);
});

test('the rules whitelist and cap the category list', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /'ingredientCategories'/);
  assert.match(rules, /ingredientCategories\.size\(\) <= 100/);
});
