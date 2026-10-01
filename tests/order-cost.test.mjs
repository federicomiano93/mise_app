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

// ── «Cartone» saved by the card (1 Oct 2026): packCount, and a weight that is ONE item's ──
import { packsPerUnit } from '../js/order-cost.js';

test('a carton card prices a carton, not one busta: the weight text is one item\'s', () => {
  const carton = { unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
  const perKg = { priceUnit: 'kg', pricePerUnit: 2 };
  assert.equal(unitCost(carton, perKg), 20, '4 × 2.5 kg at 2 a kilo');
  assert.equal(packsPerUnit(carton), 4);
  // ordered in the package word itself: one busta
  assert.equal(unitCost({ ...carton, unit: 'busta', packUnit: 'busta' }, perKg), 5);
  assert.equal(packsPerUnit({ ...carton, unit: 'Busta' }), 1, 'the package word is matched ignoring case');
});

test('without a packCount nothing changed: the weight is the whole pack', () => {
  const old = { unit: 'cartone', packUnit: 'busta', weight: '2.5kg' };
  assert.equal(unitCost(old, { priceUnit: 'kg', pricePerUnit: 2 }), 5);
  assert.equal(packsPerUnit(old), 1);
  for (const packCount of [0, -1, 2.5, '4', null, undefined]) {
    assert.equal(packsPerUnit({ ...old, packCount }), 1, String(packCount));
  }
  assert.equal(unitCost({ unit: 'sacco', weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 0.8 }), 20);
});

test('ordering by weight on a carton card is still a plain rate × kilos', () => {
  const carton = { unit: 'kg', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
  assert.equal(unitCost(carton, { priceUnit: 'kg', pricePerUnit: 2 }), 2);
});

test('a stored case of PIECES whose count is the card\'s packCount counts as a case of packages', () => {
  const card = { unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '' };
  const price = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
  assert.equal(unitCost(card, price), 20, 'the carton');
  assert.equal(unitCost({ ...card, unit: 'pezzo' }, price), 0.4, 'one pezzo');
  assert.equal(unitCost({ ...card, unit: 'pz' }, price), 0.4, 'a piece word');
  // a DIFFERENT packCount is not the case that was priced: the package word stays ambiguous
  assert.equal(unitCost({ ...card, packCount: 40, unit: 'busta', packUnit: 'busta' }, price), null);
  // and the busta of a pieces case is NOT a piece when the card says nothing about it
  const nothing = { unit: 'busta', packUnit: 'busta', weight: '' };
  assert.equal(unitCost(nothing, price), null);
});
