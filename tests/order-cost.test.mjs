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
