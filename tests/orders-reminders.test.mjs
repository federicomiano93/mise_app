// Unit tests for the two Orders reminders (P15 — the owner cannot read code, so
// these tests are the safety net).
//
//   todayOrders      — what to order today, and what is already done.
//   pendingSuppliers — an order typed on an earlier day and never marked placed;
//                      it must be offered for ITS day, not today.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayOrders, pendingSuppliers, placedOn, suppliersStillToOrder } from '../js/orders/reminders.js';

// 13 July 2026 is a Monday.
const MONDAY = '2026-07-13';
const SUNDAY = '2026-07-12';

const ALBA = { id: 'alba', name: 'Alba', orderDays: ['Monday'], active: true };
const ETNA = { id: 'etna', name: 'Etna', orderDays: ['Monday', 'Tuesday'], active: true };
const DELTA = { id: 'cont', name: 'Delta', orderDays: ['Thursday'], active: true };
const CLOSED = { id: 'closed', name: 'Closed Ltd', orderDays: ['Monday'], active: false };

const SUPPLIERS = [ETNA, CLOSED, DELTA, ALBA];

const INGREDIENTS = [
  { id: 'flour', supplierId: 'alba' },
  { id: 'semola', supplierId: 'alba' },
  { id: 'nutella', supplierId: 'etna' },
  { id: 'gomo', supplierId: 'cont' },
  { id: 'oldbag', supplierId: 'alba', active: false },
];

// ── todayOrders ───────────────────────────────────────────────────────────────

test('lists the suppliers ordered today, by name, ignoring the rest', () => {
  const result = todayOrders({ suppliers: SUPPLIERS, history: [], today: MONDAY });
  // Delta orders on Thursday; "Closed Ltd" is deactivated.
  assert.deepEqual(result.map(r => r.supplier.name), ['Alba', 'Etna']);
  assert.deepEqual(result.map(r => r.placed), [false, false]);
});

test('a supplier already ordered TODAY is shown as done', () => {
  const history = [
    { id: '2026-07-13_alba', date: MONDAY, supplierId: 'alba', quantities: { flour: 2 } },
  ];
  const result = todayOrders({ suppliers: SUPPLIERS, history, today: MONDAY });
  assert.deepEqual(result.map(r => [r.supplier.name, r.placed]), [['Alba', true], ['Etna', false]]);
});

test('an order placed on an EARLIER day does not mark today as done', () => {
  const history = [
    { id: '2026-07-12_alba', date: SUNDAY, supplierId: 'alba', quantities: { flour: 2 } },
    { id: '2026-W28', weekStart: '2026-07-06', quantities: { flour: 6 } }, // legacy: no supplierId
  ];
  const result = todayOrders({ suppliers: SUPPLIERS, history, today: MONDAY });
  assert.equal(result.find(r => r.supplier.id === 'alba').placed, false);
});

test('nothing to order today means no reminder at all', () => {
  // Wednesday 15 July: only Etna orders Mon/Tue, Alba Mon, Delta Thu.
  assert.deepEqual(todayOrders({ suppliers: SUPPLIERS, history: [], today: '2026-07-15' }), []);
  assert.deepEqual(todayOrders({ suppliers: [], history: [], today: MONDAY }), []);
});

// ── pendingSuppliers ──────────────────────────────────────────────────────────

const entries = e => e;

test('an order typed yesterday and never placed is flagged, under YESTERDAY', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ flour: { qty: 3, stock: 1 }, semola: { qty: 2, stock: 0 } }),
    days: { alba: SUNDAY },
    today: MONDAY,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].supplier.id, 'alba');
  assert.equal(result[0].day, SUNDAY);
  assert.equal(result[0].itemCount, 2);
});

test("today's own work in progress is never nagged about", () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ flour: { qty: 3, stock: 1 } }),
    days: { alba: MONDAY },
    today: MONDAY,
  });
  assert.deepEqual(result, []);
});

test('stock jotted down with nothing ordered is not an unplaced order', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ flour: { qty: 0, stock: 8 } }),
    days: { alba: SUNDAY },
    today: MONDAY,
  });
  assert.deepEqual(result, []);
});

test('a draft written before the app recorded days falls back to its own timestamp', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ flour: { qty: 3, stock: 0 } }),
    days: {},                 // the old draft has no per-supplier stamp
    fallbackDay: SUNDAY,      // ...but the document itself was last written on Sunday
    today: MONDAY,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].day, SUNDAY);
});

test('with no stamp and no fallback, nothing is claimed to be from an earlier day', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ flour: { qty: 3, stock: 0 } }),
    days: {}, fallbackDay: '', today: MONDAY,
  });
  assert.deepEqual(result, []);
});

test('a deactivated supplier is ignored — its rows are invisible, so nagging never ends', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS,
    ingredients: [...INGREDIENTS, { id: 'x', supplierId: 'closed' }],
    entries: entries({ x: { qty: 5, stock: 0 } }),
    days: { closed: SUNDAY },
    today: MONDAY,
  });
  assert.deepEqual(result, []);
});

test('a quantity left on a deactivated PRODUCT is not nagged about either', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ oldbag: { qty: 4, stock: 0 } }), // product active:false
    days: { alba: SUNDAY },
    today: MONDAY,
  });
  assert.deepEqual(result, []);
});

test('several forgotten orders come back oldest first', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ flour: { qty: 1, stock: 0 }, nutella: { qty: 2, stock: 0 }, gomo: { qty: 3, stock: 0 } }),
    days: { alba: SUNDAY, etna: '2026-07-09', cont: SUNDAY },
    today: MONDAY,
  });
  assert.deepEqual(result.map(r => [r.supplier.name, r.day]), [
    ['Etna', '2026-07-09'],
    ['Alba', SUNDAY],
    ['Delta', SUNDAY],
  ]);
});

test('a stamp in the future is not "before today", so it is left alone', () => {
  const result = pendingSuppliers({
    suppliers: SUPPLIERS, ingredients: INGREDIENTS,
    entries: entries({ flour: { qty: 3, stock: 0 } }),
    days: { alba: '2026-07-20' },
    today: MONDAY,
  });
  assert.deepEqual(result, []);
});

// ── What the Home badge counts ───────────────────────────────────────────────
//
// The badge on the Home card used to count every supplier whose order day was
// today, whether or not the order had already gone out — so it said "3" all day
// after the work was done, and contradicted the Orders screen, which ticks them
// off. A reminder that stays lit after the job is done is one people stop reading.

test('placedOn collects the suppliers recorded on that day', () => {
  const history = [
    { date: MONDAY, supplierId: 'alba' },
    { date: SUNDAY, supplierId: 'etna' },      // yesterday — not today's business
    { date: MONDAY, weekStart: '2026-07-06' }, // legacy record: no supplierId
  ];
  assert.deepEqual([...placedOn(history, MONDAY)], ['alba']);
  assert.deepEqual([...placedOn([], MONDAY)], []);
  assert.deepEqual([...placedOn(null, MONDAY)], []);
});

test('a supplier already ordered today is dropped from what the badge counts', () => {
  const history = [{ date: MONDAY, supplierId: 'alba', quantities: { flour: 2 } }];
  const left = suppliersStillToOrder(SUPPLIERS, history, MONDAY);
  assert.deepEqual(left.map(s => s.id).sort(), ['closed', 'cont', 'etna']);
});

test('everything ordered today leaves nothing for the badge to show', () => {
  const history = SUPPLIERS.map(s => ({ date: MONDAY, supplierId: s.id }));
  assert.deepEqual(suppliersStillToOrder(SUPPLIERS, history, MONDAY), []);
});

test("yesterday's orders do not silence today's badge", () => {
  // The trap this guards: filtering on supplierId alone would treat an order placed
  // any day as "done", and the badge would go quiet for ever after the first week.
  const history = [{ date: SUNDAY, supplierId: 'alba' }, { date: SUNDAY, supplierId: 'etna' }];
  const left = suppliersStillToOrder(SUPPLIERS, history, MONDAY);
  assert.equal(left.length, SUPPLIERS.length);
});

test('no history at all leaves every supplier to order', () => {
  assert.equal(suppliersStillToOrder(SUPPLIERS, [], MONDAY).length, SUPPLIERS.length);
  assert.equal(suppliersStillToOrder(SUPPLIERS, null, MONDAY).length, SUPPLIERS.length);
  assert.deepEqual(suppliersStillToOrder(null, [], MONDAY), []);
});
