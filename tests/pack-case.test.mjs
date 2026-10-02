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

// ⚠️ REVERSED by the 2nd review of 1 Oct 2026. «Tray is not one egg» held while a package word could mean anything;
// now it is how the card says «one item»: a package word equal to the unit is ONE item of a case of pieces
// (what a Singola leaves behind after a Cartone). A tray that is NOT one egg must not be declared as the package.
test('⚠️ eggs: a «vaschetta» ordered by vaschetta from a case of 60 pieces at 12 is ONE item, 0.20 (was: no price)', () => {
  const eggs = { casePrice: 12, caseCount: 60, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.2 };
  assert.equal(unitCost({ unit: 'vaschetta', weight: '360 g', packUnit: 'vaschetta' }, eggs), 0.2);
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

// ⚠️ Review of 30 Sep 2026, REVISED by the 2nd review of 1 Oct 2026: on an explicit-size case (kilos), an
// order unit equal to the ingredient's package word is ambiguous even when it is also a CASE word. On a case
// of PIECES it is no longer: the package word is ONE item (what a Singola leaves behind after a Cartone), so a
// box priced «100 pz at 30» declared as a «scatola» and ordered by «scatola» is 0.30 a scatola.
test('a package word that is also a case word is ONE item on a case of pieces, and no price on a case of kilos', () => {
  const boxes = { priceUnit: 'pcs', pricePerUnit: 0.3, casePrice: 30, caseCount: 100, caseItemSize: null, caseItemUnit: 'pcs' };
  assert.equal(unitCost({ unit: 'scatola', packUnit: 'scatola' }, boxes), 0.3);
  assert.equal(unitCost({ unit: 'scatola.', packUnit: 'Scatola' }, boxes), 0.3);
  // Without a package word «scatola» is only a case word: one case.
  assert.equal(unitCost({ unit: 'scatola' }, boxes), 30);
  assert.equal(unitCost({ unit: 'pz', packUnit: 'scatola' }, boxes), 0.3);

  const flour = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 10, caseItemSize: 1, caseItemUnit: 'kg' };
  assert.equal(unitCost({ unit: 'confezione', packUnit: 'confezione', weight: '1 kg' }, flour), null);
  // A case of ONE item is never ambiguous.
  const single = { priceUnit: 'pcs', pricePerUnit: 30, casePrice: 30, caseCount: 1, caseItemSize: null, caseItemUnit: 'pcs' };
  assert.equal(unitCost({ unit: 'scatola', packUnit: 'scatola' }, single), 30);
});

// ── A case of ONE package, and a stored size written back verbatim (1 Oct 2026) ──
// «Singola» with a weight that reads is a case of one: 20 for a 25 kg sack is 0.80 a kilo.
test('a case of one package prices the pack: 20 for a 25 kg sack is 0.80 a kilo, and the sack costs 20', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 1, caseItemUnit: 'pack' }, AT, '25kg');
  assert.deepEqual([p.priceUnit, p.pricePerUnit, p.caseCount, p.caseItemUnit, p.caseItemSize], ['kg', 0.8, 1, 'pack', 25]);
  assert.ok(storedCaseOf(p), 'a case of one stands on its own rate');
  for (const unit of ['', 'sacco', 'busta', 'pz']) {
    assert.equal(unitCost({ unit, weight: '25kg' }, p), 20, `ordered in "${unit}"`);
  }
  assert.equal(unitCost({ unit: 'kg', weight: '25kg' }, p), 0.8, 'ordered by weight it is the rate');
});

test('20 for 4 × 2.5 kg is 2 a kilo and 5 a busta, ordered either way', () => {
  const p = patchFor('2.5kg');
  assert.equal(p.pricePerUnit, 2);
  const card = { unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
  assert.equal(unitCost(card, p), 20);
  assert.equal(unitCost({ ...card, unit: 'busta' }, p), 5);
});

test('packBasis makes the stored size authoritative: the weight on the card is not read', () => {
  const stored = { priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack', packBasis: 'kg' };
  for (const weight of ['2.5kg', '3kg', '', 'sacco', undefined]) {
    const p = pricePatch(stored, AT, weight);
    assert.deepEqual([p.priceUnit, p.pricePerUnit, p.caseItemSize], ['kg', 2, 2.5], String(weight));
  }
  // a basis that is not kg or l is ignored, and the weight rules again (here: unreadable → no price)
  assert.equal(pricePatch({ ...stored, packBasis: 'pcs' }, AT, '').pricePerUnit, null);
  assert.equal(pricePatch({ ...stored, packBasis: 'l' }, AT, '').priceUnit, 'l');
});
