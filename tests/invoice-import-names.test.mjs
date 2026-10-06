// «Nome in fattura» — the third name of an ingredient (`invoiceName`): the product description exactly as the supplier's
// invoice writes it, saved by the invoice import and never typed. It is how the import tells an ingredient it already holds
// from a new one when the article code is missing or has changed.
// Every name, code, VAT number and price below is INVENTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _dictionaries } from '../js/i18n.js';
import {
  IMPORT_FORMAT, IMPORT_VERSION, CHECK_REASONS, parseImportFile, planIngredients, resolveRow, ingredientWrites,
} from '../js/orders/invoice-import-model.js';
import { applyDecisions, bucketOf, importTotals, rowToWrite, withRename, writesRow } from '../js/orders/invoice-import-plan.js';
import { invoiceNameOf } from '../js/orders/invoice-zip/classify.js';
import { newCase } from './helpers/invoice-builders.mjs';

const DICT = _dictionaries();
const SUPPLIER_KEY = 'IT00000000001';
const SUPPLIER_ID = 'sup-1';

const point = (over = {}) => ({
  invoiceId: '18000000001', line: 1, invoiceDate: '2026-09-10', pricePerUnit: 0.9, qty: 50, reliability: 'alta', ...over,
});
const rawIngredient = (over = {}) => ({
  key: `${SUPPLIER_KEY}|code:F00-25`, supplierKey: SUPPLIER_KEY, mergeWith: '', name: 'Farina tipo 00',
  invoiceName: 'FARINA TIPO 00 SACCO KG 25', brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco',
  packCount: null, priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [point()], ...over,
});
const fileOf = (ingredients) => {
  const r = parseImportFile(JSON.stringify({
    format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-06T10:00:00Z',
    suppliers: [{ key: SUPPLIER_KEY, vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
    ingredients,
  }));
  assert.equal(r.ok, true);
  return r.file;
};
const stored = (over = {}) => ({
  id: 'ing-1', name: 'Farina del mulino', shortName: '', supplierId: SUPPLIER_ID, supplierCode: 'F00-25',
  invoiceName: 'FARINA TIPO 00 SACCO KG 25', weight: '25 kg', kind: 'ingredient', ...over,
});
const ctxOf = (over = {}) => ({
  supplierIdByKey: { [SUPPLIER_KEY]: SUPPLIER_ID }, ingredients: [stored()], pricesById: {}, invoicePointIds: {}, ...over,
});
const planOne = (raw, ctx) => planIngredients(fileOf([raw]).ingredients, ctx)[0];
const writesOf = (row, raw) => ingredientWrites(row, fileOf([raw]).ingredients[0], '2026-10-06T10:00:00Z', {}).flat();
const entryOf = (planned, confirm = new Set()) => applyDecisions([planned], {}, ctxOf(), new Set(), confirm)[0];
// The point of the raw file ingredient is already recorded: nothing to write but names and codes.
const known = (raw) => ({ 'ing-1': new Set(raw.prices.map(p => `inv-${p.invoiceId}-${p.line}`)) });

// ── 1 · the entry carries it ─────────────────────────────────────────────────────

test('1 · invoiceNameOf removes ONLY the {…} lot blocks and collapses whitespace: case and the rest are kept', () => {
  assert.equal(invoiceNameOf('  Lievito  {LOTTO 77}  FRESCO\tKG 1 '), 'Lievito FRESCO KG 1');
  assert.equal(invoiceNameOf('Zucchero {a} semolato {b}'), 'Zucchero semolato');
  assert.equal(invoiceNameOf('Olio EXTRA vergine, 5 lt.'), 'Olio EXTRA vergine, 5 lt.');
  assert.equal(invoiceNameOf(undefined), '');
});

test('1 · the file ingredient carries the description of the NEWEST invoice, lot blocks removed, case kept', () => {
  const c = newCase();
  c.add([{ desc: 'FARINA 00 {LOTTO A1} SACCO KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 28.5 }], { date: '2026-08-01' });
  c.add([{ desc: 'Farina 00  {LOTTO B2}  Sacco KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 29 }], { date: '2026-09-01' });
  const [ing] = c.build().importFile.ingredients;
  assert.equal(ing.invoiceName, 'Farina 00 Sacco KG 25', 'the latest invoice wins, and its capitals are kept');
  assert.notEqual(ing.name, ing.invoiceName, 'the proposed name is still the cleaned one');
});

test('1 · the .json of the Python script has no description: no invoiceName, and nothing is patched', () => {
  const raw = rawIngredient();
  delete raw.invoiceName;
  const file = fileOf([raw]);
  assert.equal('invoiceName' in file.ingredients[0], false);
  const row = planIngredients(file.ingredients, ctxOf({ ingredients: [stored({ invoiceName: '' })] }))[0];
  assert.equal(row.patchInvoiceName, null);
  assert.equal(row.checkReason, undefined);
});

// ── 2 · a new ingredient gets it ─────────────────────────────────────────────────

test('2 · a new ingredient is created with its invoiceName', () => {
  const raw = rawIngredient();
  const row = planOne(raw, ctxOf({ ingredients: [] }));
  assert.equal(row.status, 'new');
  const create = writesOf(row, raw).find(op => op.type === 'create-ingredient');
  assert.equal(create.data.invoiceName, 'FARINA TIPO 00 SACCO KG 25');
  assert.equal(create.data.name, 'Farina tipo 00', 'the name in the message is the proposed one');
});

test('2 · a file with no invoiceName creates an ingredient with no such key', () => {
  const raw = rawIngredient();
  delete raw.invoiceName;
  const create = writesOf(planOne(raw, ctxOf({ ingredients: [] })), raw).find(op => op.type === 'create-ingredient');
  assert.equal('invoiceName' in create.data, false);
});

// ── 3 · matching ─────────────────────────────────────────────────────────────────

test('3 · the exact invoice name finds the ingredient when the file has no article code', () => {
  const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina` });
  const row = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '' })] }));
  assert.equal(row.status, 'update-price');
  assert.equal(row.ingredientId, 'ing-1');
});

test('3 · the invoice name is compared ignoring letter case and spacing, nothing else: digits and punctuation still count', () => {
  const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Impasto speciale' });
  const same = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', name: 'Altro', invoiceName: 'farina  tipo 00 sacco kg 25' })] }));
  assert.equal(same.ingredientId, 'ing-1', 'case and spaces are not a different product');
  const other = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', name: 'Altro', invoiceName: 'farina tipo 00 sacco kg 5' })] }));
  assert.notEqual(other.ingredientId, 'ing-1', 'a different weight is a different name');
  const punct = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', name: 'Altro', invoiceName: 'farina tipo 00, sacco kg 25' })] }));
  assert.notEqual(punct.ingredientId, 'ing-1');
});

test('3 · the same invoice name under ANOTHER article code is a question, never a silent match', () => {
  const raw = rawIngredient({ supplierCode: 'NEW-CODE', key: `${SUPPLIER_KEY}|code:NEW-CODE` });
  const row = planOne(raw, ctxOf());
  assert.equal(row.status, 'maybe-duplicate');
  assert.equal(row.reason, 'code-differs');
  assert.deepEqual(row.candidates.map(c => c.id), ['ing-1']);
});

test('3 · two ingredients with the same invoice name make a name-ambiguous question', () => {
  const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina` });
  const row = planOne(raw, ctxOf({
    ingredients: [stored({ supplierCode: '' }), stored({ id: 'ing-2', name: 'Altra farina', supplierCode: '' })],
  }));
  assert.equal(row.status, 'maybe-duplicate');
  assert.equal(row.reason, 'name-ambiguous');
  assert.equal(row.candidates.length, 2);
});

test('3 · an ingredient of ANOTHER supplier is never found by its invoice name', () => {
  const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Impasto speciale' });
  const row = planOne(raw, ctxOf({ ingredients: [stored({ supplierCode: '', supplierId: 'sup-other', name: 'Altro' })] }));
  assert.equal(row.status, 'new');
});

// ── 4 · a code match fills in or proposes the invoice name ───────────────────────

test('4 · a code match fills in an EMPTY invoice name silently', () => {
  const raw = rawIngredient();
  const row = planOne(raw, ctxOf({ ingredients: [stored({ invoiceName: '' })] }));
  assert.equal(row.patchInvoiceName, 'FARINA TIPO 00 SACCO KG 25');
  assert.equal(row.checkReason, undefined, 'no question for a name that was never there');
  assert.equal(row.invoiceRename, undefined);
  const patch = writesOf(row, raw).find(op => op.type === 'patch-ingredient');
  assert.deepEqual(patch.data, { invoiceName: 'FARINA TIPO 00 SACCO KG 25' });
  assert.ok(writesOf(row, raw).some(op => op.type === 'set-current-price'), 'the price goes in with it');
});

test('4 · an otherwise UNCHANGED row still writes the invoice name, counts as a write, and writes only that', () => {
  const raw = rawIngredient();
  const row = planOne(raw, ctxOf({ ingredients: [stored({ invoiceName: '' })], invoicePointIds: known(raw) }));
  assert.equal(row.status, 'unchanged');
  const ops = writesOf(row, raw);
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0], { type: 'patch-ingredient', ingredientId: 'ing-1', data: { invoiceName: 'FARINA TIPO 00 SACCO KG 25' } });
  assert.equal(writesRow({ row }), true, 'the primary action counts it: «Done» never discards it');
  assert.equal(importTotals([{ row }]).rows, 1);
  assert.equal(writesRow({ row: { ...row, patchInvoiceName: null } }), false);
});

test('4 · the same invoice name writes nothing at all, and neither does another CASE or spacing of it', () => {
  const raw = rawIngredient();
  const row = planOne(raw, ctxOf({ invoicePointIds: known(raw) }));
  assert.equal(row.status, 'unchanged');
  assert.equal(row.patchInvoiceName, null);
  assert.deepEqual(writesOf(row, raw), []);
  const shouted = planOne(rawIngredient({ invoiceName: 'Farina  tipo 00 sacco KG 25' }), ctxOf({ invoicePointIds: known(raw) }));
  assert.equal(shouted.invoiceRename, undefined, 'a supplier switching case is not a rename');
  assert.equal(shouted.patchInvoiceName, null);
  assert.equal(bucketOf({ planned: shouted, row: shouted }), 'unchanged');
});

const RENAMED = 'Farina 00 sacco da kg 25 (nuova ricetta)';

test('4 · a DIFFERENT invoice name under the same main code NEVER holds the prices: they are written, the rename is a choice', () => {
  const raw = rawIngredient({ invoiceName: RENAMED });
  const row = planOne(raw, ctxOf());
  assert.equal(row.status, 'update-price');
  assert.equal(row.checkReason, undefined, 'no price is held for a name');
  assert.deepEqual(row.invoiceRename, { stored: 'FARINA TIPO 00 SACCO KG 25', file: RENAMED });
  assert.equal(row.patchInvoiceName, null);
  const entry = entryOf(row);
  assert.equal(entry.row.status, 'update-price');
  assert.equal(bucketOf(entry), 'check', 'visible under «To check», not held');
  const ops = writesOf(entry.row, raw);
  assert.ok(ops.some(op => op.type === 'set-current-price') && ops.some(op => op.type === 'add-price-point'));
  assert.equal(ops.some(op => op.type === 'patch-ingredient'), false, 'the old name is kept by default');
});

test('4 · the rename is written only when the person chose it for THAT old → new pair', () => {
  const raw = rawIngredient({ invoiceName: RENAMED });
  const row = planOne(raw, ctxOf());
  const pair = { stored: 'FARINA TIPO 00 SACCO KG 25', file: RENAMED };
  const chosen = applyDecisions([row], {}, ctxOf(), new Set(), new Set(), new Map([[row.key, pair]]))[0];
  assert.deepEqual(writesOf(chosen.row, raw).find(op => op.type === 'patch-ingredient').data, { invoiceName: RENAMED });
  const other = applyDecisions([row], {}, ctxOf(), new Set(), new Set(), new Map([[row.key, { ...pair, file: 'Another' }]]))[0];
  assert.equal(writesOf(other.row, raw).some(op => op.type === 'patch-ingredient'), false, 'another pair is not what was chosen');
  assert.equal(withRename(row, null), row);
  assert.equal(withRename({ ...row, invoiceRename: { ...pair, stored: 'moved' } }, pair).patchInvoiceName, null);
});

test('4 · a renamed product whose prices are all in already is a write only once the rename is chosen', () => {
  const raw = rawIngredient({ invoiceName: RENAMED });
  const row = planOne(raw, ctxOf({ invoicePointIds: known(raw) }));
  assert.equal(row.status, 'unchanged');
  assert.equal(bucketOf(entryOf(row)), 'check');
  assert.equal(writesRow(entryOf(row)), false);
  const chosen = applyDecisions([row], {}, ctxOf(), new Set(), new Set(), new Map([[row.key, row.invoiceRename]]))[0];
  assert.equal(writesRow(chosen), true);
  const ops = writesOf(chosen.row, raw);
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].data, { invoiceName: RENAMED });
});

test('4 · a price reason AND a rename are both on the row; confirming the price never saves the name', () => {
  const raw = rawIngredient({ invoiceName: RENAMED, prices: [point({ pricePerUnit: 1.4, reliability: 'media' })] });
  const row = planOne(raw, ctxOf({
    pricesById: { 'ing-1': { priceUnit: 'kg', pricePerUnit: 1, priceUpdatedAt: '2026-01-01T12:00:00.000Z' } },
  }));
  assert.equal(row.checkReason, CHECK_REASONS.PRICE_JUMP);
  assert.ok(row.invoiceRename, 'the name sentence is not hidden by the price reason');
  assert.deepEqual(writesOf(entryOf(row).row, raw), [], 'the price is held');
  const confirmed = writesOf(entryOf(row, new Set([row.key])).row, raw);
  assert.ok(confirmed.some(op => op.type === 'set-current-price'));
  assert.equal(confirmed.some(op => op.type === 'patch-ingredient'), false, 'a price confirmation never authorises a rename');
});

test('4 · a file OLDER than what the venue holds never proposes a rename (an empty name is still filled in)', () => {
  const raw = rawIngredient({ invoiceName: RENAMED, prices: [point({ invoiceDate: '2026-03-01' })] });
  const price = { 'ing-1': { priceUnit: 'kg', pricePerUnit: 1, priceUpdatedAt: '2026-06-01T12:00:00.000Z' } };
  const old = planOne(raw, ctxOf({ pricesById: price }));
  assert.equal(old.invoiceRename, undefined);
  assert.equal(old.patchInvoiceName, null);
  const points = new Set();
  points.points = [{ invoiceDate: '2026-07-01' }];
  const byPoint = planOne(raw, ctxOf({ invoicePointIds: { 'ing-1': points } }));
  assert.equal(byPoint.invoiceRename, undefined, 'the newest stored invoice point counts too');
  const filled = planOne(raw, ctxOf({ ingredients: [stored({ invoiceName: '' })], pricesById: price }));
  assert.equal(filled.patchInvoiceName, RENAMED);
  const newer = planOne(rawIngredient({ invoiceName: RENAMED, prices: [point({ invoiceDate: '2026-09-01' })] }), ctxOf({ pricesById: price }));
  assert.ok(newer.invoiceRename);
});

test('4 · a hit through an EXTRA code (another pack) never compares nor fills in the invoice name', () => {
  const raw = rawIngredient({ supplierCode: 'F00-5', key: `${SUPPLIER_KEY}|code:F00-5`, invoiceName: 'FARINA TIPO 00 SACCHETTO KG 5' });
  const other = stored({ supplierCode: 'F00-25', supplierCodes: ['F00-5'] });
  const different = planOne(raw, ctxOf({ ingredients: [other] }));
  assert.equal(different.ingredientId, 'ing-1');
  assert.equal(different.patchInvoiceName, null);
  assert.equal(different.invoiceRename, undefined);
  const empty = planOne(raw, ctxOf({ ingredients: [{ ...other, invoiceName: '' }] }));
  assert.equal(empty.patchInvoiceName, null, 'an empty name is not filled with the name of another pack either');
});

// ── 4b · a new pack must never put its name on the main pack ──────────────────────

test('4b · a NEW pack added through «Same as» writes its code, never its description; the main pack on the next file is no rename', () => {
  const pack5 = rawIngredient({ supplierCode: 'F00-5', key: `${SUPPLIER_KEY}|code:F00-5`, name: 'Farina tipo 00', invoiceName: 'FARINA TIPO 00 SACCHETTO KG 5', weight: '5 kg' });
  const main = rawIngredient({ prices: [point({ invoiceId: '18000000002', invoiceDate: '2026-10-01' })] });
  const catalogue = { ingredients: [stored({ invoiceName: '', name: 'Farina tipo 00' })], pricesById: {}, invoicePointIds: {} };
  const ctx = () => ({ supplierIdByKey: { [SUPPLIER_KEY]: SUPPLIER_ID }, ...catalogue });
  const asked = planIngredients(fileOf([pack5]).ingredients, ctx())[0];
  assert.equal(asked.status, 'maybe-duplicate');
  assert.equal(asked.reason, 'code-differs');
  const answered = resolveRow(asked, { sameAs: 'ing-1' }, ctx());
  assert.deepEqual(answered.setSupplierCodes, ['F00-5']);
  assert.equal(answered.patchInvoiceName, null, 'the 5 kg description is not the name of the main pack');
  apply([answered], fileOf([pack5]), catalogue);
  assert.equal(catalogue.ingredients[0].invoiceName, '');
  assert.deepEqual(catalogue.ingredients[0].supplierCodes, ['F00-5']);
  // The main pack arrives on the next file: its name fills the empty name, no rename, prices are written.
  const next = planIngredients(fileOf([main]).ingredients, ctx())[0];
  assert.equal(next.invoiceRename, undefined);
  assert.equal(next.checkReason, undefined);
  assert.equal(next.patchInvoiceName, 'FARINA TIPO 00 SACCO KG 25');
  assert.ok(writesOf(next, main).some(op => op.type === 'set-current-price'));
});

test('4b · the same RUN: the new pack row first, then the main pack row, each planned on what the first wrote', () => {
  const pack5 = rawIngredient({ supplierCode: 'F00-5', key: `${SUPPLIER_KEY}|code:F00-5`, name: 'Farina tipo 00', invoiceName: 'FARINA TIPO 00 SACCHETTO KG 5', weight: '5 kg', prices: [point({ invoiceId: '18000000003', line: 2 })] });
  const main = rawIngredient();
  const file = fileOf([pack5, main]);
  const catalogue = { ingredients: [stored({ invoiceName: '', name: 'Farina tipo 00' })], pricesById: {}, invoicePointIds: {}, created: null };
  const ctx = () => ({ supplierIdByKey: { [SUPPLIER_KEY]: SUPPLIER_ID }, ...catalogue });
  const first = resolveRow(planIngredients([file.ingredients[0]], ctx())[0], { sameAs: 'ing-1' }, ctx());
  apply([first], file, catalogue);
  const second = planIngredients([file.ingredients[1]], ctx())[0];
  assert.equal(second.checkReason, undefined);
  assert.equal(second.invoiceRename, undefined);
  assert.ok(writesOf(rowToWrite(second, {}), main).some(op => op.type === 'add-price-point'), 'its prices are written, not dropped');
});

test('4b · a row with NO code answered «Same as» onto an ingredient that has a main code leaves its name alone', () => {
  const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Farina tipo 00 speciale', invoiceName: 'FARINA SPECIALE KG 25' });
  const target = stored({ invoiceName: '', name: 'Farina tipo 00' });
  const asked = planOne(raw, ctxOf({ ingredients: [target] }));
  assert.equal(asked.status, 'maybe-duplicate');
  assert.equal(resolveRow(asked, { sameAs: 'ing-1' }, ctxOf({ ingredients: [target] })).patchInvoiceName, null);
});

// ── 4c · the write-time gate ──────────────────────────────────────────────────────

test('4c · rowToWrite: a fresh plan with a price reason nobody confirmed is not written; a rename not chosen is not written', () => {
  const raw = rawIngredient({ invoiceName: RENAMED, prices: [point({ pricePerUnit: 1.4, reliability: 'media' })] });
  const row = planOne(raw, ctxOf({ pricesById: { 'ing-1': { priceUnit: 'kg', pricePerUnit: 1, priceUpdatedAt: '2026-01-01T12:00:00.000Z' } } }));
  assert.equal(rowToWrite(row, { confirmed: false }), null, 'the price needs a look and nobody gave it');
  assert.equal(rowToWrite(row, { confirmed: true }).patchInvoiceName, null, 'a confirmed price never carries a rename');
  const pair = row.invoiceRename;
  assert.equal(rowToWrite(row, { confirmed: true, rename: pair }).patchInvoiceName, RENAMED);
  assert.equal(rowToWrite(row, { confirmed: true, rename: { ...pair, stored: 'was something else' } }).patchInvoiceName, null,
    'the pair changed since the person looked: nothing is written');
  assert.equal(rowToWrite(null, {}), null);
});

// ── 5 · a person's answer ────────────────────────────────────────────────────────

test('5 · «Same as X» fills in X\'s empty invoice name, and leaves a different one alone (another pack)', () => {
  const raw = rawIngredient({ supplierCode: '', key: `${SUPPLIER_KEY}|name:farina`, name: 'Farina tipo 00 speciale', invoiceName: 'FARINA SPECIALE KG 25' });
  const empty = stored({ supplierCode: '', invoiceName: '', name: 'Farina tipo 00' });
  const asked = planOne(raw, ctxOf({ ingredients: [empty] }));
  assert.equal(asked.status, 'maybe-duplicate');
  const filled = resolveRow(asked, { sameAs: 'ing-1' }, ctxOf({ ingredients: [empty] }));
  assert.equal(filled.patchInvoiceName, 'FARINA SPECIALE KG 25');
  assert.equal(filled.checkReason, undefined);

  const other = stored({ supplierCode: '', invoiceName: 'FARINA TIPO 00 KG 1', name: 'Farina tipo 00' });
  const askedAgain = planOne(raw, ctxOf({ ingredients: [other] }));
  const left = resolveRow(askedAgain, { sameAs: 'ing-1' }, ctxOf({ ingredients: [other] }));
  assert.equal(left.patchInvoiceName, null);
  assert.equal(left.checkReason, undefined);
});

test('5 · «Create new» on a question carries no invoice-name patch', () => {
  const raw = rawIngredient({ supplierCode: 'NEW-CODE', key: `${SUPPLIER_KEY}|code:NEW-CODE` });
  const asked = planOne(raw, ctxOf());
  const made = resolveRow(asked, { createNew: true }, ctxOf());
  assert.equal(made.status, 'new');
  assert.equal(made.patchInvoiceName, null);
});

// ── 6 · building and planning the same invoices twice ─────────────────────────────

// Applies the writes of one plan to a fake catalogue, the way the data layer would.
function apply(rows, file, catalogue) {
  let counter = catalogue.ingredients.length;
  rows.forEach(row => {
    const fileIngredient = file.ingredients.find(i => i.key === row.key);
    ingredientWrites(row, fileIngredient, '2026-10-06T10:00:00Z', {}).flat().forEach(op => {
      if (op.type === 'create-ingredient') {
        counter += 1;
        catalogue.created = `ing-${counter}`;
        catalogue.ingredients.push({ id: catalogue.created, supplierId: SUPPLIER_ID, ...op.data });
        return;
      }
      const id = op.ingredientId ?? catalogue.created;
      if (op.type === 'patch-ingredient') Object.assign(catalogue.ingredients.find(i => i.id === id), op.data);
      if (op.type === 'set-current-price') catalogue.pricesById[id] = op.data;
      if (op.type === 'add-price-point') (catalogue.invoicePointIds[id] ||= new Set()).add(op.pointId);
    });
  });
}

test('6 · idempotency: the same invoices planned twice give no new row, no question and no hold the second time', () => {
  const c = newCase();
  c.add([
    { desc: 'FARINA TIPO 00 {LOTTO 77} SACCO KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 28.5 },
    { desc: 'Lievito fresco {L 9} panetto KG 1', code: 'L-1', qty: 4, unit: 'KG', total: 12 },
    { desc: 'ZUCCHERO SEMOLATO SACCHI DA KG 25', qty: 2, unit: 'PZ', total: 40 },
  ], { date: '2026-09-01' });
  c.add([
    { desc: 'FARINA TIPO 00 {LOTTO 80} SACCO KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 30 },
    { desc: 'ZUCCHERO SEMOLATO SACCHI DA KG 25', qty: 2, unit: 'PZ', total: 41 },
  ], { date: '2026-09-15' });
  const built = c.build().importFile;
  assert.ok(built.ingredients.length >= 3);
  assert.ok(built.ingredients.every(i => i.invoiceName), 'every entry carries its invoice name');
  const file = parseImportFile(JSON.stringify(built)).file;
  const catalogue = { ingredients: [], pricesById: {}, invoicePointIds: {}, created: null };
  const ctx = () => ({ supplierIdByKey: { [file.suppliers[0].key]: SUPPLIER_ID }, ...catalogue });

  const first = planIngredients(file.ingredients, ctx());
  assert.ok(first.every(r => r.status === 'new'), JSON.stringify(first.map(r => r.status)));
  apply(first, file, catalogue);
  assert.equal(catalogue.ingredients.length, first.length);

  // The same file again, against what the first run wrote.
  const second = planIngredients(file.ingredients, ctx());
  assert.deepEqual(second.map(r => r.status), second.map(() => 'unchanged'), 'every row is the ingredient it created');
  assert.ok(second.every(r => !r.checkReason && !r.patchInvoiceName && !r.patchSupplierCode && !r.setSupplierCodes));
  second.forEach(row => {
    assert.deepEqual(ingredientWrites(row, file.ingredients.find(i => i.key === row.key), '2026-10-06T10:00:00Z', {}), []);
  });

  // A third look, as the screen does it (decisions applied): nothing is held, nothing waits.
  const entries = applyDecisions(second, {}, ctx(), new Set(), new Set());
  assert.ok(entries.every(e => !e.waiting && e.row.status === 'unchanged' && !e.row.held));
});

test('6 · the same product on a later invoice with another LOT number is still the same ingredient', () => {
  const first = newCase();
  first.add([{ desc: 'FARINA TIPO 00 {LOTTO 77} SACCO KG 25', qty: 2, unit: 'PZ', total: 28.5 }], { date: '2026-09-01' });
  const second = newCase();
  second.add([{ desc: 'FARINA TIPO 00 {LOTTO 91} SACCO KG 25', qty: 2, unit: 'PZ', total: 30 }], { date: '2026-10-01', sdi: '9100000001' });
  const a = parseImportFile(JSON.stringify(first.build().importFile)).file;
  const b = parseImportFile(JSON.stringify(second.build().importFile)).file;
  const catalogue = { ingredients: [], pricesById: {}, invoicePointIds: {}, created: null };
  const ctx = () => ({ supplierIdByKey: { [a.suppliers[0].key]: SUPPLIER_ID }, ...catalogue });
  apply(planIngredients(a.ingredients, ctx()), a, catalogue);
  // The owner retyped «Name in the message»: only the invoice name can still find the ingredient (no article code).
  catalogue.ingredients[0].name = 'Farina del mulino';
  const row = planIngredients(b.ingredients, ctx())[0];
  assert.equal(row.ingredientId, catalogue.ingredients[0].id, 'found by its invoice name, with no article code to go by');
  assert.equal(row.status, 'update-price');
});

// ── 7 · the words ────────────────────────────────────────────────────────────────

test('7 · every new label and reason exists in English and Italian', () => {
  const keys = [
    'invoiceImport.check.invoiceNameChanged', 'invoiceImport.ing.rename.label', 'invoiceImport.ing.rename.keep', 'invoiceImport.ing.rename.save',

    'orders.ingredient.field.invoiceName', 'orders.ingredient.field.invoiceNameHint',
    'orders.ingredient.field.messageName', 'orders.ingredient.field.messageNameHint',
    'orders.ingredient.field.listName', 'orders.ingredient.field.listNameHint',
    'orders.field.name', 'orders.field.shortName', 'orders.field.shortNameHint',
  ];
  for (const lang of ['en', 'it']) {
    for (const key of keys) assert.equal(typeof DICT[lang][key], 'string', `${lang} ${key}`);
  }
  assert.match(DICT.en['invoiceImport.check.invoiceNameChanged'], /\{old\}.*\{new\}/);
  assert.match(DICT.it['invoiceImport.check.invoiceNameChanged'], /\{old\}.*\{new\}/);
  assert.equal(DICT.en['invoiceImport.ing.rename.keep'], 'Keep the old name');
  assert.equal(DICT.it['invoiceImport.ing.rename.keep'], 'Tieni il nome vecchio');
  assert.equal(DICT.en['invoiceImport.ing.rename.save'], 'Save the new name');
  assert.equal(DICT.it['invoiceImport.ing.rename.save'], 'Salva il nome nuovo');
  assert.equal(DICT.en['invoiceImport.ing.group.check'].other, 'To check ({n})');
  assert.equal(DICT.it['invoiceImport.ing.group.check'].other, 'Da controllare ({n})');
  assert.equal(DICT.en['invoiceImport.summary.names'].other, '{n} names on the invoice saved');
  assert.equal(DICT.it['invoiceImport.summary.names'].one, '{n} nome in fattura salvato');
});

// ── 8 · the merge tool never touches the survivor's invoice name ──────────────────

test('8 · merging two ingredients writes no invoiceName onto the survivor', async () => {
  const { planMerge } = await import('../js/orders/ingredient-merge.js');
  const a = stored({ supplierCode: 'F00-25', invoiceName: 'FARINA TIPO 00 SACCO KG 25' });
  const b = stored({ id: 'ing-2', supplierCode: 'F00-5', invoiceName: 'FARINA TIPO 00 SACCHETTO KG 5' });
  const ops = planMerge({ a, b, bPoints: [], aPointIds: new Set(), aPrice: null, bPrice: null }).batches.flat();
  assert.ok(ops.length > 0);
  assert.ok(ops.every(op => !('invoiceName' in op.data)));
  assert.deepEqual(ops.find(op => op.path.length === 2 && op.path[1] === 'ing-1').data, { supplierCodes: ['F00-5'] });
});

// The workbook advice («correct it in the workbook», «write “unisci con …” in Azione») belongs to the .json path:
// an invoice zip has no workbook, and its answers are remembered by the price points they leave.
test('the summary gives the workbook advice only on the .json path', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../js/orders/invoice-import-screen.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!s\.built && sum\.notFixableByRetry > 0\)/);
  assert.match(src, /if \(!s\.built && s\.remember\.length > 0\)/);
});

test('the note on ingredients already in Mise says what the import adds to them', () => {
  const { en, it } = DICT;
  assert.match(en['invoiceImport.ing.note'], /name on the invoice/);
  assert.match(it['invoiceImport.ing.note'], /nome in fattura/);
  assert.equal(it['invoiceImport.status.priceCheck'], 'Da controllare');
});
