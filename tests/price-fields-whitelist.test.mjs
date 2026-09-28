// The price keys the app writes must be keys the RULES accept, on both documents.
//
// ⚠️ WRITTEN AFTER A NEAR MISS (28 Sep 2026): `vatRate` joined PRICE_FIELDS, and
// splitPriceFields() drains every one of those onto the INGREDIENT document as null.
// The `ingredients` rule whitelists its keys and has no `vatRate`, so every ingredient
// save — for every role — would have been refused, with the whole suite green: the
// rules checks write hand-made documents, never what the app actually sends. This
// file compares the two directly, reading the whitelists out of firestore.rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRICE_FIELDS, INGREDIENT_DRAINED_FIELDS, splitPriceFields } from '../js/price-model.js';

const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

// The first hasOnly([...]) list inside `match /<path> {`.
function whitelistOf(matchPath) {
  const start = RULES.indexOf(`match ${matchPath} {`);
  assert.notEqual(start, -1, `firestore.rules has no "match ${matchPath}"`);
  const m = RULES.slice(start).match(/hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(m, `no hasOnly([...]) under ${matchPath}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

const INGREDIENT_KEYS = whitelistOf('/ingredients/{id}');
const PRICE_KEYS = whitelistOf('/ingredient-prices/{id}');

test('the whitelists were found and look like themselves', () => {
  assert.ok(INGREDIENT_KEYS.includes('name') && INGREDIENT_KEYS.includes('supplierId'));
  assert.ok(PRICE_KEYS.includes('pricePerUnit') && PRICE_KEYS.includes('vatRate'));
});

test('every price key drained onto an ingredient is one the ingredients rule accepts', () => {
  for (const key of INGREDIENT_DRAINED_FIELDS) {
    assert.ok(INGREDIENT_KEYS.includes(key), `ingredients rule refuses "${key}" — every ingredient save would fail`);
  }
});

test('every price key is one the ingredient-prices rule accepts', () => {
  for (const key of PRICE_FIELDS) {
    assert.ok(PRICE_KEYS.includes(key), `ingredient-prices rule refuses "${key}"`);
  }
});

test('vatRate never reaches the ingredient document, with or without a rate typed', () => {
  for (const data of [
    { name: 'Flour', supplierId: 'S1' },
    { name: 'Flour', supplierId: 'S1', priceUnit: 'kg', pricePerUnit: 1.8, vatRate: 4 },
    { name: 'Flour', supplierId: 'S1', priceUnit: 'kg', pricePerUnit: 1.8, vatRate: null },
  ]) {
    const { ingredient, price } = splitPriceFields(data);
    assert.equal('vatRate' in ingredient, false);
    for (const key of Object.keys(ingredient)) {
      if (PRICE_FIELDS.includes(key)) assert.ok(INGREDIENT_KEYS.includes(key), key);
    }
    for (const key of Object.keys(price)) assert.ok(PRICE_KEYS.includes(key), key);
  }
});

test('the vatRate typed goes to the price half', () => {
  const { price } = splitPriceFields({ name: 'Flour', priceUnit: 'kg', pricePerUnit: 1.8, vatRate: 4 });
  assert.equal(price.vatRate, 4);
});
