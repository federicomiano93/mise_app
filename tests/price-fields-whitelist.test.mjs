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

// ── The four case keys (30 Sep 2026) follow the vatRate pattern exactly ──────────

const CASE_KEYS = ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit'];

test('the ingredient-prices rule accepts each case key', () => {
  for (const key of CASE_KEYS) assert.ok(PRICE_KEYS.includes(key), `ingredient-prices refuses "${key}"`);
});

test('the ingredients rule has NO case key, so none may be drained onto an ingredient', () => {
  for (const key of CASE_KEYS) {
    assert.equal(INGREDIENT_KEYS.includes(key), false, `ingredients rule unexpectedly lists "${key}"`);
    assert.equal(INGREDIENT_DRAINED_FIELDS.includes(key), false, `"${key}" would be written onto every ingredient`);
  }
  assert.equal(INGREDIENT_DRAINED_FIELDS.includes('vatRate'), false);
});

test('a case typed in the form reaches the price half and never the ingredient', () => {
  const data = {
    name: 'Eggs', supplierId: 'S1', priceUnit: 'pcs', pricePerUnit: 0.4,
    casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs',
  };
  const { ingredient, price } = splitPriceFields(data);
  for (const key of CASE_KEYS) {
    assert.equal(key in ingredient, false, `${key} reached the ingredient`);
    assert.ok(key in price, key);
  }
  for (const key of Object.keys(ingredient)) {
    if (PRICE_FIELDS.includes(key)) assert.ok(INGREDIENT_KEYS.includes(key), key);
  }
  for (const key of Object.keys(price)) assert.ok(PRICE_KEYS.includes(key), key);
});

// ── packCount (1 Oct 2026): product data, so it lives on the ingredient and nowhere near the money ──
test('packCount is on the ingredients whitelist and on neither price list', () => {
  assert.ok(INGREDIENT_KEYS.includes('packCount'), 'the ingredients rule must accept it');
  assert.equal(PRICE_KEYS.includes('packCount'), false, 'ingredient-prices never carries it');
  assert.equal(PRICE_FIELDS.includes('packCount'), false, 'splitPriceFields would send it to the price document');
  assert.equal(INGREDIENT_DRAINED_FIELDS.includes('packCount'), false, 'and it is not drained to null on every save');
});

test('packCount stays on the ingredient half when an ingredient is split', () => {
  const { ingredient, price } = splitPriceFields({ name: 'Flour', packCount: 4, packUnit: 'busta', unit: 'cartone', pricePerUnit: 2, priceUnit: 'kg' });
  assert.equal(ingredient.packCount, 4);
  assert.equal('packCount' in price, false);
  // a Singola after a Cartone writes null, which the rules accept
  assert.equal(splitPriceFields({ packCount: null }).ingredient.packCount, null);
});

test('every key the format adds to a payload is one the ingredients rule accepts', async () => {
  const { formatPatch } = await import('../js/pack-format.js');
  const fresh = { kind: 'single', count: null, inner: '', unit: 'sacco', packUnit: 'x' };
  for (const form of [
    { kind: 'carton', count: 4, inner: 'busta', cartonWord: 'cartone' },
    { kind: 'carton', count: 4, inner: '', cartonWord: 'case' },
  ]) {
    for (const key of Object.keys(formatPatch(fresh, form))) assert.ok(INGREDIENT_KEYS.includes(key), key);
  }
  const carton = { kind: 'carton', count: 4, inner: 'busta', unit: 'cartone', packUnit: 'busta' };
  for (const key of Object.keys(formatPatch(carton, { kind: 'single', count: null, inner: 'busta', cartonWord: 'cartone' }))) {
    assert.ok(INGREDIENT_KEYS.includes(key), key);
  }
});

// ── priceBasis (7 Oct 2026): what the typed price refers to — price document only, like vatRate ──
test('priceBasis is on the ingredient-prices whitelist, off the ingredients one, and never drained onto an ingredient', () => {
  assert.ok(PRICE_KEYS.includes('priceBasis'), 'ingredient-prices must accept it');
  assert.ok(PRICE_FIELDS.includes('priceBasis'), 'splitPriceFields must route it to the price document');
  assert.equal(INGREDIENT_KEYS.includes('priceBasis'), false, 'the ingredients rule has no such key');
  assert.equal(INGREDIENT_DRAINED_FIELDS.includes('priceBasis'), false, 'writing it null on an ingredient would refuse every save');
});

test('the price-history subcollection does not carry priceBasis', () => {
  const start = RULES.indexOf('/prices/{');
  assert.notEqual(start, -1);
  const m = RULES.slice(start).match(/hasOnly\(\[([\s\S]*?)\]\)/);
  assert.equal(m[1].includes('priceBasis'), false);
});
