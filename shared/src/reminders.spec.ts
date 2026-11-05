// Tests for the two Orders reminders (P15), run against BOTH implementations: the TypeScript port in shared/ and
// js/orders/reminders.js, which the live app uses today. The module is a FULL port, so parity.spec.ts also compares its exports.
//
//   todayOrders      — what to order today, and what is already done.
//   pendingSuppliers — an order typed on an earlier day and never marked placed; it must be offered for ITS day, not today.
//
// PORTED: every test of tests/orders-reminders.test.mjs. LEFT OUT: nothing.

import { describe, expect, test } from 'vitest';
import * as ported from './reminders';
import * as legacyJs from '../../js/orders/reminders.js';

const legacy = legacyJs as unknown as typeof ported;

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

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { todayOrders, pendingSuppliers, placedOn, suppliersStillToOrder } = m;

  // ── todayOrders ─────────────────────────────────────────────────────────────

  test('lists the suppliers ordered today, by name, ignoring the rest', () => {
    const result = todayOrders({ suppliers: SUPPLIERS, history: [], today: MONDAY });
    // Delta orders on Thursday; "Closed Ltd" is deactivated.
    expect(result.map(r => r.supplier.name)).toStrictEqual(['Alba', 'Etna']);
    expect(result.map(r => r.placed)).toStrictEqual([false, false]);
  });

  test('a supplier already ordered TODAY is shown as done', () => {
    const history = [
      { id: '2026-07-13_alba', date: MONDAY, supplierId: 'alba', quantities: { flour: 2 } },
    ];
    const result = todayOrders({ suppliers: SUPPLIERS, history, today: MONDAY });
    expect(result.map(r => [r.supplier.name, r.placed])).toStrictEqual([['Alba', true], ['Etna', false]]);
  });

  test('an order placed on an EARLIER day does not mark today as done', () => {
    const history = [
      { id: '2026-07-12_alba', date: SUNDAY, supplierId: 'alba', quantities: { flour: 2 } },
      { id: '2026-W28', weekStart: '2026-07-06', quantities: { flour: 6 } }, // legacy: no supplierId
    ];
    const result = todayOrders({ suppliers: SUPPLIERS, history, today: MONDAY });
    expect(result.find(r => r.supplier.id === 'alba')!.placed).toBe(false);
  });

  test('nothing to order today means no reminder at all', () => {
    // Wednesday 15 July: only Etna orders Mon/Tue, Alba Mon, Delta Thu.
    expect(todayOrders({ suppliers: SUPPLIERS, history: [], today: '2026-07-15' })).toStrictEqual([]);
    expect(todayOrders({ suppliers: [], history: [], today: MONDAY })).toStrictEqual([]);
  });

  // ── pendingSuppliers ────────────────────────────────────────────────────────

  test('an order typed yesterday and never placed is flagged, under YESTERDAY', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { flour: { qty: 3 }, semola: { qty: 2 } },
      days: { alba: SUNDAY },
      today: MONDAY,
    });
    expect(result.length).toBe(1);
    expect(result[0]!.supplier.id).toBe('alba');
    expect(result[0]!.day).toBe(SUNDAY);
    expect(result[0]!.itemCount).toBe(2);
  });

  test("today's own work in progress is never nagged about", () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { flour: { qty: 3 } },
      days: { alba: MONDAY },
      today: MONDAY,
    });
    expect(result).toStrictEqual([]);
  });

  test('stock jotted down with nothing ordered is not an unplaced order', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { flour: { qty: 0 } },
      days: { alba: SUNDAY },
      today: MONDAY,
    });
    expect(result).toStrictEqual([]);
  });

  test('a draft written before the app recorded days falls back to its own timestamp', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { flour: { qty: 3 } },
      days: {},                 // the old draft has no per-supplier stamp
      fallbackDay: SUNDAY,      // ...but the document itself was last written on Sunday
      today: MONDAY,
    });
    expect(result.length).toBe(1);
    expect(result[0]!.day).toBe(SUNDAY);
  });

  test('with no stamp and no fallback, nothing is claimed to be from an earlier day', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { flour: { qty: 3 } },
      days: {}, fallbackDay: '', today: MONDAY,
    });
    expect(result).toStrictEqual([]);
  });

  test('a deactivated supplier is ignored — its rows are invisible, so nagging never ends', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS,
      ingredients: [...INGREDIENTS, { id: 'x', supplierId: 'closed' }],
      entries: { x: { qty: 5 } },
      days: { closed: SUNDAY },
      today: MONDAY,
    });
    expect(result).toStrictEqual([]);
  });

  test('a quantity left on a deactivated PRODUCT is not nagged about either', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { oldbag: { qty: 4 } }, // product active:false
      days: { alba: SUNDAY },
      today: MONDAY,
    });
    expect(result).toStrictEqual([]);
  });

  test('several forgotten orders come back oldest first', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { flour: { qty: 1 }, nutella: { qty: 2 }, gomo: { qty: 3 } },
      days: { alba: SUNDAY, etna: '2026-07-09', cont: SUNDAY },
      today: MONDAY,
    });
    expect(result.map(r => [r.supplier.name, r.day])).toStrictEqual([
      ['Etna', '2026-07-09'],
      ['Alba', SUNDAY],
      ['Delta', SUNDAY],
    ]);
  });

  test('a stamp in the future is not "before today", so it is left alone', () => {
    const result = pendingSuppliers({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS,
      entries: { flour: { qty: 3 } },
      days: { alba: '2026-07-20' },
      today: MONDAY,
    });
    expect(result).toStrictEqual([]);
  });

  test('no today, no reminders', () => {
    expect(pendingSuppliers({ suppliers: SUPPLIERS, ingredients: INGREDIENTS, entries: { flour: { qty: 3 } }, days: { alba: SUNDAY } }))
      .toStrictEqual([]);
    expect(todayOrders({ suppliers: SUPPLIERS, history: [] })).toStrictEqual([]);
  });

  // ── What the Home badge counts ─────────────────────────────────────────────
  //
  // The badge on the Home card used to count every supplier whose order day was today, whether or not the order had already
  // gone out — so it said "3" all day after the work was done, and contradicted the Orders screen, which ticks them off. A
  // reminder that stays lit after the job is done is one people stop reading.

  test('placedOn collects the suppliers recorded on that day', () => {
    const history = [
      { date: MONDAY, supplierId: 'alba' },
      { date: SUNDAY, supplierId: 'etna' },      // yesterday — not today's business
      { date: MONDAY, weekStart: '2026-07-06' }, // legacy record: no supplierId
    ];
    expect([...placedOn(history, MONDAY)]).toStrictEqual(['alba']);
    expect([...placedOn([], MONDAY)]).toStrictEqual([]);
    expect([...placedOn(null, MONDAY)]).toStrictEqual([]);
  });

  test('a supplier already ordered today is dropped from what the badge counts', () => {
    const history = [{ date: MONDAY, supplierId: 'alba', quantities: { flour: 2 } }];
    const left = suppliersStillToOrder(SUPPLIERS, history, MONDAY);
    expect(left.map(s => s.id).sort()).toStrictEqual(['closed', 'cont', 'etna']);
  });

  test('everything ordered today leaves nothing for the badge to show', () => {
    const history = SUPPLIERS.map(s => ({ date: MONDAY, supplierId: s.id }));
    expect(suppliersStillToOrder(SUPPLIERS, history, MONDAY)).toStrictEqual([]);
  });

  test("yesterday's orders do not silence today's badge", () => {
    // The trap this guards: filtering on supplierId alone would treat an order placed any day as "done", and the badge would
    // go quiet for ever after the first week.
    const history = [{ date: SUNDAY, supplierId: 'alba' }, { date: SUNDAY, supplierId: 'etna' }];
    const left = suppliersStillToOrder(SUPPLIERS, history, MONDAY);
    expect(left.length).toBe(SUPPLIERS.length);
  });

  test('no history at all leaves every supplier to order', () => {
    expect(suppliersStillToOrder(SUPPLIERS, [], MONDAY).length).toBe(SUPPLIERS.length);
    expect(suppliersStillToOrder(SUPPLIERS, null, MONDAY).length).toBe(SUPPLIERS.length);
    expect(suppliersStillToOrder(null, [], MONDAY)).toStrictEqual([]);
  });
});
