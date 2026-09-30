// The ingredient card's choice menus: pins the wiring no DOM-less test can drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FORM = read('js/ingredient-record-form.js');

test('an empty category is still saved as "Other", and weight/unit come from the controls', () => {
  assert.match(FORM, /category: category\.read\(\) \|\| 'Other'/);
  assert.match(FORM, /weight: weight\.read\(\)/);
  assert.match(FORM, /unit: unit\.read\(\)/);
});

test('the card imports no feature folder, and receives its lists as parameters', () => {
  assert.doesNotMatch(FORM, /from '\.\/(orders|catalogue|foodcost|inventory)\//);
  assert.match(FORM, /categories = \[\], orderUnits = \[\]/);
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
