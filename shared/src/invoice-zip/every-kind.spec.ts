// MISE 2 ONLY (14 Nov 2026, «tutti i prodotti delle fatture in Mise»): the invoice import brings in EVERY product, each with its
// item kind — the `everyKind` options of build-import.ts, selection.ts and invoice-import-model.ts's plan. The paired specs run the
// original's behaviour (no option) against both files; this one runs the port alone, with the options, through the whole chain:
// invented invoices → build → selection → plan → writes. Invented invoices only (testing/invoice-builders.ts), never real ones.

import { describe, expect, test } from 'vitest';
import { ingredientWrites, parseImportFile, planIngredients } from '../invoice-import-model';
import type { FileIngredient } from '../invoice-import-model';
import { selectImport, decisionId, supplierDecisionKey } from './selection';
import { ported } from './testing/implementations';
import { makeCase } from './testing/invoice-builders';
import type { LineSpec } from './testing/invoice-builders';
import type { ImportResult } from './build-import';
import { changesFromPoints } from '../price-changes-model';
import { planPriceChanges } from '../invoice-import-plan';

const SUPPLIER = 'IT00000000001';
const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00', qty: 25, unit: 'KG', total: 14.25 };
const FILM: LineSpec = { desc: 'PELLICOLA ALIMENTARE ROTOLO', code: 'PEL', qty: 3, unit: 'KG', total: 15 };
const WATER: LineSpec = { desc: 'ACQUA SABRINELLA NAT 1/2X12', code: 'AQ', qty: 10, unit: 'CT', total: 30 };
const SOAP: LineSpec = { desc: 'DETERSIVO PAVIMENTI', code: 'DT', qty: 4, unit: 'PZ', total: 12 };
const COLA: LineSpec = { desc: 'COCA COLA ZERO', code: 'CZ', qty: 24, unit: 'PZ', total: 12 };
// Packaging counted in pieces, with no weight anywhere on the line (15 Nov 2026: priced per piece like resale and other).
const TRAYS: LineSpec = { desc: 'VASCHETTE ALLUMINIO', code: 'VA', qty: 200, unit: 'PZ', total: 30 };
const key = (code: string): string => `${SUPPLIER}|code:${code}`;

function built(lines: readonly LineSpec[], everyKind = true): ImportResult {
  const c = makeCase(ported.caseImpl);
  c.add(lines);
  return c.build(everyKind ? { everyKind: true } : {});
}

const fileOf = (result: ImportResult): FileIngredient[] => {
  const parsed = parseImportFile(JSON.stringify(result.importFile));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.file.ingredients;
};

describe('build-import with everyKind', () => {
  test('one line of each kind: four products in the file, each with its kind', () => {
    const result = built([FLOUR, FILM, WATER, SOAP]);
    const kinds = Object.fromEntries(result.importFile.ingredients.map(i => [i.key, i.kind]));
    expect(kinds).toStrictEqual({ [key('F00')]: 'ingredient', [key('PEL')]: 'packaging', [key('AQ')]: 'resale', [key('DT')]: 'other' });
    for (const row of result.products) {
      expect(row.inImport, row.key).toBe(true);
      expect(row.leftOutReason, row.key).toBe('');
    }
  });

  test('«ACQUA … 1/2X12» is priced per litre: ten cases of twelve half-litre bottles for 30.00 is 0.50 a litre', () => {
    const water = built([WATER]).importFile.ingredients[0];
    expect(water).toMatchObject({ kind: 'resale', priceUnit: 'l', weight: '0.5 l', packCount: 12 });
    expect(water?.prices.map(p => p.pricePerUnit)).toStrictEqual([0.5]);
  });

  test('resale and other with no weight on the invoice are priced per piece, with no piece weight', () => {
    const file = built([SOAP, COLA]).importFile.ingredients;
    expect(file.find(i => i.key === key('DT'))).toMatchObject({ kind: 'other', priceUnit: 'pcs', unitWeightKg: null });
    expect(file.find(i => i.key === key('DT'))?.prices.map(p => p.pricePerUnit)).toStrictEqual([3]);
    expect(file.find(i => i.key === key('CZ'))).toMatchObject({ kind: 'resale', priceUnit: 'pcs', unitWeightKg: null });
    expect(file.find(i => i.key === key('CZ'))?.prices.map(p => p.pricePerUnit)).toStrictEqual([0.5]);
  });

  test('⚠️ packaging counted in pieces with no weight is priced per piece too, with no piece weight (15 Nov 2026)', () => {
    const result = built([TRAYS]);
    expect(result.products[0]).toMatchObject({ type: 'packaging', canImport: true, inImport: true, leftOutReason: '' });
    const trays = result.importFile.ingredients[0];
    expect(trays).toMatchObject({ key: key('VA'), kind: 'packaging', priceUnit: 'pcs', unitWeightKg: null });
    expect(trays?.prices.map(p => p.pricePerUnit)).toStrictEqual([0.15]);
  });

  test('food keeps today\'s rule: counted in pieces with no weight is still unreadable', () => {
    const result = built([{ desc: 'FARINA SPECIALE', code: 'FS', qty: 4, unit: 'PZ', total: 12 }]);
    expect(result.importFile.ingredients).toStrictEqual([]);
    expect(result.products[0]).toMatchObject({ type: 'ingrediente', canImport: false, unreadableReason: 'pieces-need-price-unit-and-weight' });
  });

  test('without the option the result is the original\'s: only the ingredient, no kind, the soap unreadable', () => {
    const result = built([FLOUR, FILM, WATER, SOAP], false);
    expect(result.importFile.ingredients.map(i => i.key)).toStrictEqual([key('F00')]);
    expect(result.importFile.ingredients[0]).not.toHaveProperty('kind');
    expect(result.products.find(r => r.key === key('DT'))).toMatchObject({ type: 'altro', canImport: false, leftOutReason: 'not-an-ingredient' });
  });
});

describe('selection with everyKind', () => {
  test('everything readable goes in, grouped and counted by kind; nothing is «not imported»', () => {
    const selection = selectImport(built([FLOUR, FILM, WATER, SOAP]), { everyKind: true });
    expect(selection.importFile.ingredients).toHaveLength(4);
    expect(selection.groups.notImported).toStrictEqual([]);
    expect(selection.counts.byKind).toStrictEqual({ ingredient: 1, packaging: 1, resale: 1, other: 1 });
    expect(selection.groups.byKind?.resale.map(item => item.key)).toStrictEqual([key('AQ')]);
    expect(selection.groups.byKind?.other[0]).toMatchObject({ key: key('DT'), kind: 'other' });
  });

  test('«skip this product» and «skip this supplier» still work; a stored «ingredient» means «import»', () => {
    const result = built([FLOUR, FILM, WATER, SOAP]);
    const skipSoap = selectImport(result, { everyKind: true, decisions: [{ id: decisionId(key('DT')), decision: 'skip' }] });
    expect(skipSoap.importFile.ingredients.map(i => i.key)).not.toContain(key('DT'));
    expect(skipSoap.groups.skippedByYou.map(item => item.key)).toStrictEqual([key('DT')]);
    expect(skipSoap.counts.byKind?.other).toBe(0);
    // Ticked «import again» on the first screen: back in.
    const again = selectImport(result, {
      everyKind: true, decisions: [{ id: decisionId(key('DT')), decision: 'skip' }], overrides: { [key('DT')]: 'ingredient' },
    });
    expect(again.importFile.ingredients.map(i => i.key)).toContain(key('DT'));

    const skipSupplier = selectImport(result, { everyKind: true, decisions: [{ id: decisionId(supplierDecisionKey(SUPPLIER)), decision: 'skip' }] });
    expect(skipSupplier.importFile.ingredients).toStrictEqual([]);

    const stored = selectImport(result, {
      everyKind: true,
      decisions: [{ id: decisionId(supplierDecisionKey(SUPPLIER)), decision: 'skip' }, { id: decisionId(key('AQ')), decision: 'ingredient' }],
    });
    expect(stored.importFile.ingredients.map(i => [i.key, i.kind])).toStrictEqual([[key('AQ'), 'resale']]);
  });
});

describe('the plan and the writes with every kind', () => {
  const SUPPLIER_ID = 's-cerere';
  const ctx = (ingredients: readonly Record<string, unknown>[] = []) => ({
    supplierIdByKey: { [SUPPLIER]: SUPPLIER_ID }, ingredients, pricesById: {}, invoicePointIds: {}, everyKind: true,
  });
  const createdKinds = (file: FileIngredient[], context: ReturnType<typeof ctx>): (string | undefined)[] => {
    const rows = planIngredients(file, context);
    return rows.flatMap((row, index) => ingredientWrites(row, file[index], '2026-11-14T10:00:00.000Z', { language: 'it' }).flat())
      .filter(op => op.type === 'create-ingredient')
      .map(op => (op as { data: { kind?: string } }).data.kind);
  };

  test('⚠️ a file with one line of each kind ends with four NEW items with the right kinds', () => {
    const file = fileOf(built([FLOUR, FILM, WATER, SOAP]));
    expect(createdKinds(file, ctx()).sort()).toStrictEqual(['ingredient', 'other', 'packaging', 'resale']);
  });

  test('a per-piece packaging, resale or other entry with no weight is valid; an ingredient one is not', () => {
    const file = fileOf(built([SOAP, COLA, TRAYS]));
    expect(file.map(entry => entry.invalid)).toStrictEqual([undefined, undefined, undefined]);
    const raw = JSON.parse(JSON.stringify(built([SOAP]).importFile)) as { ingredients: Record<string, unknown>[] };
    raw.ingredients = raw.ingredients.map(entry => ({ ...entry, kind: undefined }));
    const parsed = parseImportFile(JSON.stringify(raw));
    expect(parsed.ok && parsed.file.ingredients[0]?.invalid).toBe('unit-weight-missing');
  });

  test('⚠️ an existing RESALE item matched by its article code is never turned into an ingredient', () => {
    // The same water, but this month's line no longer says it is a drink: the reader takes it for an ingredient.
    const result = built([{ ...WATER, desc: 'SABRINELLA NATURALE 1/2 LT X 12' }]);
    const file = fileOf(result);
    expect(file[0]?.kind).toBeUndefined();
    const existing = [{ id: 'w1', supplierId: SUPPLIER_ID, name: 'Acqua naturale', supplierCode: 'AQ', kind: 'resale' }];
    const rows = planIngredients(file, ctx(existing));
    expect(rows[0]).toMatchObject({ ingredientId: 'w1' });
    const ops = ingredientWrites(rows[0], file[0], '2026-11-14T10:00:00.000Z', { language: 'it' }).flat();
    expect(ops.some(op => op.type === 'create-ingredient')).toBe(false);
    expect(ops.every(op => !('kind' in (op.data as object)))).toBe(true);
  });

  test('⚠️ a packaging line with no weight becomes a NEW packaging item priced per piece, with no piece weight', () => {
    const file = fileOf(built([TRAYS]));
    const rows = planIngredients(file, ctx());
    const ops = ingredientWrites(rows[0], file[0], '2026-11-15T10:00:00.000Z', { language: 'it' }).flat();
    const created = ops.find(op => op.type === 'create-ingredient') as { data: Record<string, unknown> } | undefined;
    expect(created?.data).toMatchObject({ kind: 'packaging' });
    // The price in force: per piece, the piece weight null (the card's own shape); the history point names no weight at all.
    const current = ops.find(op => op.type === 'set-current-price') as { data: Record<string, unknown> } | undefined;
    expect(current?.data).toMatchObject({ priceUnit: 'pcs', pricePerUnit: 0.15, unitWeightKg: null });
    const points = ops.filter(op => op.type === 'add-price-point') as { data: Record<string, unknown> }[];
    expect(points).toHaveLength(1);
    expect(points[0]?.data).toMatchObject({ priceUnit: 'pcs', pricePerUnit: 0.15 });
    expect(points[0]?.data).not.toHaveProperty('unitWeightKg');
  });

  test('a packaging line finds the packaging item it already is (every kind is matched)', () => {
    const file = fileOf(built([FILM]));
    const existing = [{ id: 'p1', supplierId: SUPPLIER_ID, name: 'Pellicola', supplierCode: 'PEL', kind: 'packaging' }];
    expect(planIngredients(file, ctx(existing))[0]).toMatchObject({ ingredientId: 'p1' });
    // Without the option (the original) a packaging item is never a match: a new item would be proposed.
    expect(planIngredients(file, { ...ctx(existing), everyKind: false })[0]).not.toMatchObject({ ingredientId: 'p1' });
  });
});

// Code review of 15 Nov 2026: a product priced per piece with NO weight must keep being priced by the next invoices, and must
// never put that price on a FOOD item.
describe('per-piece prices with no weight, on the next invoices', () => {
  const SUPPLIER_ID = 's-cerere';
  const ctx = (ingredients: readonly Record<string, unknown>[], pricesById: Record<string, Record<string, unknown>> = {}) => ({
    supplierIdByKey: { [SUPPLIER]: SUPPLIER_ID }, ingredients, pricesById, invoicePointIds: {}, everyKind: true,
  });
  const trays = (fields: Record<string, unknown> = {}) =>
    ({ id: 'p1', supplierId: SUPPLIER_ID, name: 'Vaschette', supplierCode: 'VA', kind: 'packaging', ...fields });
  const storedPrice = (fields: Record<string, unknown> = {}) =>
    ({ priceUnit: 'pcs', pricePerUnit: 0.14, unitWeightKg: null, priceUpdatedAt: '2020-01-01T12:00:00.000Z', ...fields });

  test('⚠️ an item already priced per piece with no weight gets the newer price (never «a piece of another size»)', () => {
    const file = fileOf(built([TRAYS]));
    const row = planIngredients(file, ctx([trays()], { p1: storedPrice() }))[0];
    expect(row).toMatchObject({ ingredientId: 'p1', status: 'update-price', updateCurrent: true });
    expect(row).not.toHaveProperty('reason', 'piece-differs');
    const ops = ingredientWrites(row, file[0], '2026-11-15T10:00:00.000Z', { language: 'it' }).flat();
    expect(ops.find(op => op.type === 'set-current-price')?.data).toMatchObject({ priceUnit: 'pcs', pricePerUnit: 0.15, unitWeightKg: null });
  });

  test('a stored piece WITH a weight is still another piece: the new prices go to the history only', () => {
    const file = fileOf(built([TRAYS]));
    const row = planIngredients(file, ctx([trays()], { p1: storedPrice({ unitWeightKg: 0.02 }) }))[0];
    expect(row).toMatchObject({ ingredientId: 'p1', status: 'history-only', updateCurrent: false });
  });

  test.each([
    ['no kind', {}],
    ['kind «ingredient»', { kind: 'ingredient' }],
  ])('⚠️ never on a FOOD item (%s): matched by its code, the row is an error and nothing is written', (_label, fields) => {
    const file = fileOf(built([TRAYS]));
    const row = planIngredients(file, ctx([trays({ kind: undefined, ...fields })]))[0];
    expect(row).toMatchObject({ status: 'error', reason: 'unit-weight-missing' });
    expect(ingredientWrites(row, file[0], '2026-11-15T10:00:00.000Z', { language: 'it' }).flat()).toStrictEqual([]);
  });

  test('price changes: two per-piece prices with no weight are compared (Mise 2 option); a weighed and a weightless one never', () => {
    const point = (invoiceId: string, invoiceDate: string, pricePerUnit: number, unitWeightKg?: number) => ({
      invoiceId, line: 1, invoiceDate, pricePerUnit, priceUnit: 'pcs', ...(unitWeightKg ? { unitWeightKg } : {}),
    });
    const item = { id: 'p1', supplierId: SUPPLIER_ID, name: 'Vaschette' };
    const weightless = [point('A', '2026-10-01', 0.14), point('B', '2026-11-01', 0.17)];
    expect(changesFromPoints(item, weightless)).toStrictEqual([]);
    expect(changesFromPoints(item, weightless, { weightlessPieces: true })).toMatchObject([{ oldPrice: 0.14, newPrice: 0.17 }]);
    expect(changesFromPoints(item, [point('A', '2026-10-01', 0.14, 0.02), point('B', '2026-11-01', 0.17)], { weightlessPieces: true }))
      .toStrictEqual([]);
  });

  test('planPriceChanges records the change of a per-piece price with no weight', async () => {
    const plan = await planPriceChanges({
      ingredientId: 'p1', supplierId: SUPPLIER_ID, name: 'Vaschette', priceUnit: 'pcs', unitWeightKg: null, isNew: false,
      storedPoints: [{ invoiceId: '101', line: 1, invoiceDate: '2026-10-01', pricePerUnit: 0.14, priceUnit: 'pcs' }],
      newPoints: [{ invoiceId: '102', line: 1, invoiceDate: '2026-11-01', pricePerUnit: 0.17, priceUnit: 'pcs' }],
      read: { changeIds: () => [] }, nowIso: '2026-11-15T10:00:00.000Z',
    });
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ type: 'add-price-change', data: { oldPrice: 0.14, newPrice: 0.17 } });
  });
});
