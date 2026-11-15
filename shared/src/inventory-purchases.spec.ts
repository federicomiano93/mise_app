// Unit tests for what a month's orders say was bought (P15 — the owner cannot read code, so these
// tests are the safety net), run against BOTH implementations: the TypeScript port in shared/ and
// js/inventory/inventory-purchases.js, which the live app uses today. Ported from
// tests/inventory-purchases.test.mjs and, for qtyInCardUnit, tests/readers-regression-grid.test.mjs;
// the two must stay equal until the switch to Mise 2. The module is a FULL port, so parity.spec.ts also
// compares its exports name by name.
//
// The figure this produces lands in a subtraction the owner makes business decisions on, and he cannot
// read the code that produces it. The two tests that matter most: the retired weekly record must never
// leak into a month, and an item marked as never delivered must not count as bought.
//
// Each side is tested with its OWN neighbours (the TypeScript module reads the TypeScript order-unit
// and price-model, the js/ one the js/ ones), so a test never mixes the two apps.
//
// PORTED: 24 of the 25 tests of tests/inventory-purchases.test.mjs, and from
// tests/readers-regression-grid.test.mjs the grid of qtyInCardUnit, with 'the grid is big enough…'.
//
// NOT PORTED:
//   * 'the sentence exists in English and Italian and inventory imports only from js/ root' — it reads
//     js/i18n.js and js/inventory/inventory-purchases.js as text (the dictionary, and a rule about the
//     files of the current app). The sentence itself belongs to the app's dictionary in Mise 2, and
//     the import rule is architecture.md's: shared/ never imports from a feature.
//   * The rest of tests/readers-regression-grid.test.mjs is the order-cost's grid (order-cost.spec.ts)
//     and the value's (inventory-value.spec.ts).
//
// A FROZEN COPY runs in the grid: tests/helpers/legacy-inventory-purchases.mjs, taken from
// `git show main:…` before «Cartone» (1 Oct 2026). Both files are held to it, number for number.

import { describe, expect, test } from 'vitest';
import * as ported from './inventory-purchases';
import * as legacyJs from '../../js/inventory/inventory-purchases.js';
import * as frozenOld from '../../tests/helpers/legacy-inventory-purchases.mjs';

const legacy = legacyJs as unknown as typeof ported;

const FLOUR = 'flour';
const BUTTER = 'butter';

const order = (date: unknown, quantities: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  bakery: 'main', date, supplierId: 'alba', supplierName: 'Alba',
  quantities, stock: {}, createdAt: date, updatedAt: date, ...over,
});

// A «cartone» card holding 4 × «busta», priced by the case (the case is what lets a line
// in buste be counted in cartoni).
const CASED = {
  id: 'flour', unit: 'cartone', packUnit: 'busta',
  priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
};
const UNCASED = { id: 'flour', unit: 'cartone', packUnit: 'busta' };
const withUnits = (qty: number, unit: string): Record<string, unknown> =>
  order('2026-09-04', { flour: qty }, { units: { flour: unit } });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── Which records belong to the month ──────────────────────────────────────

  test('a record belongs to the month its date falls in', () => {
    expect(m.isInMonth(order('2026-09-04', {}), '2026-09')).toBe(true);
    expect(m.isInMonth(order('2026-08-31', {}), '2026-09')).toBe(false);
    expect(m.isInMonth(order('2026-10-01', {}), '2026-09')).toBe(false);
  });

  test('⚠️ the retired weekly record belongs to NO month', () => {
    // The one such document in production is `2026-W28` from July 2026: it has
    // `weekStart` instead of `date` and merges every supplier into one map. Guessing
    // a date for it would drop somebody else's July into somebody's September.
    const retired = { bakery: 'main', weekStart: '2026-07-06', quantities: { [FLOUR]: 9 }, stock: {} };
    expect(m.isInMonth(retired, '2026-07')).toBe(false);
    expect(m.purchasesInMonth([retired], '2026-07').totals).toStrictEqual({});
  });

  test('a date that is not a date is dropped rather than guessed at', () => {
    expect(m.isInMonth(order('4 September', {}), '2026-09')).toBe(false);
    expect(m.isInMonth(order(20260904, {}), '2026-09')).toBe(false);
    expect(m.isInMonth(null, '2026-09')).toBe(false);
  });

  // ── What one order brought in ──────────────────────────────────────────────

  test('what was ordered is what came in, unless somebody said otherwise', () => {
    expect(m.receivedFrom(order('2026-09-04', { [FLOUR]: 10, [BUTTER]: 2 })))
      .toStrictEqual({ [FLOUR]: 10, [BUTTER]: 2 });
  });

  test('⚠️ an item marked as never delivered did not come in', () => {
    const rec = order('2026-09-04', { [FLOUR]: 10, [BUTTER]: 2 }, { missing: { [BUTTER]: true } });
    expect(m.receivedFrom(rec)).toStrictEqual({ [FLOUR]: 10 });
  });

  test('a missing mark for something never ordered is meaningless, not a phantom row', () => {
    const rec = order('2026-09-04', { [FLOUR]: 10 }, { missing: { [BUTTER]: true } });
    expect(m.receivedFrom(rec)).toStrictEqual({ [FLOUR]: 10 });
  });

  test('a missing entry that is not a true is not a missing entry', () => {
    const rec = order('2026-09-04', { [FLOUR]: 10 }, { missing: { [FLOUR]: 'yes' } });
    expect(m.receivedFrom(rec)).toStrictEqual({ [FLOUR]: 10 });
  });

  test('a zero or junk quantity brings nothing in and never becomes NaN', () => {
    const rec = order('2026-09-04', { a: 0, b: -3, c: 'HELLO', d: Infinity, e: null, f: 2 });
    expect(m.receivedFrom(rec)).toStrictEqual({ f: 2 });
  });

  test('a record with no maps at all cannot throw', () => {
    expect(m.receivedFrom({})).toStrictEqual({});
    expect(m.receivedFrom(null)).toStrictEqual({});
  });

  // ── The month, added up ────────────────────────────────────────────────────

  test('every order of the month is added up, per product', () => {
    const out = m.purchasesInMonth([
      order('2026-09-04', { [FLOUR]: 10 }),
      order('2026-09-18', { [FLOUR]: 6, [BUTTER]: 2 }),
      order('2026-08-30', { [FLOUR]: 99 }),
      order('2026-10-02', { [FLOUR]: 99 }),
    ], '2026-09');
    expect(out.totals).toStrictEqual({ [FLOUR]: 16, [BUTTER]: 2 });
    expect(out.orders).toBe(2);
    expect(out.products).toBe(2);
  });

  test('two suppliers selling the same product add up — it is one shelf', () => {
    const out = m.purchasesInMonth([
      order('2026-09-04', { [FLOUR]: 10 }, { supplierId: 'alba' }),
      order('2026-09-05', { [FLOUR]: 4 }, { supplierId: 'other' }),
    ], '2026-09');
    expect(out.totals).toStrictEqual({ [FLOUR]: 14 });
  });

  test('halves add up without leaving float dust behind', () => {
    const out = m.purchasesInMonth([
      order('2026-09-04', { [FLOUR]: 0.1 }),
      order('2026-09-05', { [FLOUR]: 0.2 }),
    ], '2026-09');
    expect(out.totals[FLOUR]).toBe(0.3);
  });

  test('a month with no orders proposes nothing, and says so without failing', () => {
    const out = m.purchasesInMonth([], '2026-09');
    expect(out).toStrictEqual({ totals: {}, orders: 0, products: 0, unconverted: [] });
    expect(m.purchasesInMonth(null, '2026-09').totals).toStrictEqual({});
  });

  // ── Units ──────────────────────────────────────────────────────────────────

  test('a line in the card’s own unit counts as before', () => {
    const r = m.purchasesInMonth([withUnits(3, 'cartone')], '2026-09', { flour: UNCASED });
    expect(r.totals).toStrictEqual({ flour: 3 });
    expect(r.unconverted).toStrictEqual([]);
  });

  test('⚠️ 2 buste on a case of 4 are half a cartone', () => {
    const r = m.purchasesInMonth([withUnits(2, 'busta'), withUnits(3, 'cartone')], '2026-09', { flour: CASED });
    expect(r.totals).toStrictEqual({ flour: 3.5 });
    expect(r.unconverted).toStrictEqual([]);
  });

  test('an odd division is kept to three decimals, the precision the stocktake stores', () => {
    // 30 / (3 × 2.5 kg) = 4 per kg: the stored rate must stay the one the case derives.
    const three = { ...CASED, caseCount: 3, casePrice: 30, pricePerUnit: 4 };
    expect(m.purchasesInMonth([withUnits(1, 'busta')], '2026-09', { flour: three }).totals).toStrictEqual({ flour: 0.333 });
  });

  test('⚠️ another unit with no case to convert by is LEFT OUT and reported, never guessed', () => {
    const r = m.purchasesInMonth([withUnits(2, 'busta'), withUnits(3, 'cartone')], '2026-09', { flour: UNCASED });
    expect(r.totals).toStrictEqual({ flour: 3 });
    expect(r.unconverted).toStrictEqual(['flour']);
  });

  test('a case of pieces (not packages), or a stale case, is not used to convert', () => {
    const pieces = { ...CASED, caseItemUnit: 'pcs', caseItemSize: null };
    expect(m.qtyInCardUnit(2, 'busta', pieces)).toBe(null);
    const stale = { ...CASED, pricePerUnit: 9 };
    expect(m.qtyInCardUnit(2, 'busta', stale)).toBe(null);
  });

  test('a unit that is neither the card’s nor its package is not converted', () => {
    expect(m.qtyInCardUnit(2, 'sacco', CASED)).toBe(null);
  });

  test('a frozen unit with no card (deleted) is reported, never counted as the card unit', () => {
    const r = m.purchasesInMonth([withUnits(2, 'busta')], '2026-09', {});
    expect(r.totals).toStrictEqual({});
    expect(r.unconverted).toStrictEqual(['flour']);
  });

  test('a product with no card (deleted) and old records behave exactly as before', () => {
    expect(m.purchasesInMonth([order('2026-09-04', { flour: 5 })], '2026-09', { flour: CASED }).totals).toStrictEqual({ flour: 5 });
    expect(m.purchasesInMonth([order('2026-09-04', { flour: 5 })], '2026-09').totals).toStrictEqual({ flour: 5 });
  });

  test('a line marked missing does not reach the unit question at all', () => {
    const rec = order('2026-09-04', { flour: 2 }, { units: { flour: 'busta' }, missing: { flour: true } });
    const r = m.purchasesInMonth([rec], '2026-09', { flour: UNCASED });
    expect(r.totals).toStrictEqual({});
    expect(r.unconverted).toStrictEqual([]);
  });

  // ── «Cartone» saved by the card: packCount converts buste into cartoni (1 Oct 2026) ──

  test('qtyInCardUnit converts with the card\'s own packCount, no price needed', () => {
    const card = { unit: 'cartone', packUnit: 'busta', packCount: 4 };
    expect(m.qtyInCardUnit(8, 'busta', card)).toBe(2);
    expect(m.qtyInCardUnit(2, 'cartone', card)).toBe(2);
    expect(m.qtyInCardUnit(2, 'Busta', card), 'matched ignoring case').toBe(0.5);
    expect(m.qtyInCardUnit(3, 'sacco', card), 'a unit the card does not offer is never guessed').toBe(null);
  });

  test('packCount wins over a stored case; a stored case of packages is the fallback', () => {
    const stored = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(m.qtyInCardUnit(8, 'busta', { unit: 'cartone', packUnit: 'busta', packCount: 8, ...stored })).toBe(1);
    expect(m.qtyInCardUnit(8, 'busta', { unit: 'cartone', packUnit: 'busta', ...stored }), 'a card saved before packCount').toBe(2);
    expect(m.qtyInCardUnit(8, 'busta', { unit: 'cartone', packUnit: 'busta' }), 'neither: not guessed').toBe(null);
    const pieces = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
    expect(m.qtyInCardUnit(100, 'pezzo', { unit: 'cartone', packUnit: 'pezzo', ...pieces }),
      'a case of pieces alone is not a carton count').toBe(null);
    expect(m.qtyInCardUnit(100, 'pezzo', { unit: 'cartone', packUnit: 'pezzo', packCount: 50, ...pieces })).toBe(2);
    for (const packCount of [0, -2, 1.5, '4']) {
      expect(m.qtyInCardUnit(8, 'busta', { unit: 'cartone', packUnit: 'busta', packCount }), String(packCount)).toBe(null);
    }
  });

  // ── «An item with no packCount must give EXACTLY today's numbers» (readers-regression-grid) ──────
  //
  // ⚠️ THE READERS WERE REWRITTEN FOR «CARTONE» (1 Oct 2026, review), and the one promise that must
  // outlive that is that nothing already in production reprices or re-counts. So this runs a FROZEN COPY
  // of the old qtyInCardUnit against the live one over every stored shape that has no packCount — or an
  // invalid one, which the rules would never store — and demands IDENTICAL results, number for number,
  // null for null.

  interface Shape {
    id: string;
    unit: string;
    packUnit: string;
    weight: string;
    packCount: unknown;
    priceUnit?: string;
    pricePerUnit?: number;
    unitWeightKg?: number;
    casePrice?: number;
    caseCount?: number;
    caseItemSize?: number;
    caseItemUnit?: string;
  }
  type StoredPart = Pick<Shape, 'priceUnit' | 'pricePerUnit' | 'unitWeightKg' | 'casePrice' | 'caseCount' | 'caseItemSize' | 'caseItemUnit'>;

  const UNITS = ['', 'kg', 'g', 'l', 'ml', 'pz', 'pezzo', 'cartone', 'Cassa', 'busta', 'sacco', 'scatola', 'vassoio', 'confezione', 'box.'];
  const PACK_UNITS = ['', 'busta', 'pezzo', 'scatola', 'sacco'];
  const WEIGHTS = ['', '25kg', '2.5kg', '500g', '750ml', '1l', '6x1kg', 'sacco', '2,27 kg', '12x500g', '360 pz'];
  // What the rules would never store, or nothing: all of them mean «no packCount».
  const NO_COUNT = [undefined, null, 0, -1, 2.5, '4', NaN];

  const CASES: Record<string, StoredPart> = {
    none: {},
    rateKg: { priceUnit: 'kg', pricePerUnit: 2 },
    rateL: { priceUnit: 'l', pricePerUnit: 3.2 },
    ratePcs: { priceUnit: 'pcs', pricePerUnit: 0.4 },
    ratePcsWeighed: { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
    packCase: { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
    packCaseL: { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 0.5, caseItemUnit: 'pack' },
    oneBag: { priceUnit: 'kg', pricePerUnit: 0.8, casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'pack' },
    kgCase: { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
    gCase: { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
    mlCase: { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
    pcsCase: { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' },
    pcsCaseOne: { priceUnit: 'pcs', pricePerUnit: 5, casePrice: 5, caseCount: 1, caseItemUnit: 'pcs' },
    staleCase: { priceUnit: 'kg', pricePerUnit: 3, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
    zeroRate: { priceUnit: 'kg', pricePerUnit: 0 },
    badUnit: { priceUnit: 'box', pricePerUnit: 2 },
  };

  function* shapes(): Generator<{ name: string; ing: Shape }> {
    for (const [name, stored] of Object.entries(CASES)) {
      for (const unit of UNITS) {
        for (const packUnit of PACK_UNITS) {
          for (const weight of WEIGHTS) {
            for (const packCount of NO_COUNT) {
              yield { name, ing: { id: 'x', unit, packUnit, weight, packCount, ...stored } };
            }
          }
        }
      }
    }
  }

  const same = (a: unknown, b: unknown): boolean => Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && a === b);

  test('the grid is big enough to mean something', () => {
    let n = 0;
    for (const _ of shapes()) n += 1;
    expect(n, `${n} shapes`).toBeGreaterThan(90000);
  });

  test('qtyInCardUnit gives EXACTLY the old numbers for every item with no packCount', () => {
    const bad: string[] = [];
    for (const { name, ing } of shapes()) {
      for (const line of ['', ing.unit, ing.packUnit, 'cartone', 'busta']) {
        if (!same(m.qtyInCardUnit(8, line, ing), frozenOld.qtyInCardUnit(8, line, ing))) bad.push(`${line} ${name} ${JSON.stringify(ing)}`);
      }
      if (bad.length > 5) break;
    }
    expect(bad).toStrictEqual([]);
  }, 120_000);

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in the original tests.

  test('a month is the dates that start with it: the first and the last day belong, the day after does not', () => {
    for (const date of ['2026-09-01', '2026-09-30']) expect(m.isInMonth(order(date, {}), '2026-09'), date).toBe(true);
    for (const date of ['2026-08-31', '2026-10-01', '2025-09-15']) expect(m.isInMonth(order(date, {}), '2026-09'), date).toBe(false);
  });

  test('records that are not in the month are not even counted as orders', () => {
    const out = m.purchasesInMonth([order('2026-08-30', { flour: 5 }), order('2026-10-02', { flour: 5 })], '2026-09');
    expect(out).toStrictEqual({ totals: {}, orders: 0, products: 0, unconverted: [] });
  });

  test('an order of the month where everything was marked missing is an order that brought nothing', () => {
    const rec = order('2026-09-04', { flour: 2 }, { missing: { flour: true } });
    expect(m.purchasesInMonth([rec], '2026-09')).toStrictEqual({ totals: {}, orders: 1, products: 0, unconverted: [] });
  });

  test('a product reported as unconverted is reported once, however many lines it had', () => {
    const r = m.purchasesInMonth([withUnits(2, 'busta'), withUnits(1, 'busta'), withUnits(4, 'sacco')], '2026-09', { flour: UNCASED });
    expect(r.unconverted).toStrictEqual(['flour']);
  });

  test('the same product in its own unit and in the package adds up in the card’s unit', () => {
    const r = m.purchasesInMonth([withUnits(1, 'cartone'), withUnits(4, 'busta'), withUnits(2, 'busta')], '2026-09', { flour: CASED });
    expect(r.totals).toStrictEqual({ flour: 2.5 });
    expect(r.orders).toBe(3);
  });
});
