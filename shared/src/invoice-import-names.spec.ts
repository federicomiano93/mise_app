// «Nome in fattura» — the third name of an ingredient (`invoiceName`): the product description exactly as the supplier's
// invoice writes it, saved by the invoice import and never typed. It is how the import tells an ingredient it already holds
// from a new one when the article code is missing or has changed (P15), run against BOTH implementations: the TypeScript
// port in shared/ and the js/ files the live app uses today. Ported from tests/invoice-import-names.test.mjs.
// Every name, code, VAT number and price below is INVENTED.
//
// PORTED: 21 of the 36 tests of tests/invoice-import-names.test.mjs, all of them the ones that run the MODEL
// (invoice-import-model, with invoiceNameOf of classify and the invented invoices of testing/invoice-builders.ts):
//   '1 · invoiceNameOf removes ONLY the {…} lot blocks…', '1 · the file ingredient carries the description of the NEWEST
//   invoice…', '1 · the .json of the Python script has no description…', '2 · a new ingredient is created with its
//   invoiceName', '2 · a file with no invoiceName creates an ingredient with no such key', the five '3 ·' tests,
//   '4 · a code match fills in an EMPTY invoice name silently', '4 · a file OLDER than what the venue holds never proposes a
//   rename…', '4 · a hit through an EXTRA code (another pack)…', '4b · a NEW pack added through «Same as»…', '4b · a row with
//   NO code answered «Same as»…', the two '5 ·' tests, '6 · the same product on a later invoice with another LOT number…',
//   '9 · the «older file» floor comes only from the MAIN pack…', '9 · M13…' and '9 · M14…'.
//
// LEFT FOR SLICE B1b (they call invoice-import-plan.js — applyDecisions, bucketOf, importTotals, rowToWrite, summarizeRun,
// withRename, writesRow — which is not ported yet; ELEVEN tests):
//   '4 · an otherwise UNCHANGED row still writes the invoice name, counts as a write…', '4 · the same invoice name writes
//   nothing at all, and neither does another CASE or spacing of it', '4 · a DIFFERENT invoice name under the same main code
//   NEVER holds the prices…', '4 · the rename is written only when the person chose it for THAT old → new pair', '4 · a
//   renamed product whose prices are all in already is a write only once the rename is chosen', '4 · a price reason AND a
//   rename are both on the row…', '4b · the same RUN: the new pack row first, then the main pack row…' (rowToWrite), '4c ·
//   rowToWrite: a fresh plan with a price reason nobody confirmed is not written…', '6 · idempotency: the same invoices planned
//   twice…' (its last lines apply the decisions), '9 · a held PRICE with a chosen rename still saves the name…', '9 · the
//   summary counts the chosen renames that could not be written…'.
//
// NOT PORTED, because the test is about something else (FOUR tests): '7 · every new label and reason exists in English and
// Italian' and 'the note on ingredients already in Mise says what the import adds to them' (the dictionary, which in Mise 2
// belongs to the app), '8 · merging two ingredients writes no invoiceName onto the survivor' (ingredient-merge's planMerge,
// whose port is partial), and 'the summary gives the workbook advice only on the .json path' (reads the screen's source).

import { describe, expect, test } from 'vitest';
import { implementations } from './invoice-zip/testing/implementations';
import { makeCase } from './invoice-zip/testing/invoice-builders';
import type { InvoiceCase } from './invoice-zip/testing/invoice-builders';
import * as ported from './invoice-import-model';
import * as portedClassify from './invoice-zip/classify';
import * as legacyJs from '../../js/orders/invoice-import-model.js';
import * as legacyClassifyJs from '../../js/orders/invoice-zip/classify.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyClassify = legacyClassifyJs as unknown as typeof portedClassify;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

const SUPPLIER_KEY = 'IT00000000001';
const SUPPLIER_ID = 'sup-1';

describe.each([
  ['shared/ (TypeScript)', ported, portedClassify, implementations[0][1]],
  ['js/ (current app)', legacy, legacyClassify, implementations[1][1]],
] as const)('%s', (_name, m, classify, impl) => {
  const { IMPORT_FORMAT, IMPORT_VERSION, parseImportFile, planIngredients } = m;
  const { invoiceNameOf } = classify;
  const resolveRow = m.resolveRow as (row: Loose, decision?: Loose, ctx?: Loose) => Loose;
  const ingredientWrites = m.ingredientWrites as (row: Loose, file: Loose, nowIso?: Loose, options?: Loose) => Loose;
  const newCase = (): InvoiceCase => makeCase(impl.caseImpl);

  const point = (over: Loose = {}): Loose => ({
    invoiceId: '18000000001', line: 1, invoiceDate: '2026-09-10', pricePerUnit: 0.9, qty: 50, reliability: 'alta', ...over,
  });
  const rawIngredient = (over: Loose = {}): Loose => ({
    key: `${SUPPLIER_KEY}|code:F00-25`, supplierKey: SUPPLIER_KEY, mergeWith: '', name: 'Farina tipo 00',
    invoiceName: 'FARINA TIPO 00 SACCO KG 25', brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco',
    packCount: null, priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [point()], ...over,
  });
  const fileOf = (ingredients: Loose[]): Loose => {
    const r = parseImportFile(JSON.stringify({
      format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-06T10:00:00Z',
      suppliers: [{ key: SUPPLIER_KEY, vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
      ingredients,
    }));
    expect(r.ok).toBe(true);
    return (r as Loose).file;
  };
  const stored = (over: Loose = {}): Loose => ({
    id: 'ing-1', name: 'Farina del mulino', shortName: '', supplierId: SUPPLIER_ID, supplierCode: 'F00-25',
    invoiceName: 'FARINA TIPO 00 SACCO KG 25', weight: '25 kg', kind: 'ingredient', ...over,
  });
  const ctxOf = (over: Loose = {}): Loose => ({
    supplierIdByKey: { [SUPPLIER_KEY]: SUPPLIER_ID }, ingredients: [stored()], pricesById: {}, invoicePointIds: {}, ...over,
  });
  const planOne = (raw: Loose, ctx: Loose): Loose => planIngredients(fileOf([raw]).ingredients, ctx)[0];
  const writesOf = (row: Loose, raw: Loose): Loose[] => ingredientWrites(row, fileOf([raw]).ingredients[0], '2026-10-06T10:00:00Z', {}).flat();

  // ── 1 · the entry carries it ─────────────────────────────────────────────────────

  test('1 · invoiceNameOf removes ONLY the {…} lot blocks and collapses whitespace: case and the rest are kept', () => {
    expect(invoiceNameOf('  Lievito  {LOTTO 77}  FRESCO\tKG 1 ')).toBe('Lievito FRESCO KG 1');
    expect(invoiceNameOf('Zucchero {a} semolato {b}')).toBe('Zucchero semolato');
    expect(invoiceNameOf('Olio EXTRA vergine, 5 lt.')).toBe('Olio EXTRA vergine, 5 lt.');
    expect(invoiceNameOf(undefined)).toBe('');
  });

  test('1 · the file ingredient carries the description of the NEWEST invoice, lot blocks removed, case kept', () => {
    const c = newCase();
    c.add([{ desc: 'FARINA 00 {LOTTO A1} SACCO KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 28.5 }], { date: '2026-08-01' });
    c.add([{ desc: 'Farina 00  {LOTTO B2}  Sacco KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 29 }], { date: '2026-09-01' });
    const [ing] = c.build().importFile.ingredients as Loose[];
    expect(ing.invoiceName, 'the latest invoice wins, and its capitals are kept').toBe('Farina 00 Sacco KG 25');
    expect(ing.name, 'the proposed name is still the cleaned one').not.toBe(ing.invoiceName);
  });

  test('1 · the .json of the Python script has no description: no invoiceName, and nothing is patched', () => {
    const raw = rawIngredient();
    delete raw.invoiceName;
    const file = fileOf([raw]);
    expect('invoiceName' in file.ingredients[0]).toBe(false);
    const row = planIngredients(file.ingredients, ctxOf({ ingredients: [stored({ invoiceName: '' })] }))[0] as Loose;
    expect(row.patchInvoiceName).toBe(null);
    expect(row.checkReason).toBe(undefined);
  });

  // ── 2 · a new ingredient gets it ─────────────────────────────────────────────────

  test('2 · a new ingredient is created with its invoiceName', () => {
    const raw = rawIngredient();
    const row = planOne(raw, ctxOf({ ingredients: [] }));
    expect(row.status).toBe('new');
    const create = writesOf(row, raw).find((op) => op.type === 'create-ingredient')!;
    expect(create.data.invoiceName).toBe('FARINA TIPO 00 SACCO KG 25');
    expect(create.data.name, 'the name in the message is the proposed one').toBe('Farina tipo 00');
  });

  test('2 · a file with no invoiceName creates an ingredient with no such key', () => {
    const raw = rawIngredient();
    delete raw.invoiceName;
    const create = writesOf(planOne(raw, ctxOf({ ingredients: [] })), raw).find((op) => op.type === 'create-ingredient')!;
    expect('invoiceName' in create.data).toBe(false);
  });

  // ── 3 · matching ─────────────────────────────────────────────────────────────────

  test('3 · the exact invoice name finds the ingredient when the file has no article code', () => {
    const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina` });
    const row = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '' })] }));
    expect(row.status).toBe('update-price');
    expect(row.ingredientId).toBe('ing-1');
  });

  test('3 · the invoice name is compared ignoring letter case and spacing, nothing else: digits and punctuation still count', () => {
    const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Impasto speciale' });
    const same = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', name: 'Altro', invoiceName: 'farina  tipo 00 sacco kg 25' })] }));
    expect(same.ingredientId, 'case and spaces are not a different product').toBe('ing-1');
    const other = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', name: 'Altro', invoiceName: 'farina tipo 00 sacco kg 5' })] }));
    expect(other.ingredientId, 'a different weight is a different name').not.toBe('ing-1');
    const punct = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', name: 'Altro', invoiceName: 'farina tipo 00, sacco kg 25' })] }));
    expect(punct.ingredientId).not.toBe('ing-1');
  });

  test('3 · the same invoice name under ANOTHER article code is a question, never a silent match', () => {
    const raw = rawIngredient({ supplierCode: 'NEW-CODE', key: `${SUPPLIER_KEY}|code:NEW-CODE` });
    const row = planOne(raw, ctxOf());
    expect(row.status).toBe('maybe-duplicate');
    expect(row.reason).toBe('code-differs');
    expect(row.candidates.map((c: Loose) => c.id)).toStrictEqual(['ing-1']);
  });

  test('3 · two ingredients with the same invoice name make a name-ambiguous question', () => {
    const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina` });
    const row = planOne(raw, ctxOf({
      ingredients: [stored({ supplierCode: '' }), stored({ id: 'ing-2', name: 'Altra farina', supplierCode: '' })],
    }));
    expect(row.status).toBe('maybe-duplicate');
    expect(row.reason).toBe('name-ambiguous');
    expect(row.candidates.length).toBe(2);
  });

  test('3 · an ingredient of ANOTHER supplier is never found by its invoice name', () => {
    const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Impasto speciale' });
    const row = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', supplierId: 'sup-other', name: 'Altro' })] }));
    expect(row.status).toBe('new');
  });

  // ── 4 · a code match fills in or proposes the invoice name ───────────────────────

  test('4 · a code match fills in an EMPTY invoice name silently', () => {
    const raw = rawIngredient();
    const row = planOne(raw, ctxOf({ ingredients: [stored({ invoiceName: '' })] }));
    expect(row.patchInvoiceName).toBe('FARINA TIPO 00 SACCO KG 25');
    expect(row.checkReason, 'no question for a name that was never there').toBe(undefined);
    expect(row.invoiceRename).toBe(undefined);
    const patch = writesOf(row, raw).find((op) => op.type === 'patch-ingredient')!;
    expect(patch.data).toStrictEqual({ invoiceName: 'FARINA TIPO 00 SACCO KG 25' });
    expect(writesOf(row, raw).some((op) => op.type === 'set-current-price'), 'the price goes in with it').toBeTruthy();
  });

  const RENAMED = 'Farina 00 sacco da kg 25 (nuova ricetta)';

  test('4 · a file OLDER than what the venue holds never proposes a rename (an empty name is still filled in)', () => {
    const raw = rawIngredient({ invoiceName: RENAMED, prices: [point({ invoiceDate: '2026-03-01' })] });
    const points = Object.assign(new Set<string>(), { points: [{ invoiceDate: '2026-07-01' }] });
    const ids = { 'ing-1': points };
    const old = planOne(raw, ctxOf({ invoicePointIds: ids }));
    expect(old.invoiceRename, 'the newest stored invoice point of the main pack counts').toBe(undefined);
    expect(old.patchInvoiceName).toBe(null);
    const filled = planOne(raw, ctxOf({ ingredients: [stored({ invoiceName: '' })], invoicePointIds: ids }));
    expect(filled.patchInvoiceName).toBe(RENAMED);
    const newer = planOne(rawIngredient({ invoiceName: RENAMED, prices: [point({ invoiceDate: '2026-09-01' })] }), ctxOf({ invoicePointIds: ids }));
    expect(newer.invoiceRename).toBeTruthy();
  });

  test('4 · a hit through an EXTRA code (another pack) never compares nor fills in the invoice name', () => {
    const raw = rawIngredient({ supplierCode: 'F00-5', key: `${SUPPLIER_KEY}|code:F00-5`, invoiceName: 'FARINA TIPO 00 SACCHETTO KG 5' });
    const other = stored({ supplierCode: 'F00-25', supplierCodes: ['F00-5'] });
    const different = planOne(raw, ctxOf({ ingredients: [other] }));
    expect(different.ingredientId).toBe('ing-1');
    expect(different.patchInvoiceName).toBe(null);
    expect(different.invoiceRename).toBe(undefined);
    const empty = planOne(raw, ctxOf({ ingredients: [{ ...other, invoiceName: '' }] }));
    expect(empty.patchInvoiceName, 'an empty name is not filled with the name of another pack either').toBe(null);
  });

  // ── 4b · a new pack must never put its name on the main pack ──────────────────────

  // Applies the writes of one plan to a fake catalogue, the way the data layer would.
  function apply(rows: Loose[], file: Loose, catalogue: Loose): void {
    let counter = catalogue.ingredients.length;
    rows.forEach((row) => {
      const fileIngredient = file.ingredients.find((i: Loose) => i.key === row.key);
      ingredientWrites(row, fileIngredient, '2026-10-06T10:00:00Z', {}).flat().forEach((op: Loose) => {
        if (op.type === 'create-ingredient') {
          counter += 1;
          catalogue.created = `ing-${counter}`;
          catalogue.ingredients.push({ id: catalogue.created, supplierId: SUPPLIER_ID, ...op.data });
          return;
        }
        const id = op.ingredientId ?? catalogue.created;
        if (op.type === 'patch-ingredient') Object.assign(catalogue.ingredients.find((i: Loose) => i.id === id), op.data);
        if (op.type === 'set-current-price') catalogue.pricesById[id] = op.data;
        if (op.type === 'add-price-point') (catalogue.invoicePointIds[id] ||= new Set()).add(op.pointId);
      });
    });
  }

  test('4b · a NEW pack added through «Same as» writes its code, never its description; the main pack on the next file is no rename', () => {
    const pack5 = rawIngredient({ supplierCode: 'F00-5', key: `${SUPPLIER_KEY}|code:F00-5`, name: 'Farina tipo 00', invoiceName: 'FARINA TIPO 00 SACCHETTO KG 5', weight: '5 kg' });
    const main = rawIngredient({ prices: [point({ invoiceId: '18000000002', invoiceDate: '2026-10-01' })] });
    const catalogue: Loose = { ingredients: [stored({ invoiceName: '', name: 'Farina tipo 00' })], pricesById: {}, invoicePointIds: {} };
    const ctx = (): Loose => ({ supplierIdByKey: { [SUPPLIER_KEY]: SUPPLIER_ID }, ...catalogue });
    const asked = planIngredients(fileOf([pack5]).ingredients, ctx())[0] as Loose;
    expect(asked.status).toBe('maybe-duplicate');
    expect(asked.reason).toBe('code-differs');
    const answered = resolveRow(asked, { sameAs: 'ing-1' }, ctx());
    expect(answered.setSupplierCodes).toStrictEqual(['F00-5']);
    expect(answered.patchInvoiceName, 'the 5 kg description is not the name of the main pack').toBe(null);
    apply([answered], fileOf([pack5]), catalogue);
    expect(catalogue.ingredients[0].invoiceName).toBe('');
    expect(catalogue.ingredients[0].supplierCodes).toStrictEqual(['F00-5']);
    // The main pack arrives on the next file: its name fills the empty name, no rename, prices are written.
    const next = planIngredients(fileOf([main]).ingredients, ctx())[0] as Loose;
    expect(next.invoiceRename).toBe(undefined);
    expect(next.checkReason).toBe(undefined);
    expect(next.patchInvoiceName).toBe('FARINA TIPO 00 SACCO KG 25');
    expect(writesOf(next, main).some((op) => op.type === 'set-current-price')).toBeTruthy();
  });

  test('4b · a row with NO code answered «Same as» onto an ingredient that has a main code leaves its name alone', () => {
    const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Farina tipo 00 speciale', invoiceName: 'FARINA SPECIALE KG 25' });
    const target = stored({ invoiceName: '', name: 'Farina tipo 00' });
    const asked = planOne(raw, ctxOf({ ingredients: [target] }));
    expect(asked.status).toBe('maybe-duplicate');
    expect(resolveRow(asked, { sameAs: 'ing-1' }, ctxOf({ ingredients: [target] })).patchInvoiceName).toBe(null);
  });

  // ── 5 · a person's answer ────────────────────────────────────────────────────────

  test('5 · «Same as X» fills in X\'s empty invoice name, and leaves a different one alone (another pack)', () => {
    const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Farina tipo 00 speciale', invoiceName: 'FARINA SPECIALE KG 25' });
    const empty = stored({ supplierCode: '', invoiceName: '', name: 'Farina tipo 00' });
    const asked = planOne(raw, ctxOf({ ingredients: [empty] }));
    expect(asked.status).toBe('maybe-duplicate');
    const filled = resolveRow(asked, { sameAs: 'ing-1' }, ctxOf({ ingredients: [empty] }));
    expect(filled.patchInvoiceName).toBe('FARINA SPECIALE KG 25');
    expect(filled.checkReason).toBe(undefined);

    const other = stored({ supplierCode: '', invoiceName: 'FARINA TIPO 00 KG 1', name: 'Farina tipo 00' });
    const askedAgain = planOne(raw, ctxOf({ ingredients: [other] }));
    const left = resolveRow(askedAgain, { sameAs: 'ing-1' }, ctxOf({ ingredients: [other] }));
    expect(left.patchInvoiceName).toBe(null);
    expect(left.checkReason).toBe(undefined);
  });

  test('5 · «Create new» on a question carries no invoice-name patch', () => {
    const raw = rawIngredient({ supplierCode: 'NEW-CODE', key: `${SUPPLIER_KEY}|code:NEW-CODE` });
    const asked = planOne(raw, ctxOf());
    const made = resolveRow(asked, { createNew: true }, ctxOf());
    expect(made.status).toBe('new');
    expect(made.patchInvoiceName).toBe(null);
  });

  // ── 6 · building and planning the same invoices twice ─────────────────────────────

  test('6 · the same product on a later invoice with another LOT number is still the same ingredient', () => {
    const first = newCase();
    first.add([{ desc: 'FARINA TIPO 00 {LOTTO 77} SACCO KG 25', qty: 2, unit: 'PZ', total: 28.5 }], { date: '2026-09-01' });
    const second = newCase();
    second.add([{ desc: 'FARINA TIPO 00 {LOTTO 91} SACCO KG 25', qty: 2, unit: 'PZ', total: 30 }], { date: '2026-10-01', sdi: '9100000001' });
    const a = (parseImportFile(JSON.stringify(first.build().importFile)) as Loose).file;
    const b = (parseImportFile(JSON.stringify(second.build().importFile)) as Loose).file;
    const catalogue: Loose = { ingredients: [], pricesById: {}, invoicePointIds: {}, created: null };
    const ctx = (): Loose => ({ supplierIdByKey: { [a.suppliers[0].key]: SUPPLIER_ID }, ...catalogue });
    apply(planIngredients(a.ingredients, ctx()), a, catalogue);
    // The owner retyped «Name in the message»: only the invoice name can still find the ingredient (no article code).
    catalogue.ingredients[0].name = 'Farina del mulino';
    const row = planIngredients(b.ingredients, ctx())[0] as Loose;
    expect(row.ingredientId, 'found by its invoice name, with no article code to go by').toBe(catalogue.ingredients[0].id);
    expect(row.status).toBe('update-price');
  });

  // ── 9 · the second review ────────────────────────────────────────────────────────

  test('9 · the «older file» floor comes only from the MAIN pack: another pack\'s newer invoice never drops the rename', () => {
    const raw = rawIngredient({ invoiceName: RENAMED, prices: [point({ invoiceDate: '2026-09-10' })] });
    const other = stored({ supplierCodes: ['F00-5'] });
    const withPoints = (points: Loose[]): Loose => ({ 'ing-1': Object.assign(new Set<string>(), { points }) });
    const price = { 'ing-1': { priceUnit: 'kg', pricePerUnit: 1, priceUpdatedAt: '2026-10-01T12:00:00.000Z' } };
    // The 5 kg pack wrote its October invoice first: the shared price date and its point are both newer.
    const row = planOne(raw, ctxOf({
      ingredients: [other], pricesById: price,
      invoicePointIds: withPoints([{ invoiceDate: '2026-10-01', packCode: 'F00-5' }, { invoiceDate: '2026-08-01', packCode: 'F00-25' }]),
    }));
    expect(row.invoiceRename, 'the 25 kg rename is still proposed').toBeTruthy();
    // A point with no pack code is the main pack's, and a newer one of the main pack does make the file old.
    const legacyPoint = planOne(raw, ctxOf({ ingredients: [other], invoicePointIds: withPoints([{ invoiceDate: '2026-09-20' }]) }));
    expect(legacyPoint.invoiceRename).toBe(undefined);
    const mainNewer = planOne(raw, ctxOf({ ingredients: [other], invoicePointIds: withPoints([{ invoiceDate: '2026-09-20', packCode: 'F00-25' }]) }));
    expect(mainNewer.invoiceRename).toBe(undefined);
  });

  test('9 · M13: an ingredient taking its FIRST main code takes the invoice name too', () => {
    const raw = rawIngredient({ name: 'Farina tipo 00' });
    const row = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', invoiceName: '', name: 'Farina tipo 00' })] }));
    expect(row.patchSupplierCode).toBe('F00-25');
    expect(row.patchInvoiceName).toBe('FARINA TIPO 00 SACCO KG 25');
  });

  test('9 · M14: a rename is proposed only through the MAIN code, never on the first-code or the no-code paths', () => {
    const different = 'ALTRO NOME DIVERSO';
    const first = planOne(rawIngredient({ name: 'Farina tipo 00' }), ctxOf({
      ingredients: [stored({ supplierCode: '', invoiceName: different, name: 'Farina tipo 00' })],
    }));
    expect(first.patchSupplierCode).toBe('F00-25');
    expect(first.invoiceRename).toBe(undefined);
    expect(first.patchInvoiceName).toBe(null);
    const codeless = planOne(rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Farina tipo 00' }), ctxOf({
      ingredients: [stored({ supplierCode: '', invoiceName: different, name: 'Farina tipo 00' })],
    }));
    expect(codeless.ingredientId).toBe('ing-1');
    expect(codeless.invoiceRename).toBe(undefined);
    expect(codeless.patchInvoiceName).toBe(null);
  });
});
