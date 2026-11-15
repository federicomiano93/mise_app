// Tests for what has been ordered and has not arrived, and what is still to re-order (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/orders/deliveries.js, which the live app uses today. The module is a FULL port, so
// parity.spec.ts also compares its exports.
//
// PORTED: every test of tests/deliveries.test.mjs that calls the pure functions — all of the first 28. LEFT OUT, three tests at the
// end of that file: they READ THE SOURCE of js/orders/deliveries-view.js and js/orders/draft.js (a regex over the screen's text and
// over the Firestore write), because the screen and the write need a browser. Mise 2 has no such source to read; what those three pin
// (a re-opened delivery goes straight to the rows with the old marks unticked; the answer REPLACES the stored marks; «Risolto» is a
// merge beside `missing`) is pinned there by ordersStore.incoming.spec.ts and OrdersSection.incoming.spec.tsx, which run the real
// code against the fake source. The tests still run on the current app's side through tests/deliveries.test.mjs.
//
// ⚠️ THE TESTS THAT MATTER MOST ARE THE ONES ABOUT WHAT MUST NOT DISAPPEAR. An order that never turned up is the single most important
// row this feature draws, and every cheap version of this design loses it: a window swallows it, a derived «it must have arrived by
// now» hides it, a tidy-up deletes it. Each of those has a test below.

import { describe, expect, test } from 'vitest';
import * as ported from './deliveries';
import * as legacyJs from '../../js/orders/deliveries.js';

const legacy = legacyJs as unknown as typeof ported;

// 2026-08-14 is a Friday.
const TODAY = '2026-08-14';

type Ord = { id?: string; supplierId?: string; date?: string; quantities?: Record<string, number>; [key: string]: unknown };

const SUPPLIERS = {
  weekly: { id: 'weekly', name: 'Weekly Co', deliveryDays: ['Monday', 'Thursday'] },
  noDays: { id: 'noDays', name: 'Unset Co', deliveryDays: [] },
};

const order = (over: Ord = {}): Ord => ({
  supplierId: 'weekly',
  date: '2026-08-10',
  quantities: { flour: 10, butter: 4 },
  ...over,
});

const missed = (over: Ord = {}): Ord => order({
  date: '2026-08-10',
  quantities: { flour: 10 },
  missing: { flour: true },
  deliveredAt: '2026-08-13',
  ...over,
});

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { AHEAD_DAYS, isDelivered, shortfall, expectedDeliveryOn, pendingDeliveries, stillToReorder, applyReorder, unansweredBefore } = m;

  const ids = (list: Array<{ order: Ord }>) => list.map(e => `${e.order.date}/${e.order.supplierId}`);
  const all = (out: ReturnType<typeof pendingDeliveries>) => [...out.late, ...out.dueToday, ...out.coming];

  // ── ⚠️ NOTHING THAT NEVER ARRIVED MAY DISAPPEAR ────────────────────────────

  // ⚠️⚠️ THIS TEST USED TO ASSERT THE OPPOSITE, AND THE CHANGE IS THE POINT: since 14 Aug the list is the CURRENT WEEK. What replaced
  // «the old one stays» is «the old one MOVED» — out of the daily list and into the debt, which is the half that keeps the promise.
  test('⚠️ an order from weeks ago LEAVES the list — and lands in the debt, not in nothing', () => {
    const ancient = order({ date: '2026-07-06' });
    const soon = order({ date: '2026-08-13' });
    const out = pendingDeliveries([soon, ancient], SUPPLIERS, TODAY);

    expect(out.late.length, 'no longer cluttering the daily list').toBe(0);
    expect(ids(out.coming)).toStrictEqual(['2026-08-13/weekly']);

    expect(unansweredBefore([soon, ancient], TODAY).map(o => o.date), 'and it is owed an answer — the week does not expire in silence')
      .toStrictEqual(['2026-07-06']);
  });

  test('⚠️ the debt is oldest first, and a confirmed order is never in it', () => {
    const old1 = order({ date: '2026-07-06' });
    const old2 = order({ date: '2026-07-20' });
    const done = order({ date: '2026-07-13', deliveredAt: '2026-07-15' });
    expect(unansweredBefore([old2, done, old1], TODAY).map(o => o.date)).toStrictEqual(['2026-07-06', '2026-07-20']);
  });

  test('this week is never in the debt, and neither is a legacy weekly record', () => {
    const thisWeek = order({ date: '2026-08-13' });
    const legacyRecord = { weekStart: '2026-07-06', quantities: { flour: 5 } };
    expect(unansweredBefore([thisWeek, legacyRecord], TODAY)).toStrictEqual([]);
    expect(unansweredBefore(null, TODAY)).toStrictEqual([]);
    expect(unansweredBefore([thisWeek], '')).toStrictEqual([]);
  });

  // ⚠️ The setting moves BOTH halves at once, or one would quietly disagree with the other about which week an order is in.
  test('⚠️ a Monday start moves the window and the debt together', () => {
    const sunday = order({ date: '2026-08-09' });
    const asSunday = pendingDeliveries([sunday], SUPPLIERS, TODAY, { weekStartsOn: 'Sunday' });
    const asMonday = pendingDeliveries([sunday], SUPPLIERS, TODAY, { weekStartsOn: 'Monday' });
    const count = (o: ReturnType<typeof pendingDeliveries>) => o.late.length + o.dueToday.length + o.coming.length;

    expect(count(asSunday)).toBe(1);
    expect(count(asMonday)).toBe(0);
    expect(unansweredBefore([sunday], TODAY, { weekStartsOn: 'Monday' }).map(o => o.date), 'what left the list is owed an answer, never dropped')
      .toStrictEqual(['2026-08-09']);
    expect(unansweredBefore([sunday], TODAY, { weekStartsOn: 'Sunday' })).toStrictEqual([]);
  });

  // ⚠️ AN UNREADABLE STAMP MEANS «NOT DELIVERED», never «delivered».
  test('⚠️ only a real stamp counts as delivered; anything odd stays pending', () => {
    expect(isDelivered({ deliveredAt: '2026-08-14' })).toBe(true);
    expect(isDelivered({ deliveredAt: '' })).toBe(false);
    expect(isDelivered({ deliveredAt: '   ' })).toBe(false);
    expect(isDelivered({ deliveredAt: null })).toBe(false);
    expect(isDelivered({ deliveredAt: 12345 }), 'a number is not a confirmation').toBe(false);
    expect(isDelivered({})).toBe(false);
    expect(isDelivered(null)).toBe(false);
  });

  test('a confirmed order leaves the list', () => {
    const out = pendingDeliveries([order({ deliveredAt: '2026-08-12' })], SUPPLIERS, TODAY);
    expect(all(out)).toStrictEqual([]);
  });

  // ⚠️ NOT KNOWING WHEN IT COMES IS NOT THE SAME AS IT NOT COMING.
  test('⚠️ a supplier with no delivery days is shown, never hidden, and never «late»', () => {
    const out = pendingDeliveries([order({ supplierId: 'noDays' })], SUPPLIERS, TODAY);
    expect(out.late.length, 'we do not know it is late').toBe(0);
    expect(out.coming.length).toBe(1);
    expect(out.coming[0]!.expected).toBe('');
  });

  test('an order whose supplier has been deleted is still shown', () => {
    const out = pendingDeliveries([order({ supplierId: 'gone' })], SUPPLIERS, TODAY);
    expect(out.coming.length).toBe(1);
    expect(out.coming[0]!.supplier).toBe(null);
  });

  // ⚠️ The pre-v179 weekly records merged every supplier into one document, so they cannot name a delivery.
  test('legacy weekly records are not deliveries', () => {
    const legacyRecord = { weekStart: '2026-07-06', quantities: { flour: 5 } };
    const out = pendingDeliveries([legacyRecord], SUPPLIERS, TODAY);
    expect(all(out)).toStrictEqual([]);
  });

  // ── When a delivery is expected ────────────────────────────────────────────

  // ⚠️ STRICTLY AFTER. What is on today's van was decided before today's order existed.
  test('⚠️ ordering on a delivery day means the NEXT one, not today', () => {
    // 2026-08-10 is a Monday, and Monday is a delivery day.
    expect(expectedDeliveryOn(order({ date: '2026-08-10' }), SUPPLIERS.weekly)).toBe('2026-08-13');
  });

  test('the next declared day after the order', () => {
    expect(expectedDeliveryOn(order({ date: '2026-08-11' }), SUPPLIERS.weekly)).toBe('2026-08-13');
    expect(expectedDeliveryOn(order({ date: '2026-08-14' }), SUPPLIERS.weekly)).toBe('2026-08-17');
  });

  test('no days declared, no date invented', () => {
    expect(expectedDeliveryOn(order(), SUPPLIERS.noDays)).toBe('');
    expect(expectedDeliveryOn(order(), null)).toBe('');
    expect(expectedDeliveryOn(null, SUPPLIERS.weekly)).toBe('');
  });

  test('due today lands in its own group', () => {
    const out = pendingDeliveries([order({ date: '2026-08-11', supplierId: 'fri' })], { fri: { deliveryDays: ['Friday'] } }, TODAY);
    expect(out.dueToday.length).toBe(1);
    expect(out.dueToday[0]!.expected).toBe(TODAY);
  });

  test('the horizon is a week, and it is exported so the screen cannot disagree', () => {
    expect(AHEAD_DAYS).toBe(7);
  });

  // ── What did not arrive ────────────────────────────────────────────────────

  // ⚠️ A `missing` entry for something the order never contained would put a row on the re-order list that no amount of ordering
  // could ever clear.
  test('⚠️ shortfall counts only what was actually ordered', () => {
    const o = order({ missing: { flour: true, ghost: true, butter: false } });
    expect(shortfall(o)).toStrictEqual(['flour']);
  });

  test('no missing map at all is not a shortfall', () => {
    expect(shortfall(order())).toStrictEqual([]);
    expect(shortfall(null)).toStrictEqual([]);
  });

  // ── The re-order list, derived ─────────────────────────────────────────────

  test('an ingredient that did not arrive is still to re-order', () => {
    expect(stillToReorder([missed()], {})).toStrictEqual(
      [{ id: 'flour', supplierId: 'weekly', recordId: '2026-08-10_weekly', qty: 10, missedOn: '2026-08-10' }]);
  });

  test('…and drops off once a LATER order to that supplier asks for it again', () => {
    const later = order({ date: '2026-08-12', quantities: { flour: 10 }, deliveredAt: '' });
    expect(stillToReorder([missed(), later], {})).toStrictEqual([]);
  });

  // ⚠️ An EARLIER order does not count — it happened before the thing went missing.
  test('an earlier order does not clear it', () => {
    const earlier = order({ date: '2026-08-01', quantities: { flour: 10 } });
    expect(stillToReorder([missed(), earlier], {}).length).toBe(1);
  });

  // Since «Ordina da un altro fornitore» (2 Oct 2026) the same ingredient id can be ordered from another supplier, so a LATER order
  // from any supplier counts as ordering it again.
  test('a later order for the same ingredient from another supplier clears it', () => {
    const other = order({ date: '2026-08-12', supplierId: 'noDays', quantities: { flour: 10 } });
    expect(stillToReorder([missed(), other], {}).length).toBe(0);
  });

  // ⚠️ THIS IS WHY THE BANNER GOES QUIET AS SOON AS THE WORK IS DONE, rather than when the order is finally placed.
  test('⚠️ it clears the moment the ingredient is in the order being typed', () => {
    expect(stillToReorder([missed()], { flour: { qty: 6 } })).toStrictEqual([]);
    expect(stillToReorder([missed()], { flour: { qty: 0 } }).length, '0 is not typed').toBe(1);
  });

  test('missing twice in a row keeps the newer entry only', () => {
    const first = missed({ date: '2026-08-03' });
    const second = missed({ date: '2026-08-10' });
    const out = stillToReorder([first, second], {});
    expect(out.length).toBe(1);
    expect(out[0]!.missedOn, 'the newer one survives, the older was re-ordered').toBe('2026-08-10');
  });

  test('newest first, ties broken so two repaints never swap rows', () => {
    const a = missed({ date: '2026-08-03', quantities: { apple: 1 }, missing: { apple: true } });
    const b = missed({ date: '2026-08-03', quantities: { beet: 1 }, missing: { beet: true }, supplierId: 'noDays' });
    const c = missed({ date: '2026-08-11', quantities: { cream: 1 }, missing: { cream: true }, supplierId: 'third' });
    expect(stillToReorder([a, b, c], {}).map(x => x.id)).toStrictEqual(['cream', 'apple', 'beet']);
  });

  test('nothing at all is answered with nothing, not a throw', () => {
    expect(stillToReorder(null, null)).toStrictEqual([]);
    expect(stillToReorder([], {})).toStrictEqual([]);
    const out = pendingDeliveries(null, null, TODAY);
    expect(all(out)).toStrictEqual([]);
    expect(pendingDeliveries([order()], SUPPLIERS, '').late).toStrictEqual([]);
  });

  // ── ⚠️ PUTTING IT BACK MUST NOT TOUCH SOMEBODY ELSE'S TYPING ───────────────

  // ⚠️ THE ORDER IS SHARED AND LIVE. A number already there was typed by a person, possibly seconds ago on another phone.
  test('⚠️ a row that already has a quantity is never overwritten — and the skip is reported', () => {
    const items = [{ id: 'flour', qty: 10 }, { id: 'butter', qty: 4 }];
    const { applied, skipped } = applyReorder(items, { flour: { qty: 3 } });

    expect(applied).toStrictEqual([{ id: 'butter', qty: 4 }]);
    expect(skipped, 'the screen must be able to SAY it skipped one').toStrictEqual([{ id: 'flour', qty: 10, existing: 3 }]);
  });

  test('an empty or zero row is filled', () => {
    const { applied, skipped } = applyReorder([{ id: 'flour', qty: 10 }], { flour: { qty: 0 } });
    expect(applied).toStrictEqual([{ id: 'flour', qty: 10 }]);
    expect(skipped).toStrictEqual([]);
  });

  test('junk in, no throw out', () => {
    expect(applyReorder(null, null)).toStrictEqual({ applied: [], skipped: [] });
    expect(applyReorder([null, {}], {})).toStrictEqual({ applied: [], skipped: [] });
  });

  // ── ⚠️ THE GUARANTEE THAT KEEPS THE SUGGESTIONS UNTOUCHED ──────────────────

  // ⚠️ `orders-history.quantities` is the map the suggestion engine averages over. Nothing in this module may write to the records it
  // is handed.
  test('⚠️ nothing here mutates the orders it is given', () => {
    const record = missed();
    const before = JSON.stringify(record);
    stillToReorder([record], {});
    shortfall(record);
    pendingDeliveries([record], SUPPLIERS, TODAY);
    expectedDeliveryOn(record, SUPPLIERS.weekly);
    expect(JSON.stringify(record), 'the record must come back untouched').toBe(before);
  });

  // ── «Risolto»: a missing line bought elsewhere (1 Oct 2026) ────────────────

  test('a missing line marked «Risolto» leaves the re-order list for good', () => {
    const record = order({
      id: '2026-08-10_weekly', deliveredAt: '2026-08-11T09:00:00Z', missing: { flour: true, butter: true },
      missingResolved: { flour: '2026-08-12T10:00:00Z' },
    });
    const list = stillToReorder([record], {});
    expect(list.map(i => i.id)).toStrictEqual(['butter']);
    expect(list[0]!.recordId).toBe('2026-08-10_weekly');
  });

  test('only a non-empty string resolves a line — anything else leaves it on the list', () => {
    for (const odd of ['', '   ', true, 1, null]) {
      const record = order({ deliveredAt: '2026-08-11T09:00:00Z', missing: { flour: true }, missingResolved: { flour: odd } });
      expect(stillToReorder([record], {}).map(i => i.id), `value ${JSON.stringify(odd)}`).toStrictEqual(['flour']);
    }
  });

  test('a record read without its id still names the record a «Risolto» goes to', () => {
    const record = order({ deliveredAt: '2026-08-11T09:00:00Z', missing: { flour: true } });
    expect(stillToReorder([record], {})[0]!.recordId).toBe('2026-08-10_weekly');
  });
});
