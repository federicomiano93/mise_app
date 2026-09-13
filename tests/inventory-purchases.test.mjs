// inventory-purchases.test.mjs — what a month's orders say was bought.
//
// The figure this produces lands in a subtraction the owner makes business
// decisions on, and he cannot read the code that produces it. These are the net
// (P15). The two that matter most: the retired weekly record must never leak into
// a month, and an item marked as never delivered must not count as bought.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isInMonth, receivedFrom, purchasesInMonth,
} from '../js/inventory/inventory-purchases.js';

const FLOUR = 'flour';
const BUTTER = 'butter';

const order = (date, quantities, over = {}) => ({
  bakery: 'main', date, supplierId: 'salvo', supplierName: 'Salvo',
  quantities, stock: {}, createdAt: date, updatedAt: date, ...over,
});

// ── Which records belong to the month ────────────────────────────────────────

test('a record belongs to the month its date falls in', () => {
  assert.equal(isInMonth(order('2026-09-04', {}), '2026-09'), true);
  assert.equal(isInMonth(order('2026-08-31', {}), '2026-09'), false);
  assert.equal(isInMonth(order('2026-10-01', {}), '2026-09'), false);
});

test('⚠️ the retired weekly record belongs to NO month', () => {
  // The one such document in production is `2026-W28` from July 2026: it has
  // `weekStart` instead of `date` and merges every supplier into one map. Guessing
  // a date for it would drop somebody else's July into somebody's September.
  const legacy = { bakery: 'main', weekStart: '2026-07-06', quantities: { [FLOUR]: 9 }, stock: {} };
  assert.equal(isInMonth(legacy, '2026-07'), false);
  assert.deepEqual(purchasesInMonth([legacy], '2026-07').totals, {});
});

test('a date that is not a date is dropped rather than guessed at', () => {
  assert.equal(isInMonth(order('4 September', {}), '2026-09'), false);
  assert.equal(isInMonth(order(20260904, {}), '2026-09'), false);
  assert.equal(isInMonth(null, '2026-09'), false);
});

// ── What one order brought in ────────────────────────────────────────────────

test('what was ordered is what came in, unless somebody said otherwise', () => {
  assert.deepEqual(receivedFrom(order('2026-09-04', { [FLOUR]: 10, [BUTTER]: 2 })),
    { [FLOUR]: 10, [BUTTER]: 2 });
});

test('⚠️ an item marked as never delivered did not come in', () => {
  const rec = order('2026-09-04', { [FLOUR]: 10, [BUTTER]: 2 }, { missing: { [BUTTER]: true } });
  assert.deepEqual(receivedFrom(rec), { [FLOUR]: 10 });
});

test('a missing mark for something never ordered is meaningless, not a phantom row', () => {
  const rec = order('2026-09-04', { [FLOUR]: 10 }, { missing: { [BUTTER]: true } });
  assert.deepEqual(receivedFrom(rec), { [FLOUR]: 10 });
});

test('a missing entry that is not a true is not a missing entry', () => {
  const rec = order('2026-09-04', { [FLOUR]: 10 }, { missing: { [FLOUR]: 'yes' } });
  assert.deepEqual(receivedFrom(rec), { [FLOUR]: 10 });
});

test('a zero or junk quantity brings nothing in and never becomes NaN', () => {
  const rec = order('2026-09-04', { a: 0, b: -3, c: 'HELLO', d: Infinity, e: null, f: 2 });
  assert.deepEqual(receivedFrom(rec), { f: 2 });
});

test('a record with no maps at all cannot throw', () => {
  assert.deepEqual(receivedFrom({}), {});
  assert.deepEqual(receivedFrom(null), {});
});

// ── The month, added up ──────────────────────────────────────────────────────

test('every order of the month is added up, per product', () => {
  const out = purchasesInMonth([
    order('2026-09-04', { [FLOUR]: 10 }),
    order('2026-09-18', { [FLOUR]: 6, [BUTTER]: 2 }),
    order('2026-08-30', { [FLOUR]: 99 }),
    order('2026-10-02', { [FLOUR]: 99 }),
  ], '2026-09');
  assert.deepEqual(out.totals, { [FLOUR]: 16, [BUTTER]: 2 });
  assert.equal(out.orders, 2);
  assert.equal(out.products, 2);
});

test('two suppliers selling the same product add up — it is one shelf', () => {
  const out = purchasesInMonth([
    order('2026-09-04', { [FLOUR]: 10 }, { supplierId: 'salvo' }),
    order('2026-09-05', { [FLOUR]: 4 }, { supplierId: 'other' }),
  ], '2026-09');
  assert.deepEqual(out.totals, { [FLOUR]: 14 });
});

test('halves add up without leaving float dust behind', () => {
  const out = purchasesInMonth([
    order('2026-09-04', { [FLOUR]: 0.1 }),
    order('2026-09-05', { [FLOUR]: 0.2 }),
  ], '2026-09');
  assert.equal(out.totals[FLOUR], 0.3);
});

test('a month with no orders proposes nothing, and says so without failing', () => {
  const out = purchasesInMonth([], '2026-09');
  assert.deepEqual(out, { totals: {}, orders: 0, products: 0 });
  assert.deepEqual(purchasesInMonth(null, '2026-09').totals, {});
});
