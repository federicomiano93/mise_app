// pack-case.test.mjs — a case of «buste» (30 Sep 2026): «Contiene 4 × busta da 2,5 kg».
// The size of ONE package is copied from the ingredient's weight INTO the case when the price
// is saved (caseItemUnit 'pack' + caseItemSize in kg or l), so a weight edited later, from a
// screen with no price section, cannot move a price nobody re-saved. And `packUnit`, the word
// for one package, on the order-unit side — meaningful only on a case of packages.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  caseRate, caseOf, storedCaseOf, pricePatch, packBaseOf, CASE_MODE, CASE_ITEM_UNITS, PACK_ITEM,
} from '../js/price-model.js';
import { unitCost } from '../js/order-cost.js';
import { packPrice, valueBlocker, casePackNote, NO_PACK } from '../js/inventory/inventory-value.js';

const AT = '2026-09-30T09:00:00.000Z';
const FORM = { priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' };
const patchFor = (weight, form = FORM) => pricePatch(form, AT, weight);

test('pack is a case unit and needs a stored size', () => {
  assert.ok(CASE_ITEM_UNITS.includes(PACK_ITEM));
  assert.equal(caseOf({ casePrice: 20, caseCount: 4, caseItemSize: null, caseItemUnit: 'pack' }), null);
  assert.deepEqual(caseOf({ casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' }),
    { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' });
});

test('packBaseOf reads a weight in the rate base, and nothing else', () => {
  assert.deepEqual(packBaseOf('2,5 kg'), { size: 2.5, priceUnit: 'kg' });
  assert.deepEqual(packBaseOf('500 g'), { size: 0.5, priceUnit: 'kg' });
  assert.deepEqual(packBaseOf('750 ml'), { size: 0.75, priceUnit: 'l' });
  assert.deepEqual(packBaseOf('1 l'), { size: 1, priceUnit: 'l' });
  for (const w of ['', undefined, 'sacco', '6x1kg', '50 cl']) assert.equal(packBaseOf(w), null, String(w));
});

test('20 for 4 × a 2.5 kg package is 2 a kilo; the stored size and unit decide', () => {
  const c = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  assert.deepEqual(caseRate(c, 'kg'), { priceUnit: 'kg', pricePerUnit: 2 });
  assert.deepEqual(caseRate({ ...c, casePrice: 12, caseCount: 6, caseItemSize: 0.5 }, 'l'), { priceUnit: 'l', pricePerUnit: 4 });
  assert.equal(caseRate(c), null, 'no basis, no rate');
  assert.equal(caseRate(c, 'pcs'), null);
  assert.equal(caseRate({ ...c, caseItemSize: null }, 'kg'), null);
});

test('the patch copies the package size in the base of the weight, whatever unit it was typed in', () => {
  let p = patchFor('2.5 kg');
  assert.deepEqual([p.priceUnit, p.pricePerUnit, p.caseItemUnit, p.caseItemSize, p.casePrice], ['kg', 2, 'pack', 2.5, 20]);
  p = patchFor('500 g');
  assert.deepEqual([p.priceUnit, p.pricePerUnit, p.caseItemSize], ['kg', 10, 0.5]);
  p = pricePatch({ ...FORM, casePrice: 12, caseCount: 6 }, AT, '500 ml');
  assert.deepEqual([p.priceUnit, p.pricePerUnit, p.caseItemSize], ['l', 4, 0.5]);
});

test('a weight that cannot be read gives no price, all four case keys null', () => {
  for (const weight of ['', undefined, 'sacco', '6x1kg']) {
    const p = patchFor(weight);
    assert.equal(p.pricePerUnit, null);
    for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) assert.equal(p[key], null);
  }
});

test('a size typed into the (hidden) size box never wins over the weight', () => {
  assert.equal(patchFor('2.5 kg', { ...FORM, caseItemSize: '99' }).caseItemSize, 2.5);
});

test('⚠️ the stored case does not depend on the weight edited afterwards', () => {
  const price = patchFor('2.5 kg');
  assert.notEqual(storedCaseOf(price), null);
  // nothing about the ingredient's weight is an input any more
  assert.equal(unitCost({ unit: 'kg', weight: '3 kg' }, price), 2);
  assert.equal(unitCost({ unit: 'kg', weight: 'sacco' }, price), 2);
  assert.equal(unitCost({ unit: 'cartone', weight: '3 kg' }, price), 20);
  assert.equal(unitCost({ unit: 'cartone' }, price), 20);
});

test('a rate typed since (old phone) makes the pack case stale', () => {
  assert.equal(storedCaseOf({ ...patchFor('2.5 kg'), pricePerUnit: 3 }), null);
  assert.equal(storedCaseOf({ ...patchFor('2.5 kg'), caseItemSize: null }), null);
});

// ── Orders ───────────────────────────────────────────────────────────────────

const price = patchFor('2.5 kg');
const busta = (unit, extra = {}) => ({ unit, weight: '2.5 kg', packUnit: 'busta', ...extra });

test('ordered by weight, a pack case is the rate times that unit', () => {
  assert.equal(unitCost(busta('kg'), price), 2);
  assert.equal(unitCost(busta('g'), price), 0.002);
});

test('the package word and piece words are ONE package: case price / count', () => {
  assert.equal(unitCost(busta('busta'), price), 5);
  assert.equal(unitCost(busta(' Busta '), price), 5);
  assert.equal(unitCost(busta('busta.'), price), 5);
  assert.equal(unitCost(busta('Busta', { packUnit: ' busta. ' }), price), 5);
  assert.equal(unitCost(busta('pz'), price), 5);
  assert.equal(unitCost(busta('pezzi'), price), 5);
});

test('case words and an empty unit are the whole case', () => {
  assert.equal(unitCost(busta('cartone'), price), 20);
  assert.equal(unitCost(busta(''), price), 20);
});

test('a package declared with a CASE word is asked first: «scatola» ordered by scatola is one package', () => {
  assert.equal(unitCost({ unit: 'scatola', weight: '2.5 kg', packUnit: 'scatola' }, price), 5);
  assert.equal(unitCost({ unit: 'box', packUnit: 'box' }, price), 5);
  assert.equal(unitCost({ unit: 'scatola', packUnit: 'busta' }, price), 20, 'another word: still the case');
});

test('another word on a case of several is null; on a case of one it is the case price', () => {
  assert.equal(unitCost(busta('sacco'), price), null);
  const one = pricePatch({ ...FORM, caseCount: 1 }, AT, '2.5 kg');
  assert.equal(unitCost(busta('sacco'), one), 20);
});

// ── The package word means nothing on any other case ────────────────────────

test('⚠️ eggs: a «vaschetta» of 360 g ordered by vaschetta from a case of 60 pieces at 12 is null, not 0.20', () => {
  const eggs = { casePrice: 12, caseCount: 60, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.2 };
  assert.equal(unitCost({ unit: 'vaschetta', weight: '360 g', packUnit: 'vaschetta' }, eggs), null);
  assert.equal(unitCost({ unit: 'pz', packUnit: 'vaschetta' }, eggs), 0.2, 'a piece word still counts');
  assert.equal(unitCost({ unit: 'cartone', packUnit: 'vaschetta' }, eggs), 12);
});

test('⚠️ a «sacco» of 5 kg ordered by sacco from a case of 10 × 1 kg is null, not the price of 1 kg', () => {
  const flour = { casePrice: 20, caseCount: 10, caseItemSize: 1, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };
  assert.equal(unitCost({ unit: 'sacco', weight: '5 kg', packUnit: 'sacco' }, flour), null);
  assert.equal(unitCost({ unit: 'busta', packUnit: 'busta' }, flour), null);
  assert.equal(unitCost({ unit: 'kg', packUnit: 'sacco' }, flour), 2);
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

test('the stocktake ignores a weight edited afterwards: the case stands on its stored size', () => {
  const ing = { id: 'F', unit: 'cartone', weight: 'sacco', packUnit: 'busta', ...price };
  assert.equal(packPrice({}, ing, false), 20);
  assert.equal(valueBlocker({}, ing, false), null);
});

test('a stale pack case falls back to the typed rate and its pack weight', () => {
  const ing = { id: 'F', unit: 'kg', weight: 'sacco', ...price, pricePerUnit: 3 };
  assert.equal(valueBlocker({}, ing, false), NO_PACK);
});
