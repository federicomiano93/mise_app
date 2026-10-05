// «Price changes» — the pure model: chains of invoice price points, periods and labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changesFromPoints, periodOf, shiftPeriod, periodContains, periodLabel, summarize,
} from '../js/orders/price-changes-model.js';

const ING = { id: 'ing1', supplierId: 'sup1', name: 'Flour 00' };
const pt = (invoiceId, line, invoiceDate, pricePerUnit, extra = {}) =>
  ({ invoiceId, line, invoiceDate, pricePerUnit, priceUnit: 'kg', ...extra });

test('a rise between two invoices becomes one document shaped like the Firestore one', () => {
  const [c, ...rest] = changesFromPoints(ING, [pt('100', 1, '2026-09-01', 2.1), pt('200', 3, '2026-09-20', 2.31)]);
  assert.equal(rest.length, 0);
  assert.deepEqual(c, {
    id: 'inv-200-3-ing1', ingredientId: 'ing1', name: 'Flour 00', priceUnit: 'kg', supplierId: 'sup1',
    oldPrice: 2.1, newPrice: 2.31, oldDate: '2026-09-01', date: '2026-09-20', invoiceId: '200', line: 3, pct: 10,
  });
});

test('points arrive in any order, duplicates by invoice and line count once', () => {
  const list = changesFromPoints(ING, [
    pt('200', 1, '2026-09-20', 3), pt('100', 1, '2026-09-01', 2), pt('100', 1, '2026-09-01', 2), pt('200', 1, '2026-09-20', 3),
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].pct, 50);
});

test('same day: sorted by numeric invoice id, then line', () => {
  const list = changesFromPoints(ING, [pt('9', 1, '2026-09-01', 1), pt('10', 1, '2026-09-01', 2), pt('10', 2, '2026-09-01', 3)]);
  assert.deepEqual(list.map(c => c.id), ['inv-10-1-ing1', 'inv-10-2-ing1']);
});

test('a drop is negative, rounded to two decimals; below minPct is ignored', () => {
  const [drop] = changesFromPoints(ING, [pt('1', 1, '2026-09-01', 3), pt('2', 1, '2026-09-08', 2.9)]);
  assert.equal(drop.pct, -3.33);
  assert.equal(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 100), pt('2', 1, '2026-09-08', 100.4)]).length, 0);
  assert.equal(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 100), pt('2', 1, '2026-09-08', 100.5)]).length, 1);
  assert.equal(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 100), pt('2', 1, '2026-09-08', 100.4)], { minPct: 0.1 }).length, 1);
});

test('a unit switch restarts the chain instead of comparing kg with pieces', () => {
  const list = changesFromPoints(ING, [
    pt('1', 1, '2026-09-01', 2), pt('2', 1, '2026-09-08', 20, { priceUnit: 'pcs', unitWeightKg: 0.05 }), pt('3', 1, '2026-09-15', 22, { priceUnit: 'pcs', unitWeightKg: 0.05 }),
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].priceUnit, 'pcs');
  assert.equal(list[0].pct, 10);
});

test('packs are carried only when the two article codes differ', () => {
  const [a] = changesFromPoints(ING, [
    pt('1', 1, '2026-09-01', 2, { pack: '25 kg', packCode: 'A-25' }), pt('2', 1, '2026-09-08', 3, { pack: '10 kg', packCode: 'A-10' }),
  ]);
  assert.equal(a.oldPack, '25 kg');
  assert.equal(a.newPack, '10 kg');
  const [b] = changesFromPoints(ING, [pt('1', 1, '2026-09-01', 2), pt('2', 1, '2026-09-08', 3)]);
  assert.ok(!('oldPack' in b) && !('newPack' in b));
});

test('⚠️ labels worded differently under the SAME code are not another pack', () => {
  const [c] = changesFromPoints(ING, [
    pt('1', 1, '2026-09-01', 2, { pack: 'Lievito sacco 5 kg', packCode: 'S5' }), pt('2', 1, '2026-09-08', 3, { pack: 'LIEVITO SACCO (5kg)', packCode: 's5' }),
  ]);
  assert.ok(c);
  assert.ok(!('oldPack' in c) && !('newPack' in c));
  // One side without a code is not «another pack» either: nothing proves it.
  const [d] = changesFromPoints(ING, [pt('1', 1, '2026-09-01', 2, { pack: 'x', packCode: 'S5' }), pt('2', 1, '2026-09-08', 3, { pack: 'y' })]);
  assert.ok(!('oldPack' in d));
});

test('⚠️ per-piece prices of pieces of another weight never make a change; the same piece does', () => {
  const pcs = (id, date, price, kg) => pt(id, 1, date, price, { priceUnit: 'pcs', unitWeightKg: kg });
  assert.equal(changesFromPoints(ING, [pcs('1', '2026-09-01', 5, 5), pcs('2', '2026-09-08', 1, 1)]).length, 0, '5 kg then 1 kg');
  // The chain restarts: the next point of the 1 kg piece is compared with the 1 kg piece, not with the sack.
  const list = changesFromPoints(ING, [pcs('1', '2026-09-01', 5, 5), pcs('2', '2026-09-08', 1, 1), pcs('3', '2026-09-15', 1.2, 1)]);
  assert.equal(list.length, 1);
  assert.equal(list[0].oldPrice, 1);
  assert.equal(changesFromPoints(ING, [pcs('1', '2026-09-01', 5, 1), pcs('2', '2026-09-08', 6, 1.0005)]).length, 1, 'within 0.1%');
  assert.equal(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 5, { priceUnit: 'pcs' }), pcs('2', '2026-09-08', 6, 1)]).length, 0, 'a missing weight is not «equal»');
  // Per kilo stays comparable across packs: that is the point of the feature.
  assert.equal(changesFromPoints(ING, [pt('1', 1, '2026-09-01', 4, { packCode: 'S5' }), pt('2', 1, '2026-09-08', 5, { packCode: 'B1' })]).length, 1);
});

test('never NaN: unusable points are skipped, the chain goes on across them', () => {
  const list = changesFromPoints(ING, [
    pt('1', 1, '2026-09-01', 2), pt('2', 1, '2026-09-05', NaN), pt('3', 1, '2026-09-06', 0), pt('4', 1, '2026-09-07', -1),
    pt('5', 1, '2026-09-08', '3'), pt('6', 1, 'nope', 5), pt('7', 0, '2026-09-09', 5), pt('8', 1, '2026-09-10', 4),
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].oldDate, '2026-09-01');
  assert.equal(list[0].pct, 100);
  for (const c of list) assert.ok(Number.isFinite(c.pct));
  assert.deepEqual(changesFromPoints(ING, null), []);
});

test('periodOf: month bounds, leap February', () => {
  assert.deepEqual(periodOf('month', '2026-09-17'), { kind: 'month', from: '2026-09-01', to: '2026-09-30' });
  assert.equal(periodOf('month', '2028-02-10').to, '2028-02-29');
});

test('periodOf: a week follows the start day and crosses month and year boundaries', () => {
  assert.deepEqual(periodOf('week', '2026-10-05', 'Monday'), { kind: 'week', from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(periodOf('week', '2026-10-04', 'Monday'), { kind: 'week', from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(periodOf('week', '2026-12-31', 'Monday'), { kind: 'week', from: '2026-12-28', to: '2027-01-03' });
  assert.deepEqual(periodOf('week', '2026-10-05', 'Sunday'), { kind: 'week', from: '2026-10-04', to: '2026-10-10' });
});

test('periodOf with an unreadable date gives empty bounds', () => {
  assert.equal(periodOf('month', '').from, '');
  assert.equal(periodOf('week', 'x').to, '');
});

test('shiftPeriod steps weeks and months, over year ends both ways', () => {
  const w = periodOf('week', '2026-12-31', 'Monday');
  assert.deepEqual(shiftPeriod(w, 1, 'Monday'), { kind: 'week', from: '2027-01-04', to: '2027-01-10' });
  assert.deepEqual(shiftPeriod(w, -1, 'Monday'), { kind: 'week', from: '2026-12-21', to: '2026-12-27' });
  const m = periodOf('month', '2026-12-15');
  assert.deepEqual(shiftPeriod(m, 1), { kind: 'month', from: '2027-01-01', to: '2027-01-31' });
  assert.deepEqual(shiftPeriod(periodOf('month', '2026-01-15'), -1), { kind: 'month', from: '2025-12-01', to: '2025-12-31' });
});

test('periodContains is inclusive on both ends', () => {
  const m = periodOf('month', '2026-09-17');
  assert.ok(periodContains(m, '2026-09-01') && periodContains(m, '2026-09-30'));
  assert.ok(!periodContains(m, '2026-10-01') && !periodContains(m, '2026-08-31'));
});

test('periodLabel in Italian and English', () => {
  const m = periodOf('month', '2026-09-17');
  assert.equal(periodLabel(m, 'it'), 'settembre 2026');
  assert.equal(periodLabel(m, 'en'), 'September 2026');
  const w = periodOf('week', '2026-10-01', 'Monday'); // 28 Sep – 4 Oct
  assert.match(periodLabel(w, 'it'), /^28 set – 4 ott 2026$/);
  assert.match(periodLabel(w, 'en'), /^28 Sep[t]? – 4 Oct 2026$/);
  const y = periodOf('week', '2026-12-31', 'Monday');
  assert.match(periodLabel(y, 'it'), /^28 dic 2026 – 3 gen 2027$/);
  assert.equal(periodLabel({ kind: 'week', from: '', to: '' }, 'it'), '');
});

test('summarize: rises biggest first, drops biggest first, ties by name, never NaN', () => {
  const c = (name, pct) => ({ name, pct });
  const { increases, decreases, counts } = summarize([
    c('B', 5), c('A', 5), c('C', 12), c('D', -2), c('E', -9), c('F', NaN), c('G', 0),
  ]);
  assert.deepEqual(increases.map(x => x.name), ['C', 'A', 'B']);
  assert.deepEqual(decreases.map(x => x.name), ['E', 'D']);
  assert.deepEqual(counts, { increases: 3, decreases: 2, total: 5 });
  assert.deepEqual(summarize(undefined).counts, { increases: 0, decreases: 0, total: 0 });
});
