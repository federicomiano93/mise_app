// «Import from invoices» — the model that decides what would be written (js/orders/invoice-import-model.js).
// Every name, VAT number and invoice id below is INVENTED. Real invoices never go in this repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IMPORT_FORMAT, IMPORT_VERSION, MAX_DOCS_PER_BATCH,
  parseImportFile, normalizeVat, normalizeSupplierName, normalizeIngredientName,
  planSuppliers, supplierWrites, planIngredients, resolveRow, ingredientWrites, summarize,
  packLabelOf, extraCodesOf, MAX_SUPPLIER_CODES,
} from '../js/orders/invoice-import-model.js';
import { INGREDIENT_DRAINED_FIELDS } from '../js/price-model.js';

const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

// The first hasOnly([...]) list under `match /<path> {` — the way tests/price-fields-whitelist.test.mjs reads it.
function whitelistOf(matchPath) {
  const start = RULES.indexOf(`match ${matchPath} {`);
  assert.notEqual(start, -1, `firestore.rules has no "match ${matchPath}"`);
  const m = RULES.slice(start).match(/hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(m, `no hasOnly([...]) under ${matchPath}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}
const SUPPLIER_KEYS = whitelistOf('/suppliers/{id}');
const INGREDIENT_KEYS = whitelistOf('/ingredients/{id}');
const PRICE_DOC_KEYS = whitelistOf('/ingredient-prices/{id}');
const POINT_KEYS = whitelistOf('/prices/{priceId}');

// ── Builders ────────────────────────────────────────────────────────────────────
const price = (over = {}) => ({ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, qty: 25, ...over });
const rawIngredient = (over = {}) => ({
  key: 'IT00000000001|code:F00-25', supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00',
  brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null,
  priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [price()], ...over,
});
const rawFile = (over = {}) => ({
  format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-03T10:00:00Z',
  suppliers: [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
  ingredients: [rawIngredient()],
  ...over,
});
const parse = (obj) => {
  const r = parseImportFile(JSON.stringify(obj));
  assert.equal(r.ok, true);
  return r.file;
};
const oneIngredient = (over, extra) => parse(rawFile({ ingredients: [rawIngredient(over)], ...extra })).ingredients[0];

const SUPPLIER_ID = 'sup-1';
const ctxOf = (over = {}) => ({
  supplierIdByKey: { IT00000000001: SUPPLIER_ID },
  ingredients: [],
  pricesById: new Map(),
  invoicePointIds: new Map(),
  ...over,
});
const existingIng = (over = {}) => ({
  id: 'ing-1', name: 'Farina 00 Esempio', shortName: '', supplierId: SUPPLIER_ID, supplierCode: '', kind: 'ingredient', active: true, ...over,
});
const planOne = (file, ctx) => planIngredients([file], ctx)[0];
const flat = (batches) => batches.flat();

// No number anywhere in a structure is NaN or infinite.
function assertNoNaN(value, path = 'value') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertNoNaN(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => assertNoNaN(v, `${path}.${k}`));
}

// ── Constants ───────────────────────────────────────────────────────────────────
test('the format, the version and the batch size are the agreed ones', () => {
  assert.equal(IMPORT_FORMAT, 'mise-invoice-import');
  assert.equal(IMPORT_VERSION, 1);
  assert.equal(MAX_DOCS_PER_BATCH, 5);
});

// ── parseImportFile ─────────────────────────────────────────────────────────────
test('a good file is read whole', () => {
  const r = parseImportFile(JSON.stringify(rawFile()));
  assert.equal(r.ok, true);
  assert.equal(r.file.generatedAt, '2026-10-03T10:00:00Z');
  assert.deepEqual(r.file.suppliers, [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }]);
  const ing = r.file.ingredients[0];
  assert.equal(ing.invalid, undefined);
  assert.deepEqual(ing.prices, [{ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, qty: 25 }]);
  assert.equal(ing.vatRate, 4);
  assertNoNaN(r.file);
});

test('whole-file refusals each have their own code', () => {
  assert.deepEqual(parseImportFile('{nope'), { ok: false, error: 'not-json' });
  assert.deepEqual(parseImportFile(''), { ok: false, error: 'not-json' });
  assert.deepEqual(parseImportFile(undefined), { ok: false, error: 'not-json' });
  assert.deepEqual(parseImportFile('[]'), { ok: false, error: 'invalid' });
  assert.deepEqual(parseImportFile('null'), { ok: false, error: 'invalid' });
  assert.deepEqual(parseImportFile('42'), { ok: false, error: 'invalid' });
  assert.deepEqual(parseImportFile(JSON.stringify(rawFile({ format: 'something-else' }))), { ok: false, error: 'wrong-format' });
  assert.deepEqual(parseImportFile(JSON.stringify({ suppliers: [], ingredients: [] })), { ok: false, error: 'wrong-format' });
  assert.deepEqual(parseImportFile(JSON.stringify(rawFile({ version: 2 }))), { ok: false, error: 'wrong-version' });
  assert.deepEqual(parseImportFile(JSON.stringify(rawFile({ suppliers: undefined }))), { ok: false, error: 'invalid' });
  assert.deepEqual(parseImportFile(JSON.stringify(rawFile({ ingredients: {} }))), { ok: false, error: 'invalid' });
});

test('a byte-order mark in front of the JSON does not matter', () => {
  assert.equal(parseImportFile(`﻿${JSON.stringify(rawFile())}`).ok, true);
});

test('a bad entry is kept with its reason, never a reason to lose the file', () => {
  const file = parse(rawFile({
    suppliers: [
      { key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'Mulino Esempio' },
      { key: 'IT00000000002', vatNumber: 'IT00000000002', name: '' },
      'not an object',
      { key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'Same key twice' },
      { key: 'IT00000000003', vatNumber: '', name: 'No VAT and no NOVAT key' },
      { key: 'IT00000000004', vatNumber: 'IT'.padEnd(40, '9'), name: 'Long VAT' },
    ],
    ingredients: [
      rawIngredient(),
      rawIngredient({ key: 'k2', name: '' }),
      rawIngredient({ key: 'k3', priceUnit: 'ton' }),
      rawIngredient({ key: 'k4', priceUnit: 'pcs', unitWeightKg: null }),
      rawIngredient({ key: 'k5', prices: [] }),
      rawIngredient({ key: 'k6', prices: [price({ pricePerUnit: 0 })] }),
      rawIngredient({ key: 'k7', packCount: 0 }),
      rawIngredient({ key: '', name: 'No key' }),
      rawIngredient({ key: 'k9', supplierKey: '' }),
      null,
    ],
  }));
  assert.deepEqual(file.suppliers.map(s => s.invalid), [
    undefined, 'name-missing', 'not-object', 'duplicate-key', 'vat-missing', 'vat-too-long',
  ]);
  assert.deepEqual(file.ingredients.map(i => i.invalid), [
    undefined, 'name-missing', 'price-unit', 'unit-weight-missing', 'no-prices', 'price-invalid',
    'pack-count', 'key-missing', 'supplier-key-missing', 'not-object',
  ]);
  assertNoNaN(file);
});

test('a supplier whose key is NOVAT: has no VAT number, whatever vatNumber says', () => {
  const file = parse(rawFile({ suppliers: [{ key: 'NOVAT:0123456789ab', vatNumber: 'IT999', name: 'Mario Rossi' }] }));
  assert.equal(file.suppliers[0].invalid, undefined);
  assert.equal(file.suppliers[0].vatNumber, '');
});

test('the VAT number is stored in the one spelling', () => {
  const file = parse(rawFile({ suppliers: [{ key: 'IT00000000001', vatNumber: ' it 000 000 000 01 ', name: 'A' }] }));
  assert.equal(file.suppliers[0].vatNumber, 'IT00000000001');
});

test('texts are trimmed and cut to what the rules accept', () => {
  const ing = oneIngredient({
    name: `  ${'n'.repeat(300)}  `, brand: 'b'.repeat(300), category: 'c'.repeat(300),
    supplierCode: 'x'.repeat(100), weight: 'w'.repeat(200), packUnit: 'p'.repeat(90),
  });
  assert.equal(ing.name.length, 200);
  assert.equal(ing.brand.length, 200);
  assert.equal(ing.category.length, 200);
  assert.equal(ing.supplierCode.length, 60);
  assert.equal(ing.weight.length, 100);
  assert.equal(ing.packUnit.length, 40);
  assert.equal(oneIngredient({ name: '  Sale  ' }).name, 'Sale');
});

test('packCount is a whole number from 1 to 10000, or null', () => {
  assert.equal(oneIngredient({ packCount: 4 }).packCount, 4);
  assert.equal(oneIngredient({ packCount: 10000 }).packCount, 10000);
  assert.equal(oneIngredient({ packCount: null }).packCount, null);
  assert.equal(oneIngredient({ packCount: undefined }).invalid, undefined);
  for (const bad of [0, -1, 2.5, 10001, '4', true]) {
    assert.equal(oneIngredient({ packCount: bad }).invalid, 'pack-count', String(bad));
  }
});

test('priceUnit is kg, l or pcs; pcs needs a piece weight, the others never carry one', () => {
  for (const unit of ['kg', 'l']) assert.equal(oneIngredient({ priceUnit: unit }).priceUnit, unit);
  assert.equal(oneIngredient({ priceUnit: 'kg', unitWeightKg: 0.06 }).unitWeightKg, null);
  const eggs = oneIngredient({ priceUnit: 'pcs', unitWeightKg: 0.06 });
  assert.equal(eggs.invalid, undefined);
  assert.equal(eggs.unitWeightKg, 0.06);
  for (const bad of [0, -0.1, NaN, '0.06', null]) {
    assert.equal(oneIngredient({ priceUnit: 'pcs', unitWeightKg: bad }).invalid, 'unit-weight-missing', String(bad));
  }
});

test('the VAT rate is one of 0 4 5 10 20 22, else not stated — never 0', () => {
  for (const rate of [0, 4, 5, 10, 20, 22]) assert.equal(oneIngredient({ vatRate: rate }).vatRate, rate);
  for (const bad of [null, undefined, '', 7, 21, -4, 'abc', NaN, 4.5]) {
    assert.equal(oneIngredient({ vatRate: bad }).vatRate, null, String(bad));
  }
});

test('a price needs a digits-only invoice id, a line 1..999999, a real date and a rate above zero', () => {
  const bad = [
    { invoiceId: '' }, { invoiceId: 'A123' }, { invoiceId: '1'.repeat(21) }, { invoiceId: 18000000001 },
    { line: 0 }, { line: 1000000 }, { line: 1.5 }, { line: '5' },
    { invoiceDate: '2026-02-30' }, { invoiceDate: '31/08/2026' }, { invoiceDate: '2026-8-1' }, { invoiceDate: null },
    { pricePerUnit: 0 }, { pricePerUnit: -1 }, { pricePerUnit: NaN }, { pricePerUnit: '0.5' }, { pricePerUnit: 0.00001 },
  ];
  for (const over of bad) {
    assert.equal(oneIngredient({ prices: [price(over)] }).invalid, 'price-invalid', JSON.stringify(over));
  }
  assert.equal(oneIngredient({ prices: [price({ invoiceId: '1'.repeat(20), line: 999999, invoiceDate: '2024-02-29' })] }).invalid, undefined);
});

test('qty is a positive number or null — a bad one is dropped, not a reason to refuse the price', () => {
  for (const q of [0, -3, NaN, '25', undefined, null]) {
    const ing = oneIngredient({ prices: [price({ qty: q })] });
    assert.equal(ing.invalid, undefined, String(q));
    assert.equal(ing.prices[0].qty, null, String(q));
  }
  assert.equal(oneIngredient({ prices: [price({ qty: 12.5 })] }).prices[0].qty, 12.5);
});

test('the rate is rounded the way the card rounds a typed one', () => {
  assert.equal(oneIngredient({ prices: [price({ pricePerUnit: 1.234567 })] }).prices[0].pricePerUnit, 1.2346);
});

test('the same invoice and line inside one ingredient collapse to one point; points come oldest first', () => {
  const ing = oneIngredient({
    prices: [
      price({ invoiceId: '18000000003', line: 2, invoiceDate: '2026-09-30', pricePerUnit: 0.6 }),
      price({ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57 }),
      price({ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.99 }),
      price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-08-31', pricePerUnit: 0.58 }),
    ],
  });
  assert.deepEqual(ing.prices.map(p => `${p.invoiceId}-${p.line}`), ['18000000001-5', '18000000002-1', '18000000003-2']);
  assert.equal(ing.prices[0].pricePerUnit, 0.57, 'the first of the duplicates wins');
});

test('two entries with one key: the second is refused, the decisions are keyed by it', () => {
  const file = parse(rawFile({ ingredients: [rawIngredient(), rawIngredient({ name: 'Other' })] }));
  assert.equal(file.ingredients[1].invalid, 'duplicate-key');
});

test('a key that would reach the prototype is refused', () => {
  const file = parse(rawFile({ ingredients: [rawIngredient({ key: '__proto__' })] }));
  assert.equal(file.ingredients[0].invalid, 'key-missing');
});

// ── Normalisers ─────────────────────────────────────────────────────────────────
test('normalizeVat: upper case, no whitespace at all, empty stays empty, NOVAT keys mean none', () => {
  assert.equal(normalizeVat('it 01234567890'), 'IT01234567890');
  assert.equal(normalizeVat(' IT0123\t4567\n890 '), 'IT01234567890');
  assert.equal(normalizeVat(''), '');
  assert.equal(normalizeVat(null), '');
  assert.equal(normalizeVat(undefined), '');
  assert.equal(normalizeVat(12), '');
  assert.equal(normalizeVat('NOVAT:0123456789ab'), '');
  assert.equal(normalizeVat(' novat:abc'), '');
});

test('normalizeSupplierName: accents, case, punctuation and legal forms do not matter', () => {
  const same = [
    ['Mulino Esempio S.r.l.', 'MULINO ESEMPIO SRL'],
    ['Mulino Esempio S.R.L.', 'mulino   esempio'],
    ['Caffè Esempio S.p.A.', 'caffe esempio spa'],
    ['Caffè Esempio SpA', 'Caffe Esempio'],
    ['Latteria Esempio s.a.s.', 'Latteria Esempio'],
    ['Latteria Esempio S.N.C.', 'latteria esempio snc'],
    ['Latteria Esempio sapa', 'Latteria Esempio'],
    ['Latteria Esempio S.C.A.R.L.', 'Latteria Esempio scarl'],
    ['Latteria Esempio SRLS', 'Latteria Esempio S.R.L.S.'],
    ['Coop Esempio', 'Esempio'],
    ['Bianchi & Verdi sas di Bianchi Luca', 'Bianchi Verdi Bianchi Luca'],
    ['Bianchi & Verdi snc di Bianchi Luca', 'Bianchi Verdi Bianchi Luca'],
  ];
  for (const [a, b] of same) assert.equal(normalizeSupplierName(a), normalizeSupplierName(b), `${a} / ${b}`);
});

test('«di» is only dropped right after sas / snc', () => {
  assert.equal(normalizeSupplierName('Forno di Paese'), 'forno di paese');
  assert.equal(normalizeSupplierName('Rossi sas di Rossi'), 'rossi rossi');
});

test('a name made only of a legal form does not collapse to nothing', () => {
  assert.equal(normalizeSupplierName('S.r.l.'), 's r l');
  assert.equal(normalizeSupplierName(''), '');
  assert.equal(normalizeSupplierName(null), '');
});

test('normalizeIngredientName: accents, case and punctuation only', () => {
  assert.equal(normalizeIngredientName('  Crème  Fraîche, 35% '), 'creme fraiche 35');
  assert.equal(normalizeIngredientName('Farina tipo "00"'), 'farina tipo 00');
  assert.equal(normalizeIngredientName(undefined), '');
  assert.notEqual(normalizeIngredientName('Farina srl'), normalizeIngredientName('Farina'), 'legal forms are for suppliers only');
});

// ── planSuppliers ───────────────────────────────────────────────────────────────
const fileSupplier = (over = {}) => ({ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL', ...over });
const existingSupplier = (over = {}) => ({ id: 's1', name: 'Fornitore Esempio', shortName: '', vatNumber: '', ...over });

test('the same VAT number in two spellings is the same supplier', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ id: 'x', name: 'Whatever', vatNumber: 'it 000 000 000 01' })]);
  assert.deepEqual(plan, [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL', status: 'present', supplierId: 'x' }]);
});

test('a VAT match wins even when the names have nothing in common', () => {
  const plan = planSuppliers([fileSupplier()], [
    existingSupplier({ id: 'a', name: 'Fornitore Esempio' }),
    existingSupplier({ id: 'b', name: 'Totally Different', vatNumber: 'IT00000000001' }),
  ]);
  assert.equal(plan[0].status, 'present');
  assert.equal(plan[0].supplierId, 'b');
});

test('a similar name with a DIFFERENT VAT number is never a candidate', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ id: 'a', name: 'Fornitore Esempio', vatNumber: 'IT00000000099' })]);
  assert.equal(plan[0].status, 'new');
  assert.equal(plan[0].candidates, undefined);
});

test('two people with one surname and different VAT numbers are two suppliers', () => {
  const plan = planSuppliers(
    [fileSupplier({ key: 'IT00000000002', vatNumber: 'IT00000000002', name: 'ROSSI MARIO' })],
    [existingSupplier({ id: 'a', name: 'Rossi Mario', vatNumber: 'IT00000000003' })],
  );
  assert.equal(plan[0].status, 'new');
});

test('no VAT match and a similar supplier without a VAT number → maybe, with the candidate', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ id: 'a', name: 'Fornitore Esempio', shortName: 'Esempio' })]);
  assert.equal(plan[0].status, 'maybe');
  assert.deepEqual(plan[0].candidates, [{ id: 'a', label: 'Esempio' }], 'the label is what the app shows');
});

test('the short name is compared too', () => {
  const plan = planSuppliers([fileSupplier({ name: 'Mulino Esempio S.r.l.' })], [existingSupplier({ id: 'a', name: 'Ditta 12', shortName: 'Mulino Esempio' })]);
  assert.equal(plan[0].status, 'maybe');
});

test('similarity: one name holds all the other\'s words, or half of the words are shared', () => {
  const file = fileSupplier({ name: 'Mulino Esempio Molino Grande Srl' });
  const names = {
    contained: 'Mulino Esempio',                // all of its words are in the file name
    container: 'Mulino Esempio Molino Grande Italia SpA', // holds all the file name's words
    half: 'Molino Grande Altro Mulino',         // 3 of 5 shared words
    unrelated: 'Caseificio Rossi',
    onlyShort: 'Zz Mulino',                     // "zz" is under 3 letters: its only long word is in the file name
  };
  const suppliers = Object.entries(names).map(([id, name]) => existingSupplier({ id, name }));
  const plan = planSuppliers([file], suppliers)[0];
  const ids = plan.candidates.map(c => c.id);
  assert.ok(ids.includes('contained'));
  assert.ok(ids.includes('container'));
  assert.ok(ids.includes('half'));
  assert.ok(ids.includes('onlyShort'));
  assert.ok(!ids.includes('unrelated'));
});

test('an exact name (after normalising) is the first candidate', () => {
  const plan = planSuppliers([fileSupplier({ name: 'Mulino Esempio S.r.l.' })], [
    existingSupplier({ id: 'loose', name: 'Mulino Esempio Italia Alimentare' }),
    existingSupplier({ id: 'exact', name: 'MULINO ESEMPIO' }),
  ]);
  assert.deepEqual(plan[0].candidates.map(c => c.id), ['exact', 'loose']);
});

test('nothing alike → new', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ name: 'Caseificio Rossi' })]);
  assert.equal(plan[0].status, 'new');
  assert.equal(planSuppliers([fileSupplier()], [])[0].status, 'new');
  assert.equal(planSuppliers([fileSupplier()], null)[0].status, 'new');
});

test('two existing suppliers with the same VAT number → maybe, both are candidates', () => {
  const plan = planSuppliers([fileSupplier()], [
    existingSupplier({ id: 'b', name: 'Beta', vatNumber: 'IT00000000001' }),
    existingSupplier({ id: 'a', name: 'Alfa', vatNumber: 'IT 00000000001' }),
  ]);
  assert.equal(plan[0].status, 'maybe');
  assert.equal(plan[0].reason, 'duplicate-vat');
  assert.deepEqual(plan[0].candidates.map(c => c.id).sort(), ['a', 'b']);
});

test('a supplier without a VAT number is matched by name only', () => {
  const file = fileSupplier({ key: 'NOVAT:0123456789ab', vatNumber: '', name: 'Mario Rossi' });
  const plan = planSuppliers([file], [
    existingSupplier({ id: 'a', name: 'Rossi Mario' }),
    existingSupplier({ id: 'b', name: 'Mario Rossi', vatNumber: 'IT00000000007' }),
  ]);
  assert.equal(plan[0].status, 'maybe');
  assert.deepEqual(plan[0].candidates.map(c => c.id), ['a']);
});

test('an invalid supplier entry is an error row with its reason', () => {
  const bad = parse(rawFile({ suppliers: [{ key: 'IT1', vatNumber: 'IT1', name: '' }] })).suppliers[0];
  const plan = planSuppliers([bad], []);
  assert.equal(plan[0].status, 'error');
  assert.equal(plan[0].reason, 'name-missing');
});

// ── supplierWrites ──────────────────────────────────────────────────────────────

// What the new-supplier form builds, read out of its source: the form needs a DOM, the payload does not.
function formPayloadKeys() {
  const source = readFileSync(new URL('../js/supplier-record-form.js', import.meta.url), 'utf8');
  const block = source.match(/const payload = \{([\s\S]*?)\n    \};/);
  assert.ok(block, 'the form no longer builds `const payload = {…}` the way this test reads it');
  return [...block[1].matchAll(/^\s{6}(\w+):/gm)].map(m => m[1]);
}

test('a created supplier has exactly what the form saves for a new one, VAT number included', () => {
  const plan = planSuppliers([fileSupplier()], []);
  const { ops } = supplierWrites(plan, {});
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'create-supplier');
  assert.equal(ops[0].key, 'IT00000000001');
  const formKeys = formPayloadKeys();
  assert.ok(formKeys.length >= 8, 'the key list was read');
  assert.deepEqual(Object.keys(ops[0].data).sort(), [...formKeys].sort());
  assert.ok(formKeys.includes('vatNumber'), 'the supplier form saves the VAT number the import writes');
  assert.deepEqual(ops[0].data, {
    name: 'FORNITORE ESEMPIO SRL', shortName: '', category: '', phone: '', email: '',
    deliveryDays: [], orderDays: [], active: true, vatNumber: 'IT00000000001',
  });
  for (const key of Object.keys(ops[0].data)) assert.ok(SUPPLIER_KEYS.includes(key), `the suppliers rule refuses "${key}"`);
});

test('a supplier without a VAT number is created with an empty one', () => {
  const plan = planSuppliers([fileSupplier({ key: 'NOVAT:0123456789ab', vatNumber: '', name: 'Mario Rossi' })], []);
  const { ops } = supplierWrites(plan, {});
  assert.equal(ops[0].data.vatNumber, '');
});

test('a present supplier is a mapping and no write', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ id: 'x', vatNumber: 'IT00000000001' })]);
  const out = supplierWrites(plan, {});
  assert.deepEqual(out, { ops: [], supplierIdByKey: { IT00000000001: 'x' }, blocked: [] });
});

test('a maybe with no decision blocks; linking writes the VAT number and nothing else', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ id: 'a', name: 'Fornitore Esempio' })]);
  assert.deepEqual(supplierWrites(plan, {}), { ops: [], supplierIdByKey: {}, blocked: ['IT00000000001'] });
  const linked = supplierWrites(plan, { IT00000000001: { linkTo: 'a' } });
  assert.deepEqual(linked.ops, [{ type: 'link-supplier', key: 'IT00000000001', supplierId: 'a', data: { vatNumber: 'IT00000000001' } }]);
  assert.deepEqual(linked.supplierIdByKey, { IT00000000001: 'a' });
  assert.deepEqual(linked.blocked, []);
});

test('linking to somebody who is not a candidate still blocks', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ id: 'a' })]);
  assert.deepEqual(supplierWrites(plan, { IT00000000001: { linkTo: 'someone-else' } }).blocked, ['IT00000000001']);
});

test('a maybe can be created as new, or skipped', () => {
  const plan = planSuppliers([fileSupplier()], [existingSupplier({ id: 'a' })]);
  const created = supplierWrites(plan, { IT00000000001: { createNew: true } });
  assert.equal(created.ops[0].type, 'create-supplier');
  assert.deepEqual(created.blocked, []);
  const skipped = supplierWrites(plan, { IT00000000001: { skip: true } });
  assert.deepEqual(skipped, { ops: [], supplierIdByKey: {}, blocked: [] });
});

test('a new supplier is created without a decision and skipped on request; an error row does nothing', () => {
  const bad = parse(rawFile({ suppliers: [{ key: 'IT9', vatNumber: 'IT9', name: '' }] })).suppliers[0];
  const plan = planSuppliers([fileSupplier(), bad], []);
  assert.equal(supplierWrites(plan, {}).ops.length, 1);
  assert.deepEqual(supplierWrites(plan, { IT00000000001: { skip: true } }).ops, []);
  assert.deepEqual(supplierWrites(plan, {}).blocked, []);
});

test('linking a supplier without a VAT number writes nothing, only remembers who it is', () => {
  const file = fileSupplier({ key: 'NOVAT:0123456789ab', vatNumber: '', name: 'Mario Rossi' });
  const plan = planSuppliers([file], [existingSupplier({ id: 'a', name: 'Rossi Mario' })]);
  const out = supplierWrites(plan, { 'NOVAT:0123456789ab': { linkTo: 'a' } });
  assert.deepEqual(out.ops, []);
  assert.deepEqual(out.supplierIdByKey, { 'NOVAT:0123456789ab': 'a' });
});

// ── planIngredients ─────────────────────────────────────────────────────────────
test('no similar ingredient → new, with every point to write', () => {
  const row = planOne(oneIngredient(), ctxOf());
  assert.equal(row.status, 'new');
  assert.equal(row.supplierId, SUPPLIER_ID);
  assert.equal(row.updateCurrent, true);
  assert.deepEqual(row.newPoints.map(p => p.id), ['inv-18000000001-5']);
  assert.equal(row.ingredientId, undefined);
});

test('an ingredient whose supplier is not known is an error row', () => {
  const row = planOne(oneIngredient(), ctxOf({ supplierIdByKey: {} }));
  assert.equal(row.status, 'error');
  assert.equal(row.reason, 'supplier-missing');
  assert.deepEqual(row.newPoints, []);
  assert.equal(planOne(oneIngredient(), ctxOf({ supplierIdByKey: new Map() })).reason, 'supplier-missing');
  assert.equal(planOne(oneIngredient(), ctxOf({ supplierIdByKey: new Map([['IT00000000001', SUPPLIER_ID]]) })).status, 'new');
});

test('an invalid file entry is an error row, not a crash', () => {
  const file = parse(rawFile({ ingredients: [rawIngredient({ name: '' }), rawIngredient({ key: 'k2', prices: [] })] }));
  const rows = planIngredients(file.ingredients, ctxOf());
  assert.deepEqual(rows.map(r => [r.status, r.reason]), [['error', 'name-missing'], ['error', 'no-prices']]);
  assert.deepEqual(ingredientWrites(rows[0], file.ingredients[0], ''), []);
});

test('the same name matches; accents, case and the display name do not get in the way', () => {
  const row = planOne(oneIngredient({ supplierCode: '', name: 'FARINA  tipo 00' }), ctxOf({
    ingredients: [existingIng({ id: 'i1', name: 'Farina 00 Esempio', shortName: 'Farina Tipo 00' })],
  }));
  assert.equal(row.status, 'update-price');
  assert.equal(row.ingredientId, 'i1');
});

test('the same ingredient under two suppliers is two separate ingredients', () => {
  const file = parse(rawFile({
    suppliers: [fileSupplier(), fileSupplier({ key: 'IT00000000002', vatNumber: 'IT00000000002', name: 'ALTRO' })],
    ingredients: [
      rawIngredient({ supplierCode: '', name: 'Sale fino' }),
      rawIngredient({ key: 'IT00000000002|name:sale fino', supplierKey: 'IT00000000002', supplierCode: '', name: 'Sale fino' }),
    ],
  }));
  const ctx = ctxOf({
    supplierIdByKey: { IT00000000001: 's-one', IT00000000002: 's-two' },
    ingredients: [
      existingIng({ id: 'salt-one', name: 'Sale fino', supplierId: 's-one' }),
      existingIng({ id: 'salt-two', name: 'Sale fino', supplierId: 's-two' }),
    ],
  });
  const rows = planIngredients(file.ingredients, ctx);
  assert.deepEqual(rows.map(r => r.ingredientId), ['salt-one', 'salt-two']);
  const onlyOne = planIngredients(file.ingredients, { ...ctx, ingredients: [ctx.ingredients[0]] });
  assert.equal(onlyOne[0].ingredientId, 'salt-one');
  assert.equal(onlyOne[1].status, 'new', 'the other supplier\'s salt is not this supplier\'s salt');
});

test('packaging is never a match; an inactive ingredient is', () => {
  const box = planOne(oneIngredient({ supplierCode: '', name: 'Scatola' }), ctxOf({
    ingredients: [existingIng({ id: 'p1', name: 'Scatola', kind: 'packaging' })],
  }));
  assert.equal(box.status, 'new');
  const off = planOne(oneIngredient({ supplierCode: '', name: 'Scatola' }), ctxOf({
    ingredients: [existingIng({ id: 'i1', name: 'Scatola', active: false })],
  }));
  assert.equal(off.ingredientId, 'i1');
});

test('the supplier\'s article code wins over a changed name', () => {
  const row = planOne(oneIngredient({ supplierCode: ' f00-25 ', name: 'Farina 00 nuova descrizione' }), ctxOf({
    ingredients: [
      existingIng({ id: 'other', name: 'Farina 00 nuova descrizione', supplierCode: 'ZZZ' }),
      existingIng({ id: 'coded', name: 'Farina del mulino', supplierCode: 'F00-25' }),
    ],
  }));
  assert.equal(row.ingredientId, 'coded');
  assert.equal(row.patchSupplierCode, null, 'it already has its code');
});

test('a match by name asks to remember the code only when the ingredient has none', () => {
  const none = planOne(oneIngredient({ name: 'Farina del mulino' }), ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina del mulino' })] }));
  assert.equal(none.patchSupplierCode, 'F00-25');
  const had = planOne(oneIngredient({ name: 'Farina del mulino' }), ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina del mulino', supplierCode: 'OLD' })] }));
  assert.equal(had.patchSupplierCode, null);
  const fileNone = planOne(oneIngredient({ name: 'Farina del mulino', supplierCode: '' }), ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina del mulino' })] }));
  assert.equal(fileNone.patchSupplierCode, null);
});

test('«unisci con» finds the ingredient by its name or display name', () => {
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina 00 Esempio', shortName: 'Farina' })] });
  const byName = planOne(oneIngredient({ mergeWith: 'farina 00 esempio', name: 'Something else entirely' }), ctx);
  assert.equal(byName.status, 'update-price');
  assert.equal(byName.ingredientId, 'i1');
  const byShort = planOne(oneIngredient({ mergeWith: 'FARINA', name: 'Something else entirely' }), ctx);
  assert.equal(byShort.ingredientId, 'i1');
});

test('«unisci con» pointing at nothing → choose, with every ingredient of that supplier as a candidate', () => {
  const row = planOne(oneIngredient({ mergeWith: 'Does not exist' }), ctxOf({
    ingredients: [
      existingIng({ id: 'b', name: 'Zucchero' }),
      existingIng({ id: 'a', name: 'Albicocche' }),
      existingIng({ id: 'p', name: 'Scatola', kind: 'packaging' }),
      existingIng({ id: 'x', name: 'Other supplier', supplierId: 'someone' }),
    ],
  }));
  assert.equal(row.status, 'choose');
  assert.equal(row.reason, 'merge-target-not-found');
  assert.deepEqual(row.candidates.map(c => c.id), ['a', 'b']);
});

test('«unisci con» is not undone by a code or a name that would match something else', () => {
  const row = planOne(oneIngredient({ mergeWith: 'Nowhere', supplierCode: 'F00-25', name: 'Farina' }), ctxOf({
    ingredients: [existingIng({ id: 'coded', name: 'Farina', supplierCode: 'F00-25' })],
  }));
  assert.equal(row.status, 'choose');
});

test('a similar name is a maybe-duplicate with the closest first', () => {
  const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero tipo 00' }), ctxOf({
    ingredients: [
      existingIng({ id: 'far', name: 'Farina' }),
      existingIng({ id: 'close', name: 'Farina grano tenero tipo 00' }),
      existingIng({ id: 'no', name: 'Zucchero' }),
    ],
  }));
  assert.equal(row.status, 'maybe-duplicate');
  assert.deepEqual(row.candidates.map(c => c.id), ['close', 'far']);
  assert.deepEqual(row.newPoints.map(p => p.id), ['inv-18000000001-5'], 'what it would write if it were new');
  assert.equal(row.updateCurrent, false);
});

test('two existing ingredients with one code or one name are not guessed between', () => {
  const byCode = planOne(oneIngredient(), ctxOf({
    ingredients: [existingIng({ id: 'a', name: 'A', supplierCode: 'F00-25' }), existingIng({ id: 'b', name: 'B', supplierCode: 'f00-25' })],
  }));
  assert.equal(byCode.status, 'maybe-duplicate');
  assert.equal(byCode.reason, 'code-ambiguous');
  const byName = planOne(oneIngredient({ supplierCode: '' }), ctxOf({
    ingredients: [existingIng({ id: 'a', name: 'Farina tipo 00' }), existingIng({ id: 'b', name: 'Other', shortName: 'farina tipo 00' })],
  }));
  assert.equal(byName.status, 'maybe-duplicate');
  assert.equal(byName.reason, 'name-ambiguous');
});

// ── Points and the current price ────────────────────────────────────────────────
const knownIds = (id, ...pointIds) => new Map([[id, new Set(pointIds)]]);
const priceDoc = (stamp) => new Map([['i1', { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: stamp }]]);

test('a matched ingredient with no price document, or a price with no date, is updated', () => {
  const ctx = { ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] };
  assert.equal(planOne(oneIngredient({ supplierCode: '' }), ctxOf(ctx)).status, 'update-price');
  assert.equal(planOne(oneIngredient({ supplierCode: '' }), ctxOf({ ...ctx, pricesById: priceDoc(null) })).status, 'update-price');
  assert.equal(planOne(oneIngredient({ supplierCode: '' }), ctxOf({ ...ctx, pricesById: priceDoc('') })).status, 'update-price');
});

test('a newer invoice updates the price; an older one, or the same day, only feeds the history', () => {
  const file = oneIngredient({ supplierCode: '', prices: [price({ invoiceDate: '2026-08-31' })] });
  const ctx = (stamp) => ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: priceDoc(stamp) });
  const newer = planOne(file, ctx('2026-08-30T09:15:00.000Z'));
  assert.equal(newer.status, 'update-price');
  assert.equal(newer.updateCurrent, true);
  const older = planOne(file, ctx('2026-09-15T09:15:00.000Z'));
  assert.equal(older.status, 'history-only');
  assert.equal(older.updateCurrent, false);
  assert.equal(older.newPoints.length, 1);
  assert.equal(planOne(file, ctx('2026-08-31T23:59:00.000Z')).status, 'history-only');
});

test('the latest NEW point decides whether the price is updated', () => {
  const file = oneIngredient({
    supplierCode: '',
    prices: [price({ invoiceId: '18000000001', invoiceDate: '2026-07-31' }), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })],
  });
  const row = planOne(file, ctxOf({
    ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })],
    pricesById: priceDoc('2026-08-15T12:00:00.000Z'),
  }));
  assert.equal(row.status, 'update-price');
  assert.equal(row.newPoints.length, 2);
});

test('only the points not recorded yet are new; none left → unchanged', () => {
  const file = oneIngredient({
    supplierCode: '',
    prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })],
  });
  const base = { ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] };
  const some = planOne(file, ctxOf({ ...base, invoicePointIds: knownIds('i1', 'inv-18000000001-5') }));
  assert.deepEqual(some.newPoints.map(p => p.id), ['inv-18000000002-1']);
  const all = planOne(file, ctxOf({ ...base, invoicePointIds: knownIds('i1', 'inv-18000000001-5', 'inv-18000000002-1') }));
  assert.equal(all.status, 'unchanged');
  assert.deepEqual(all.newPoints, []);
  assert.equal(all.updateCurrent, false);
  const asObject = planOne(file, ctxOf({ ...base, invoicePointIds: { i1: ['inv-18000000001-5', 'inv-18000000002-1'] } }));
  assert.equal(asObject.status, 'unchanged');
});

test('a point recorded for ANOTHER ingredient does not count', () => {
  const row = planOne(oneIngredient({ supplierCode: '' }), ctxOf({
    ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })],
    invoicePointIds: knownIds('i2', 'inv-18000000001-5'),
  }));
  assert.equal(row.status, 'update-price');
});

test('every point id has the shape the rules demand', () => {
  const file = oneIngredient({
    prices: [price({ invoiceId: '1'.repeat(20), line: 999999 }), price({ invoiceId: '7', line: 1, invoiceDate: '2026-09-01' })],
  });
  const row = planOne(file, ctxOf());
  for (const p of row.newPoints) assert.match(p.id, /^inv-[0-9]{1,20}-[0-9]{1,6}$/);
});

// ── resolveRow ──────────────────────────────────────────────────────────────────
const ambiguousCtx = () => ctxOf({
  ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'zz', name: 'Zucchero' })],
});
// The same venue once the point of the file is recorded on «Farina» (what the screen reads after the answer).
const ambiguousCtxRecorded = () => ({ ...ambiguousCtx(), invoicePointIds: knownIds('far', 'inv-18000000001-5') });

test('«same as» recomputes the row as that ingredient', () => {
  const ctx = ambiguousCtx();
  const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' }), ctx);
  assert.equal(row.status, 'maybe-duplicate');
  const resolved = resolveRow(row, { sameAs: 'far' }, ambiguousCtxRecorded());
  assert.equal(resolved.status, 'unchanged', 'its point was recorded already');
  assert.equal(resolved.ingredientId, 'far');
  assert.equal(resolved.candidates, undefined);
  const other = resolveRow(row, { sameAs: 'zz' }, ctx);
  assert.equal(other.status, 'update-price');
  assert.equal(other.ingredientId, 'zz');
});

test('«same as» something that is not this supplier\'s ingredient is an error, not a write', () => {
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'foreign', name: 'Farina', supplierId: 'elsewhere' })] });
  const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' }), ctx);
  assert.equal(resolveRow(row, { sameAs: 'foreign' }, ctx).status, 'error');
  assert.equal(resolveRow(row, { sameAs: 'nobody' }, ctx).reason, 'target-not-found');
});

test('«create new» makes it a new ingredient; «skip» writes nothing', () => {
  const ctx = ambiguousCtx();
  const file = oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' });
  const row = planOne(file, ctx);
  const created = resolveRow(row, { createNew: true }, ctx);
  assert.equal(created.status, 'new');
  assert.equal(created.updateCurrent, true);
  assert.equal(created.ingredientId, undefined);
  assert.equal(created.candidates, undefined);
  assert.equal(flat(ingredientWrites(created, file, '')).filter(o => o.type === 'create-ingredient').length, 1);
  const skipped = resolveRow(row, { skip: true }, ctx);
  assert.equal(skipped.status, 'skipped');
  assert.deepEqual(ingredientWrites(skipped, file, ''), []);
});

test('a «unisci con» row cannot be made a new ingredient', () => {
  const ctx = ambiguousCtx();
  const row = planOne(oneIngredient({ mergeWith: 'Nowhere' }), ctx);
  assert.equal(row.status, 'choose');
  assert.equal(resolveRow(row, { createNew: true }, ctx), row);
  assert.equal(resolveRow(row, { sameAs: 'far' }, ctx).ingredientId, 'far');
  assert.equal(resolveRow(row, { skip: true }, ctx).status, 'skipped');
});

test('resolveRow leaves other rows and empty answers alone', () => {
  const ctx = ambiguousCtx();
  const settled = planOne(oneIngredient(), ctxOf());
  assert.equal(settled.status, 'new');
  assert.equal(resolveRow(settled, { skip: true }, ctx), settled);
  const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' }), ctx);
  assert.equal(resolveRow(row, undefined, ctx), row);
  assert.equal(resolveRow(row, {}, ctx), row);
});

// ── ingredientWrites ────────────────────────────────────────────────────────────
const writesFor = (file, ctx, options) => {
  const row = planOne(file, ctx || ctxOf());
  return { row, batches: ingredientWrites(row, file, '2026-10-03T10:00:00.000Z', options) };
};

test('a new ingredient: create, current price, then the points — the later ops wait for the id', () => {
  const file = oneIngredient({ prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30', pricePerUnit: 0.6, qty: null })] });
  const { batches } = writesFor(file);
  const ops = flat(batches);
  assert.deepEqual(ops.map(o => o.type), ['create-ingredient', 'set-current-price', 'add-price-point', 'add-price-point']);
  assert.equal(batches[0][0].type, 'create-ingredient');
  assert.deepEqual(ops.slice(1).map(o => o.ingredientId), [null, null, null]);
  assert.equal(ops[0].ingredientId, undefined);
  assert.deepEqual(ops.slice(2).map(o => o.pointId), ['inv-18000000001-5', 'inv-18000000002-1'], 'oldest first');
  assert.equal(ops[1].data.pricePerUnit, 0.6, 'the current price is the latest invoice\'s');
  assert.equal(ops[1].data.priceUpdatedAt, '2026-09-30T12:00:00.000Z');
});

test('a new Singola gets what the new card writes for one: no packCount, an empty unit when the weight reads', () => {
  const { batches } = writesFor(oneIngredient());
  const data = batches[0][0].data;
  assert.equal(data.name, 'Farina tipo 00');
  assert.equal(data.shortName, '');
  assert.equal(data.supplierId, SUPPLIER_ID);
  assert.equal(data.supplierCode, 'F00-25');
  assert.equal(data.brand, '');
  assert.equal(data.weight, '25 kg');
  assert.equal(data.unit, '');
  assert.equal('packUnit' in data, false, 'the card writes no package word on a Singola');
  assert.equal('packCount' in data, false);
  assert.equal(data.category, 'Other');
  assert.equal(data.active, true);
  assert.equal(data.kind, 'ingredient');
});

test('the weight is stored the way the card stores it', () => {
  const weightOf = (w) => writesFor(oneIngredient({ weight: w })).batches[0][0].data.weight;
  assert.equal(weightOf('2,5kg'), '2.5 kg');
  assert.equal(weightOf('500 G'), '500 g');
  assert.equal(weightOf(''), '');
  assert.equal(weightOf('6x1kg'), '6x1kg', 'a weight the card cannot read is kept as typed');
});

test('a loose Singola with no readable weight gets the venue\'s word for how it is bought', () => {
  const unitOf = (over, options) => writesFor(oneIngredient({ weight: '', packUnit: '', ...over }), ctxOf(), options).batches[0][0].data.unit;
  assert.equal(unitOf({ priceUnit: 'kg' }), 'kg');
  assert.equal(unitOf({ priceUnit: 'l' }), 'l');
  assert.equal(unitOf({ priceUnit: 'pcs', unitWeightKg: 0.06 }), 'pz');
  assert.equal(unitOf({ priceUnit: 'pcs', unitWeightKg: 0.06 }, { language: 'en' }), 'pcs');
  assert.equal(unitOf({ priceUnit: 'kg', weight: '25 kg' }), '', 'a readable weight needs no word');
});

test('a Cartone is stored the way the card writes one: packCount, the inner word and the carton word', () => {
  const data = writesFor(oneIngredient({ weight: '2.5 kg', packUnit: 'busta', packCount: 4 })).batches[0][0].data;
  assert.equal(data.packCount, 4);
  assert.equal(data.packUnit, 'busta');
  assert.equal(data.unit, 'cartone');
  assert.equal(data.weight, '2.5 kg');
  const en = writesFor(oneIngredient({ weight: '2.5 kg', packUnit: 'bag', packCount: 4 }), ctxOf(), { language: 'en' }).batches[0][0].data;
  assert.equal(en.unit, 'case');
});

test('a Cartone with no word for what is inside gets the venue\'s default one, like the card', () => {
  const it = writesFor(oneIngredient({ packUnit: '', packCount: 6 })).batches[0][0].data;
  assert.equal(it.packUnit, 'busta');
  const en = writesFor(oneIngredient({ packUnit: '', packCount: 6 }), ctxOf(), { language: 'en' }).batches[0][0].data;
  assert.equal(en.packUnit, 'bag');
});

test('the file\'s own brand and category are kept', () => {
  const data = writesFor(oneIngredient({ brand: 'Esempio', category: 'Flour' })).batches[0][0].data;
  assert.equal(data.brand, 'Esempio');
  assert.equal(data.category, 'Flour');
});

test('a new ingredient carries every retired price key as null, and nothing about allergens or nutrition', () => {
  const data = writesFor(oneIngredient()).batches[0][0].data;
  for (const key of INGREDIENT_DRAINED_FIELDS) {
    assert.ok(key in data, `${key} must be written as null, like splitPriceFields does`);
    assert.equal(data[key], null);
  }
  for (const forbidden of ['allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients']) {
    assert.equal(forbidden in data, false, `${forbidden} must never be written by an import`);
  }
  assert.equal('vatRate' in data, false);
  for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) assert.equal(key in data, false, key);
});

test('no op of any kind ever names an allergen or nutrition key', () => {
  const file = oneIngredient({ prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })] });
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] });
  for (const c of [ctxOf(), ctx]) {
    for (const op of flat(writesFor(file, c).batches)) {
      for (const key of Object.keys(op.data)) assert.ok(!/allerg|nutrition|mayContain|packIngredients/i.test(key), key);
    }
  }
});

test('the current price carries the rate, the unit, the VAT, the date — and clears any stale case', () => {
  const { batches } = writesFor(oneIngredient({ vatRate: 4 }));
  const set = flat(batches).find(o => o.type === 'set-current-price');
  assert.deepEqual(set.data, {
    priceUnit: 'kg', pricePerUnit: 0.57,
    casePrice: null, caseCount: null, caseItemSize: null, caseItemUnit: null,
    packPrice: null, packSize: null, unitWeightKg: null,
    priceUpdatedAt: '2026-08-31T12:00:00.000Z', vatRate: 4,
  });
});

test('an unstated VAT rate is written null, never 0', () => {
  const set = flat(writesFor(oneIngredient({ vatRate: null })).batches).find(o => o.type === 'set-current-price');
  assert.equal(set.data.vatRate, null);
});

test('a per-piece price keeps the piece weight on the price and on each point', () => {
  const file = oneIngredient({ priceUnit: 'pcs', unitWeightKg: 0.06, weight: '', packUnit: '', prices: [price({ pricePerUnit: 0.25 })] });
  const ops = flat(writesFor(file).batches);
  assert.equal(ops.find(o => o.type === 'set-current-price').data.unitWeightKg, 0.06);
  const point = ops.find(o => o.type === 'add-price-point');
  assert.equal(point.data.unitWeightKg, 0.06);
  assert.equal(point.data.priceUnit, 'pcs');
});

test('a per-kilo point has no unitWeightKg key at all, and no invoiceQty key without a quantity', () => {
  const file = oneIngredient({ prices: [price({ qty: null })] });
  const point = flat(writesFor(file).batches).find(o => o.type === 'add-price-point');
  assert.equal('unitWeightKg' in point.data, false);
  assert.equal('invoiceQty' in point.data, false);
});

test('a point is exactly what the history rule describes', () => {
  const point = flat(writesFor(oneIngredient()).batches).find(o => o.type === 'add-price-point');
  assert.deepEqual(point.data, {
    recordedAt: '2026-08-31T12:00:00.000Z', priceUnit: 'kg', pricePerUnit: 0.57,
    supplierId: SUPPLIER_ID, source: 'invoice', invoiceId: '18000000001', invoiceDate: '2026-08-31', invoiceQty: 25,
    packLabel: 'Farina tipo 00 25 kg',
  });
  assert.equal(point.pointId, 'inv-18000000001-5');
  assert.match(point.pointId, new RegExp(`^inv-${point.data.invoiceId}-[0-9]{1,6}$`));
});

test('an existing ingredient: price and points, no create; the code only when it had none', () => {
  const ctx = (extra) => ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00', ...extra })] });
  const withPatch = flat(writesFor(oneIngredient(), ctx()).batches);
  assert.deepEqual(withPatch.map(o => o.type), ['patch-ingredient', 'set-current-price', 'add-price-point']);
  assert.deepEqual(withPatch[0], { type: 'patch-ingredient', ingredientId: 'i1', data: { supplierCode: 'F00-25' } });
  assert.deepEqual(withPatch.map(o => o.ingredientId), ['i1', 'i1', 'i1']);
  const without = flat(writesFor(oneIngredient(), ctx({ supplierCode: 'F00-25' })).batches);
  assert.deepEqual(without.map(o => o.type), ['set-current-price', 'add-price-point']);
});

test('an existing ingredient\'s name, brand, category, weight and supplier are never in a write', () => {
  const file = oneIngredient({ brand: 'Other brand', category: 'Other category', weight: '1 kg', packCount: 4 });
  const ops = flat(writesFor(file, ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] })).batches);
  for (const op of ops.filter(o => o.type === 'patch-ingredient')) assert.deepEqual(Object.keys(op.data), ['supplierCode']);
  assert.equal(ops.some(o => o.type === 'create-ingredient'), false);
});

test('an older invoice is history only: points, and no current price', () => {
  const ctx = ctxOf({
    ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00', supplierCode: 'F00-25' })],
    pricesById: priceDoc('2026-09-20T10:00:00.000Z'),
  });
  const { row, batches } = writesFor(oneIngredient(), ctx);
  assert.equal(row.status, 'history-only');
  assert.deepEqual(flat(batches).map(o => o.type), ['add-price-point']);
});

test('the second import writes nothing: every point already there → unchanged → no batch', () => {
  const file = oneIngredient({ prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })] });
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00', supplierCode: 'F00-25' })] });
  const first = writesFor(file, ctx);
  assert.equal(first.row.status, 'update-price');
  const recorded = flat(first.batches).filter(o => o.type === 'add-price-point').map(o => o.pointId);
  const again = writesFor(file, { ...ctx, invoicePointIds: knownIds('i1', ...recorded) });
  assert.equal(again.row.status, 'unchanged');
  assert.deepEqual(again.batches, []);
});

test('a row that is not new / update-price / history-only writes nothing', () => {
  const file = oneIngredient();
  const row = planOne(file, ctxOf());
  for (const status of ['unchanged', 'maybe-duplicate', 'choose', 'skipped', 'error']) {
    assert.deepEqual(ingredientWrites({ ...row, status }, file, ''), [], status);
  }
  assert.deepEqual(ingredientWrites(null, file, ''), []);
});

test('batches never hold more than five operations, and keep the order', () => {
  const prices = Array.from({ length: 14 }, (_, i) => price({ invoiceId: String(18000000100 + i), line: i + 1, invoiceDate: `2026-08-${String(10 + i).padStart(2, '0')}` }));
  const file = oneIngredient({ prices });
  const { batches } = writesFor(file);
  assert.ok(batches.length > 1);
  for (const b of batches) assert.ok(b.length >= 1 && b.length <= MAX_DOCS_PER_BATCH);
  const ops = flat(batches);
  assert.equal(ops.length, 16, 'create + current price + 14 points');
  assert.deepEqual(ops.slice(0, 2).map(o => o.type), ['create-ingredient', 'set-current-price']);
  assert.deepEqual(ops.slice(2).map(o => o.pointId), prices.map(p => `inv-${p.invoiceId}-${p.line}`));
  assert.equal(batches[0][0].type, 'create-ingredient');
});

test('every key of every op is one the matching rule accepts', () => {
  const file = oneIngredient({
    brand: 'Esempio', category: 'Flour', weight: '2.5 kg', packUnit: 'busta', packCount: 4,
    prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })],
  });
  const eggs = oneIngredient({ key: 'k2', priceUnit: 'pcs', unitWeightKg: 0.06, weight: '', packUnit: '', supplierCode: '', name: 'Uova' });
  const existing = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] });
  const allowed = { 'create-ingredient': INGREDIENT_KEYS, 'patch-ingredient': INGREDIENT_KEYS, 'set-current-price': PRICE_DOC_KEYS, 'add-price-point': POINT_KEYS };
  const seen = new Set();
  for (const [f, c] of [[file, ctxOf()], [file, existing], [eggs, ctxOf()]]) {
    for (const op of flat(writesFor(f, c).batches)) {
      seen.add(op.type);
      for (const key of Object.keys(op.data)) assert.ok(allowed[op.type].includes(key), `${op.type}: the rules refuse "${key}"`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(allowed).sort());
});

test('every value the ops carry is a type the rules accept', () => {
  const file = oneIngredient({ packUnit: 'busta', packCount: 4 });
  for (const op of flat(writesFor(file).batches)) {
    if (op.type === 'create-ingredient') {
      assert.ok(Number.isInteger(op.data.packCount) && op.data.packCount >= 1 && op.data.packCount <= 10000);
      assert.ok(op.data.name.length <= 200 && op.data.weight.length <= 100 && op.data.packUnit.length <= 40 && op.data.supplierCode.length <= 60);
    }
    if (op.type === 'add-price-point') {
      assert.match(op.data.invoiceId, /^[0-9]{1,20}$/);
      assert.match(op.data.invoiceDate, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
      assert.ok(op.data.pricePerUnit > 0);
      assert.ok(['kg', 'l', 'pcs'].includes(op.data.priceUnit));
      assert.ok(op.data.recordedAt.length > 0 && op.data.recordedAt.length <= 64);
      assert.equal(typeof op.data.supplierId, 'string');
    }
    if (op.type === 'set-current-price') {
      assert.ok(op.data.pricePerUnit > 0);
      assert.ok([0, 4, 5, 10, 20, 22, null].includes(op.data.vatRate));
    }
  }
});

test('the point ids written all match the pattern the rules enforce, for any invoice the file can hold', () => {
  const file = oneIngredient({
    prices: [price({ invoiceId: '1', line: 1 }), price({ invoiceId: '9'.repeat(20), line: 999999, invoiceDate: '2026-09-01' })],
  });
  for (const op of flat(writesFor(file).batches).filter(o => o.type === 'add-price-point')) {
    assert.match(op.pointId, /^inv-[0-9]{1,20}-[0-9]{1,6}$/);
  }
});

test('no NaN or infinity anywhere in a plan or its writes', () => {
  const file = parse(rawFile({
    ingredients: [
      rawIngredient(),
      rawIngredient({ key: 'k2', priceUnit: 'pcs', unitWeightKg: 0.06, weight: '', prices: [price({ qty: NaN, pricePerUnit: 0.25 })] }),
      rawIngredient({ key: 'k3', packCount: 'many' }),
      rawIngredient({ key: 'k4', prices: [price({ pricePerUnit: Infinity })] }),
    ],
  }));
  const ctx = ctxOf();
  const rows = planIngredients(file.ingredients, ctx);
  assertNoNaN(rows, 'rows');
  file.ingredients.forEach((f, i) => assertNoNaN(ingredientWrites(rows[i], f, ''), `writes[${i}]`));
});

// ── summarize ───────────────────────────────────────────────────────────────────
test('summarize counts the rows per status, every ingredient status present', () => {
  const rows = [{ status: 'new' }, { status: 'new' }, { status: 'error' }, { status: 'unchanged' }, { status: 'history-only' }];
  assert.deepEqual(summarize(rows), {
    new: 2, 'update-price': 0, 'history-only': 1, unchanged: 1, 'maybe-duplicate': 0, choose: 0, skipped: 0, error: 1,
  });
  assert.equal(summarize([]).new, 0);
  assert.equal(summarize(undefined).error, 0);
  assert.equal(summarize([{ status: 'present' }]).present, 1, 'supplier plans can be counted too');
});

// ── The module is pure ──────────────────────────────────────────────────────────
test('the model imports no Firebase, no DOM and nothing from another feature\'s folder', () => {
  const source = readFileSync(new URL('../js/orders/invoice-import-model.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]);
  assert.ok(imports.length >= 4);
  for (const spec of imports) {
    // The reason codes of the zip reader (a pure constants file of this same feature) are the one sibling allowed.
    if (spec === './invoice-zip/reasons.js') continue;
    assert.ok(spec.startsWith('../') && !spec.slice(3).includes('/'), `${spec}: only js/ root modules`);
    assert.ok(!/firebase|dom\.js|firebase-/.test(spec), spec);
  }
  assert.ok(!/\bdocument\.|\bwindow\./.test(source));
});

// ── Review fixes: VAT canonical form, article codes, units, remembered answers ──

test('normalizeVat: a number typed without its country prefix is an Italian one; foreign prefixes are left alone', () => {
  assert.equal(normalizeVat('01234567890'), 'IT01234567890');
  assert.equal(normalizeVat(' 012.345.678.90 '), 'IT01234567890');
  assert.equal(normalizeVat('it 012 345 678 90'), 'IT01234567890');
  assert.equal(normalizeVat('IT01234567890'), 'IT01234567890');
  assert.equal(normalizeVat('DE123456789'), 'DE123456789', 'a foreign prefix is never touched');
  assert.equal(normalizeVat('fr12345678901'), 'FR12345678901', 'eleven digits WITH country letters are not prefixed again');
  assert.equal(normalizeVat('ATU12345678'), 'ATU12345678');
  assert.equal(normalizeVat('123456789'), '123456789', 'a short number is not guessed at');
  assert.equal(normalizeVat('0123456789012'), '0123456789012', 'nor a long one');
  assert.equal(normalizeVat('NOVAT:0123456789ab'), '', 'a NOVAT key is still «none»');
});

test('⚠️ a VAT typed on the supplier card WITHOUT «IT» is the supplier the file names', () => {
  const file = fileSupplier();   // IT00000000001
  const typedBare = { id: 'a', name: 'Mulino Esempio', vatNumber: '00000000001' };
  const plan = planSuppliers([file], [typedBare]);
  assert.equal(plan[0].status, 'present');
  assert.equal(plan[0].supplierId, 'a');
  const bareInFile = parse(rawFile({ suppliers: [{ key: '00000000001', vatNumber: '00000000001', name: 'FORNITORE ESEMPIO SRL' }] })).suppliers[0];
  assert.equal(bareInFile.vatNumber, 'IT00000000001', 'the file is read into the same form');
  assert.equal(planSuppliers([bareInFile], [{ id: 'b', name: 'X', vatNumber: 'it 000 000 000 01' }])[0].supplierId, 'b');
  const foreign = planSuppliers([fileSupplier({ vatNumber: 'DE123456789', key: 'DE123456789' })], [{ id: 'c', name: 'Y', vatNumber: 'de123456789' }]);
  assert.equal(foreign[0].status, 'present');
});

test('⚠️ the same name under ANOTHER article code is a question, never a silent match', () => {
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'i25', name: 'Farina 00', supplierCode: 'CODE-A' })] });
  const sameCode = planOne(oneIngredient({ name: 'Farina 00', supplierCode: 'CODE-A' }), ctx);
  assert.equal(sameCode.status, 'update-price');
  assert.equal(sameCode.ingredientId, 'i25');
  const otherCode = planOne(oneIngredient({ key: 'k5', name: 'Farina 00', supplierCode: 'CODE-B' }), ctx);
  assert.equal(otherCode.status, 'maybe-duplicate');
  assert.equal(otherCode.reason, 'code-differs');
  assert.deepEqual(otherCode.candidates, [{ id: 'i25', label: 'Farina 00' }]);
  assert.equal(otherCode.ingredientId, undefined);
  assert.deepEqual(ingredientWrites(otherCode, oneIngredient({ supplierCode: 'CODE-B' }), ''), [], 'it writes nothing until answered');
  // An existing ingredient WITHOUT a code, and a row WITHOUT a code, are still plain name matches.
  const noCodeStored = planOne(oneIngredient({ name: 'Farina 00', supplierCode: 'CODE-B' }), ctxOf({ ingredients: [existingIng({ id: 'i0', name: 'Farina 00', supplierCode: '' })] }));
  assert.equal(noCodeStored.status, 'update-price');
  assert.equal(noCodeStored.patchSupplierCode, 'CODE-B');
  const noCodeFile = planOne(oneIngredient({ name: 'Farina 00', supplierCode: '' }), ctx);
  assert.equal(noCodeFile.status, 'update-price');
});

test('a current price kept in ANOTHER unit is never replaced: the new prices go to the history only', () => {
  const perPiece = new Map([['i1', { priceUnit: 'pcs', pricePerUnit: 0.2, unitWeightKg: 0.05, priceUpdatedAt: '2026-01-01T12:00:00.000Z', vatRate: 4 }]]);
  const file = oneIngredient({ supplierCode: '', prices: [price({ invoiceDate: '2026-08-31' })] });   // per kg, and newer
  const row = planOne(file, ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: perPiece }));
  assert.equal(row.status, 'history-only');
  assert.equal(row.reason, 'unit-differs');
  assert.equal(row.updateCurrent, false);
  assert.equal(row.newPoints.length, 1);
  const ops = flat(ingredientWrites(row, file, ''));
  assert.deepEqual(ops.map(o => o.type), ['add-price-point'], 'no set-current-price');
  // The same unit still updates.
  const sameUnit = new Map([['i1', { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: '2026-01-01T12:00:00.000Z' }]]);
  const updated = planOne(file, ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: sameUnit }));
  assert.equal(updated.status, 'update-price');
  assert.equal(updated.reason, undefined);
});

test('a rate the file does not state keeps the one stored; one it does state replaces it', () => {
  const stored = new Map([['i1', { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: '2026-01-01T12:00:00.000Z', vatRate: 10 }]]);
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: stored });
  const unstated = oneIngredient({ supplierCode: '', vatRate: null });
  const row = planOne(unstated, ctx);
  const set = flat(ingredientWrites(row, unstated, '')).find(o => o.type === 'set-current-price');
  assert.equal(set.data.vatRate, 10, 'the stated rate is not overwritten with «not stated»');
  const stated = oneIngredient({ supplierCode: '', vatRate: 4 });
  const set4 = flat(ingredientWrites(planOne(stated, ctx), stated, '')).find(o => o.type === 'set-current-price');
  assert.equal(set4.data.vatRate, 4);
  // Nothing stored and nothing in the file: still «not stated», never 0.
  const bare = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] });
  const none = flat(ingredientWrites(planOne(unstated, bare), unstated, '')).find(o => o.type === 'set-current-price');
  assert.equal(none.data.vatRate, null);
});

test('⚠️ a decision is remembered by the prices it left behind: one holder of the row\'s points is the answer', () => {
  const base = [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'zz', name: 'Zucchero' })];
  const file = oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' });
  const asked = planOne(file, ctxOf({ ingredients: base }));
  assert.equal(asked.status, 'maybe-duplicate', 'with nothing recorded it is a question');
  const remembered = planOne(file, ctxOf({ ingredients: base, invoicePointIds: knownIds('far', 'inv-18000000001-5') }));
  assert.equal(remembered.status, 'unchanged');
  assert.equal(remembered.ingredientId, 'far');
  assert.equal(remembered.candidates, undefined);
  // The same for a new price of an ingredient that already holds an OLDER point of this row.
  const newer = oneIngredient({ supplierCode: '', name: 'Farina di grano tenero', prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })] });
  const next = planOne(newer, ctxOf({ ingredients: base, invoicePointIds: knownIds('far', 'inv-18000000001-5') }));
  assert.equal(next.status, 'update-price');
  assert.equal(next.ingredientId, 'far');
  assert.deepEqual(next.newPoints.map(p => p.id), ['inv-18000000002-1']);
  // Two holders cannot say which one it was: still a question.
  const two = planOne(file, ctxOf({
    ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'far2', name: 'Farina grano' })],
    invoicePointIds: new Map([['far', new Set(['inv-18000000001-5'])], ['far2', new Set(['inv-18000000001-5'])]]),
  }));
  assert.equal(two.status, 'maybe-duplicate');
  // A point held by something that is not a candidate of this row decides nothing.
  const elsewhere = planOne(file, ctxOf({ ingredients: base, invoicePointIds: knownIds('zz', 'inv-18000000001-5') }));
  assert.equal(elsewhere.status, 'maybe-duplicate');
});

test('an «unisci con» row that points at nobody is remembered the same way', () => {
  const ctx = ctxOf({
    ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'zz', name: 'Zucchero' })],
    invoicePointIds: knownIds('far', 'inv-18000000001-5'),
  });
  const row = planOne(oneIngredient({ mergeWith: 'Nowhere' }), ctx);
  assert.equal(row.status, 'unchanged');
  assert.equal(row.ingredientId, 'far');
});

// ── An ingredient the invoices state no trustworthy price for (priceCheck) ──────
test('prices: [] is valid ONLY together with a priceCheck code', () => {
  const withCode = oneIngredient({ prices: [], priceCheck: 'price-out-of-scale' });
  assert.equal(withCode.invalid, undefined);
  assert.equal(withCode.priceCheck, 'price-out-of-scale');
  assert.deepEqual(withCode.prices, []);

  assert.equal(oneIngredient({ prices: [] }).invalid, 'no-prices', 'a file from the script never has empty prices');
  assert.equal(oneIngredient({ prices: [], priceCheck: '' }).invalid, 'no-prices');
  assert.equal(oneIngredient({ prices: [], priceCheck: 'not-a-code' }).invalid, 'no-prices');
  assert.equal(oneIngredient({ prices: [], priceCheck: 42 }).invalid, 'no-prices');
  assert.equal('priceCheck' in oneIngredient(), false, 'an ordinary entry carries none');
  // a code beside real prices is meaningless and dropped
  assert.equal('priceCheck' in oneIngredient({ priceCheck: 'price-out-of-scale' }), false);
});

test('every reason a price is «da verificare» is an accepted priceCheck code', async () => {
  const { NOTE, LEFT_OUT } = await import('../js/orders/invoice-zip/reasons.js');
  const { PRICE_CHECK_CODES } = await import('../js/orders/invoice-import-model.js');
  assert.ok(PRICE_CHECK_CODES.includes(NOTE.PRICE_OUT_OF_SCALE));
  assert.ok(PRICE_CHECK_CODES.includes(NOTE.UNATTRIBUTED_DISCOUNT));
  assert.ok(PRICE_CHECK_CODES.includes(LEFT_OUT.NEEDS_CHECKING));
  assert.ok(!PRICE_CHECK_CODES.includes(NOTE.BY_WEIGHT), 'a note that is not a doubt is not a code');
});

test('a NEW priceCheck row creates the ingredient with no price document and no points', () => {
  const file = oneIngredient({ prices: [], priceCheck: 'price-out-of-scale' });
  const row = planOne(file, ctxOf());
  assert.equal(row.status, 'new');
  assert.equal(row.priceCheck, 'price-out-of-scale');
  assert.deepEqual(row.newPoints, []);
  const ops = flat(ingredientWrites(row, file, '2026-10-05T10:00:00.000Z', { language: 'it' }));
  assert.deepEqual(ops.map(o => o.type), ['create-ingredient']);
  assert.equal(ops[0].data.name, 'Farina tipo 00');
  assert.equal(ops[0].data.supplierId, SUPPLIER_ID);
  assertNoNaN(ops);
  for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients']) assert.ok(!(key in ops[0].data));
});

test('a priceCheck row matched to an existing ingredient writes nothing', () => {
  const file = oneIngredient({ prices: [], priceCheck: 'unattributed-discount' });
  const row = planOne(file, ctxOf({ ingredients: [existingIng({ name: 'Farina tipo 00', supplierCode: 'F00-25' })] }));
  assert.equal(row.status, 'unchanged');
  assert.equal(row.ingredientId, 'ing-1');
  assert.deepEqual(ingredientWrites(row, file, '2026-10-05T10:00:00.000Z', { language: 'it' }), []);
});

test('an ordinary row with no new points still writes nothing, and a row without priceCheck is untouched by the change', () => {
  const file = oneIngredient();
  const row = planOne(file, ctxOf());
  assert.equal(row.priceCheck, '');
  assert.ok(flat(ingredientWrites(row, file, '', { language: 'it' })).some(o => o.type === 'set-current-price'));
  const known = planOne(file, ctxOf({
    ingredients: [existingIng({ name: 'Farina tipo 00', supplierCode: 'F00-25' })], invoicePointIds: new Map([['ing-1', new Set(['inv-18000000001-5'])]]),
  }));
  assert.equal(known.status, 'unchanged');
  assert.deepEqual(ingredientWrites(known, file, '', { language: 'it' }), []);
});

// ── One ingredient, several packs (5 Oct 2026) ──────────────────────────────────

test('matching by article code reads the main code AND every extra pack code, case and spaces ignored', () => {
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Lievito Pegaso', supplierCode: 'PEG', supplierCodes: [' zeus ', 'Zeus', ''] })] });
  const zeus = planOne(oneIngredient({ name: 'Qualcosa di diverso', supplierCode: 'ZEUS' }), ctx);
  assert.equal(zeus.ingredientId, 'x');
  assert.notEqual(zeus.status, 'maybe-duplicate');
  assert.equal(zeus.patchSupplierCode, null);
  assert.equal(zeus.setSupplierCodes, null, 'it already knows that code');
  const main = planOne(oneIngredient({ name: 'Altro ancora', supplierCode: 'peg' }), ctx);
  assert.equal(main.ingredientId, 'x');
});

test('a code the ingredient does not know yet is added to supplierCodes (the main code stays), and never twice', () => {
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD', supplierCodes: ['B'] })] });
  const row = planOne(oneIngredient({ supplierCode: 'NEW', mergeWith: 'Farina tipo 00' }), ctx);
  assert.equal(row.ingredientId, 'x');
  assert.equal(row.patchSupplierCode, null);
  assert.deepEqual(row.setSupplierCodes, ['B', 'NEW']);
  const ops = flat(ingredientWrites(row, oneIngredient({ supplierCode: 'NEW', mergeWith: 'Farina tipo 00' }), ''));
  assert.deepEqual(ops[0], { type: 'patch-ingredient', ingredientId: 'x', data: { supplierCodes: ['B', 'NEW'] } });
  assert.ok(INGREDIENT_KEYS.includes('supplierCodes'), 'the rules accept the key');
});

test('an ingredient with no main code takes the file code as its main code, as before', () => {
  const row = planOne(oneIngredient({ supplierCode: 'NEW' }), ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: '' })] }));
  assert.equal(row.patchSupplierCode, 'NEW');
  assert.equal(row.setSupplierCodes, null);
});

test('a full list (20 extra codes) adds nothing, says so, and the write has no code patch', () => {
  const full = Array.from({ length: MAX_SUPPLIER_CODES }, (_, i) => `C${i}`);
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD', supplierCodes: full })] });
  const file = oneIngredient({ supplierCode: 'NEW', mergeWith: 'Farina tipo 00' });
  const row = planOne(file, ctx);
  assert.equal(row.codesFull, true);
  assert.equal(row.setSupplierCodes, null);
  assert.equal(flat(ingredientWrites(row, file, '')).some(o => o.type === 'patch-ingredient'), false);
});

test('a «Same as» answer to a code-differs question teaches the ingredient the new code', () => {
  const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD' })] });
  const file = oneIngredient({ supplierCode: 'NEW' });
  const asked = planOne(file, ctx);
  assert.equal(asked.status, 'maybe-duplicate');
  const answered = resolveRow(asked, { sameAs: 'x' }, ctx);
  assert.deepEqual(answered.setSupplierCodes, ['NEW']);
});

test('an «unchanged» row (every price already in) still learns a new pack code, and writes nothing else', () => {
  const file = oneIngredient({ supplierCode: 'NEW' });
  const ctx = ctxOf({
    ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD' })],
    invoicePointIds: new Map([['x', new Set(['inv-18000000001-5'])]]),
  });
  const row = planOne(file, ctx);
  assert.equal(row.status, 'unchanged');
  assert.deepEqual(flat(ingredientWrites(row, file, '')), [{ type: 'patch-ingredient', ingredientId: 'x', data: { supplierCodes: ['NEW'] } }]);
});

test('every invoice point says which pack it paid for: the name, plus the weight unless the name has it', () => {
  assert.equal(packLabelOf({ name: 'Lievito Zeus', weight: '1 kg' }), 'Lievito Zeus 1 kg');
  assert.equal(packLabelOf({ name: 'Lievito Zeus 1kg', weight: '1 kg' }), 'Lievito Zeus 1kg');
  assert.equal(packLabelOf({ name: 'Lievito Zeus', weight: '' }), 'Lievito Zeus');
  assert.equal(packLabelOf({ name: 'x'.repeat(200), weight: '1 kg' }).length, 120);
  const points = flat(writesFor(oneIngredient({ weight: '25 kg', name: 'Farina tipo 00' })).batches).filter(o => o.type === 'add-price-point');
  assert.ok(points.length > 0);
  points.forEach(p => assert.equal(p.data.packLabel, 'Farina tipo 00 25 kg'));
  assert.ok(POINT_KEYS.includes('packLabel'), 'the rules accept the key');
});

test('extraCodesOf cleans the list: texts only, trimmed, no repeats, never the main code', () => {
  assert.deepEqual(extraCodesOf({ supplierCode: 'A', supplierCodes: ['a', ' B ', 'b', 4, '', 'C'] }), ['B', 'C']);
  assert.deepEqual(extraCodesOf({}), []);
});
