// «Import from invoices» writes the price changes it finds — the PURE half (invoice-import-plan): which points are combined,
// what is skipped, what is removed, how the writes are batched (P15). Run against BOTH implementations: the TypeScript port
// in shared/ and js/orders/invoice-import-plan.js, which the live app uses today. Ported from
// tests/invoice-import-price-changes.test.mjs. Every id and price is INVENTED.
//
// PORTED: 18 of 18 tests of tests/invoice-import-price-changes.test.mjs.

import { describe, expect, test } from 'vitest';
import * as portedModel from './invoice-import-model';
import * as portedPlan from './invoice-import-plan';
import * as legacyModelJs from '../../js/orders/invoice-import-model.js';
import * as legacyPlanJs from '../../js/orders/invoice-import-plan.js';

const legacyModel = legacyModelJs as unknown as typeof portedModel;
const legacyPlan = legacyPlanJs as unknown as typeof portedPlan;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

describe.each([
  ['shared/ (TypeScript)', portedModel, portedPlan],
  ['js/ (current app)', legacyModel, legacyPlan],
] as const)('%s', (_name, model, plan) => {
  const { MAX_DOCS_PER_BATCH } = model;
  const { summarizeRun, ingredientDisplayName } = plan;
  const planPriceChanges = plan.planPriceChanges as (input: Loose) => Promise<Loose>;
  const priceChangeBatches = plan.priceChangeBatches as (ops: Loose) => Loose[][];
  const planBatchWrites = plan.planBatchWrites as (batches: Loose, options?: Loose) => Loose;
  const replanRow = plan.replanRow as (input: Loose) => Promise<Loose>;
  const pointsOfDocs = plan.pointsOfDocs as (docs: Loose) => Loose[];

  const NOW = '2026-10-05T09:00:00.000Z';
  const stored = (invoiceId: string, line: number, invoiceDate: string, pricePerUnit: number, priceUnit = 'kg'): Loose =>
    ({ invoiceId, line, invoiceDate, pricePerUnit, priceUnit });
  // A stored change as the data layer hands it back (storedPriceChangeIds).
  const storedChange = (id: string, oldPrice: number, newPrice: number, oldDate: string, date: string, priceUnit = 'kg'): Loose =>
    ({ id, oldPrice, newPrice, oldDate, date, priceUnit });
  const none = { changeIds: async (): Promise<Loose[]> => [] };
  const base: Loose = { ingredientId: 'i1', supplierId: 's1', name: 'Farina', priceUnit: 'kg', isNew: false, read: none, nowIso: NOW };

  test('stored points and the points about to be written are ONE history, a point in both counts once', async () => {
    const ops = await planPriceChanges({
      ...base,
      storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 1.1)],
      newPoints: [
        { id: 'inv-200-1', invoiceId: '200', line: 1, invoiceDate: '2026-02-10', pricePerUnit: 1.1, qty: 1 },
        { id: 'inv-300-1', invoiceId: '300', line: 1, invoiceDate: '2026-03-10', pricePerUnit: 1.1, qty: 1 },
      ],
    });
    expect(ops.create.length, '1.00 → 1.10 → 1.10: one change').toBe(1);
    expect(ops.remove).toStrictEqual([]);
    expect(ops.create[0]).toStrictEqual({
      type: 'add-price-change', ingredientId: 'i1', changeId: 'inv-200-1-i1',
      data: {
        ingredientId: 'i1', name: 'Farina', priceUnit: 'kg', oldPrice: 1, newPrice: 1.1, oldDate: '2026-01-10',
        date: '2026-02-10', invoiceId: '200', line: 1, pct: 10, supplierId: 's1', recordedAt: NOW,
      },
    });
  });

  test('a change whose id is already stored (and still right) is left out; the rest are written', async () => {
    const ops = await planPriceChanges({
      ...base,
      storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2), stored('300', 1, '2026-03-10', 3)],
      newPoints: [],
      read: { changeIds: async () => [storedChange('inv-200-1-i1', 1, 2, '2026-01-10', '2026-02-10')] },
    });
    expect(ops.create.map((o: Loose) => o.changeId)).toStrictEqual(['inv-300-1-i1']);
    expect(ops.remove, 'a stored change that is still right stays').toStrictEqual([]);
  });

  test('an unchanged row (nothing new to write) still produces the changes its stored history shows', async () => {
    const ops = await planPriceChanges({
      ...base, storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)], newPoints: [],
    });
    expect(ops.create.length).toBe(1);
    expect(ops.create[0].data.pct).toBe(100);
  });

  test('no change across units, and no read at all when there is nothing to write', async () => {
    let reads = 0;
    const read = { changeIds: async () => { reads += 1; return []; } };
    const ops = await planPriceChanges({
      ...base, read, storedPoints: [stored('100', 1, '2026-01-10', 1, 'kg'), stored('200', 1, '2026-02-10', 9, 'pcs')], newPoints: [],
    });
    expect(ops).toStrictEqual({ create: [], remove: [] });
    expect(reads).toBe(0);
  });

  test('a NEW ingredient has no stored changes, so it reads none', async () => {
    const read = { changeIds: async () => { throw new Error('must not be read'); } };
    const ops = await planPriceChanges({
      ...base, isNew: true, read, storedPoints: [],
      newPoints: [
        { id: 'a', invoiceId: '1', line: 1, invoiceDate: '2026-01-01', pricePerUnit: 1 },
        { id: 'b', invoiceId: '2', line: 1, invoiceDate: '2026-02-01', pricePerUnit: 2 },
      ],
    });
    expect(ops.create.length).toBe(1);
  });

  test('⚠️ nothing the rules would refuse is ever planned: a non-numeric invoice id, an unknown unit', async () => {
    const odd = await planPriceChanges({
      ...base, storedPoints: [stored('A1', 1, '2026-01-10', 1), stored('A2', 1, '2026-02-10', 2)], newPoints: [],
    });
    expect(odd.create).toStrictEqual([]);
    const unit = await planPriceChanges({
      ...base, priceUnit: 'box', storedPoints: [stored('1', 1, '2026-01-10', 1, 'box'), stored('2', 1, '2026-02-10', 2, 'box')], newPoints: [],
    });
    expect(unit.create).toStrictEqual([]);
    expect(await planPriceChanges({ ...base, ingredientId: null, storedPoints: [], newPoints: [] })).toStrictEqual({ create: [], remove: [] });
  });

  test('⚠️ nothing the rules would refuse: a supplier or ingredient id over 100 characters is refused, a long name is cut to 200', async () => {
    const points = [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)];
    const longSupplier = await planPriceChanges({ ...base, supplierId: 's'.repeat(101), storedPoints: points, newPoints: [] });
    expect(longSupplier.create, 'a supplier id over 100 characters would be refused').toStrictEqual([]);
    const longId = await planPriceChanges({ ...base, ingredientId: 'i'.repeat(101), storedPoints: points, newPoints: [] });
    expect(longId).toStrictEqual({ create: [], remove: [] });
    const named = await planPriceChanges({ ...base, name: `  ${'n'.repeat(250)}  `, storedPoints: points, newPoints: [] });
    expect(named.create.length, 'truncated, not dropped').toBe(1);
    expect(named.create[0].data.name).toBe('n'.repeat(200));
    const noSupplier = await planPriceChanges({ ...base, supplierId: undefined, storedPoints: points, newPoints: [] });
    expect(noSupplier.create.length).toBe(1);
    expect('supplierId' in noSupplier.create[0].data).toBe(false);
  });

  test('⚠️ an invoice that arrives OUT OF ORDER removes the change it made wrong and writes the two right ones', async () => {
    // Stored: Jan 1.00 and Mar 1.20, with the change recorded at March (+20%). A later zip brings February at 1.10.
    const read = { changeIds: async () => [storedChange('inv-300-1-i1', 1, 1.2, '2026-01-10', '2026-03-10')] };
    const ops = await planPriceChanges({
      ...base, read,
      storedPoints: [stored('100', 1, '2026-01-10', 1), stored('300', 1, '2026-03-10', 1.2)],
      newPoints: [{ id: 'inv-200-1', invoiceId: '200', line: 1, invoiceDate: '2026-02-10', pricePerUnit: 1.1, qty: 1 }],
    });
    expect(ops.remove).toStrictEqual([{ type: 'remove-price-change', ingredientId: 'i1', changeId: 'inv-300-1-i1' }]);
    expect(ops.create.map((o: Loose) => [o.changeId, o.data.oldPrice, o.data.newPrice, o.data.pct])).toStrictEqual([
      ['inv-200-1-i1', 1, 1.1, 10],
      ['inv-300-1-i1', 1.1, 1.2, 9.09],
    ]);
    // removals run first, in their own batches, then the creations (the March change keeps its id)
    const batches = priceChangeBatches(ops);
    expect(batches.map((b) => b.map((o) => o.type))).toStrictEqual([['remove-price-change'], ['add-price-change', 'add-price-change']]);
  });

  test('a stored change that is no longer expected is removed; one whose unit differs is replaced', async () => {
    const read = {
      changeIds: async () => [
        storedChange('inv-200-1-i1', 1, 2, '2026-01-10', '2026-02-10'),
        storedChange('inv-999-1-i1', 5, 6, '2025-01-01', '2025-02-01'),
      ],
    };
    const ops = await planPriceChanges({
      ...base, read, storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)], newPoints: [],
    });
    expect(ops.remove.map((o: Loose) => o.changeId)).toStrictEqual(['inv-999-1-i1']);
    expect(ops.create).toStrictEqual([]);
    const unit = await planPriceChanges({
      ...base, read: { changeIds: async () => [storedChange('inv-200-1-i1', 1, 2, '2026-01-10', '2026-02-10', 'l')] },
      storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)], newPoints: [],
    });
    expect(unit.remove.map((o: Loose) => o.changeId)).toStrictEqual(['inv-200-1-i1']);
    expect(unit.create.map((o: Loose) => o.changeId)).toStrictEqual(['inv-200-1-i1']);
  });

  test('removals are batched at the cap too, and a remove op becomes a delete the data layer runs', () => {
    const remove = Array.from({ length: MAX_DOCS_PER_BATCH + 1 }, (_, i) => ({ type: 'remove-price-change', ingredientId: 'i1', changeId: `c${i}` }));
    const batches = priceChangeBatches({ create: [{ type: 'add-price-change', ingredientId: 'i1', changeId: 'n', data: {} }], remove });
    expect(batches.every((b) => b.length <= MAX_DOCS_PER_BATCH)).toBeTruthy();
    expect(batches.length).toBe(3);
    expect(batches[2]![0]!.type, 'creations come last').toBe('add-price-change');
    const { batches: steps } = planBatchWrites([[remove[0]]], { mintId: () => 'x', bakery: 'b' });
    expect(steps[0][0]).toStrictEqual({ path: ['price-changes', 'c0'], remove: true });
  });

  test('the summary counts the ingredients whose changes could not be recorded, apart from the failed rows', () => {
    const sum = summarizeRun([
      { key: 'a', name: 'A', outcome: 'created', pricesAdded: 1, changesAdded: 0, changesFailed: 1 },
      { key: 'b', name: 'B', outcome: 'unchanged', changesAdded: 0, changesFailed: 1 },
      { key: 'c', name: 'C', outcome: 'updated' },
    ]);
    expect(sum.changesFailed).toBe(2);
    expect(sum.failed.length, 'the rows themselves are not failures').toBe(0);
    expect(sum.created).toBe(1);
  });

  test('the changes go in batches of at most the cap, after which nothing is lost', () => {
    const ops = Array.from({ length: MAX_DOCS_PER_BATCH * 2 + 1 }, (_, i) => ({ type: 'add-price-change', changeId: `c${i}` }));
    const batches = priceChangeBatches(ops);
    expect(batches.every((b) => b.length <= MAX_DOCS_PER_BATCH)).toBeTruthy();
    expect(batches.flat().length).toBe(ops.length);
    expect(priceChangeBatches([])).toStrictEqual([]);
    expect(priceChangeBatches({ create: [], remove: [] })).toStrictEqual([]);
  });

  test('pointsOfDocs reads the line from the id and keeps only what a change needs', () => {
    expect(pointsOfDocs([
      { id: 'inv-18000000001-5', data: { invoiceId: '18000000001', invoiceDate: '2026-08-31', pricePerUnit: 0.57, priceUnit: 'kg', qty: 3 } },
      { id: 'manual-1', data: { pricePerUnit: 1 } },
    ])).toStrictEqual([{ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, priceUnit: 'kg' }]);
  });

  test('a change op becomes a create-only price-changes document stamped with the venue', () => {
    const { batches } = planBatchWrites([[{
      type: 'add-price-change', ingredientId: 'i1', changeId: 'inv-200-1-i1', data: { ingredientId: 'i1', pct: 10 },
    }]], { mintId: () => 'x', bakery: 'loc-test' });
    expect(batches[0][0]).toStrictEqual({ path: ['price-changes', 'inv-200-1-i1'], data: { ingredientId: 'i1', pct: 10, bakery: 'loc-test' }, merge: false });
    expect(() => planBatchWrites([[{ type: 'add-price-change', ingredientId: 'i1', data: {} }]], { mintId: () => 'x', bakery: 'b' })).toThrow(/no id/);
  });

  test('the summary counts the changes recorded, for any outcome', () => {
    const sum = summarizeRun([
      { key: 'a', name: 'A', outcome: 'created', pricesAdded: 2, changesAdded: 1 },
      { key: 'b', name: 'B', outcome: 'unchanged', changesAdded: 2 },
    ]);
    expect(sum.changesAdded).toBe(3);
  });

  test('replanRow hands back the matched ingredient and its stored points from the SAME read', async () => {
    const points = [stored('100', 1, '2026-01-10', 1)];
    const ids = Object.assign(new Set(['inv-100-1']), { points });
    let pointReads = 0;
    const out = await replanRow({
      fileIngredient: {
        key: 'k', supplierKey: 'S', name: 'Farina', supplierCode: '', mergeWith: '', priceUnit: 'kg', weight: '', packUnit: '',
        packCount: null, prices: [{ invoiceId: '100', line: 1, invoiceDate: '2026-01-10', pricePerUnit: 1, qty: 1 }],
      },
      supplierIdByKey: { S: 's1' },
      read: {
        ingredients: async () => [{ id: 'i1', name: 'Farina', shortName: 'Fa', supplierId: 's1', kind: 'ingredient' }],
        pointIds: async () => { pointReads += 1; return ids; },
        price: async () => null,
      },
    });
    expect(out.row.status).toBe('unchanged');
    expect(out.row.ingredientId).toBe('i1');
    expect(out.ingredient.id).toBe('i1');
    expect(out.storedPoints).toStrictEqual(points);
    expect(pointReads).toBe(1);
    expect(ingredientDisplayName(out.ingredient)).toBe('Fa');
  });

  test('the pack of a stored point and of the new points is carried into oldPack / newPack', async () => {
    const [point] = pointsOfDocs([
      { id: 'inv-100-1', data: { invoiceId: '100', invoiceDate: '2026-01-10', pricePerUnit: 4, priceUnit: 'kg', packLabel: 'Lievito sacco 5 kg' } },
    ]) as Loose[];
    expect(point.pack).toBe('Lievito sacco 5 kg');
    expect(pointsOfDocs([{ id: 'inv-100-2', data: { invoiceId: '100', invoiceDate: '2026-01-10', pricePerUnit: 4, priceUnit: 'kg' } }])[0]!.pack).toBe(undefined);
    const ops = await planPriceChanges({
      ...base,
      storedPoints: [{ ...point, packCode: 'SACCO' }],
      newPoints: [{ id: 'inv-200-1', invoiceId: '200', line: 1, invoiceDate: '2026-02-10', pricePerUnit: 6, qty: 1 }],
      packLabel: 'Lievito pacco 1 kg',
      packCode: 'PACCO',
    });
    expect(ops.create[0].data.oldPack).toBe('Lievito sacco 5 kg');
    expect(ops.create[0].data.newPack).toBe('Lievito pacco 1 kg');
  });

  test('⚠️ an OLD unlabelled point takes the ingredient\'s main code and its name + weight; a new pack code makes the note', async () => {
    const storedPoints = pointsOfDocs([
      { id: 'inv-100-1', data: { invoiceId: '100', invoiceDate: '2026-01-10', pricePerUnit: 4, priceUnit: 'kg' } },
    ]);
    expect(storedPoints[0]!.packCode, 'nothing is invented in the reader').toBe(undefined);
    const ingredient = { name: 'Lievito sacco', weight: '5 kg', supplierCode: 'SACCO' };
    const newPoints = [{ id: 'inv-200-1', invoiceId: '200', line: 1, invoiceDate: '2026-02-10', pricePerUnit: 6, qty: 1 }];
    const other = await planPriceChanges({ ...base, storedPoints, newPoints, packLabel: 'Lievito pacco 1 kg', packCode: 'PACCO', ingredient });
    expect(other.create[0].data.oldPack).toBe('Lievito sacco 5 kg');
    expect(other.create[0].data.newPack).toBe('Lievito pacco 1 kg');
    // The same code, worded differently: a price change, no pack note.
    const same = await planPriceChanges({ ...base, storedPoints, newPoints, packLabel: 'LIEVITO SACCO', packCode: 'sacco', ingredient });
    expect(same.create.length).toBe(1);
    expect(!('oldPack' in same.create[0].data) && !('newPack' in same.create[0].data)).toBeTruthy();
    // Per piece: a 5 kg piece then a 1 kg piece is no change at all.
    const pieces = await planPriceChanges({
      ...base,
      storedPoints: [{ invoiceId: '100', line: 1, invoiceDate: '2026-01-10', pricePerUnit: 5, priceUnit: 'pcs', unitWeightKg: 5 }],
      newPoints, priceUnit: 'pcs', unitWeightKg: 1, ingredient,
    });
    expect(pieces.create.length).toBe(0);
  });
});
