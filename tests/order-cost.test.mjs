// Unit tests for js/order-cost.js (P15).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitCost, orderCost } from '../js/order-cost.js';

// ── unitCost ─────────────────────────────────────────────────────────────

test('priceUnit pcs: unitCost is pricePerUnit itself, no conversion', () => {
  assert.equal(unitCost({ weight: '' }, { priceUnit: 'pcs', pricePerUnit: 0.9 }), 0.9);
});

test('priceUnit kg: unitCost is pricePerUnit × the pack weight in kilos', () => {
  assert.equal(unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), 45);
});

test('priceUnit l: the same reading, litres treated as kilos', () => {
  assert.equal(unitCost({ weight: '1L' }, { priceUnit: 'l', pricePerUnit: 1.2 }), 1.2);
});

test('an unreadable pack weight -> null, never a guess', () => {
  assert.equal(unitCost({ weight: 'sacco' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), null);
  assert.equal(unitCost({ weight: '' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), null);
  assert.equal(unitCost({}, { priceUnit: 'kg', pricePerUnit: 1.8 }), null);
});

test('no price at all -> null', () => {
  assert.equal(unitCost({ weight: '25kg' }, null), null);
  assert.equal(unitCost({ weight: '25kg' }, undefined), null);
  assert.equal(unitCost({ weight: '25kg' }, {}), null);
  assert.equal(unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: null }), null);
  assert.equal(unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 0 }), null);
  assert.equal(unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 'free' }), null);
});

test('an invalid priceUnit -> null, never a silent fallback', () => {
  assert.equal(unitCost({ weight: '25kg' }, { priceUnit: 'crate', pricePerUnit: 5 }), null);
  assert.equal(unitCost({ weight: '25kg' }, { pricePerUnit: 5 }), null);
});

// ── orderCost ────────────────────────────────────────────────────────────

test('qty 0 or non-numeric: not a line at all, excluded from every count', () => {
  const result = orderCost([
    { qty: 0, unitCost: 5, vatRate: 4 },
    { qty: 'lots', unitCost: 5, vatRate: 4 },
    { qty: -3, unitCost: 5, vatRate: 4 },
    { qty: null, unitCost: 5, vatRate: 4 },
  ]);
  assert.deepEqual(result, { net: 0, vatByRate: {}, gross: 0, missingPrice: 0, missingVat: 0, costed: 0 });
});

test('a missing price: excluded from net, counted, never treated as £0', () => {
  const result = orderCost([
    { qty: 3, unitCost: null, vatRate: 4 },
    { qty: 2, unitCost: 10, vatRate: 4 },
  ]);
  assert.equal(result.missingPrice, 1);
  assert.equal(result.net, 20); // only the priced line
  assert.equal(result.vatByRate[4], 0.8);
});

test('a priced line with no VAT rate: still added to net, counted in missingVat, never taxed at 0', () => {
  const result = orderCost([
    { qty: 4, unitCost: 45, vatRate: null },
  ]);
  assert.equal(result.net, 180);
  assert.deepEqual(result.vatByRate, {});
  assert.equal(result.missingVat, 1);
  assert.equal(result.gross, 180); // no VAT counted, but the net is real
});

test('a genuine 0% VAT rate reads exactly like any other stated rate — never confused with "not stated"', () => {
  const result = orderCost([{ qty: 2, unitCost: 10, vatRate: 0 }]);
  assert.equal(result.missingVat, 0);
  assert.deepEqual(result.vatByRate, { 0: 0 });
  assert.equal(result.gross, 20);
});

test('mixed rates: one bucket per rate, summed independently', () => {
  const result = orderCost([
    { qty: 2, unitCost: 10, vatRate: 4 },   // net 20, vat 0.8
    { qty: 1, unitCost: 100, vatRate: 22 }, // net 100, vat 22
    { qty: 3, unitCost: 5, vatRate: 4 },    // net 15, vat 0.6
  ]);
  assert.equal(result.net, 135);
  assert.equal(result.vatByRate[4], 1.4);
  assert.equal(result.vatByRate[22], 22);
  assert.equal(result.gross, 135 + 1.4 + 22);
  assert.equal(result.missingPrice, 0);
  assert.equal(result.missingVat, 0);
});

test('pcs and kg lines together, exactly as unitCost() would hand them over', () => {
  const lines = [
    { qty: 4, unitCost: unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), vatRate: 4 },
    { qty: 2, unitCost: unitCost({}, { priceUnit: 'pcs', pricePerUnit: 0.9 }), vatRate: 4 },
  ];
  const result = orderCost(lines);
  assert.equal(result.net, 4 * 45 + 2 * 0.9);
});

test('empty / missing lines -> all zero, never throws', () => {
  assert.deepEqual(orderCost([]), { net: 0, vatByRate: {}, gross: 0, missingPrice: 0, missingVat: 0, costed: 0 });
  assert.deepEqual(orderCost(undefined), { net: 0, vatByRate: {}, gross: 0, missingPrice: 0, missingVat: 0, costed: 0 });
  assert.deepEqual(orderCost(null), { net: 0, vatByRate: {}, gross: 0, missingPrice: 0, missingVat: 0, costed: 0 });
});

// ⚠️ The order unit decides what the quantity counts (review of 28 Sep 2026): a
// guess here is a total 25 times too high or 6 times too low that looks right.
test('a kg price ordered IN kilos costs the kilos, not whole packs', () => {
  assert.equal(unitCost({ weight: '25kg', unit: 'kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), 1.8);
  assert.equal(unitCost({ weight: '25kg', unit: 'g' }, { priceUnit: 'kg', pricePerUnit: 2 }), 0.002);
  assert.equal(unitCost({ weight: '', unit: 'L' }, { priceUnit: 'l', pricePerUnit: 1.2 }), 1.2);
});

test('a kg price ordered by the sack costs the sack', () => {
  assert.equal(unitCost({ weight: '25kg', unit: 'sacchi' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), 45);
  assert.equal(unitCost({ weight: '6x1kg', unit: 'casse' }, { priceUnit: 'kg', pricePerUnit: 2 }), 12);
  assert.equal(unitCost({ weight: 'sacco', unit: 'sacchi' }, { priceUnit: 'kg', pricePerUnit: 2 }), null);
});

test('a per-piece price is used only when one ordered unit is plainly one piece', () => {
  assert.equal(unitCost({ weight: '1kg', unit: 'pz' }, { priceUnit: 'pcs', pricePerUnit: 9.5 }), 9.5);
  assert.equal(unitCost({ weight: '', unit: '' }, { priceUnit: 'pcs', pricePerUnit: 0.35 }), 0.35);
  assert.equal(unitCost({ weight: '6x1kg', unit: 'casse' }, { priceUnit: 'pcs', pricePerUnit: 2 }), null);
  assert.equal(unitCost({ weight: '', unit: 'kg' }, { priceUnit: 'pcs', pricePerUnit: 2 }), null);
});

test('costed counts the lines that got a price', () => {
  const r = orderCost([
    { qty: 2, unitCost: 10, vatRate: 4 },
    { qty: 1, unitCost: null, vatRate: 4 },
    { qty: 3, unitCost: 1, vatRate: null },
  ]);
  assert.equal(r.costed, 2);
  assert.equal(r.missingPrice, 1);
  assert.equal(r.missingVat, 1);
});

test('weight words are read in the forms people type, in both languages', () => {
  for (const unit of ['kili', 'Kg.', 'chili', 'kilo']) {
    assert.equal(unitCost({ weight: '25kg', unit }, { priceUnit: 'kg', pricePerUnit: 1.8 }), 1.8, unit);
  }
  assert.equal(unitCost({ weight: '25kg', unit: 'gr' }, { priceUnit: 'kg', pricePerUnit: 2 }), 0.002);
  assert.equal(unitCost({ weight: '', unit: 'litri' }, { priceUnit: 'l', pricePerUnit: 1.2 }), 1.2);
});

// ── «Cartone» (1 Oct 2026, review): current product data × the stored cost of ONE item ──────────
// An employee can change the count, the package word or the weight from a screen with no price
// section; the frozen case then no longer matches. The readers therefore compute from what the card
// says NOW: cost of ONE item × the items in one ORDERED unit (packCount for the carton word, 1 for
// the package word). Items with no packCount are priced exactly as before (readers-regression-grid).
import { itemsPerOrderedUnit, validPackCount, costPerItem, lineUnitCost } from '../js/order-cost.js';

const CARTON_CARD = { unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };

test('2(a) a one-pack case of 5 turned into a carton of 4 costs 20, not 5', () => {
  const oneBag = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 5, caseCount: 1, caseItemSize: 2.5, caseItemUnit: 'pack' };
  assert.equal(unitCost(CARTON_CARD, oneBag), 20);
  assert.equal(unitCost({ ...CARTON_CARD, unit: 'busta' }, oneBag), 5, 'and one busta is still 5');
});

test('2(b) a pack case of 4 turned into a Singola prices one bag as 5, not the whole 20', () => {
  const packCase = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  // what the card writes for Singola after Cartone: no packCount, the carton word replaced by the package word
  const single = { unit: 'busta', packUnit: 'busta', weight: '2.5kg' };
  assert.equal(unitCost(single, packCase), 5);
  // the carton itself is unchanged
  assert.equal(unitCost(CARTON_CARD, packCase), 20);
});

test('2(c) a typed 0.40 a piece turned into a carton of 50 costs 20, not 0.40', () => {
  const perPiece = { priceUnit: 'pcs', pricePerUnit: 0.4 };
  const card = { unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '' };
  assert.equal(unitCost(card, perPiece), 20);
  assert.equal(unitCost({ ...card, unit: 'pezzo' }, perPiece), 0.4);
});

test('3 a legacy «6x1kg» weight with packCount 6 is NOT multiplied twice: 12, not 72', () => {
  const card = { unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1kg' };
  assert.equal(unitCost(card, { priceUnit: 'kg', pricePerUnit: 2 }), 12);
  assert.equal(costPerItem(card, { priceUnit: 'kg', pricePerUnit: 2 }), null, 'one item\'s weight is unknown');
  // a pieces rate on a multiplier text stays ambiguous, as it always was
  assert.equal(unitCost(card, { priceUnit: 'pcs', pricePerUnit: 0.4 }), null);
  // «sacco» is no weight either
  assert.equal(unitCost({ ...card, weight: 'sacco' }, { priceUnit: 'kg', pricePerUnit: 2 }), null);
});

test('4th review 3: a piece that is not the item (eggs on a 360 g tray) has no carton price', () => {
  const eggs = { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const card = { unit: 'cartone', packUnit: 'vaschetta', packCount: 10, weight: '360g' };
  assert.equal(costPerItem(card, eggs), null, 'one tray is not one egg');
  assert.equal(unitCost(card, eggs), null);
  assert.equal(lineUnitCost(card, eggs, 'vaschetta'), null);
  // the piece IS the item when the price remembers the card's own weight, or no weight at all
  assert.equal(unitCost({ ...card, weight: '60g' }, eggs), 2.5);
  assert.equal(unitCost(card, { priceUnit: 'pcs', pricePerUnit: 0.25 }), 2.5);
  assert.equal(unitCost({ ...card, weight: '' }, eggs), 2.5, 'no weight on the card: the piece is the item');
  // litres read 1:1 as kilos
  assert.equal(unitCost({ ...card, weight: '750ml' }, { priceUnit: 'pcs', pricePerUnit: 3, unitWeightKg: 0.75 }), 30);
  // and an item with NO packCount reads exactly as before
  assert.equal(unitCost({ unit: 'vaschetta', weight: '360g' }, eggs), 0.25);
});

test('a per-kilo rate × one item\'s weight × the items in the unit', () => {
  const perKg = { priceUnit: 'kg', pricePerUnit: 2 };
  assert.equal(unitCost(CARTON_CARD, perKg), 20, '2 a kilo × 2.5 kg × 4');
  assert.equal(unitCost({ ...CARTON_CARD, unit: 'busta' }, perKg), 5);
  assert.equal(unitCost({ ...CARTON_CARD, weight: '500g' }, perKg), 4, 'grams read as thousandths of a kilo');
  assert.equal(unitCost({ ...CARTON_CARD, unit: 'kg' }, perKg), 2, 'ordered by weight it is still the plain rate');
});

test('a case of pieces, priced per item, follows the count the card says now', () => {
  const pcsCase = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
  const card = { unit: 'cartone', packUnit: 'pezzo', packCount: 40, weight: '' };
  assert.equal(unitCost(card, pcsCase), 16, '40 × 0.40 — not the 20 the old 50 cost');
  assert.equal(unitCost({ ...card, packCount: 50 }, pcsCase), 20);
});

test('itemsPerOrderedUnit: the carton word counts packCount, the package or a piece word counts one, no packCount is null', () => {
  assert.equal(itemsPerOrderedUnit(CARTON_CARD), 4);
  assert.equal(itemsPerOrderedUnit({ ...CARTON_CARD, unit: 'Busta' }), 1);
  assert.equal(itemsPerOrderedUnit({ ...CARTON_CARD, unit: 'pz' }), 1);
  assert.equal(itemsPerOrderedUnit({ unit: 'cartone', packUnit: 'busta' }), null);
  for (const packCount of [0, -1, 2.5, '4', null, undefined, NaN]) {
    assert.equal(validPackCount({ packCount }), null, String(packCount));
  }
});

test('the per-item price storage (pcs rate + piece weight) prices every way', () => {
  // an egg at 0.25 a piece, 60 g: a carton of 30 costs 7.50; one egg 0.25; per kilo it is 4.1667
  const egg = { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const card = { unit: 'cartone', packUnit: 'uovo', packCount: 30, weight: '60g' };
  assert.equal(unitCost(card, egg), 7.5);
  assert.equal(unitCost({ ...card, unit: 'uovo' }, egg), 0.25);
});
