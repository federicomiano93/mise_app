// pack-case.test.mjs — a case of «buste» (30 Sep 2026): «Contiene 4 × busta da 2,5 kg», where the
// size of one package is read from the ingredient's own WEIGHT at compute time, never stored
// beside the case. And `packUnit`, the word for one package, on the order-unit side.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  caseRate, caseOf, storedCaseOf, pricePatch, CASE_MODE, CASE_ITEM_UNITS, PACK_ITEM,
} from '../js/price-model.js';
import { unitCost } from '../js/order-cost.js';
import { packPrice, valueBlocker, casePackNote, NO_PACK } from '../js/inventory/inventory-value.js';

const AT = '2026-09-30T09:00:00.000Z';
const CASE = { casePrice: 20, caseCount: 4, caseItemSize: null, caseItemUnit: 'pack' };

test('pack is a case unit, sized by nothing stored', () => {
  assert.ok(CASE_ITEM_UNITS.includes(PACK_ITEM));
  assert.deepEqual(caseOf({ ...CASE, caseItemSize: 999 }),
    { casePrice: 20, caseCount: 4, caseItemSize: null, caseItemUnit: 'pack' });
});

test('20 for 4 × «busta da 2,5 kg» is 2 a kilo', () => {
  assert.deepEqual(caseRate(CASE, '2.5 kg'), { priceUnit: 'kg', pricePerUnit: 2 });
  assert.deepEqual(caseRate(CASE, '2,5kg'), { priceUnit: 'kg', pricePerUnit: 2 });
});

test('grams price per kilo, millilitres and litres per litre', () => {
  assert.deepEqual(caseRate(CASE, '500 g'), { priceUnit: 'kg', pricePerUnit: 10 });
  assert.deepEqual(caseRate({ ...CASE, casePrice: 12, caseCount: 6 }, '1 l'), { priceUnit: 'l', pricePerUnit: 2 });
  assert.deepEqual(caseRate({ ...CASE, casePrice: 12, caseCount: 6 }, '500 ml'), { priceUnit: 'l', pricePerUnit: 4 });
});

test('a weight that cannot be read gives no price, never a guess', () => {
  for (const weight of ['', undefined, null, 'sacco', '6x1kg', '50 cl', 'abc']) {
    assert.equal(caseRate(CASE, weight), null, String(weight));
  }
  assert.equal(caseRate(CASE), null);
});

test('the patch of a pack case stores the derived rate and no size', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemSize: '7', caseItemUnit: 'pack' }, AT, '2.5 kg');
  assert.equal(p.priceUnit, 'kg');
  assert.equal(p.pricePerUnit, 2);
  assert.equal(p.caseItemUnit, 'pack');
  assert.equal(p.caseItemSize, null);
  assert.equal(p.casePrice, 20);
});

test('a pack case with no readable weight is «no price», all four case keys null', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' }, AT, 'sacco');
  assert.equal(p.pricePerUnit, null);
  assert.equal(p.priceUnit, null);
  for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) assert.equal(p[key], null);
});

test('storedCaseOf follows the weight: a weight edited since the save makes the case stale', () => {
  const price = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' }, AT, '2.5 kg');
  assert.notEqual(storedCaseOf(price, { weight: '2.5 kg' }), null);
  assert.equal(storedCaseOf(price, { weight: '3 kg' }), null);
  assert.equal(storedCaseOf(price, { weight: 'sacco' }), null);
  assert.equal(storedCaseOf(price, {}), null);
  assert.notEqual(storedCaseOf({ ...price, weight: '2.5 kg' }), null, 'merged object carries its own weight');
});

// ── Orders ───────────────────────────────────────────────────────────────────

const price = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' }, AT, '2.5 kg');
const busta = (unit, extra = {}) => ({ unit, weight: '2.5 kg', packUnit: 'busta', ...extra });

test('ordered by weight, a pack case is the rate times that unit', () => {
  assert.equal(unitCost(busta('kg'), price), 2);
  assert.equal(unitCost(busta('g'), price), 0.002);
});

test('the package word and piece words are ONE package: case price / count', () => {
  assert.equal(unitCost(busta('busta'), price), 5);
  assert.equal(unitCost(busta(' Busta '), price), 5);
  assert.equal(unitCost(busta('pz'), price), 5);
  assert.equal(unitCost(busta('pezzi'), price), 5);
});

test('case words and an empty unit are the whole case', () => {
  assert.equal(unitCost(busta('cartone'), price), 20);
  assert.equal(unitCost(busta(''), price), 20);
});

test('another word on a case of several is null; on a case of one it is the case price', () => {
  assert.equal(unitCost(busta('sacco'), price), null);
  const one = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 1, caseItemUnit: 'pack' }, AT, '2.5 kg');
  assert.equal(unitCost(busta('sacco'), one), 20);
});

test('a stale pack case (weight changed) is ignored: the typed rate wins', () => {
  assert.equal(unitCost({ unit: 'kg', weight: '3 kg', packUnit: 'busta' }, price), 2);
  assert.equal(unitCost({ unit: 'cartone', weight: '3 kg' }, price), 6);
});

test('the package word counts as one item for an ordinary (non-pack) case too', () => {
  const flour = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };
  assert.equal(unitCost({ unit: 'busta', packUnit: 'busta' }, flour), 5);
  assert.equal(unitCost({ unit: 'busta' }, flour), null, 'without the packUnit it is still doubt');
  assert.equal(unitCost({ unit: 'busta', packUnit: '' }, flour), null);
  assert.equal(unitCost({ unit: '', packUnit: '' }, flour), 20, 'an empty packUnit never matches an empty unit');
});

test('without a case, packUnit changes nothing', () => {
  assert.equal(unitCost({ weight: '25kg', packUnit: 'sacco', unit: 'sacco' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), 45);
});

// ── The stocktake ────────────────────────────────────────────────────────────

test('the stocktake values one busta and reads «€5.00 per busta»', () => {
  const ing = { id: 'F', ...busta('busta'), ...price };
  assert.equal(packPrice({}, ing, false), 5);
  assert.equal(valueBlocker({}, ing, false), null);
  assert.deepEqual(casePackNote(ing), { key: 'inv.packCasePer', value: 5, unit: 'busta' });
});

test('a pack case whose weight became unreadable has no value in the stocktake, not a guess', () => {
  const ing = { id: 'F', unit: 'busta', weight: 'sacco', packUnit: 'busta', ...price };
  assert.equal(casePackNote(ing), null);
  assert.equal(packPrice({}, ing, false), null);
  assert.equal(valueBlocker({}, ing, false), NO_PACK, 'the stale case is ignored: the typed rate needs a readable pack weight');
});
