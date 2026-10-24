// «Price changes» — the pure model: chains of invoice price points, periods and labels (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/price-changes-model.js, which the live app uses
// today. Ported from tests/price-changes-model.test.mjs; the module is a FULL port, so parity.spec.ts also
// compares its exports.
//
// PORTED: 16 of 16 tests of tests/price-changes-model.test.mjs.

import { describe, expect, test } from 'vitest';
import * as ported from './price-changes-model';
import * as legacyJs from '../../js/orders/price-changes-model.js';

const legacy = legacyJs as unknown as typeof ported;

const ING = { id: 'ing1', supplierId: 'sup1', name: 'Flour 00' };
const pt = (invoiceId: unknown, line: unknown, invoiceDate: unknown, pricePerUnit: unknown, extra: Record<string, unknown> = {}) =>
  ({ invoiceId, line, invoiceDate, pricePerUnit, priceUnit: 'kg', ...extra });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { changesFromPoints, periodOf, shiftPeriod, periodContains, periodLabel, summarize } = m;

  test('a rise between two invoices becomes one document shaped like the Firestore one', () => {
    const [c, ...rest] = changesFromPoints(ING, [pt('100', 1, '2026-09-01', 2.1), pt('200', 3, '2026-09-20', 2.31)]);
    expect(rest.length).toBe(0);
    expect(c).toStrictEqual({
      id: 'inv-200-3-ing1', ingredientId: 'ing1', name: 'Flour 00', priceUnit: 'kg', supplierId: 'sup1',
      oldPrice: 2.1, newPrice: 2.31, oldDate: '2026-09-01', date: '2026-09-20', invoiceId: '200', line: 3, pct: 10,
    });
  });

  test('points arrive in any order, duplicates by invoice and line count once', () => {
    const list = changesFromPoints(ING, [
      pt('200', 1, '2026-09-20', 3), pt('100', 1, '2026-09-01', 2), pt('100', 1, '2026-09-01', 2), pt('200', 1, '2026-09-20', 3),
    ]);
    expect(list.length).toBe(1);
    expect(list[0]?.pct).toBe(50);
  });

  test('same day: sorted by numeric invoice id, then line', () => {
    const list = changesFromPoints(ING, [pt('9', 1, '2026-09-01', 1), pt('10', 1, '2026-09-01', 2), pt('10', 2, '2026-09-01', 3)]);
    expect(list.map(c => c.id)).toStrictEqual(['inv-10-1-ing1', 'inv-10-2-ing1']);
  });

  test('a drop is negative, rounded to two decimals; below minPct is ignored', () => {
    const [drop] = changesFromPoints(ING, [pt('1', 1, '2026-09-01', 3), pt('2', 1, '2026-09-08', 2.9)]);
    expect(drop?.pct).toBe(-3.33);
    expect(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 100), pt('2', 1, '2026-09-08', 100.4)]).length).toBe(0);
    expect(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 100), pt('2', 1, '2026-09-08', 100.5)]).length).toBe(1);
    expect(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 100), pt('2', 1, '2026-09-08', 100.4)], { minPct: 0.1 }).length).toBe(1);
  });

  test('a unit switch restarts the chain instead of comparing kg with pieces', () => {
    const list = changesFromPoints(ING, [
      pt('1', 1, '2026-09-01', 2), pt('2', 1, '2026-09-08', 20, { priceUnit: 'pcs', unitWeightKg: 0.05 }), pt('3', 1, '2026-09-15', 22, { priceUnit: 'pcs', unitWeightKg: 0.05 }),
    ]);
    expect(list.length).toBe(1);
    expect(list[0]?.priceUnit).toBe('pcs');
    expect(list[0]?.pct).toBe(10);
  });

  test('packs are carried only when the two article codes differ', () => {
    const [a] = changesFromPoints(ING, [
      pt('1', 1, '2026-09-01', 2, { pack: '25 kg', packCode: 'A-25' }), pt('2', 1, '2026-09-08', 3, { pack: '10 kg', packCode: 'A-10' }),
    ]);
    expect(a?.oldPack).toBe('25 kg');
    expect(a?.newPack).toBe('10 kg');
    const [b] = changesFromPoints(ING, [pt('1', 1, '2026-09-01', 2), pt('2', 1, '2026-09-08', 3)]);
    expect(b && !('oldPack' in b) && !('newPack' in b)).toBeTruthy();
  });

  test('⚠️ labels worded differently under the SAME code are not another pack', () => {
    const [c] = changesFromPoints(ING, [
      pt('1', 1, '2026-09-01', 2, { pack: 'Lievito sacco 5 kg', packCode: 'S5' }), pt('2', 1, '2026-09-08', 3, { pack: 'LIEVITO SACCO (5kg)', packCode: 's5' }),
    ]);
    expect(c).toBeTruthy();
    expect(c && !('oldPack' in c) && !('newPack' in c)).toBeTruthy();
    // One side without a code is not «another pack» either: nothing proves it.
    const [d] = changesFromPoints(ING, [pt('1', 1, '2026-09-01', 2, { pack: 'x', packCode: 'S5' }), pt('2', 1, '2026-09-08', 3, { pack: 'y' })]);
    expect(d && !('oldPack' in d)).toBeTruthy();
  });

  test('⚠️ per-piece prices of pieces of another weight never make a change; the same piece does', () => {
    const pcs = (id: string, date: string, price: number, kg: number) => pt(id, 1, date, price, { priceUnit: 'pcs', unitWeightKg: kg });
    expect(changesFromPoints(ING, [pcs('1', '2026-09-01', 5, 5), pcs('2', '2026-09-08', 1, 1)]).length, '5 kg then 1 kg').toBe(0);
    // The chain restarts: the next point of the 1 kg piece is compared with the 1 kg piece, not with the sack.
    const list = changesFromPoints(ING, [pcs('1', '2026-09-01', 5, 5), pcs('2', '2026-09-08', 1, 1), pcs('3', '2026-09-15', 1.2, 1)]);
    expect(list.length).toBe(1);
    expect(list[0]?.oldPrice).toBe(1);
    expect(changesFromPoints(ING, [pcs('1', '2026-09-01', 5, 1), pcs('2', '2026-09-08', 6, 1.0005)]).length, 'within 0.1%').toBe(1);
    expect(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 5, { priceUnit: 'pcs' }), pcs('2', '2026-09-08', 6, 1)]).length, 'a missing weight is not «equal»').toBe(0);
    // Per kilo stays comparable across packs: that is the point of the feature.
    expect(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 4, { packCode: 'S5' }), pt('2', 1, '2026-09-08', 5, { packCode: 'B1' })]).length).toBe(1);
  });

  test('never NaN: unusable points are skipped, the chain goes on across them', () => {
    const list = changesFromPoints(ING, [
      pt('1', 1, '2026-09-01', 2), pt('2', 1, '2026-09-05', NaN), pt('3', 1, '2026-09-06', 0), pt('4', 1, '2026-09-07', -1),
      pt('5', 1, '2026-09-08', '3'), pt('6', 1, 'nope', 5), pt('7', 0, '2026-09-09', 5), pt('8', 1, '2026-09-10', 4),
    ]);
    expect(list.length).toBe(1);
    expect(list[0]?.oldDate).toBe('2026-09-01');
    expect(list[0]?.pct).toBe(100);
    for (const c of list) expect(Number.isFinite(c.pct)).toBeTruthy();
    expect(changesFromPoints(ING, null)).toStrictEqual([]);
  });

  test('periodOf: month bounds, leap February', () => {
    expect(periodOf('month', '2026-09-17')).toStrictEqual({ kind: 'month', from: '2026-09-01', to: '2026-09-30' });
    expect(periodOf('month', '2028-02-10').to).toBe('2028-02-29');
  });

  test('periodOf: a week follows the start day and crosses month and year boundaries', () => {
    expect(periodOf('week', '2026-10-05', 'Monday')).toStrictEqual({ kind: 'week', from: '2026-10-05', to: '2026-10-11' });
    expect(periodOf('week', '2026-10-04', 'Monday')).toStrictEqual({ kind: 'week', from: '2026-09-28', to: '2026-10-04' });
    expect(periodOf('week', '2026-12-31', 'Monday')).toStrictEqual({ kind: 'week', from: '2026-12-28', to: '2027-01-03' });
    expect(periodOf('week', '2026-10-05', 'Sunday')).toStrictEqual({ kind: 'week', from: '2026-10-04', to: '2026-10-10' });
  });

  test('periodOf with an unreadable date gives empty bounds', () => {
    expect(periodOf('month', '').from).toBe('');
    expect(periodOf('week', 'x').to).toBe('');
  });

  test('shiftPeriod steps weeks and months, over year ends both ways', () => {
    const w = periodOf('week', '2026-12-31', 'Monday');
    expect(shiftPeriod(w, 1, 'Monday')).toStrictEqual({ kind: 'week', from: '2027-01-04', to: '2027-01-10' });
    expect(shiftPeriod(w, -1, 'Monday')).toStrictEqual({ kind: 'week', from: '2026-12-21', to: '2026-12-27' });
    const mo = periodOf('month', '2026-12-15');
    expect(shiftPeriod(mo, 1)).toStrictEqual({ kind: 'month', from: '2027-01-01', to: '2027-01-31' });
    expect(shiftPeriod(periodOf('month', '2026-01-15'), -1)).toStrictEqual({ kind: 'month', from: '2025-12-01', to: '2025-12-31' });
  });

  test('periodContains is inclusive on both ends', () => {
    const mo = periodOf('month', '2026-09-17');
    expect(periodContains(mo, '2026-09-01') && periodContains(mo, '2026-09-30')).toBeTruthy();
    expect(!periodContains(mo, '2026-10-01') && !periodContains(mo, '2026-08-31')).toBeTruthy();
  });

  test('periodLabel in Italian and English', () => {
    const mo = periodOf('month', '2026-09-17');
    expect(periodLabel(mo, 'it')).toBe('settembre 2026');
    expect(periodLabel(mo, 'en')).toBe('September 2026');
    const w = periodOf('week', '2026-10-01', 'Monday'); // 28 Sep – 4 Oct
    expect(periodLabel(w, 'it')).toMatch(/^28 set – 4 ott 2026$/);
    expect(periodLabel(w, 'en')).toMatch(/^28 Sep[t]? – 4 Oct 2026$/);
    const y = periodOf('week', '2026-12-31', 'Monday');
    expect(periodLabel(y, 'it')).toMatch(/^28 dic 2026 – 3 gen 2027$/);
    expect(periodLabel({ kind: 'week', from: '', to: '' }, 'it')).toBe('');
  });

  test('summarize: rises biggest first, drops biggest first, ties by name, never NaN', () => {
    const c = (name: string, pct: number) => ({ name, pct });
    const { increases, decreases, counts } = summarize([
      c('B', 5), c('A', 5), c('C', 12), c('D', -2), c('E', -9), c('F', NaN), c('G', 0),
    ]);
    expect(increases.map(x => x.name)).toStrictEqual(['C', 'A', 'B']);
    expect(decreases.map(x => x.name)).toStrictEqual(['E', 'D']);
    expect(counts).toStrictEqual({ increases: 3, decreases: 2, total: 5 });
    expect(summarize(undefined).counts).toStrictEqual({ increases: 0, decreases: 0, total: 0 });
  });
});
