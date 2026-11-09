// «Import from invoices» — the pure half between the model and the database (P15), run against BOTH implementations:
// the TypeScript port in shared/ and js/orders/invoice-import-plan.js, which the live app uses today. Ported from
// tests/invoice-import-plan.test.mjs: the documents a row writes, the screen's view of a plan, the re-check before each
// row and the summary. The module is a FULL port, so parity.spec.ts also compares its exports.
// Every name, VAT number and invoice id below is INVENTED.
//
// PORTED: 30 of 30 tests of tests/invoice-import-plan.test.mjs. The original imports the plan twice (the second time, at
// the foot of the file, under other names); here one import serves both halves, which changes nothing the tests see.
//
// ⚠️ These tests guard the write path of real business data: the cap of five documents per batch, the order inside one row,
// the re-check of a row on fresh data (a row NEW when planned becomes an update or a waiting question, never a duplicate),
// the runs that only a refusal or a lost connection may stop, and the summary counts.

import { describe, expect, test } from 'vitest';
import * as portedModel from './invoice-import-model';
import * as portedPlan from './invoice-import-plan';
import * as legacyModelJs from '../../js/orders/invoice-import-model.js';
import * as legacyPlanJs from '../../js/orders/invoice-import-plan.js';

const legacyModel = legacyModelJs as unknown as typeof portedModel;
const legacyPlan = legacyPlanJs as unknown as typeof portedPlan;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

const SUPPLIER_ID = 'sup-1';

describe.each([
  ['shared/ (TypeScript)', portedModel, portedPlan],
  ['js/ (current app)', legacyModel, legacyPlan],
] as const)('%s', (_name, model, plan) => {
  const { IMPORT_FORMAT, IMPORT_VERSION, parseImportFile } = model;
  const planIngredients = model.planIngredients as (file: Loose, ctx?: Loose) => Loose[];
  const ingredientWrites = model.ingredientWrites as (row: Loose, file: Loose, nowIso?: Loose, options?: Loose) => Loose;
  const {
    FORBIDDEN_KEYS, stopKind, bucketOf, filterCounts, waitingCount, writesRow, importTotals, idsToCheck, invoiceCount,
    summarizeRun, FILTERS, changedSupplierKeys, visibleFilters, isRetryableReason, priceChange,
  } = plan;
  const planBatchWrites = plan.planBatchWrites as (batches: Loose, options?: Loose) => Loose;
  const applyDecisions = plan.applyDecisions as (rows: Loose, decisions?: Loose, ctx?: Loose, forget?: Loose, confirm?: Loose, renames?: Loose) => Loose[];
  const entriesFor = plan.entriesFor as (entries: Loose, filter: string) => Loose[];
  const replanRow = plan.replanRow as (input: Loose) => Promise<Loose>;
  const rememberHints = plan.rememberHints as (entries: Loose, decisions: Loose, labelOf: Loose) => Loose;
  const bucket = bucketOf as (entry: Loose) => string;
  const countOf = filterCounts as (entries: Loose) => Loose;

  const price = (over: Loose = {}): Loose => ({ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, qty: 25, ...over });
  const rawIngredient = (over: Loose = {}): Loose => ({
    key: 'IT00000000001|code:F00-25', supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00',
    brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null,
    priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [price()], ...over,
  });
  const fileOf = (ingredients: Loose[]): Loose => {
    const r = parseImportFile(JSON.stringify({
      format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-03T10:00:00Z',
      suppliers: [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
      ingredients,
    }));
    expect(r.ok).toBe(true);
    return (r as Loose).file;
  };
  const supplierIdByKey = { IT00000000001: SUPPLIER_ID };
  const existing = (over: Loose = {}): Loose => ({
    id: 'ing-1', name: 'Farina tipo 00', shortName: '', supplierId: SUPPLIER_ID, supplierCode: 'F00-25', kind: 'ingredient', ...over,
  });
  const ctxOf = (over: Loose = {}): Loose => ({ supplierIdByKey, ingredients: [], pricesById: {}, invoicePointIds: {}, ...over });

  // ── planBatchWrites ─────────────────────────────────────────────────────────────

  test('a NEW ingredient: the minted id reaches the price and every point, and nothing else is invented', () => {
    const file = fileOf([rawIngredient({ prices: [price(), price({ line: 6, invoiceDate: '2026-09-15', pricePerUnit: 0.6 })] })]);
    const row = planIngredients(file.ingredients, ctxOf())[0] as Loose;
    expect(row.status).toBe('new');
    const batches = ingredientWrites(row, file.ingredients[0], '2026-10-03T00:00:00.000Z', { language: 'it' });
    let minted = 0;
    const written = planBatchWrites(batches, { mintId: () => { minted += 1; return 'minted-1'; }, bakery: 'loc-test' });
    expect(minted, 'one id per new ingredient').toBe(1);
    expect(written.ingredientId).toBe('minted-1');
    const writes: Loose[] = written.batches.flat();
    expect(writes[0].path).toStrictEqual(['ingredients', 'minted-1']);
    expect(writes[0].merge).toBe(true);
    expect(writes[1].path).toStrictEqual(['ingredient-prices', 'minted-1']);
    expect(writes[1].merge).toBe(true);
    const points = writes.filter((w) => w.path[2] === 'prices');
    expect(points.map((w) => w.path)).toStrictEqual([
      ['ingredients', 'minted-1', 'prices', 'inv-18000000001-5'],
      ['ingredients', 'minted-1', 'prices', 'inv-18000000001-6'],
    ]);
    points.forEach((w) => {
      expect(w.merge, 'a history point is create-only: the rules refuse the second create').toBe(false);
      expect(w.data.source).toBe('invoice');
      expect(w.data.supplierId).toBe(SUPPLIER_ID);
    });
    writes.forEach((w) => expect(w.data.bakery, 'every document carries the venue id').toBe('loc-test'));
    const shape = (name: string): void => { expect(writes.every((w) => !(name in w.data)), `${name} was written`).toBeTruthy(); };
    FORBIDDEN_KEYS.forEach(shape);
  });

  test('an EXISTING ingredient is never given a new id, and a patch only carries what the model sent', () => {
    const file = fileOf([rawIngredient({ supplierCode: 'F00-25' })]);
    const row = planIngredients(file.ingredients, ctxOf({ ingredients: [existing({ supplierCode: '' })] }))[0] as Loose;
    expect(row.status).toBe('update-price');
    const batches = ingredientWrites(row, file.ingredients[0], '2026-10-03T00:00:00.000Z', { language: 'it' });
    const written = planBatchWrites(batches, { mintId: () => { throw new Error('no id may be minted'); }, bakery: 'loc-test' });
    expect(written.ingredientId).toBe('ing-1');
    const writes: Loose[] = written.batches.flat();
    expect(writes[0].path).toStrictEqual(['ingredients', 'ing-1']);
    expect(writes[0].data).toStrictEqual({ supplierCode: 'F00-25', bakery: 'loc-test' });
    expect(writes.some((w) => w.path[0] === 'ingredient-prices' && w.merge === true)).toBeTruthy();
  });

  test('a history-only row writes points and no current price', () => {
    const file = fileOf([rawIngredient()]);
    const row = planIngredients(file.ingredients, ctxOf({
      ingredients: [existing()], pricesById: { 'ing-1': { priceUpdatedAt: '2026-09-30T12:00:00.000Z' } },
    }))[0] as Loose;
    expect(row.status).toBe('history-only');
    const written = planBatchWrites(ingredientWrites(row, file.ingredients[0], '', {}), { mintId: () => 'x', bakery: 'b' });
    expect((written.batches.flat() as Loose[]).map((w) => w.path[0])).toStrictEqual(['ingredients']);
    expect(written.batches.flat()[0].path[2]).toBe('prices');
  });

  test('⚠️ an allergen, nutrition or pack-list key can never pass, whoever builds the op', () => {
    for (const key of FORBIDDEN_KEYS) {
      expect(
        () => planBatchWrites([[{ type: 'create-ingredient', data: { name: 'x', [key]: [] } }]], { mintId: () => 'a', bakery: 'b' }),
      ).toThrow(new RegExp(key));
    }
    expect(() => planBatchWrites([[{ type: 'patch-ingredient', ingredientId: 'i', data: { allergens: ['milk'] } }]], { mintId: () => 'a', bakery: 'b' })).toThrow(/allergens/);
  });

  test('an op with nowhere to go, an unknown op and a point with no id are refused, not guessed', () => {
    const opts = { mintId: () => 'a', bakery: 'b' };
    expect(() => planBatchWrites([[{ type: 'set-current-price', ingredientId: null, data: {} }]], opts)).toThrow(/no ingredient/);
    expect(() => planBatchWrites([[{ type: 'drop-everything' }]], { ...opts })).toThrow(/Unknown|no ingredient/);
    expect(() => planBatchWrites([[{ type: 'add-price-point', ingredientId: 'i', data: {} }]], opts)).toThrow(/no id/);
    expect(planBatchWrites([], opts)).toStrictEqual({ batches: [], ingredientId: null });
  });

  test('the batches keep the model\'s order and size', () => {
    const ingredients = rawIngredient({
      prices: Array.from({ length: 12 }, (_, i) => price({ line: i + 1, invoiceDate: `2026-08-${String(i + 10).padStart(2, '0')}` })),
    });
    const file = fileOf([ingredients]);
    const row = planIngredients(file.ingredients, ctxOf())[0] as Loose;
    const batches = ingredientWrites(row, file.ingredients[0], '', { language: 'it' }) as Loose[][];
    const written = planBatchWrites(batches, { mintId: () => 'm', bakery: 'b' });
    expect((written.batches as Loose[][]).map((b) => b.length)).toStrictEqual(batches.map((b) => b.length));
    expect((written.batches as Loose[][]).every((b) => b.length <= 5)).toBeTruthy();
    expect(written.batches.flat().length, 'the ingredient, the price, twelve points').toBe(14);
  });

  // ── stopKind ────────────────────────────────────────────────────────────────────

  test('only a refusal and a lost connection stop the whole run', () => {
    expect(stopKind({ code: 'permission-denied' })).toBe('permission');
    expect(stopKind({ code: 'firestore/permission-denied' })).toBe('permission');
    expect(stopKind({ code: 'offline' })).toBe('offline');
    expect(stopKind({ code: 'unavailable' })).toBe('offline');
    expect(stopKind({ code: 'timeout' })).toBe('offline');
    expect(stopKind({ code: 'invalid-argument' })).toBe(null);
    expect(stopKind(new Error('boom'))).toBe(null);
    expect(stopKind(null)).toBe(null);
  });

  // ── The screen's view of a plan ─────────────────────────────────────────────────

  function mixedRows(): { file: Loose; ctx: Loose; rows: Loose[] } {
    const file = fileOf([
      rawIngredient({ key: 'k-new', name: 'Zucchero velo', supplierCode: '' }),
      rawIngredient({ key: 'k-same', name: 'Farina tipo 00' }),
      // Its own invoice: a point already recorded on another ingredient would be a remembered answer.
      rawIngredient({ key: 'k-maybe', name: 'Farina 00 Premium', supplierCode: '', prices: [price({ invoiceId: '18000000009' })] }),
      rawIngredient({ key: 'k-bad', name: '', supplierCode: '' }),
      rawIngredient({ key: 'k-nosup', supplierKey: 'IT99999999999', name: 'Orphan', supplierCode: '' }),
    ]);
    const ctx = ctxOf({
      ingredients: [existing({ id: 'ing-same' }), existing({ id: 'ing-near', name: 'Farina 00 Esempio', supplierCode: '' })],
      invoicePointIds: { 'ing-same': new Set(['inv-18000000001-5']) },
    });
    return { file, ctx, rows: planIngredients(file.ingredients, ctx) };
  }

  test('the chips count every row once, and Errors and Unchanged are told apart', () => {
    const { ctx, rows } = mixedRows();
    expect(rows.map((r) => r.status)).toStrictEqual(['new', 'unchanged', 'maybe-duplicate', 'error', 'error']);
    const entries = applyDecisions(rows, {}, ctx);
    const counts = filterCounts(entries);
    expect(counts).toStrictEqual({ all: 5, new: 1, 'update-price': 0, 'history-only': 0, unchanged: 1, check: 0, decide: 1, error: 2 });
    expect(FILTERS).toStrictEqual(['all', 'new', 'update-price', 'history-only', 'unchanged', 'check', 'decide', 'error']);
    expect(entriesFor(entries, 'error').map((e) => e.planned.key)).toStrictEqual(['k-bad', 'k-nosup']);
    expect(entriesFor(entries, 'all').length).toBe(5);
    expect(waitingCount(entries)).toBe(1);
    expect(bucketOf(entries[2])).toBe('decide');
  });

  test('answering a question keeps the row under «To decide» but changes what would be written', () => {
    const { ctx, rows } = mixedRows();
    const same = applyDecisions(rows, { 'k-maybe': { sameAs: 'ing-near' } }, ctx);
    expect(same[2].waiting).toBe(false);
    expect(bucketOf(same[2]), 'the row does not jump away from the finger that answered it').toBe('decide');
    expect(same[2].row.status).toBe('update-price');
    expect(same[2].row.ingredientId).toBe('ing-near');
    expect(waitingCount(same)).toBe(0);

    const created = applyDecisions(rows, { 'k-maybe': { createNew: true } }, ctx);
    expect(created[2].row.status).toBe('new');
    const skipped = applyDecisions(rows, { 'k-maybe': { skip: true } }, ctx);
    expect(skipped[2].row.status).toBe('skipped');
    expect(writesRow(skipped[2])).toBe(false);
  });

  test('the confirmation quotes the rows that write, the ingredients created and the prices added', () => {
    const { ctx, rows } = mixedRows();
    const entries = applyDecisions(rows, { 'k-maybe': { createNew: true } }, ctx);
    expect(importTotals(entries)).toStrictEqual({ rows: 2, newIngredients: 2, pricesAdded: 2, namesSaved: 0 });
    const sameAs = applyDecisions(rows, { 'k-maybe': { sameAs: 'ing-near' } }, ctx);
    expect(importTotals(sameAs)).toStrictEqual({ rows: 2, newIngredients: 1, pricesAdded: 2, namesSaved: 0 });
    expect(importTotals(applyDecisions(rows, {}, ctx))).toStrictEqual({ rows: 1, newIngredients: 1, pricesAdded: 1, namesSaved: 0 });
  });

  test('the invoice-point reads are made only for ingredients a row could be matched with', () => {
    const { rows } = mixedRows();
    expect(idsToCheck(rows).sort()).toStrictEqual(['ing-near', 'ing-same']);
    expect(idsToCheck([])).toStrictEqual([]);
  });

  test('the invoice count is by invoice, not by line', () => {
    const file = fileOf([rawIngredient({ prices: [price(), price({ line: 6 }), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-02' })] })]);
    const row = planIngredients(file.ingredients, ctxOf())[0] as Loose;
    expect(invoiceCount(row)).toBe(2);
  });

  // ── The re-check before each row ────────────────────────────────────────────────

  function reader(state: Loose): { calls: any[][]; read: Loose } {
    const calls: any[][] = [];
    return {
      calls,
      read: {
        ingredients: async (id: string) => { calls.push(['ingredients', id]); return state.ingredients; },
        pointIds: async (id: string) => { calls.push(['pointIds', id]); return state.points?.[id] || new Set(); },
        price: async (id: string) => { calls.push(['price', id]); return state.prices?.[id] || null; },
      },
    };
  }

  test('⚠️ a row that was NEW when planned becomes an update when the ingredient now exists', async () => {
    const file = fileOf([rawIngredient({ supplierCode: '' })]);
    const { read, calls } = reader({ ingredients: [existing({ id: 'just-created', supplierCode: '' })] });
    const out = await replanRow({ fileIngredient: file.ingredients[0], decision: undefined, supplierIdByKey, read });
    expect(out.waiting).toBe(false);
    expect(out.row.status).toBe('update-price');
    expect(out.row.ingredientId).toBe('just-created');
    expect(calls.map((c) => c[0])).toStrictEqual(['ingredients', 'pointIds', 'price']);
  });

  test('a row whose points are all recorded is unchanged on the re-check, and nothing is written', async () => {
    const file = fileOf([rawIngredient()]);
    const { read } = reader({
      ingredients: [existing({ id: 'i1' })],
      points: { i1: new Set(['inv-18000000001-5']) },
      prices: { i1: { priceUpdatedAt: '2026-08-31T12:00:00.000Z' } },
    });
    const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
    expect(out.row.status).toBe('unchanged');
    expect(ingredientWrites(out.row, file.ingredients[0], '', {})).toStrictEqual([]);
  });

  test('a row with nothing similar stays new and reads nothing about prices', async () => {
    const file = fileOf([rawIngredient({ supplierCode: '' })]);
    const { read, calls } = reader({ ingredients: [] });
    const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
    expect(out.row.status).toBe('new');
    expect(calls).toStrictEqual([['ingredients', SUPPLIER_ID]]);
  });

  test('a similar ingredient that appeared meanwhile leaves an undecided row WAITING, never a duplicate', async () => {
    const file = fileOf([rawIngredient({ name: 'Farina 00 Premium', supplierCode: '' })]);
    const { read } = reader({ ingredients: [existing({ id: 'near', name: 'Farina 00 Esempio', supplierCode: '' })] });
    const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
    expect(out.waiting).toBe(true);
    expect(out.row.status).toBe('maybe-duplicate');
  });

  test('the person\'s answer is applied again on the fresh data', async () => {
    const file = fileOf([rawIngredient({ name: 'Farina 00 Premium', supplierCode: '' })]);
    const state = { ingredients: [existing({ id: 'near', name: 'Farina 00 Esempio', supplierCode: '' })] };
    const same = await replanRow({ fileIngredient: file.ingredients[0], decision: { sameAs: 'near' }, supplierIdByKey, read: reader(state).read });
    expect(same.row.status).toBe('update-price');
    expect(same.row.ingredientId).toBe('near');
    const fresh = await replanRow({ fileIngredient: file.ingredients[0], decision: { createNew: true }, supplierIdByKey, read: reader(state).read });
    expect(fresh.row.status).toBe('new');
    const gone = await replanRow({ fileIngredient: file.ingredients[0], decision: { sameAs: 'deleted' }, supplierIdByKey, read: reader(state).read });
    expect(gone.row.status).toBe('error');
  });

  test('a supplier nobody mapped reads nothing and is an error row', async () => {
    const file = fileOf([rawIngredient({ supplierKey: 'IT99999999999' })]);
    const { read, calls } = reader({ ingredients: [] });
    const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
    expect(out.row.status).toBe('error');
    expect(out.row.reason).toBe('supplier-missing');
    expect(calls).toStrictEqual([]);
  });

  test('a failed read is not swallowed: the caller decides what it means', async () => {
    const file = fileOf([rawIngredient()]);
    const err = Object.assign(new Error('offline'), { code: 'unavailable' });
    await expect(
      replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read: { ingredients: async () => { throw err; } } }),
    ).rejects.toSatisfy((e: Loose) => e.code === 'unavailable');
  });

  // ── A second run writes nothing ─────────────────────────────────────────────────

  test('importing the same file twice: the second pass plans no write at all', async () => {
    const file = fileOf([rawIngredient(), rawIngredient({ key: 'k2', name: 'Zucchero', supplierCode: '', prices: [price({ line: 9 })] })]);
    const store: Loose[] = [];
    const points: Record<string, string[]> = {};
    const read = {
      ingredients: async () => store,
      pointIds: async (id: string) => new Set(points[id] || []),
      price: async () => null,
    };
    let next = 0;
    const run = async (): Promise<number> => {
      let writes = 0;
      for (const fileIngredient of file.ingredients as Loose[]) {
        const { row } = await replanRow({ fileIngredient, supplierIdByKey, read });
        const batches = ingredientWrites(row, fileIngredient, '', { language: 'it' }) as Loose[];
        if (batches.length === 0) continue;
        const written = planBatchWrites(batches, { mintId: () => { next += 1; return `id-${next}`; }, bakery: 'b' });
        (written.batches.flat() as Loose[]).forEach((w) => {
          writes += 1;
          if (w.path[0] === 'ingredients' && w.path.length === 2 && !store.some((i) => i.id === w.path[1])) {
            store.push({ id: w.path[1], supplierId: SUPPLIER_ID, kind: 'ingredient', ...w.data });
          }
          if (w.path[2] === 'prices') (points[w.path[1]] ||= []).push(w.path[3]);
        });
      }
      return writes;
    };
    expect(await run()).toBeGreaterThan(0);
    expect(await run(), 're-running the same file must write nothing').toBe(0);
    expect(store.length, 'and must not have created a copy').toBe(2);
  });

  // ── The summary ─────────────────────────────────────────────────────────────────

  test('the summary counts every outcome and keeps each failure with its reason', () => {
    const sum = summarizeRun([
      { key: 'a', name: 'A', outcome: 'created', pricesAdded: 2 },
      { key: 'b', name: 'B', outcome: 'updated', pricesAdded: 1 },
      { key: 'c', name: 'C', outcome: 'unchanged' },
      { key: 'd', name: 'D', outcome: 'skipped' },
      { key: 'e', name: 'E', outcome: 'failed', reason: 'nope' },
    ], { stopped: 'offline', notRun: 3 });
    expect(sum).toStrictEqual({
      namesSaved: 0, namesLost: 0, created: 1, updated: 1, pricesAdded: 3, changesAdded: 0, changesFailed: 0, unchanged: 1, skipped: 1, codesFull: 0,
      failed: [{ key: 'e', name: 'E', reason: 'nope', retry: false }], stopped: 'offline', notRun: 3,
      retryable: 0, notFixableByRetry: 1,
    });
    expect(summarizeRun([]).failed).toStrictEqual([]);
  });

  // ── Review fixes ────────────────────────────────────────────────────────────────

  test('⚠️ the re-check remembers an answer too: the candidate that holds the row\'s points is the match', async () => {
    const file = fileOf([rawIngredient({ name: 'Farina di grano tenero', supplierCode: '' })]);
    const { read, calls } = reader({
      ingredients: [existing({ id: 'far', name: 'Farina', supplierCode: '' }), existing({ id: 'zz', name: 'Zucchero', supplierCode: '' })],
      points: { far: new Set(['inv-18000000001-5']) },
      prices: { far: { priceUnit: 'kg', priceUpdatedAt: '2026-08-31T12:00:00.000Z' } },
    });
    const out = await replanRow({ fileIngredient: file.ingredients[0], decision: undefined, supplierIdByKey, read });
    expect(out.waiting, 'it is not a question any more').toBe(false);
    expect(out.row.status).toBe('unchanged');
    expect(out.row.ingredientId).toBe('far');
    expect(calls.map((c) => c[0])).toStrictEqual(['ingredients', 'pointIds', 'price']);
    expect(calls.filter((c) => c[0] === 'pointIds').map((c) => c[1])).toStrictEqual(['far']);
  });

  test('the same file twice after a «Same as» answer: the second run asks nothing and plans no write', () => {
    const file = fileOf([rawIngredient({ name: 'Farina di grano tenero', supplierCode: '' })]);
    const ingredients = [existing({ id: 'far', name: 'Farina', supplierCode: '' })];
    const first = planIngredients(file.ingredients, ctxOf({ ingredients }));
    expect(first[0]!.status).toBe('maybe-duplicate');
    const answered = applyDecisions(first, { [first[0]!.key]: { sameAs: 'far' } }, ctxOf({ ingredients }));
    expect(answered[0]!.row.status).toBe('update-price');
    // What the first import left behind: the point under «Farina».
    const second = planIngredients(file.ingredients, ctxOf({ ingredients, invoicePointIds: { far: new Set(['inv-18000000001-5']) } }));
    expect(second.map((r) => r.status)).toStrictEqual(['unchanged']);
    const entries = applyDecisions(second, {}, ctxOf({ ingredients }));
    expect(waitingCount(entries)).toBe(0);
    expect(importTotals(entries).rows).toBe(0);
  });

  test('the supplier plan the owner confirmed is compared with the fresh one, key by key', () => {
    const before = [
      { key: 'a', status: 'new' },
      { key: 'b', status: 'present', supplierId: 's1' },
      { key: 'c', status: 'maybe', candidates: [{ id: 'x', label: 'X' }] },
      { key: 'd', status: 'error', reason: 'name-missing' },
    ];
    expect(changedSupplierKeys(before as Loose, before.map((e) => ({ ...e })) as Loose)).toStrictEqual([]);
    const after = [
      { key: 'a', status: 'present', supplierId: 's9' },                         // appeared meanwhile
      { key: 'b', status: 'present', supplierId: 's2' },                         // now another supplier
      { key: 'c', status: 'maybe', candidates: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] },   // one more candidate
      { key: 'd', status: 'error', reason: 'name-missing' },
    ];
    expect(changedSupplierKeys(before as Loose, after as Loose)).toStrictEqual(['a', 'b', 'c']);
    expect(changedSupplierKeys(before as Loose, []), 'a missing entry is a change').toStrictEqual(['a', 'b', 'c', 'd']);
    // What this very import wrote exists now by its own doing: not a change.
    expect(changedSupplierKeys(before as Loose, after as Loose, ['a', 'b'])).toStrictEqual(['c']);
  });

  test('the chips offered: All, the one that is on, and every one with something under it', () => {
    const counts = { all: 5, new: 3, 'update-price': 0, 'history-only': 0, unchanged: 2, decide: 0, error: 0 };
    expect(visibleFilters(counts, 'all')).toStrictEqual(['all', 'new', 'unchanged']);
    expect(visibleFilters(counts, 'decide')).toStrictEqual(['all', 'new', 'unchanged', 'decide']);
    expect(visibleFilters({ ...counts, new: 0, unchanged: 0 }, 'all')).toStrictEqual(['all']);
  });

  test('only a failure a second load can fix is marked retryable; the summary counts both kinds', () => {
    const sum = summarizeRun([
      { key: 'a', name: 'A', outcome: 'failed', reason: 'invalid price', retry: false },
      { key: 'b', name: 'B', outcome: 'failed', reason: 'could not be saved', retry: true },
      { key: 'c', name: 'C', outcome: 'failed', reason: 'unmarked' },
    ]);
    expect(sum.retryable).toBe(1);
    expect(sum.notFixableByRetry, 'a failure nobody marked is not promised a fix').toBe(2);
    expect(sum.failed.map((f) => f.retry)).toStrictEqual([false, true, false]);
    expect(isRetryableReason('target-not-found')).toBe(true);
    expect(isRetryableReason('price-invalid')).toBe(false);
    expect(isRetryableReason('supplier-missing')).toBe(false);
    expect(summarizeRun([]).retryable).toBe(0);
  });

  test('every row answered by hand with no article code gets a «unisci con» line; a row with a code does not', () => {
    const file = fileOf([
      rawIngredient({ key: 'k-hand', name: 'Farina 00 Premium', supplierCode: '' }),
      rawIngredient({ key: 'k-code', name: 'Zucchero velo premium', supplierCode: 'Z1', prices: [price({ line: 2 })] }),
      rawIngredient({ key: 'k-skip', name: 'Sale marino premium', supplierCode: '', prices: [price({ line: 3 })] }),
      rawIngredient({ key: 'k-auto', name: 'Olio extra', supplierCode: '', prices: [price({ line: 4 })] }),
    ]);
    const ingredients = [
      existing({ id: 'i1', name: 'Farina 00 Esempio', supplierCode: '' }),
      existing({ id: 'i2', name: 'Zucchero velo esempio', supplierCode: '' }),
      existing({ id: 'i3', name: 'Sale marino esempio', supplierCode: '' }),
    ];
    const ctx = ctxOf({ ingredients });
    const rows = planIngredients(file.ingredients, ctx);
    const decisions = { 'k-hand': { sameAs: 'i1' }, 'k-code': { sameAs: 'i2' }, 'k-skip': { skip: true } };
    const entries = applyDecisions(rows, decisions, ctx);
    const labelOf = (id: string): string => ingredients.find((i) => i.id === id)?.name || '';
    expect(rememberHints(entries, decisions, labelOf)).toStrictEqual([{ name: 'Farina 00 Premium', target: 'Farina 00 Esempio' }]);
    expect(rememberHints(entries, {}, labelOf)).toStrictEqual([]);
    expect(rememberHints(entries, decisions, () => ''), 'a target with no label is not promised').toStrictEqual([]);
  });

  // ── The price change shown on a row, the «price to check» group and «do not import (remember)» ────

  test('priceChange: a signed whole percent, «equal» within half a percent, nothing across units or with a missing side', () => {
    expect(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.31, 'kg')).toStrictEqual({ percent: 10 });
    expect(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 1.89, 'kg')).toStrictEqual({ percent: -10 });
    expect(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.105, 'kg')).toStrictEqual({ percent: 0 });
    expect(priceChange({ pricePerUnit: 2, priceUnit: 'kg' }, 2.009, 'kg')).toStrictEqual({ percent: 0 });
    expect(priceChange({ pricePerUnit: 2, priceUnit: 'kg' }, 2.02, 'kg')).toStrictEqual({ percent: 1 });
    expect(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.31, 'l')).toBe(null);
    expect(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.31, 'pcs')).toBe(null);
    expect(priceChange(null, 2.31, 'kg')).toBe(null);
    expect(priceChange({ priceUnit: 'kg' }, 2.31, 'kg')).toBe(null);
    expect(priceChange({ pricePerUnit: 0, priceUnit: 'kg' }, 2.31, 'kg')).toBe(null);
    expect(priceChange({ pricePerUnit: 2, priceUnit: 'kg' }, 0, 'kg')).toBe(null);
  });

  test('a row with a priceCheck code is counted under «Price to check», new or matched', () => {
    const planned = [
      { key: 'a', status: 'new', priceCheck: 'price-out-of-scale', newPoints: [], allPoints: [] },
      { key: 'b', status: 'unchanged', priceCheck: 'mixed-units', newPoints: [], allPoints: [] },
      { key: 'c', status: 'new', priceCheck: '', newPoints: [{}], allPoints: [{}] },
    ];
    const entries = applyDecisions(planned, {}, {});
    expect(entries.map(bucket)).toStrictEqual(['check', 'check', 'new']);
    const counts = countOf(entries);
    expect([counts.check, counts.new, counts.unchanged]).toStrictEqual([2, 1, 0]);
  });

  test('«Do not import (remember)» turns a NEW row into a skipped one that stays under its chip', () => {
    const planned = [
      { key: 'a', status: 'new', priceCheck: '', newPoints: [{}], allPoints: [{}], updateCurrent: true },
      { key: 'b', status: 'update-price', priceCheck: '', newPoints: [{}], allPoints: [{}], updateCurrent: true },
    ];
    const entries = applyDecisions(planned, {}, {}, new Set(['a', 'b']));
    expect(entries[0]!.row.status).toBe('skipped');
    expect(entries[0]!.row.newPoints).toStrictEqual([]);
    expect(bucket(entries[0])).toBe('new');
    expect(entries[1]!.row.status, 'only a NEW row can be left out this way').toBe('update-price');
    expect(countOf(entries).new).toBe(1);
  });
});
