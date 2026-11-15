// Tests for «what has been told about the order, and what counts is what the person who places it confirms» (P15), run against
// BOTH implementations: the TypeScript port in shared/ and js/orders/untold-changes.js, which the live app uses today. The module is
// a FULL port (since step 3f-6), so parity.spec.ts also compares its exports.
//
// PORTED: every pure test of tests/untold-changes.test.mjs (the banner's rules, the gate, the boundaries, `orderedToday`, and the
// units sections); the 7 tests of «1. confirmedEntries» and the 6 of «2. askedToday» in tests/place-confirm.test.mjs; the 2
// confirmedEntries tests of tests/orders-unit-choice-data.test.mjs; plus one added here (an ingredient with no id is skipped).
//
// LEFT OUT (they read source text, the dictionary or the precache list, which Mise 2 has no equivalent of; they still run on the
// current app's side through tests/untold-changes.test.mjs and tests/place-confirm.test.mjs):
//   - «the banner is repainted when the draft changes AND when a list arrives», «the banner offers no way to dismiss it»,
//     «"send the list again" is offered only when that road is open», «what was already ordered is drawn as its own block»,
//     «the sent list is told what was actually ordered», «a row that has been ordered is not also asked whether the order moved» —
//     regexes over js/orders/orders-main.js, untold-view.js, order-requests.js and orders.css. What they pin (a repaint on both
//     paths, no dismissal, its own block for what was already ordered) belongs to the Mise 2 screen and is tested there.
//   - «the new modules are precached», «the banner has somewhere to be drawn» — js/ precache list and orders.html.
//   - «every new phrase exists in BOTH languages» — the dictionary, which in Mise 2 belongs to the app.
//   - the entriesToRecord test of place-confirm.test.mjs, which reads the source of orders-main.js.

import { describe, expect, test } from 'vitest';
import * as ported from './untold-changes';
import { buildSupplierArchive } from './archive';
import * as legacyJs from '../../js/orders/untold-changes.js';

const legacy = legacyJs as unknown as typeof ported;

const ING = [
  { id: 'flour', name: 'Flour', supplierId: 's1' },
  { id: 'bacon', name: 'Bacon', supplierId: 's1' },
  { id: 'milk', name: 'Milk', supplierId: 's1' },
];
const SUPPLIER = { id: 's1', name: 'Cielo' };
const CARD = { id: 'flour', name: 'Farina', weight: '2.5 kg', supplierId: 'sup', unit: 'cartone', packUnit: 'busta' };

// ── untoldChanges fixtures ──
const TODAY = '2026-08-24';
const SUPPLIERS = [{ id: 's1', name: 'Brava Fresh' }];
const BANNER_ING = [
  { id: 'flour', name: 'Flour', supplierId: 's1' },
  { id: 'bacon', name: 'Bacon', supplierId: 's1' },
  { id: 'olives', name: 'Olives', supplierId: 's2' },
];

type Source = { id?: string; date?: string; quantities?: Record<string, number>; supplierOf?: Record<string, string>; units?: Record<string, string>; [key: string]: unknown };

const list = (quantities: Record<string, number>, over: Source = {}): Source => ({
  date: TODAY,
  quantities,
  supplierOf: Object.fromEntries(Object.keys(quantities).map(k => [k, 's1'])),
  fromName: 'Marco',
  ...over,
});
const record = (quantities: Record<string, number>, over: Source = {}): Source => ({
  id: `${TODAY}_s1`, date: TODAY, supplierId: 's1', quantities, ...over,
});
const entriesOf = (obj: Record<string, number>): Record<string, { qty: number }> =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { qty: v }]));

const request = (over: Source = {}): Source => ({
  date: '2026-08-24',
  quantities: { flour: 4 },
  supplierOf: { flour: 's1' },
  ...over,
});

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { confirmedEntries, askedToday, orderedToday, untoldChanges } = m;

  // ── confirmedEntries ───────────────────────────────────────────────────────

  test('the confirmed number is what comes back, not the live one', () => {
    const live = { flour: { qty: 6, stock: 2 } };
    const out = confirmedEntries(live, ING, { flour: 4 });
    expect(out.flour!.qty).toBe(4);
  });

  // ⚠️⚠️ THE ONE THAT MATTERS MOST. A row the confirmer zeroed is simply ABSENT from
  // what comes back from the screen. Leaving it alone would record the live quantity
  // they had just refused — the exact opposite of what they said, and silently.
  test('⚠️⚠️ a row set to 0 is recorded as 0, never left at the live quantity', () => {
    const live = { flour: { qty: 6 }, bacon: { qty: 3 } };
    const out = confirmedEntries(live, ING, { flour: 4 });   // bacon was zeroed
    expect(out.bacon!.qty, 'a refused row must not survive on the live value').toBe(0);

    const archived = buildSupplierArchive({
      supplier: SUPPLIER, ingredients: ING, entries: out, date: '2026-08-24',
    })!;
    expect(archived.quantities, 'and it must not reach History').toStrictEqual({ flour: 4 });
  });

  test('⚠️ the caller’s entries are never mutated — a draft save holds them by reference', () => {
    const live = { flour: { qty: 6, stock: 2 } };
    const before = JSON.stringify(live);
    confirmedEntries(live, ING, { flour: 4 });
    expect(JSON.stringify(live),
      'confirming an order must not rewrite the shared order everybody else is typing into').toBe(before);
  });

  test('⚠️ another supplier’s rows are untouched — one order, one supplier', () => {
    const live = { flour: { qty: 6 }, olives: { qty: 9 } };
    const out = confirmedEntries(live, ING, { flour: 4 });
    expect(out.olives!.qty).toBe(9);
  });

  test('the stock reading survives — counting the shelves is not what was confirmed', () => {
    const out = confirmedEntries({ flour: { qty: 6, stock: 3 } }, ING, { flour: 4 });
    expect(out.flour!.stock).toBe(3);
  });

  test('junk quantities become 0, never NaN — Firestore refuses a non-finite number', () => {
    const live = { flour: { qty: 6 }, bacon: { qty: 6 }, milk: { qty: 6 } };
    const out = confirmedEntries(live, ING, { flour: -4, bacon: 'x', milk: Infinity });
    expect([out.flour!.qty, out.bacon!.qty, out.milk!.qty]).toStrictEqual([0, 0, 0]);
  });

  test('no entries, no ingredients, no quantities — nothing throws', () => {
    expect(confirmedEntries(null, null, null)).toStrictEqual({});
    expect(confirmedEntries(undefined, ING, undefined))
      .toStrictEqual({ flour: { qty: 0 }, bacon: { qty: 0 }, milk: { qty: 0 } });
  });

  test('confirmedEntries keeps the unit of the row it confirms', () => {
    const out = confirmedEntries({ flour: { qty: 9, stock: 1, unit: 'busta' } }, [CARD], { flour: 2 });
    expect(out.flour).toStrictEqual({ qty: 2, stock: 1, unit: 'busta' });
  });

  test('confirmedEntries records the unit the screen SHOWED, not the live one', () => {
    const live = { flour: { qty: 9, stock: 1, unit: 'busta' } };
    const out = confirmedEntries(live, [CARD], { flour: 2 }, { flour: 'cartone' });
    expect(out.flour!.unit).toBe('cartone');
    expect(live.flour.unit, 'the live draft is never touched').toBe('busta');
    expect(confirmedEntries(live, [CARD], { flour: 2 }).flour!.unit, 'no units given: as before').toBe('busta');
  });

  test('an ingredient with no id is skipped', () => {
    expect(confirmedEntries({}, [null, { name: 'No id' }, { id: '' }], { x: 1 })).toStrictEqual({});
  });

  // ── askedToday — what the confirmer is shown they were asked for ───────────

  test('what today’s lists asked for, per supplier', () => {
    expect(askedToday([request()], 's1', '2026-08-24')).toStrictEqual({ flour: 4 });
  });

  // ⚠️ A sent list is frozen, so a SECOND list is how somebody adds a forgotten item, and both are still on the manager's screen.
  // Reading only the newest would answer "asked for 2" when an earlier list had already asked for 6.
  test('⚠️ two lists the same day: the HIGHEST wins, not the latest', () => {
    const lists = [
      request({ quantities: { flour: 6 }, createdAt: 'a' }),
      request({ quantities: { flour: 2 }, createdAt: 'b' }),
    ];
    expect(askedToday(lists, 's1', '2026-08-24')).toStrictEqual({ flour: 6 });
  });

  test('another supplier’s lines are not counted', () => {
    const other = request({
      quantities: { flour: 4, olives: 9 },
      supplierOf: { flour: 's1', olives: 's2' },
    });
    expect(askedToday([other], 's1', '2026-08-24')).toStrictEqual({ flour: 4 });
  });

  test('yesterday’s list is not today’s question', () => {
    expect(askedToday([request({ date: '2026-08-23' })], 's1', '2026-08-24')).toStrictEqual({});
  });

  // ⚠️ THE SCREEN READS `undefined` AS "NOBODY ASKED" AND DRAWS NOTHING. A 0 here would read as "they asked for none of it", which
  // is a different statement and a false one.
  test('⚠️ a row no list carried is ABSENT, not 0', () => {
    const out = askedToday([request()], 's1', '2026-08-24');
    expect(out.bacon).toBeUndefined();
  });

  test('junk lists are ignored rather than throwing', () => {
    expect(askedToday(null, 's1', '2026-08-24')).toStrictEqual({});
    expect(askedToday([null, {}, { date: '2026-08-24' }], 's1', '2026-08-24')).toStrictEqual({});
  });

  // ── untoldChanges ──────────────────────────────────────────────────────────

  const run = ({ requests = [], history = [], draft = {} }: { requests?: Source[]; history?: Source[]; draft?: Record<string, number> }) =>
    untoldChanges({
      suppliers: SUPPLIERS, ingredients: BANNER_ING, entries: entriesOf(draft),
      requests, history, today: TODAY,
    });

  // 1. The case that was invisible.

  // ⚠️⚠️ THE WHOLE POINT. Bacon was not on the list at all, so liveDifference — which walks the list's own rows — could never have
  // mentioned it.
  test('⚠️⚠️ an ingredient ADDED after the list was sent is reported', () => {
    const out = run({ requests: [list({ flour: 4 })], draft: { flour: 4, bacon: 3 } });
    expect(out.length).toBe(1);
    expect(out[0]!.rows.map(r => r.id)).toStrictEqual(['bacon']);
    expect(out[0]!.rows[0]!.extra).toBe(3);
  });

  test('a quantity RAISED after the list was sent is reported, with the difference', () => {
    const out = run({ requests: [list({ flour: 4 })], draft: { flour: 6 } });
    expect(out[0]!.rows[0]!.extra, 'two more than anybody was told about').toBe(2);
  });

  // ⚠️ The app must not comment on work nobody has to redo.
  test('a quantity LOWERED, or unchanged, says nothing', () => {
    expect(run({ requests: [list({ flour: 4 })], draft: { flour: 2 } })).toStrictEqual([]);
    expect(run({ requests: [list({ flour: 4 })], draft: { flour: 4 } })).toStrictEqual([]);
  });

  // 2. The case the app cannot put right.

  // ⚠️⚠️ ALREADY ORDERED IS ITS OWN ANSWER. Everything else is an addition somebody still has time to act on; this one has been
  // said down a telephone already.
  test('⚠️⚠️ a row raised AFTER it was ordered is separated from the rest', () => {
    const out = run({
      requests: [list({ flour: 4 })],
      history: [record({ flour: 4 })],
      draft: { flour: 6, bacon: 2 },
    });
    expect(out[0]!.afterOrdering.map(r => r.id)).toStrictEqual(['flour']);
    expect(out[0]!.added.map(r => r.id)).toStrictEqual(['bacon']);
    expect(out[0]!.afterOrdering[0]!.ordered, 'it says how much had gone out').toBe(4);
    expect(out[0]!.afterOrdering[0]!.live, 'and how much is being asked for now').toBe(6);
  });

  test('every row of one supplier is either an addition or an after-ordering row', () => {
    const out = run({
      requests: [list({ flour: 4 })],
      history: [record({ flour: 4 })],
      draft: { flour: 6, bacon: 2 },
    });
    expect(out[0]!.added.length + out[0]!.afterOrdering.length).toBe(out[0]!.rows.length);
  });

  // 3. Why it stays quiet.

  // ⚠️⚠️ THE GATE. Before anybody has been told anything, an order being typed is simply an order being typed — reporting it would
  // be an alarm that is always on.
  test('⚠️⚠️ nothing sent and nothing ordered today: silence, however full the order', () => {
    expect(run({ draft: { flour: 99, bacon: 99 } })).toStrictEqual([]);
  });

  test('yesterday’s list does not open the question for today', () => {
    expect(run({ requests: [list({ flour: 4 }, { date: '2026-08-23' })], draft: { flour: 9 } })).toStrictEqual([]);
  });

  // ⚠️ Recording an order CLEARS that supplier's rows, so the live order drops to 0 and the answer is silence. An alarm that fires
  // when everything went right is an alarm people learn to ignore.
  test('⚠️ after the order is recorded and the rows cleared, it goes quiet by itself', () => {
    expect(run({
      requests: [list({ flour: 4 })], history: [record({ flour: 4 })], draft: {},
    })).toStrictEqual([]);
  });

  test('⚠️ sending the list again also silences it — `told` catches up with the order', () => {
    const before = run({ requests: [list({ flour: 4 })], draft: { flour: 6 } });
    expect(before.length).toBe(1);
    const after = run({
      requests: [list({ flour: 4 }), list({ flour: 6 })], draft: { flour: 6 },
    });
    expect(after).toStrictEqual([]);
  });

  // 4. Boundaries.

  test('another supplier’s ingredients are never counted against this one', () => {
    const out = run({ requests: [list({ flour: 4 })], draft: { flour: 4, olives: 50 } });
    expect(out, 'olives belong to s2 and s2 has been told nothing').toStrictEqual([]);
  });

  test('the larger of "asked" and "ordered" is the baseline, not their sum', () => {
    const out = run({
      requests: [list({ flour: 4 })], history: [record({ flour: 6 })], draft: { flour: 6 },
    });
    expect(out, 'ordered 6 covers a list that asked for 4').toStrictEqual([]);
  });

  test('the row carries the supplier’s name and the ingredient’s, for the screen', () => {
    const out = run({ requests: [list({ flour: 4 })], draft: { flour: 4, bacon: 1 } });
    expect(out[0]!.supplierName).toBe('Brava Fresh');
    expect(out[0]!.supplierId).toBe('s1');
    expect(out[0]!.rows[0]!.name).toBe('Bacon');
  });

  test('junk in, no throw out', () => {
    expect(untoldChanges()).toStrictEqual([]);
    expect(untoldChanges({})).toStrictEqual([]);
    expect(untoldChanges({ suppliers: [null, {}], ingredients: null })).toStrictEqual([]);
  });

  // 5. orderedToday.

  test('orderedToday reads the day’s record for that supplier only', () => {
    const history = [record({ flour: 4 }), { id: `${TODAY}_s2`, quantities: { olives: 9 } }];
    expect(orderedToday(history, 's1', TODAY)).toStrictEqual({ flour: 4 });
    expect(orderedToday(history, 's9', TODAY)).toStrictEqual({});
    expect(orderedToday(null, 's1', TODAY)).toStrictEqual({});
  });

  // ── Units: told and ordered count only in the unit the row means now ───────

  const CARD_ING = [{ id: 'flour', name: 'Flour', supplierId: 's1', unit: 'cartone', packUnit: 'busta' }];
  const runUnits = ({ requests = [], history = [], draft }: { requests?: Source[]; history?: Source[]; draft: Record<string, { qty: number; unit?: string }> }) =>
    untoldChanges({
      suppliers: SUPPLIERS, ingredients: CARD_ING, entries: draft, requests, history, today: TODAY,
    });

  test('⚠️ 2 cartoni told, then the line becomes 2 buste: reported in full', () => {
    const told = list({ flour: 2 }, { units: { flour: 'cartone' } });
    const out = runUnits({ requests: [told], draft: { flour: { qty: 2, unit: 'busta' } } });
    expect(out.length, 'the gate still opens: a list WAS sent').toBe(1);
    expect(out[0]!.rows[0]!.extra).toBe(2);
  });

  test('the same unit still quiets the row, whatever the capitals', () => {
    const told = list({ flour: 2 }, { units: { flour: 'Busta' } });
    expect(runUnits({ requests: [told], draft: { flour: { qty: 2, unit: 'busta' } } })).toStrictEqual([]);
  });

  test('a list with no stored unit is in the card’s unit', () => {
    const told = list({ flour: 2 });
    expect(runUnits({ requests: [told], draft: { flour: { qty: 2 } } })).toStrictEqual([]);
    expect(runUnits({ requests: [told], draft: { flour: { qty: 2, unit: 'busta' } } })[0]!.rows[0]!.extra).toBe(2);
  });

  test('an order already placed in another unit is «already ordered», never matched', () => {
    const placed = record({ flour: 2 }, { units: { flour: 'cartone' } });
    const out = runUnits({ history: [placed], draft: { flour: { qty: 2, unit: 'busta' } } });
    expect(out[0]!.rows[0]!.extra).toBe(2);
    expect(out[0]!.rows[0]!.alreadyOrdered).toBe(true);
  });

  test('orderedToday keeps only the lines in the unit asked for', () => {
    const placed = record({ flour: 2, bacon: 1 }, { units: { flour: 'busta' } });
    const live = { flour: { ing: CARD_ING[0], unit: 'cartone' } };
    expect(orderedToday([placed], 's1', TODAY, live)).toStrictEqual({ bacon: 1 });
  });
});
