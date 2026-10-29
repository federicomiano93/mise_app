// Tests for the Orders suggestion engine (P15), run against BOTH implementations: the TypeScript port in shared/ and
// js/orders/suggestions.js, which the live app uses today. The module is a FULL port, so parity.spec.ts also compares its
// exports.
//
// PORTED: all 26 tests of tests/suggestions.test.mjs and both of tests/suggestions-index.test.mjs. None left out: every
// one calls the pure functions.
//
//   par        = average, over the recent ORDERS of that ingredient, of (stock on hand + quantity ordered)
//   suggestion = round(par − current stock), floored at 0
// Hidden until 4 orders exist for that ingredient; the average uses at most the 8 most recent.

import { describe, expect, test } from 'vitest';
import * as ported from './suggestions';
import * as legacyJs from '../../js/orders/suggestions.js';

const legacy = legacyJs as unknown as typeof ported;

// One order of `id`: ordered `qty`, had `stock` on hand, placed on `date`.
const order = (date: string, id: string, qty: unknown, stock: unknown) => ({
  date, supplierId: 'alba', quantities: { [id]: qty }, stock: { [id]: stock },
});
// A record from the old weekly model: no date, no supplierId.
const legacyWeek = (weekStart: string, id: string, qty: unknown, stock: unknown) => ({
  weekStart, quantities: { [id]: qty }, stock: { [id]: stock },
});

const four = (qty: number, stock: number) =>
  ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'].map(d => order(d, 'flour', qty, stock));

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { computeSuggestion, isUnusualQuantity, unusualQuantities, indexHistoryByIngredient, UNUSUAL_FACTOR, UNUSUAL_MARGIN } = m;

  test('stays inactive with fewer than 4 orders, counting down', () => {
    const history = [order('2026-07-06', 'flour', 10, 2), order('2026-07-07', 'flour', 10, 2), order('2026-07-08', 'flour', 10, 2)];
    expect(computeSuggestion('flour', 5, history)).toStrictEqual({ active: false, ordersRemaining: 1 });
  });

  test('with no history at all it needs the full 4 orders', () => {
    expect(computeSuggestion('flour', 5, [])).toStrictEqual({ active: false, ordersRemaining: 4 });
    expect(computeSuggestion('flour', 5, null)).toStrictEqual({ active: false, ordersRemaining: 4 });
  });

  test('par is the average of (stock + ordered); suggestion tops up to par', () => {
    // Four orders, each level = 10 ordered + 2 stock = 12 → par 12; stock 5 → order 7.
    expect(computeSuggestion('flour', 5, four(10, 2))).toStrictEqual({ active: true, suggestion: 7, par: 12 });
  });

  test('the average uses only the 8 most recent orders', () => {
    const history = [order('2026-05-01', 'flour', 1000, 0)];
    for (let d = 1; d <= 8; d++) history.push(order(`2026-07-${String(d).padStart(2, '0')}`, 'flour', 10, 0));
    expect(computeSuggestion('flour', 0, history)).toStrictEqual({ active: true, suggestion: 10, par: 10 });
  });

  test('orders that did not include this ingredient are not counted toward the minimum', () => {
    const history = [
      order('2026-07-06', 'flour', 10, 0), order('2026-07-07', 'flour', 10, 0), order('2026-07-08', 'flour', 10, 0),
      order('2026-07-09', 'yeast', 5, 1),
    ];
    expect(computeSuggestion('flour', 0, history)).toStrictEqual({ active: false, ordersRemaining: 1 });
  });

  test('a stock reading with nothing ordered does NOT count as an order', () => {
    // The guard rail against the par ratchet: counting it would make par climb every slow week, for ever.
    const history = [
      order('2026-07-06', 'flour', 10, 0), order('2026-07-07', 'flour', 10, 0), order('2026-07-08', 'flour', 10, 0),
      { date: '2026-07-09', supplierId: 'alba', quantities: {}, stock: { flour: 40 } },
    ];
    expect(computeSuggestion('flour', 0, history)).toStrictEqual({ active: false, ordersRemaining: 1 });
  });

  test('suggestion never goes negative: plenty of stock means order nothing', () => {
    expect(computeSuggestion('flour', 100, four(10, 2))).toStrictEqual({ active: true, suggestion: 0, par: 12 });
  });

  test('a junk current-stock value is treated as zero, never NaN', () => {
    const result = computeSuggestion('flour', 'abc', four(10, 0));
    expect(result).toStrictEqual({ active: true, suggestion: 10, par: 10 });
  });

  test('a missing stock map defaults an order to ordered-only', () => {
    const history = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
      .map(date => ({ date, supplierId: 's', quantities: { flour: 8 } }));
    expect(computeSuggestion('flour', 0, history)).toStrictEqual({ active: true, suggestion: 8, par: 8 });
  });

  test('old weekly records and new daily ones mix, and sort together correctly', () => {
    const history = [
      legacyWeek('2026-07-06', 'flour', 20, 0),
      order('2026-07-13', 'flour', 10, 0), order('2026-07-20', 'flour', 10, 0), order('2026-07-27', 'flour', 10, 0),
    ];
    // par = (20 + 10 + 10 + 10) / 4 = 12.5 → 13.
    expect(computeSuggestion('flour', 0, history)).toStrictEqual({ active: true, suggestion: 13, par: 13 });
  });

  // ── Corrupt stored data must never reach the screen ──
  test('a junk string in a stored quantity never produces NaN', () => {
    const history = [
      order('2026-07-01', 'flour', 10, 0), order('2026-07-02', 'flour', 10, 0), order('2026-07-03', 'flour', 10, 0),
      { date: '2026-07-04', supplierId: 's', quantities: { flour: 'HELLO' }, stock: { flour: 0 } },
    ];
    expect(computeSuggestion('flour', 0, history)).toStrictEqual({ active: true, suggestion: 8, par: 8 });
  });

  test('Infinity, null and a negative quantity are all treated as zero', () => {
    const history = [
      order('2026-07-01', 'flour', 12, 0), order('2026-07-02', 'flour', 12, 0),
      { date: '2026-07-03', supplierId: 's', quantities: { flour: Infinity }, stock: { flour: 0 } },
      { date: '2026-07-04', supplierId: 's', quantities: { flour: -50 }, stock: { flour: null } },
    ];
    expect(computeSuggestion('flour', 0, history)).toStrictEqual({ active: true, suggestion: 6, par: 6 });
  });

  test('a junk CURRENT stock reading cannot produce NaN either', () => {
    for (const junk of ['abc', NaN, Infinity, -5, null, undefined, {}]) {
      const result = computeSuggestion('flour', junk, four(10, 0));
      expect(result.active && result.suggestion, String(junk)).toBe(10);
    }
  });

  // ── Catching a slip of the finger ──
  test('a tenfold typo is flagged at every scale', () => {
    for (const [usual, typo] of [[8, 80], [30, 300], [2, 20], [50, 500]]) {
      expect(isUnusualQuantity(typo, usual), `${typo} against ${usual}`).toBe(true);
    }
  });

  test('ordering the usual amount, or a bit more, is never flagged', () => {
    for (const [usual, qty] of [[8, 8], [8, 10], [8, 16], [30, 45], [30, 60], [2, 5]]) {
      expect(isUnusualQuantity(qty, usual), `${qty} against ${usual}`).toBe(false);
    }
  });

  test('a small usual amount needs a real jump, not just a multiple', () => {
    expect(isUnusualQuantity(4, 1)).toBe(false);
    expect(isUnusualQuantity(10, 1)).toBe(false);
    expect(isUnusualQuantity(11, 1)).toBe(true);
    expect(UNUSUAL_MARGIN).toBe(10);
    expect(UNUSUAL_FACTOR).toBe(4);
  });

  test('no usual amount yet means no warning', () => {
    expect(isUnusualQuantity(300, 0)).toBe(false);
    expect(isUnusualQuantity(300, null)).toBe(false);
    expect(isUnusualQuantity(300, undefined)).toBe(false);
  });

  test('junk in either argument is silent, never a crash or a false alarm', () => {
    for (const bad of ['abc', NaN, Infinity, -5, null, undefined, {}, []]) {
      expect(isUnusualQuantity(bad, 8)).toBe(false);
      expect(isUnusualQuantity(80, bad)).toBe(false);
    }
  });

  // ── The rows of one order ──
  const ING = [{ id: 'flour', name: 'Flour 25kg' }, { id: 'milk', name: 'Milk 6x1L' }, { id: 'new', name: 'New thing' }];
  const suggest = (id: string) => (({
    flour: { active: true, par: 8 },
    milk: { active: true, par: 30 },
    new: { active: false },
  } as Record<string, { active: boolean; par?: number }>)[id] || { active: false });

  test('only the rows that look wrong are reported, worst first', () => {
    const found = unusualQuantities(ING, { flour: { qty: 80 }, milk: { qty: 45 }, new: { qty: 999 } }, suggest);
    expect(found).toStrictEqual([{ id: 'flour', name: 'Flour 25kg', qty: 80, usual: 8 }]);
  });

  test('several suspicious rows come back with the biggest surprise first', () => {
    expect(unusualQuantities(ING, { flour: { qty: 40 }, milk: { qty: 900 } }, suggest).map(r => r.id)).toStrictEqual(['milk', 'flour']);
  });

  test('an order with nothing odd in it reports nothing', () => {
    expect(unusualQuantities(ING, { flour: { qty: 8 }, milk: { qty: 30 } }, suggest)).toStrictEqual([]);
    expect(unusualQuantities(ING, {}, suggest)).toStrictEqual([]);
    expect(unusualQuantities([], {}, suggest)).toStrictEqual([]);
    expect(unusualQuantities(null, null, suggest)).toStrictEqual([]);
  });

  test('a row left at zero is not an order and is never flagged', () => {
    expect(unusualQuantities(ING, { flour: { qty: 0 } }, suggest)).toStrictEqual([]);
  });

  // ── The unit an order was placed in ──
  const CARD = { id: 'flour', unit: 'cartone', packUnit: 'busta' };
  const inUnit = (date: string, qty: number, stock: number, unit?: string) =>
    ({ ...order(date, 'flour', qty, stock), ...(unit ? { units: { flour: unit } } : {}) });

  test('⚠️ orders placed in another unit are left out of the par level', () => {
    const history = [
      inUnit('2026-09-01', 4, 0), inUnit('2026-09-02', 4, 0), inUnit('2026-09-03', 4, 0), inUnit('2026-09-04', 4, 0, 'cartone'),
      inUnit('2026-09-05', 40, 0, 'busta'), inUnit('2026-09-06', 40, 0, 'busta'),
    ];
    const r = computeSuggestion('flour', 0, history, CARD);
    expect(r).toStrictEqual({ active: true, suggestion: 4, par: 4 });
    // Without the card every order counts, as before the choice existed.
    const without = computeSuggestion('flour', 0, history);
    expect(without.active && without.par).not.toBe(4);
  });

  test('orders in another unit do not count toward the four needed to activate', () => {
    const history = [inUnit('2026-09-01', 4, 0), inUnit('2026-09-02', 4, 0), inUnit('2026-09-03', 4, 0, 'busta'), inUnit('2026-09-04', 4, 0, 'busta')];
    expect(computeSuggestion('flour', 0, history, CARD)).toStrictEqual({ active: false, ordersRemaining: 2 });
  });

  test('the unit is compared ignoring capitals and spaces', () => {
    const history = ['01', '02', '03', '04'].map(d => inUnit(`2026-09-${d}`, 3, 0, ' Cartone '));
    expect(computeSuggestion('flour', 0, history, CARD).active).toBe(true);
  });

  test('a line in another unit than the card has no «usual» in the unusual-quantity check', () => {
    const always = () => ({ active: true, par: 4 });
    expect(unusualQuantities([CARD], { flour: { qty: 300, unit: 'busta' } }, always)).toStrictEqual([]);
    expect(unusualQuantities([CARD], { flour: { qty: 300 } }, always)).toHaveLength(1);
  });

  // ── The per-ingredient index (tests/suggestions-index.test.mjs) ──
  test('computeSuggestion gives the same answer from the per-ingredient index as from the whole history', () => {
    const history = [
      order('2026-07-06', 'flour', 10, 2), order('2026-07-07', 'flour', 12, 1), order('2026-07-07', 'sugar', 3, 1),
      order('2026-07-08', 'flour', 9, 4), order('2026-07-09', 'flour', 11, 0), order('2026-07-10', 'flour', 10, 2),
      order('2026-07-10', 'butter', 5, 0), legacyWeek('2026-06-29', 'flour', 20, 5), legacyWeek('2026-06-22', 'sugar', 4, 0),
      { date: '2026-07-11', supplierId: 'alba', quantities: { flour: 8 } },
      { date: '2026-07-12', supplierId: 'alba', quantities: { flour: '7', sugar: 'abc' }, stock: { flour: '2' } },
      { date: '2026-07-13', supplierId: 'alba', units: { flour: 'busta' }, quantities: { flour: 2 }, stock: { flour: 1 } },
      { date: '2026-07-14', supplierId: 'alba', stock: { flour: 3 } },
      { date: '2026-07-15', supplierId: 'alba', quantities: { flour: 6 }, stock: { flour: 1 } },
      { date: '2026-07-15', supplierId: 'borgo', quantities: { flour: 14 }, stock: { flour: 1 } },
      { date: '2026-07-16', supplierId: 'alba', quantities: { flour: 6 }, stock: { flour: 1 } },
      { date: '2026-07-17', supplierId: 'alba', quantities: { flour: 6 }, stock: { flour: 1 } },
      {},
      { date: '2026-07-18', supplierId: 'alba' },
    ];
    const cards = [null, { id: 'flour', unit: 'cartone' }, { id: 'flour', unit: 'busta' }, { id: 'flour', unit: 'kg' }, { id: 'sugar', unit: 'cartone' }];
    const index = indexHistoryByIngredient(history);
    for (const id of ['flour', 'sugar', 'butter', 'nothing-ever-ordered']) {
      for (const ing of cards) {
        for (const stock of [undefined, 0, 3, '5', 'x', -2, 1e9]) {
          expect(computeSuggestion(id, stock, index.get(id) || [], ing), `${id} / ${JSON.stringify(ing)} / ${String(stock)}`)
            .toStrictEqual(computeSuggestion(id, stock, history, ing));
        }
      }
    }
  });

  test('indexHistoryByIngredient lists each ingredient newest first and survives odd input', () => {
    const index = indexHistoryByIngredient([
      order('2026-07-06', 'flour', 1, 0), legacyWeek('2026-07-09', 'flour', 2, 0), order('2026-07-07', 'flour', 3, 0),
      null, { date: '2026-07-01' },
    ]);
    expect(index.get('flour')!.map(r => (r as { date?: string; weekStart?: string }).date || (r as { weekStart?: string }).weekStart))
      .toStrictEqual(['2026-07-09', '2026-07-07', '2026-07-06']);
    expect(index.has('sugar')).toBe(false);
    expect(indexHistoryByIngredient(undefined).size).toBe(0);
  });
});
