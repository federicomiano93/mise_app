// «Import from invoices» — the model that decides what would be written (P15), run against BOTH implementations:
// the TypeScript port in shared/ and js/orders/invoice-import-model.js, which the live app uses today. Ported from
// tests/invoice-import-model.test.mjs; the module is a FULL port, so parity.spec.ts also compares its exports.
// Every name, VAT number and invoice id below is INVENTED. Real invoices never go in this repository.
//
// PORTED: 115 of 115 tests of tests/invoice-import-model.test.mjs. Three of them read a file as TEXT in the original
// and still do, through Vite's `?raw` (shared/ has no `node:fs`): the lists of keys each collection's rule accepts
// (firestore.rules), the keys the supplier card saves (js/supplier-record-form.js), and 'the model imports no
// Firebase, no DOM and nothing from another feature's folder' — which reads the source of BOTH files, each against
// its own way of spelling an import (`'../pack-size.js'` in js/, `'./pack-size'` here).
//
// The js/ side of 'every reason a price is «da verificare»…' reads the reason codes of js/ itself
// (js/orders/invoice-zip/reasons.js), the port's those of invoice-zip/reasons.ts.
//
// NOT HERE: invoice-import-plan.js (the screen's plan: applyDecisions, rowToWrite, bucketOf…) is slice B1b; its tests
// are in invoice-import-names.spec.ts's header, by name.

import { describe, expect, test } from 'vitest';
import * as ported from './invoice-import-model';
import * as legacyJs from '../../js/orders/invoice-import-model.js';
import * as portedReasons from './invoice-zip/reasons';
import * as legacyReasons from '../../js/orders/invoice-zip/reasons.js';
import { INGREDIENT_DRAINED_FIELDS } from './price-model';
import rules from '../../firestore.rules?raw';
import supplierFormSource from '../../js/supplier-record-form.js?raw';
import legacyModelSource from '../../js/orders/invoice-import-model.js?raw';
import portedModelSource from './invoice-import-model.ts?raw';

const legacy = legacyJs as unknown as typeof ported;

// The first hasOnly([...]) list under `match /<path> {` — the way tests/price-fields-whitelist.test.mjs reads it.
function whitelistOf(matchPath: string): string[] {
  const start = rules.indexOf(`match ${matchPath} {`);
  expect(start, `firestore.rules has no "match ${matchPath}"`).not.toBe(-1);
  const m = rules.slice(start).match(/hasOnly\(\[([\s\S]*?)\]\)/);
  expect(m, `no hasOnly([...]) under ${matchPath}`).toBeTruthy();
  return [...(m as RegExpMatchArray)[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}
const SUPPLIER_KEYS = whitelistOf('/suppliers/{id}');
const INGREDIENT_KEYS = whitelistOf('/ingredients/{id}');
const PRICE_DOC_KEYS = whitelistOf('/ingredient-prices/{id}');
const POINT_KEYS = whitelistOf('/prices/{priceId}');

// The data these tests feed the model is deliberately loose: it is a file and a database, anything can arrive.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

// No number anywhere in a structure is NaN or infinite.
function assertNoNaN(value: unknown, path = 'value'): void {
  if (typeof value === 'number') expect(Number.isFinite(value), `${path} is ${value}`).toBeTruthy();
  else if (Array.isArray(value)) value.forEach((v, i) => assertNoNaN(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => assertNoNaN(v, `${path}.${k}`));
}

describe.each([
  ['shared/ (TypeScript)', ported, portedReasons, portedModelSource],
  ['js/ (current app)', legacy, legacyReasons as unknown as typeof portedReasons, legacyModelSource],
] as const)('%s', (name, m, reasons, modelSource) => {
  const {
    IMPORT_FORMAT, IMPORT_VERSION, MAX_DOCS_PER_BATCH,
    parseImportFile, normalizeVat, normalizeSupplierName, normalizeIngredientName,
    planSuppliers, planIngredients, summarize,
    packLabelOf, extraCodesOf, MAX_SUPPLIER_CODES,
  } = m;
  // The functions the tests call with loose rows go through `Loose` so a test can hand them any shape.
  const supplierWrites = m.supplierWrites as (plan: Loose, decisions?: Loose) => Loose;
  const resolveRow = m.resolveRow as (row: Loose, decision?: Loose, ctx?: Loose) => Loose;
  const ingredientWrites = m.ingredientWrites as (row: Loose, file: Loose, nowIso?: Loose, options?: Loose) => Loose;

  // ── Builders ────────────────────────────────────────────────────────────────────
  const price = (over: Loose = {}): Loose => ({ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, qty: 25, ...over });
  const rawIngredient = (over: Loose = {}): Loose => ({
    key: 'IT00000000001|code:F00-25', supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00',
    brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null,
    priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [price()], ...over,
  });
  const rawFile = (over: Loose = {}): Loose => ({
    format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-03T10:00:00Z',
    suppliers: [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
    ingredients: [rawIngredient()],
    ...over,
  });
  const parse = (obj: Loose): Loose => {
    const r = parseImportFile(JSON.stringify(obj));
    expect(r.ok).toBe(true);
    return (r as Loose).file;
  };
  const oneIngredient = (over?: Loose, extra?: Loose): Loose => parse(rawFile({ ingredients: [rawIngredient(over)], ...extra })).ingredients[0];

  const SUPPLIER_ID = 'sup-1';
  const ctxOf = (over: Loose = {}): Loose => ({
    supplierIdByKey: { IT00000000001: SUPPLIER_ID },
    ingredients: [],
    pricesById: new Map(),
    invoicePointIds: new Map(),
    ...over,
  });
  const existingIng = (over: Loose = {}): Loose => ({
    id: 'ing-1', name: 'Farina 00 Esempio', shortName: '', supplierId: SUPPLIER_ID, supplierCode: '', kind: 'ingredient', active: true, ...over,
  });
  const planOne = (file: Loose, ctx?: Loose): Loose => planIngredients([file], ctx)[0];
  const flat = (batches: Loose): Loose[] => batches.flat();

  // ── Constants ───────────────────────────────────────────────────────────────────
  test('the format, the version and the batch size are the agreed ones', () => {
    expect(IMPORT_FORMAT).toBe('mise-invoice-import');
    expect(IMPORT_VERSION).toBe(1);
    expect(MAX_DOCS_PER_BATCH).toBe(5);
  });

  // ── parseImportFile ─────────────────────────────────────────────────────────────
  test('a good file is read whole', () => {
    const r = parseImportFile(JSON.stringify(rawFile())) as Loose;
    expect(r.ok).toBe(true);
    expect(r.file.generatedAt).toBe('2026-10-03T10:00:00Z');
    expect(r.file.suppliers).toStrictEqual([{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }]);
    const ing = r.file.ingredients[0];
    expect(ing.invalid).toBe(undefined);
    expect(ing.prices).toStrictEqual([{ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, qty: 25 }]);
    expect(ing.vatRate).toBe(4);
    assertNoNaN(r.file);
  });

  test('whole-file refusals each have their own code', () => {
    expect(parseImportFile('{nope')).toStrictEqual({ ok: false, error: 'not-json' });
    expect(parseImportFile('')).toStrictEqual({ ok: false, error: 'not-json' });
    expect(parseImportFile(undefined)).toStrictEqual({ ok: false, error: 'not-json' });
    expect(parseImportFile('[]')).toStrictEqual({ ok: false, error: 'invalid' });
    expect(parseImportFile('null')).toStrictEqual({ ok: false, error: 'invalid' });
    expect(parseImportFile('42')).toStrictEqual({ ok: false, error: 'invalid' });
    expect(parseImportFile(JSON.stringify(rawFile({ format: 'something-else' })))).toStrictEqual({ ok: false, error: 'wrong-format' });
    expect(parseImportFile(JSON.stringify({ suppliers: [], ingredients: [] }))).toStrictEqual({ ok: false, error: 'wrong-format' });
    expect(parseImportFile(JSON.stringify(rawFile({ version: 2 })))).toStrictEqual({ ok: false, error: 'wrong-version' });
    expect(parseImportFile(JSON.stringify(rawFile({ suppliers: undefined })))).toStrictEqual({ ok: false, error: 'invalid' });
    expect(parseImportFile(JSON.stringify(rawFile({ ingredients: {} })))).toStrictEqual({ ok: false, error: 'invalid' });
  });

  test('a byte-order mark in front of the JSON does not matter', () => {
    expect(parseImportFile(`﻿${JSON.stringify(rawFile())}`).ok).toBe(true);
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
    expect(file.suppliers.map((s: Loose) => s.invalid)).toStrictEqual([
      undefined, 'name-missing', 'not-object', 'duplicate-key', 'vat-missing', 'vat-too-long',
    ]);
    expect(file.ingredients.map((i: Loose) => i.invalid)).toStrictEqual([
      undefined, 'name-missing', 'price-unit', 'unit-weight-missing', 'no-prices', 'price-invalid',
      'pack-count', 'key-missing', 'supplier-key-missing', 'not-object',
    ]);
    assertNoNaN(file);
  });

  test('a supplier whose key is NOVAT: has no VAT number, whatever vatNumber says', () => {
    const file = parse(rawFile({ suppliers: [{ key: 'NOVAT:0123456789ab', vatNumber: 'IT999', name: 'Mario Rossi' }] }));
    expect(file.suppliers[0].invalid).toBe(undefined);
    expect(file.suppliers[0].vatNumber).toBe('');
  });

  test('the VAT number is stored in the one spelling', () => {
    const file = parse(rawFile({ suppliers: [{ key: 'IT00000000001', vatNumber: ' it 000 000 000 01 ', name: 'A' }] }));
    expect(file.suppliers[0].vatNumber).toBe('IT00000000001');
  });

  test('texts are trimmed and cut to what the rules accept', () => {
    const ing = oneIngredient({
      name: `  ${'n'.repeat(300)}  `, brand: 'b'.repeat(300), category: 'c'.repeat(300),
      supplierCode: 'x'.repeat(100), weight: 'w'.repeat(200), packUnit: 'p'.repeat(90),
    });
    expect(ing.name.length).toBe(200);
    expect(ing.brand.length).toBe(200);
    expect(ing.category.length).toBe(200);
    expect(ing.supplierCode.length).toBe(60);
    expect(ing.weight.length).toBe(100);
    expect(ing.packUnit.length).toBe(40);
    expect(oneIngredient({ name: '  Sale  ' }).name).toBe('Sale');
  });

  test('packCount is a whole number from 1 to 10000, or null', () => {
    expect(oneIngredient({ packCount: 4 }).packCount).toBe(4);
    expect(oneIngredient({ packCount: 10000 }).packCount).toBe(10000);
    expect(oneIngredient({ packCount: null }).packCount).toBe(null);
    expect(oneIngredient({ packCount: undefined }).invalid).toBe(undefined);
    for (const bad of [0, -1, 2.5, 10001, '4', true]) {
      expect(oneIngredient({ packCount: bad }).invalid, String(bad)).toBe('pack-count');
    }
  });

  test('priceUnit is kg, l or pcs; pcs needs a piece weight, the others never carry one', () => {
    for (const unit of ['kg', 'l']) expect(oneIngredient({ priceUnit: unit }).priceUnit).toBe(unit);
    expect(oneIngredient({ priceUnit: 'kg', unitWeightKg: 0.06 }).unitWeightKg).toBe(null);
    const eggs = oneIngredient({ priceUnit: 'pcs', unitWeightKg: 0.06 });
    expect(eggs.invalid).toBe(undefined);
    expect(eggs.unitWeightKg).toBe(0.06);
    for (const bad of [0, -0.1, NaN, '0.06', null]) {
      expect(oneIngredient({ priceUnit: 'pcs', unitWeightKg: bad }).invalid, String(bad)).toBe('unit-weight-missing');
    }
  });

  test('the VAT rate is one of 0 4 5 10 20 22, else not stated — never 0', () => {
    for (const rate of [0, 4, 5, 10, 20, 22]) expect(oneIngredient({ vatRate: rate }).vatRate).toBe(rate);
    for (const bad of [null, undefined, '', 7, 21, -4, 'abc', NaN, 4.5]) {
      expect(oneIngredient({ vatRate: bad }).vatRate, String(bad)).toBe(null);
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
      expect(oneIngredient({ prices: [price(over)] }).invalid, JSON.stringify(over)).toBe('price-invalid');
    }
    expect(oneIngredient({ prices: [price({ invoiceId: '1'.repeat(20), line: 999999, invoiceDate: '2024-02-29' })] }).invalid).toBe(undefined);
  });

  test('qty is a positive number or null — a bad one is dropped, not a reason to refuse the price', () => {
    for (const q of [0, -3, NaN, '25', undefined, null]) {
      const ing = oneIngredient({ prices: [price({ qty: q })] });
      expect(ing.invalid, String(q)).toBe(undefined);
      expect(ing.prices[0].qty, String(q)).toBe(null);
    }
    expect(oneIngredient({ prices: [price({ qty: 12.5 })] }).prices[0].qty).toBe(12.5);
  });

  test('the rate is rounded the way the card rounds a typed one', () => {
    expect(oneIngredient({ prices: [price({ pricePerUnit: 1.234567 })] }).prices[0].pricePerUnit).toBe(1.2346);
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
    expect(ing.prices.map((p: Loose) => `${p.invoiceId}-${p.line}`)).toStrictEqual(['18000000001-5', '18000000002-1', '18000000003-2']);
    expect(ing.prices[0].pricePerUnit, 'the first of the duplicates wins').toBe(0.57);
  });

  test('two entries with one key: the second is refused, the decisions are keyed by it', () => {
    const file = parse(rawFile({ ingredients: [rawIngredient(), rawIngredient({ name: 'Other' })] }));
    expect(file.ingredients[1].invalid).toBe('duplicate-key');
  });

  test('a key that would reach the prototype is refused', () => {
    const file = parse(rawFile({ ingredients: [rawIngredient({ key: '__proto__' })] }));
    expect(file.ingredients[0].invalid).toBe('key-missing');
  });

  // ── Normalisers ─────────────────────────────────────────────────────────────────
  test('normalizeVat: upper case, no whitespace at all, empty stays empty, NOVAT keys mean none', () => {
    expect(normalizeVat('it 01234567890')).toBe('IT01234567890');
    expect(normalizeVat(' IT0123\t4567\n890 ')).toBe('IT01234567890');
    expect(normalizeVat('')).toBe('');
    expect(normalizeVat(null)).toBe('');
    expect(normalizeVat(undefined)).toBe('');
    expect(normalizeVat(12)).toBe('');
    expect(normalizeVat('NOVAT:0123456789ab')).toBe('');
    expect(normalizeVat(' novat:abc')).toBe('');
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
    ] as const;
    for (const [a, b] of same) expect(normalizeSupplierName(a), `${a} / ${b}`).toBe(normalizeSupplierName(b));
  });

  test('«di» is only dropped right after sas / snc', () => {
    expect(normalizeSupplierName('Forno di Paese')).toBe('forno di paese');
    expect(normalizeSupplierName('Rossi sas di Rossi')).toBe('rossi rossi');
  });

  test('a name made only of a legal form does not collapse to nothing', () => {
    expect(normalizeSupplierName('S.r.l.')).toBe('s r l');
    expect(normalizeSupplierName('')).toBe('');
    expect(normalizeSupplierName(null)).toBe('');
  });

  test('normalizeIngredientName: accents, case and punctuation only', () => {
    expect(normalizeIngredientName('  Crème  Fraîche, 35% ')).toBe('creme fraiche 35');
    expect(normalizeIngredientName('Farina tipo "00"')).toBe('farina tipo 00');
    expect(normalizeIngredientName(undefined)).toBe('');
    expect(normalizeIngredientName('Farina srl'), 'legal forms are for suppliers only').not.toBe(normalizeIngredientName('Farina'));
  });

  // ── planSuppliers ───────────────────────────────────────────────────────────────
  const fileSupplier = (over: Loose = {}): Loose => ({ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL', ...over });
  const existingSupplier = (over: Loose = {}): Loose => ({ id: 's1', name: 'Fornitore Esempio', shortName: '', vatNumber: '', ...over });
  const planSup = planSuppliers as (file: Loose, existing?: Loose) => Loose;

  test('the same VAT number in two spellings is the same supplier', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ id: 'x', name: 'Whatever', vatNumber: 'it 000 000 000 01' })]);
    expect(plan).toStrictEqual([{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL', status: 'present', supplierId: 'x' }]);
  });

  test('a VAT match wins even when the names have nothing in common', () => {
    const plan = planSup([fileSupplier()], [
      existingSupplier({ id: 'a', name: 'Fornitore Esempio' }),
      existingSupplier({ id: 'b', name: 'Totally Different', vatNumber: 'IT00000000001' }),
    ]);
    expect(plan[0].status).toBe('present');
    expect(plan[0].supplierId).toBe('b');
  });

  test('a similar name with a DIFFERENT VAT number is never a candidate', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ id: 'a', name: 'Fornitore Esempio', vatNumber: 'IT00000000099' })]);
    expect(plan[0].status).toBe('new');
    expect(plan[0].candidates).toBe(undefined);
  });

  test('two people with one surname and different VAT numbers are two suppliers', () => {
    const plan = planSup(
      [fileSupplier({ key: 'IT00000000002', vatNumber: 'IT00000000002', name: 'ROSSI MARIO' })],
      [existingSupplier({ id: 'a', name: 'Rossi Mario', vatNumber: 'IT00000000003' })],
    );
    expect(plan[0].status).toBe('new');
  });

  test('no VAT match and a similar supplier without a VAT number → maybe, with the candidate', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ id: 'a', name: 'Fornitore Esempio', shortName: 'Esempio' })]);
    expect(plan[0].status).toBe('maybe');
    expect(plan[0].candidates, 'the label is what the app shows').toStrictEqual([{ id: 'a', label: 'Esempio' }]);
  });

  test('the short name is compared too', () => {
    const plan = planSup([fileSupplier({ name: 'Mulino Esempio S.r.l.' })], [existingSupplier({ id: 'a', name: 'Ditta 12', shortName: 'Mulino Esempio' })]);
    expect(plan[0].status).toBe('maybe');
  });

  test('similarity: one name holds all the other\'s words, or half of the words are shared', () => {
    const file = fileSupplier({ name: 'Mulino Esempio Molino Grande Srl' });
    const names = {
      contained: 'Mulino Esempio', // all of its words are in the file name
      container: 'Mulino Esempio Molino Grande Italia SpA', // holds all the file name's words
      half: 'Molino Grande Altro Mulino', // 3 of 5 shared words
      unrelated: 'Caseificio Rossi',
      onlyShort: 'Zz Mulino', // "zz" is under 3 letters: its only long word is in the file name
    };
    const suppliers = Object.entries(names).map(([id, nm]) => existingSupplier({ id, name: nm }));
    const plan = planSup([file], suppliers)[0];
    const ids = plan.candidates.map((c: Loose) => c.id);
    expect(ids.includes('contained')).toBeTruthy();
    expect(ids.includes('container')).toBeTruthy();
    expect(ids.includes('half')).toBeTruthy();
    expect(ids.includes('onlyShort')).toBeTruthy();
    expect(!ids.includes('unrelated')).toBeTruthy();
  });

  test('an exact name (after normalising) is the first candidate', () => {
    const plan = planSup([fileSupplier({ name: 'Mulino Esempio S.r.l.' })], [
      existingSupplier({ id: 'loose', name: 'Mulino Esempio Italia Alimentare' }),
      existingSupplier({ id: 'exact', name: 'MULINO ESEMPIO' }),
    ]);
    expect(plan[0].candidates.map((c: Loose) => c.id)).toStrictEqual(['exact', 'loose']);
  });

  test('nothing alike → new', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ name: 'Caseificio Rossi' })]);
    expect(plan[0].status).toBe('new');
    expect(planSup([fileSupplier()], [])[0].status).toBe('new');
    expect(planSup([fileSupplier()], null)[0].status).toBe('new');
  });

  test('two existing suppliers with the same VAT number → maybe, both are candidates', () => {
    const plan = planSup([fileSupplier()], [
      existingSupplier({ id: 'b', name: 'Beta', vatNumber: 'IT00000000001' }),
      existingSupplier({ id: 'a', name: 'Alfa', vatNumber: 'IT 00000000001' }),
    ]);
    expect(plan[0].status).toBe('maybe');
    expect(plan[0].reason).toBe('duplicate-vat');
    expect(plan[0].candidates.map((c: Loose) => c.id).sort()).toStrictEqual(['a', 'b']);
  });

  test('a supplier without a VAT number is matched by name only', () => {
    const file = fileSupplier({ key: 'NOVAT:0123456789ab', vatNumber: '', name: 'Mario Rossi' });
    const plan = planSup([file], [
      existingSupplier({ id: 'a', name: 'Rossi Mario' }),
      existingSupplier({ id: 'b', name: 'Mario Rossi', vatNumber: 'IT00000000007' }),
    ]);
    expect(plan[0].status).toBe('maybe');
    expect(plan[0].candidates.map((c: Loose) => c.id)).toStrictEqual(['a']);
  });

  test('an invalid supplier entry is an error row with its reason', () => {
    const bad = parse(rawFile({ suppliers: [{ key: 'IT1', vatNumber: 'IT1', name: '' }] })).suppliers[0];
    const plan = planSup([bad], []);
    expect(plan[0].status).toBe('error');
    expect(plan[0].reason).toBe('name-missing');
  });

  // ── supplierWrites ──────────────────────────────────────────────────────────────

  // What the new-supplier form builds, read out of its source: the form needs a DOM, the payload does not.
  function formPayloadKeys(): string[] {
    const block = supplierFormSource.match(/const payload = \{([\s\S]*?)\n {4}\};/);
    expect(block, 'the form no longer builds `const payload = {…}` the way this test reads it').toBeTruthy();
    return [...(block as RegExpMatchArray)[1]!.matchAll(/^\s{6}(\w+):/gm)].map((x) => x[1] as string);
  }

  test('a created supplier has exactly what the form saves for a new one, VAT number included', () => {
    const plan = planSup([fileSupplier()], []);
    const { ops } = supplierWrites(plan, {});
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe('create-supplier');
    expect(ops[0].key).toBe('IT00000000001');
    const formKeys = formPayloadKeys();
    expect(formKeys.length >= 8, 'the key list was read').toBeTruthy();
    expect(Object.keys(ops[0].data).sort()).toStrictEqual([...formKeys].sort());
    expect(formKeys.includes('vatNumber'), 'the supplier form saves the VAT number the import writes').toBeTruthy();
    expect(ops[0].data).toStrictEqual({
      name: 'FORNITORE ESEMPIO SRL', shortName: '', category: '', phone: '', email: '',
      deliveryDays: [], orderDays: [], active: true, vatNumber: 'IT00000000001',
    });
    for (const key of Object.keys(ops[0].data)) expect(SUPPLIER_KEYS.includes(key), `the suppliers rule refuses "${key}"`).toBeTruthy();
  });

  test('a supplier without a VAT number is created with an empty one', () => {
    const plan = planSup([fileSupplier({ key: 'NOVAT:0123456789ab', vatNumber: '', name: 'Mario Rossi' })], []);
    const { ops } = supplierWrites(plan, {});
    expect(ops[0].data.vatNumber).toBe('');
  });

  test('a present supplier is a mapping and no write', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ id: 'x', vatNumber: 'IT00000000001' })]);
    const out = supplierWrites(plan, {});
    expect(out).toStrictEqual({ ops: [], supplierIdByKey: { IT00000000001: 'x' }, blocked: [] });
  });

  test('a maybe with no decision blocks; linking writes the VAT number and nothing else', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ id: 'a', name: 'Fornitore Esempio' })]);
    expect(supplierWrites(plan, {})).toStrictEqual({ ops: [], supplierIdByKey: {}, blocked: ['IT00000000001'] });
    const linked = supplierWrites(plan, { IT00000000001: { linkTo: 'a' } });
    expect(linked.ops).toStrictEqual([{ type: 'link-supplier', key: 'IT00000000001', supplierId: 'a', data: { vatNumber: 'IT00000000001' } }]);
    expect(linked.supplierIdByKey).toStrictEqual({ IT00000000001: 'a' });
    expect(linked.blocked).toStrictEqual([]);
  });

  test('linking to somebody who is not a candidate still blocks', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ id: 'a' })]);
    expect(supplierWrites(plan, { IT00000000001: { linkTo: 'someone-else' } }).blocked).toStrictEqual(['IT00000000001']);
  });

  test('a maybe can be created as new, or skipped', () => {
    const plan = planSup([fileSupplier()], [existingSupplier({ id: 'a' })]);
    const created = supplierWrites(plan, { IT00000000001: { createNew: true } });
    expect(created.ops[0].type).toBe('create-supplier');
    expect(created.blocked).toStrictEqual([]);
    const skipped = supplierWrites(plan, { IT00000000001: { skip: true } });
    expect(skipped).toStrictEqual({ ops: [], supplierIdByKey: {}, blocked: [] });
  });

  test('a new supplier is created without a decision and skipped on request; an error row does nothing', () => {
    const bad = parse(rawFile({ suppliers: [{ key: 'IT9', vatNumber: 'IT9', name: '' }] })).suppliers[0];
    const plan = planSup([fileSupplier(), bad], []);
    expect(supplierWrites(plan, {}).ops.length).toBe(1);
    expect(supplierWrites(plan, { IT00000000001: { skip: true } }).ops).toStrictEqual([]);
    expect(supplierWrites(plan, {}).blocked).toStrictEqual([]);
  });

  test('linking a supplier without a VAT number writes nothing, only remembers who it is', () => {
    const file = fileSupplier({ key: 'NOVAT:0123456789ab', vatNumber: '', name: 'Mario Rossi' });
    const plan = planSup([file], [existingSupplier({ id: 'a', name: 'Rossi Mario' })]);
    const out = supplierWrites(plan, { 'NOVAT:0123456789ab': { linkTo: 'a' } });
    expect(out.ops).toStrictEqual([]);
    expect(out.supplierIdByKey).toStrictEqual({ 'NOVAT:0123456789ab': 'a' });
  });

  // ── planIngredients ─────────────────────────────────────────────────────────────
  test('no similar ingredient → new, with every point to write', () => {
    const row = planOne(oneIngredient(), ctxOf());
    expect(row.status).toBe('new');
    expect(row.supplierId).toBe(SUPPLIER_ID);
    expect(row.updateCurrent).toBe(true);
    expect(row.newPoints.map((p: Loose) => p.id)).toStrictEqual(['inv-18000000001-5']);
    expect(row.ingredientId).toBe(undefined);
  });

  test('an ingredient whose supplier is not known is an error row', () => {
    const row = planOne(oneIngredient(), ctxOf({ supplierIdByKey: {} }));
    expect(row.status).toBe('error');
    expect(row.reason).toBe('supplier-missing');
    expect(row.newPoints).toStrictEqual([]);
    expect(planOne(oneIngredient(), ctxOf({ supplierIdByKey: new Map() })).reason).toBe('supplier-missing');
    expect(planOne(oneIngredient(), ctxOf({ supplierIdByKey: new Map([['IT00000000001', SUPPLIER_ID]]) })).status).toBe('new');
  });

  test('an invalid file entry is an error row, not a crash', () => {
    const file = parse(rawFile({ ingredients: [rawIngredient({ name: '' }), rawIngredient({ key: 'k2', prices: [] })] }));
    const rows = planIngredients(file.ingredients, ctxOf());
    expect(rows.map((r: Loose) => [r.status, r.reason])).toStrictEqual([['error', 'name-missing'], ['error', 'no-prices']]);
    expect(ingredientWrites(rows[0], file.ingredients[0], '')).toStrictEqual([]);
  });

  test('the same name matches; accents, case and the display name do not get in the way', () => {
    const row = planOne(oneIngredient({ supplierCode: '', name: 'FARINA  tipo 00' }), ctxOf({
      ingredients: [existingIng({ id: 'i1', name: 'Farina 00 Esempio', shortName: 'Farina Tipo 00' })],
    }));
    expect(row.status).toBe('update-price');
    expect(row.ingredientId).toBe('i1');
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
    expect(rows.map((r: Loose) => r.ingredientId)).toStrictEqual(['salt-one', 'salt-two']);
    const onlyOne = planIngredients(file.ingredients, { ...ctx, ingredients: [ctx.ingredients[0]] });
    expect(onlyOne[0]!.ingredientId).toBe('salt-one');
    expect(onlyOne[1]!.status, 'the other supplier\'s salt is not this supplier\'s salt').toBe('new');
  });

  test('packaging is never a match; an inactive ingredient is', () => {
    const box = planOne(oneIngredient({ supplierCode: '', name: 'Scatola' }), ctxOf({
      ingredients: [existingIng({ id: 'p1', name: 'Scatola', kind: 'packaging' })],
    }));
    expect(box.status).toBe('new');
    const off = planOne(oneIngredient({ supplierCode: '', name: 'Scatola' }), ctxOf({
      ingredients: [existingIng({ id: 'i1', name: 'Scatola', active: false })],
    }));
    expect(off.ingredientId).toBe('i1');
  });

  test('the supplier\'s article code wins over a changed name', () => {
    const row = planOne(oneIngredient({ supplierCode: ' f00-25 ', name: 'Farina 00 nuova descrizione' }), ctxOf({
      ingredients: [
        existingIng({ id: 'other', name: 'Farina 00 nuova descrizione', supplierCode: 'ZZZ' }),
        existingIng({ id: 'coded', name: 'Farina del mulino', supplierCode: 'F00-25' }),
      ],
    }));
    expect(row.ingredientId).toBe('coded');
    expect(row.patchSupplierCode, 'it already has its code').toBe(null);
  });

  test('a match by name asks to remember the code only when the ingredient has none', () => {
    const none = planOne(oneIngredient({ name: 'Farina del mulino' }), ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina del mulino' })] }));
    expect(none.patchSupplierCode).toBe('F00-25');
    const had = planOne(oneIngredient({ name: 'Farina del mulino' }), ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina del mulino', supplierCode: 'OLD' })] }));
    expect(had.patchSupplierCode).toBe(null);
    const fileNone = planOne(oneIngredient({ name: 'Farina del mulino', supplierCode: '' }), ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina del mulino' })] }));
    expect(fileNone.patchSupplierCode).toBe(null);
  });

  test('«unisci con» finds the ingredient by its name or display name', () => {
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina 00 Esempio', shortName: 'Farina' })] });
    const byName = planOne(oneIngredient({ mergeWith: 'farina 00 esempio', name: 'Something else entirely' }), ctx);
    expect(byName.status).toBe('update-price');
    expect(byName.ingredientId).toBe('i1');
    const byShort = planOne(oneIngredient({ mergeWith: 'FARINA', name: 'Something else entirely' }), ctx);
    expect(byShort.ingredientId).toBe('i1');
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
    expect(row.status).toBe('choose');
    expect(row.reason).toBe('merge-target-not-found');
    expect(row.candidates.map((c: Loose) => c.id)).toStrictEqual(['a', 'b']);
  });

  test('«unisci con» is not undone by a code or a name that would match something else', () => {
    const row = planOne(oneIngredient({ mergeWith: 'Nowhere', supplierCode: 'F00-25', name: 'Farina' }), ctxOf({
      ingredients: [existingIng({ id: 'coded', name: 'Farina', supplierCode: 'F00-25' })],
    }));
    expect(row.status).toBe('choose');
  });

  test('a similar name is a maybe-duplicate with the closest first', () => {
    const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero tipo 00' }), ctxOf({
      ingredients: [
        existingIng({ id: 'far', name: 'Farina' }),
        existingIng({ id: 'close', name: 'Farina grano tenero tipo 00' }),
        existingIng({ id: 'no', name: 'Zucchero' }),
      ],
    }));
    expect(row.status).toBe('maybe-duplicate');
    expect(row.candidates.map((c: Loose) => c.id)).toStrictEqual(['close', 'far']);
    expect(row.newPoints.map((p: Loose) => p.id), 'what it would write if it were new').toStrictEqual(['inv-18000000001-5']);
    expect(row.updateCurrent).toBe(false);
  });

  test('two existing ingredients with one code or one name are not guessed between', () => {
    const byCode = planOne(oneIngredient(), ctxOf({
      ingredients: [existingIng({ id: 'a', name: 'A', supplierCode: 'F00-25' }), existingIng({ id: 'b', name: 'B', supplierCode: 'f00-25' })],
    }));
    expect(byCode.status).toBe('maybe-duplicate');
    expect(byCode.reason).toBe('code-ambiguous');
    const byName = planOne(oneIngredient({ supplierCode: '' }), ctxOf({
      ingredients: [existingIng({ id: 'a', name: 'Farina tipo 00' }), existingIng({ id: 'b', name: 'Other', shortName: 'farina tipo 00' })],
    }));
    expect(byName.status).toBe('maybe-duplicate');
    expect(byName.reason).toBe('name-ambiguous');
  });

  // ── Points and the current price ────────────────────────────────────────────────
  const knownIds = (id: string, ...pointIds: string[]): Loose => new Map([[id, new Set(pointIds)]]);
  const priceDoc = (stamp: unknown): Loose => new Map([['i1', { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: stamp }]]);

  test('a matched ingredient with no price document, or a price with no date, is updated', () => {
    const ctx = { ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] };
    expect(planOne(oneIngredient({ supplierCode: '' }), ctxOf(ctx)).status).toBe('update-price');
    expect(planOne(oneIngredient({ supplierCode: '' }), ctxOf({ ...ctx, pricesById: priceDoc(null) })).status).toBe('update-price');
    expect(planOne(oneIngredient({ supplierCode: '' }), ctxOf({ ...ctx, pricesById: priceDoc('') })).status).toBe('update-price');
  });

  test('a newer invoice updates the price; an older one, or the same day, only feeds the history', () => {
    const file = oneIngredient({ supplierCode: '', prices: [price({ invoiceDate: '2026-08-31' })] });
    const ctx = (stamp: string) => ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: priceDoc(stamp) });
    const newer = planOne(file, ctx('2026-08-30T09:15:00.000Z'));
    expect(newer.status).toBe('update-price');
    expect(newer.updateCurrent).toBe(true);
    const older = planOne(file, ctx('2026-09-15T09:15:00.000Z'));
    expect(older.status).toBe('history-only');
    expect(older.updateCurrent).toBe(false);
    expect(older.newPoints.length).toBe(1);
    expect(planOne(file, ctx('2026-08-31T23:59:00.000Z')).status).toBe('history-only');
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
    expect(row.status).toBe('update-price');
    expect(row.newPoints.length).toBe(2);
  });

  test('only the points not recorded yet are new; none left → unchanged', () => {
    const file = oneIngredient({
      supplierCode: '',
      prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })],
    });
    const base = { ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] };
    const some = planOne(file, ctxOf({ ...base, invoicePointIds: knownIds('i1', 'inv-18000000001-5') }));
    expect(some.newPoints.map((p: Loose) => p.id)).toStrictEqual(['inv-18000000002-1']);
    const all = planOne(file, ctxOf({ ...base, invoicePointIds: knownIds('i1', 'inv-18000000001-5', 'inv-18000000002-1') }));
    expect(all.status).toBe('unchanged');
    expect(all.newPoints).toStrictEqual([]);
    expect(all.updateCurrent).toBe(false);
    const asObject = planOne(file, ctxOf({ ...base, invoicePointIds: { i1: ['inv-18000000001-5', 'inv-18000000002-1'] } }));
    expect(asObject.status).toBe('unchanged');
  });

  test('a point recorded for ANOTHER ingredient does not count', () => {
    const row = planOne(oneIngredient({ supplierCode: '' }), ctxOf({
      ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })],
      invoicePointIds: knownIds('i2', 'inv-18000000001-5'),
    }));
    expect(row.status).toBe('update-price');
  });

  test('every point id has the shape the rules demand', () => {
    const file = oneIngredient({
      prices: [price({ invoiceId: '1'.repeat(20), line: 999999 }), price({ invoiceId: '7', line: 1, invoiceDate: '2026-09-01' })],
    });
    const row = planOne(file, ctxOf());
    for (const p of row.newPoints) expect(p.id).toMatch(/^inv-[0-9]{1,20}-[0-9]{1,6}$/);
  });

  // ── resolveRow ──────────────────────────────────────────────────────────────────
  const ambiguousCtx = (): Loose => ctxOf({
    ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'zz', name: 'Zucchero' })],
  });
  // The same venue once the point of the file is recorded on «Farina» (what the screen reads after the answer).
  const ambiguousCtxRecorded = (): Loose => ({ ...ambiguousCtx(), invoicePointIds: knownIds('far', 'inv-18000000001-5') });

  test('«same as» recomputes the row as that ingredient', () => {
    const ctx = ambiguousCtx();
    const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' }), ctx);
    expect(row.status).toBe('maybe-duplicate');
    const resolved = resolveRow(row, { sameAs: 'far' }, ambiguousCtxRecorded());
    expect(resolved.status, 'its point was recorded already').toBe('unchanged');
    expect(resolved.ingredientId).toBe('far');
    expect(resolved.candidates).toBe(undefined);
    const other = resolveRow(row, { sameAs: 'zz' }, ctx);
    expect(other.status).toBe('update-price');
    expect(other.ingredientId).toBe('zz');
  });

  test('«same as» something that is not this supplier\'s ingredient is an error, not a write', () => {
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'foreign', name: 'Farina', supplierId: 'elsewhere' })] });
    const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' }), ctx);
    expect(resolveRow(row, { sameAs: 'foreign' }, ctx).status).toBe('error');
    expect(resolveRow(row, { sameAs: 'nobody' }, ctx).reason).toBe('target-not-found');
  });

  test('«create new» makes it a new ingredient; «skip» writes nothing', () => {
    const ctx = ambiguousCtx();
    const file = oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' });
    const row = planOne(file, ctx);
    const created = resolveRow(row, { createNew: true }, ctx);
    expect(created.status).toBe('new');
    expect(created.updateCurrent).toBe(true);
    expect(created.ingredientId).toBe(undefined);
    expect(created.candidates).toBe(undefined);
    expect(flat(ingredientWrites(created, file, '')).filter((o) => o.type === 'create-ingredient').length).toBe(1);
    const skipped = resolveRow(row, { skip: true }, ctx);
    expect(skipped.status).toBe('skipped');
    expect(ingredientWrites(skipped, file, '')).toStrictEqual([]);
  });

  test('a «unisci con» row cannot be made a new ingredient', () => {
    const ctx = ambiguousCtx();
    const row = planOne(oneIngredient({ mergeWith: 'Nowhere' }), ctx);
    expect(row.status).toBe('choose');
    expect(resolveRow(row, { createNew: true }, ctx)).toBe(row);
    expect(resolveRow(row, { sameAs: 'far' }, ctx).ingredientId).toBe('far');
    expect(resolveRow(row, { skip: true }, ctx).status).toBe('skipped');
  });

  test('resolveRow leaves other rows and empty answers alone', () => {
    const ctx = ambiguousCtx();
    const settled = planOne(oneIngredient(), ctxOf());
    expect(settled.status).toBe('new');
    expect(resolveRow(settled, { skip: true }, ctx)).toBe(settled);
    const row = planOne(oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' }), ctx);
    expect(resolveRow(row, undefined, ctx)).toBe(row);
    expect(resolveRow(row, {}, ctx)).toBe(row);
  });

  // ── ingredientWrites ────────────────────────────────────────────────────────────
  const writesFor = (file: Loose, ctx?: Loose, options?: Loose): { row: Loose; batches: Loose[][] } => {
    const row = planOne(file, ctx || ctxOf());
    return { row, batches: ingredientWrites(row, file, '2026-10-03T10:00:00.000Z', options) };
  };

  test('a new ingredient: create, current price, then the points — the later ops wait for the id', () => {
    const file = oneIngredient({ prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30', pricePerUnit: 0.6, qty: null })] });
    const { batches } = writesFor(file);
    const ops = flat(batches);
    expect(ops.map((o) => o.type)).toStrictEqual(['create-ingredient', 'set-current-price', 'add-price-point', 'add-price-point']);
    expect(batches[0]![0].type).toBe('create-ingredient');
    expect(ops.slice(1).map((o) => o.ingredientId)).toStrictEqual([null, null, null]);
    expect(ops[0].ingredientId).toBe(undefined);
    expect(ops.slice(2).map((o) => o.pointId), 'oldest first').toStrictEqual(['inv-18000000001-5', 'inv-18000000002-1']);
    expect(ops[1].data.pricePerUnit, 'the current price is the latest invoice\'s').toBe(0.6);
    expect(ops[1].data.priceUpdatedAt).toBe('2026-09-30T12:00:00.000Z');
  });

  test('a new Singola gets what the new card writes for one: no packCount, an empty unit when the weight reads', () => {
    const { batches } = writesFor(oneIngredient());
    const data = batches[0]![0].data;
    expect(data.name).toBe('Farina tipo 00');
    expect(data.shortName).toBe('');
    expect(data.supplierId).toBe(SUPPLIER_ID);
    expect(data.supplierCode).toBe('F00-25');
    expect(data.brand).toBe('');
    expect(data.weight).toBe('25 kg');
    expect(data.unit).toBe('');
    expect('packUnit' in data, 'the card writes no package word on a Singola').toBe(false);
    expect('packCount' in data).toBe(false);
    expect(data.category).toBe('Other');
    expect(data.active).toBe(true);
    expect(data.kind).toBe('ingredient');
  });

  test('the weight is stored the way the card stores it', () => {
    const weightOf = (w: string) => writesFor(oneIngredient({ weight: w })).batches[0]![0].data.weight;
    expect(weightOf('2,5kg')).toBe('2.5 kg');
    expect(weightOf('500 G')).toBe('500 g');
    expect(weightOf('')).toBe('');
    expect(weightOf('6x1kg'), 'a weight the card cannot read is kept as typed').toBe('6x1kg');
  });

  test('a loose Singola with no readable weight gets the venue\'s word for how it is bought', () => {
    const unitOf = (over: Loose, options?: Loose) => writesFor(oneIngredient({ weight: '', packUnit: '', ...over }), ctxOf(), options).batches[0]![0].data.unit;
    expect(unitOf({ priceUnit: 'kg' })).toBe('kg');
    expect(unitOf({ priceUnit: 'l' })).toBe('l');
    expect(unitOf({ priceUnit: 'pcs', unitWeightKg: 0.06 })).toBe('pz');
    expect(unitOf({ priceUnit: 'pcs', unitWeightKg: 0.06 }, { language: 'en' })).toBe('pcs');
    expect(unitOf({ priceUnit: 'kg', weight: '25 kg' }), 'a readable weight needs no word').toBe('');
  });

  test('a Cartone is stored the way the card writes one: packCount, the inner word and the carton word', () => {
    const data = writesFor(oneIngredient({ weight: '2.5 kg', packUnit: 'busta', packCount: 4 })).batches[0]![0].data;
    expect(data.packCount).toBe(4);
    expect(data.packUnit).toBe('busta');
    expect(data.unit).toBe('cartone');
    expect(data.weight).toBe('2.5 kg');
    const en = writesFor(oneIngredient({ weight: '2.5 kg', packUnit: 'bag', packCount: 4 }), ctxOf(), { language: 'en' }).batches[0]![0].data;
    expect(en.unit).toBe('case');
  });

  test('a Cartone with no word for what is inside gets the venue\'s default one, like the card', () => {
    const it = writesFor(oneIngredient({ packUnit: '', packCount: 6 })).batches[0]![0].data;
    expect(it.packUnit).toBe('busta');
    const en = writesFor(oneIngredient({ packUnit: '', packCount: 6 }), ctxOf(), { language: 'en' }).batches[0]![0].data;
    expect(en.packUnit).toBe('bag');
  });

  test('the file\'s own brand and category are kept', () => {
    const data = writesFor(oneIngredient({ brand: 'Esempio', category: 'Flour' })).batches[0]![0].data;
    expect(data.brand).toBe('Esempio');
    expect(data.category).toBe('Flour');
  });

  test('a new ingredient carries every retired price key as null, and nothing about allergens or nutrition', () => {
    const data = writesFor(oneIngredient()).batches[0]![0].data;
    for (const key of INGREDIENT_DRAINED_FIELDS) {
      expect(key in data, `${key} must be written as null, like splitPriceFields does`).toBeTruthy();
      expect(data[key]).toBe(null);
    }
    for (const forbidden of ['allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients']) {
      expect(forbidden in data, `${forbidden} must never be written by an import`).toBe(false);
    }
    expect('vatRate' in data).toBe(false);
    for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) expect(key in data, key).toBe(false);
  });

  test('no op of any kind ever names an allergen or nutrition key', () => {
    const file = oneIngredient({ prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })] });
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] });
    for (const c of [ctxOf(), ctx]) {
      for (const op of flat(writesFor(file, c).batches)) {
        for (const key of Object.keys(op.data)) expect(/allerg|nutrition|mayContain|packIngredients/i.test(key), key).toBe(false);
      }
    }
  });

  test('the current price carries the rate, the unit, the VAT, the date — and clears any stale case', () => {
    const { batches } = writesFor(oneIngredient({ vatRate: 4 }));
    const set = flat(batches).find((o) => o.type === 'set-current-price');
    expect(set!.data).toStrictEqual({
      priceUnit: 'kg', pricePerUnit: 0.57,
      casePrice: null, caseCount: null, caseItemSize: null, caseItemUnit: null,
      packPrice: null, packSize: null, unitWeightKg: null,
      priceUpdatedAt: '2026-08-31T12:00:00.000Z', vatRate: 4,
    });
    // ⚠️ NO priceBasis KEY: a merge write must leave the basis an owner chose on the card alone.
    expect('priceBasis' in set!.data).toBe(false);
  });

  test('no import price write of any kind carries priceBasis', () => {
    const file = oneIngredient({ vatRate: 4, prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })] });
    for (const c of [ctxOf(), ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] })]) {
      for (const op of flat(writesFor(file, c).batches)) expect('priceBasis' in op.data, op.type).toBe(false);
    }
  });

  test('an unstated VAT rate is written null, never 0', () => {
    const set = flat(writesFor(oneIngredient({ vatRate: null })).batches).find((o) => o.type === 'set-current-price');
    expect(set!.data.vatRate).toBe(null);
  });

  test('a per-piece price keeps the piece weight on the price and on each point', () => {
    const file = oneIngredient({ priceUnit: 'pcs', unitWeightKg: 0.06, weight: '', packUnit: '', prices: [price({ pricePerUnit: 0.25 })] });
    const ops = flat(writesFor(file).batches);
    expect(ops.find((o) => o.type === 'set-current-price')!.data.unitWeightKg).toBe(0.06);
    const point = ops.find((o) => o.type === 'add-price-point')!;
    expect(point.data.unitWeightKg).toBe(0.06);
    expect(point.data.priceUnit).toBe('pcs');
  });

  test('a per-kilo point has no unitWeightKg key at all, and no invoiceQty key without a quantity', () => {
    const file = oneIngredient({ prices: [price({ qty: null })] });
    const point = flat(writesFor(file).batches).find((o) => o.type === 'add-price-point')!;
    expect('unitWeightKg' in point.data).toBe(false);
    expect('invoiceQty' in point.data).toBe(false);
  });

  test('a point is exactly what the history rule describes', () => {
    const point = flat(writesFor(oneIngredient()).batches).find((o) => o.type === 'add-price-point')!;
    expect(point.data).toStrictEqual({
      recordedAt: '2026-08-31T12:00:00.000Z', priceUnit: 'kg', pricePerUnit: 0.57,
      supplierId: SUPPLIER_ID, source: 'invoice', invoiceId: '18000000001', invoiceDate: '2026-08-31', invoiceQty: 25,
      packLabel: 'Farina tipo 00 25 kg', packCode: 'F00-25',
    });
    expect(point.pointId).toBe('inv-18000000001-5');
    expect(point.pointId).toMatch(new RegExp(`^inv-${point.data.invoiceId}-[0-9]{1,6}$`));
  });

  test('an existing ingredient: price and points, no create; the code only when it had none', () => {
    const ctx = (extra?: Loose) => ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00', ...extra })] });
    const withPatch = flat(writesFor(oneIngredient(), ctx()).batches);
    expect(withPatch.map((o) => o.type)).toStrictEqual(['patch-ingredient', 'set-current-price', 'add-price-point']);
    expect(withPatch[0]).toStrictEqual({ type: 'patch-ingredient', ingredientId: 'i1', data: { supplierCode: 'F00-25' } });
    expect(withPatch.map((o) => o.ingredientId)).toStrictEqual(['i1', 'i1', 'i1']);
    const without = flat(writesFor(oneIngredient(), ctx({ supplierCode: 'F00-25' })).batches);
    expect(without.map((o) => o.type)).toStrictEqual(['set-current-price', 'add-price-point']);
  });

  test('an existing ingredient\'s name, brand, category, weight and supplier are never in a write', () => {
    const file = oneIngredient({ brand: 'Other brand', category: 'Other category', weight: '1 kg', packCount: 4 });
    const ops = flat(writesFor(file, ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] })).batches);
    for (const op of ops.filter((o) => o.type === 'patch-ingredient')) expect(Object.keys(op.data)).toStrictEqual(['supplierCode']);
    expect(ops.some((o) => o.type === 'create-ingredient')).toBe(false);
  });

  test('an older invoice is history only: points, and no current price', () => {
    const ctx = ctxOf({
      ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00', supplierCode: 'F00-25' })],
      pricesById: priceDoc('2026-09-20T10:00:00.000Z'),
    });
    const { row, batches } = writesFor(oneIngredient(), ctx);
    expect(row.status).toBe('history-only');
    expect(flat(batches).map((o) => o.type)).toStrictEqual(['add-price-point']);
  });

  test('the second import writes nothing: every point already there → unchanged → no batch', () => {
    const file = oneIngredient({ prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })] });
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00', supplierCode: 'F00-25' })] });
    const first = writesFor(file, ctx);
    expect(first.row.status).toBe('update-price');
    const recorded = flat(first.batches).filter((o) => o.type === 'add-price-point').map((o) => o.pointId);
    const again = writesFor(file, { ...ctx, invoicePointIds: knownIds('i1', ...recorded) });
    expect(again.row.status).toBe('unchanged');
    expect(again.batches).toStrictEqual([]);
  });

  test('a row that is not new / update-price / history-only writes nothing', () => {
    const file = oneIngredient();
    const row = planOne(file, ctxOf());
    for (const status of ['unchanged', 'maybe-duplicate', 'choose', 'skipped', 'error']) {
      expect(ingredientWrites({ ...row, status }, file, ''), status).toStrictEqual([]);
    }
    expect(ingredientWrites(null, file, '')).toStrictEqual([]);
  });

  test('batches never hold more than five operations, and keep the order', () => {
    const prices = Array.from({ length: 14 }, (_, i) => price({ invoiceId: String(18000000100 + i), line: i + 1, invoiceDate: `2026-08-${String(10 + i).padStart(2, '0')}` }));
    const file = oneIngredient({ prices });
    const { batches } = writesFor(file);
    expect(batches.length > 1).toBeTruthy();
    for (const b of batches) expect(b.length >= 1 && b.length <= MAX_DOCS_PER_BATCH).toBeTruthy();
    const ops = flat(batches);
    expect(ops.length, 'create + current price + 14 points').toBe(16);
    expect(ops.slice(0, 2).map((o) => o.type)).toStrictEqual(['create-ingredient', 'set-current-price']);
    expect(ops.slice(2).map((o) => o.pointId)).toStrictEqual(prices.map((p: Loose) => `inv-${p.invoiceId}-${p.line}`));
    expect(batches[0]![0].type).toBe('create-ingredient');
  });

  test('every key of every op is one the matching rule accepts', () => {
    const file = oneIngredient({
      brand: 'Esempio', category: 'Flour', weight: '2.5 kg', packUnit: 'busta', packCount: 4,
      prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })],
    });
    const eggs = oneIngredient({ key: 'k2', priceUnit: 'pcs', unitWeightKg: 0.06, weight: '', packUnit: '', supplierCode: '', name: 'Uova' });
    const existing = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] });
    const allowed: Record<string, string[]> = { 'create-ingredient': INGREDIENT_KEYS, 'patch-ingredient': INGREDIENT_KEYS, 'set-current-price': PRICE_DOC_KEYS, 'add-price-point': POINT_KEYS };
    const seen = new Set<string>();
    for (const [f, c] of [[file, ctxOf()], [file, existing], [eggs, ctxOf()]] as const) {
      for (const op of flat(writesFor(f, c).batches)) {
        seen.add(op.type);
        for (const key of Object.keys(op.data)) expect(allowed[op.type]!.includes(key), `${op.type}: the rules refuse "${key}"`).toBeTruthy();
      }
    }
    expect([...seen].sort()).toStrictEqual(Object.keys(allowed).sort());
  });

  test('every value the ops carry is a type the rules accept', () => {
    const file = oneIngredient({ packUnit: 'busta', packCount: 4 });
    for (const op of flat(writesFor(file).batches)) {
      if (op.type === 'create-ingredient') {
        expect(Number.isInteger(op.data.packCount) && op.data.packCount >= 1 && op.data.packCount <= 10000).toBeTruthy();
        expect(op.data.name.length <= 200 && op.data.weight.length <= 100 && op.data.packUnit.length <= 40 && op.data.supplierCode.length <= 60).toBeTruthy();
      }
      if (op.type === 'add-price-point') {
        expect(op.data.invoiceId).toMatch(/^[0-9]{1,20}$/);
        expect(op.data.invoiceDate).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
        expect(op.data.pricePerUnit > 0).toBeTruthy();
        expect(['kg', 'l', 'pcs'].includes(op.data.priceUnit)).toBeTruthy();
        expect(op.data.recordedAt.length > 0 && op.data.recordedAt.length <= 64).toBeTruthy();
        expect(typeof op.data.supplierId).toBe('string');
      }
      if (op.type === 'set-current-price') {
        expect(op.data.pricePerUnit > 0).toBeTruthy();
        expect([0, 4, 5, 10, 20, 22, null].includes(op.data.vatRate)).toBeTruthy();
      }
    }
  });

  test('the point ids written all match the pattern the rules enforce, for any invoice the file can hold', () => {
    const file = oneIngredient({
      prices: [price({ invoiceId: '1', line: 1 }), price({ invoiceId: '9'.repeat(20), line: 999999, invoiceDate: '2026-09-01' })],
    });
    for (const op of flat(writesFor(file).batches).filter((o) => o.type === 'add-price-point')) {
      expect(op.pointId).toMatch(/^inv-[0-9]{1,20}-[0-9]{1,6}$/);
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
    file.ingredients.forEach((f: Loose, i: number) => assertNoNaN(ingredientWrites(rows[i], f, ''), `writes[${i}]`));
  });

  // ── summarize ───────────────────────────────────────────────────────────────────
  test('summarize counts the rows per status, every ingredient status present', () => {
    const rows = [{ status: 'new' }, { status: 'new' }, { status: 'error' }, { status: 'unchanged' }, { status: 'history-only' }];
    expect(summarize(rows)).toStrictEqual({
      new: 2, 'update-price': 0, 'history-only': 1, unchanged: 1, 'maybe-duplicate': 0, choose: 0, skipped: 0, error: 1,
    });
    expect(summarize([]).new).toBe(0);
    expect(summarize(undefined).error).toBe(0);
    expect(summarize([{ status: 'present' }]).present, 'supplier plans can be counted too').toBe(1);
  });

  // ── The module is pure ──────────────────────────────────────────────────────────
  test('the model imports no Firebase, no DOM and nothing from another feature\'s folder', () => {
    const imports = [...modelSource.matchAll(/^import .* from '([^']+)'/gm)].map((x) => x[1] as string);
    expect(imports.length >= 4).toBeTruthy();
    const isPort = name.startsWith('shared/');
    for (const spec of imports) {
      // The reason codes of the zip reader (a pure constants file of this same feature) are the one sibling allowed.
      if (spec === (isPort ? './invoice-zip/reasons' : './invoice-zip/reasons.js')) continue;
      // The pure piece-weight comparison, shared with the price-changes model (no imports of its own but a date helper).
      if (spec === (isPort ? './price-changes-model' : './price-changes-model.js')) continue;
      // Only the root of the shared base: `./x` here, `../x.js` in js/.
      if (isPort) expect(spec.startsWith('./') && !spec.slice(2).includes('/'), `${spec}: only shared/ root modules`).toBeTruthy();
      else expect(spec.startsWith('../') && !spec.slice(3).includes('/'), `${spec}: only js/ root modules`).toBeTruthy();
      expect(/firebase|dom\.js|firebase-/.test(spec), spec).toBe(false);
    }
    expect(/\bdocument\.|\bwindow\./.test(modelSource)).toBe(false);
  });

  // ── Review fixes: VAT canonical form, article codes, units, remembered answers ──

  test('normalizeVat: a number typed without its country prefix is an Italian one; foreign prefixes are left alone', () => {
    expect(normalizeVat('01234567890')).toBe('IT01234567890');
    expect(normalizeVat(' 012.345.678.90 ')).toBe('IT01234567890');
    expect(normalizeVat('it 012 345 678 90')).toBe('IT01234567890');
    expect(normalizeVat('IT01234567890')).toBe('IT01234567890');
    expect(normalizeVat('DE123456789'), 'a foreign prefix is never touched').toBe('DE123456789');
    expect(normalizeVat('fr12345678901'), 'eleven digits WITH country letters are not prefixed again').toBe('FR12345678901');
    expect(normalizeVat('ATU12345678')).toBe('ATU12345678');
    expect(normalizeVat('123456789'), 'a short number is not guessed at').toBe('123456789');
    expect(normalizeVat('0123456789012'), 'nor a long one').toBe('0123456789012');
    expect(normalizeVat('NOVAT:0123456789ab'), 'a NOVAT key is still «none»').toBe('');
  });

  test('⚠️ a VAT typed on the supplier card WITHOUT «IT» is the supplier the file names', () => {
    const file = fileSupplier(); // IT00000000001
    const typedBare = { id: 'a', name: 'Mulino Esempio', vatNumber: '00000000001' };
    const plan = planSup([file], [typedBare]);
    expect(plan[0].status).toBe('present');
    expect(plan[0].supplierId).toBe('a');
    const bareInFile = parse(rawFile({ suppliers: [{ key: '00000000001', vatNumber: '00000000001', name: 'FORNITORE ESEMPIO SRL' }] })).suppliers[0];
    expect(bareInFile.vatNumber, 'the file is read into the same form').toBe('IT00000000001');
    expect(planSup([bareInFile], [{ id: 'b', name: 'X', vatNumber: 'it 000 000 000 01' }])[0].supplierId).toBe('b');
    const foreign = planSup([fileSupplier({ vatNumber: 'DE123456789', key: 'DE123456789' })], [{ id: 'c', name: 'Y', vatNumber: 'de123456789' }]);
    expect(foreign[0].status).toBe('present');
  });

  test('⚠️ the same name under ANOTHER article code is a question, never a silent match', () => {
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'i25', name: 'Farina 00', supplierCode: 'CODE-A' })] });
    const sameCode = planOne(oneIngredient({ name: 'Farina 00', supplierCode: 'CODE-A' }), ctx);
    expect(sameCode.status).toBe('update-price');
    expect(sameCode.ingredientId).toBe('i25');
    const otherCode = planOne(oneIngredient({ key: 'k5', name: 'Farina 00', supplierCode: 'CODE-B' }), ctx);
    expect(otherCode.status).toBe('maybe-duplicate');
    expect(otherCode.reason).toBe('code-differs');
    expect(otherCode.candidates).toStrictEqual([{ id: 'i25', label: 'Farina 00' }]);
    expect(otherCode.ingredientId).toBe(undefined);
    expect(ingredientWrites(otherCode, oneIngredient({ supplierCode: 'CODE-B' }), ''), 'it writes nothing until answered').toStrictEqual([]);
    // An existing ingredient WITHOUT a code, and a row WITHOUT a code, are still plain name matches.
    const noCodeStored = planOne(oneIngredient({ name: 'Farina 00', supplierCode: 'CODE-B' }), ctxOf({ ingredients: [existingIng({ id: 'i0', name: 'Farina 00', supplierCode: '' })] }));
    expect(noCodeStored.status).toBe('update-price');
    expect(noCodeStored.patchSupplierCode).toBe('CODE-B');
    const noCodeFile = planOne(oneIngredient({ name: 'Farina 00', supplierCode: '' }), ctx);
    expect(noCodeFile.status).toBe('update-price');
  });

  test('a current price kept in ANOTHER unit is never replaced: the new prices go to the history only', () => {
    const perPiece = new Map([['i1', { priceUnit: 'pcs', pricePerUnit: 0.2, unitWeightKg: 0.05, priceUpdatedAt: '2026-01-01T12:00:00.000Z', vatRate: 4 }]]);
    const file = oneIngredient({ supplierCode: '', prices: [price({ invoiceDate: '2026-08-31' })] }); // per kg, and newer
    const row = planOne(file, ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: perPiece }));
    expect(row.status).toBe('history-only');
    expect(row.reason).toBe('unit-differs');
    expect(row.updateCurrent).toBe(false);
    expect(row.newPoints.length).toBe(1);
    const ops = flat(ingredientWrites(row, file, ''));
    expect(ops.map((o) => o.type), 'no set-current-price').toStrictEqual(['add-price-point']);
    // The same unit still updates.
    const sameUnit = new Map([['i1', { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: '2026-01-01T12:00:00.000Z' }]]);
    const updated = planOne(file, ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: sameUnit }));
    expect(updated.status).toBe('update-price');
    expect(updated.reason).toBe(undefined);
  });

  test('⚠️ a per-piece price of a piece of ANOTHER weight never becomes the current price: history only', () => {
    const stored = (kg: number | undefined) => new Map([['i1', { priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: kg, priceUpdatedAt: '2026-01-01T12:00:00.000Z', vatRate: 4 }]]);
    const file = oneIngredient({ supplierCode: '', priceUnit: 'pcs', unitWeightKg: 1, weight: '1 kg', prices: [price({ invoiceDate: '2026-08-31', pricePerUnit: 1.2 })] });
    const run = (kg: number | undefined) => planOne(file, ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: stored(kg) }));
    const sack = run(5);
    expect(sack.status).toBe('history-only');
    expect(sack.reason).toBe('piece-differs');
    expect(sack.updateCurrent).toBe(false);
    expect(sack.newPoints.length, 'the point still joins the history').toBe(1);
    expect(flat(ingredientWrites(sack, file, '')).map((o) => o.type), 'no set-current-price').toStrictEqual(['add-price-point']);
    expect(run(undefined).status, 'a stored piece with no weight is not «equal» either').toBe('history-only');
    const same = run(1.0005);
    expect(same.status, 'the same piece (within 0.1%) updates it').toBe('update-price');
    expect(same.reason).toBe(undefined);
    // Per kilo is comparable across packs: nothing changes there.
    const perKg = planOne(oneIngredient({ supplierCode: '', prices: [price({ invoiceDate: '2026-08-31' })] }), ctxOf({
      ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })],
      pricesById: new Map([['i1', { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: '2026-01-01T12:00:00.000Z' }]]),
    }));
    expect(perKg.status).toBe('update-price');
  });

  test('every point the import writes carries the article code of its pack (when the file has one)', () => {
    const withCode = flat(writesFor(oneIngredient({ supplierCode: 'PACCO-1' })).batches).find((o) => o.type === 'add-price-point')!;
    expect(withCode.data.packCode).toBe('PACCO-1');
    const without = flat(writesFor(oneIngredient({ supplierCode: '' })).batches).find((o) => o.type === 'add-price-point')!;
    expect('packCode' in without.data).toBe(false);
  });

  test('a rate the file does not state keeps the one stored; one it does state replaces it', () => {
    const stored = new Map([['i1', { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: '2026-01-01T12:00:00.000Z', vatRate: 10 }]]);
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })], pricesById: stored });
    const unstated = oneIngredient({ supplierCode: '', vatRate: null });
    const row = planOne(unstated, ctx);
    const set = flat(ingredientWrites(row, unstated, '')).find((o) => o.type === 'set-current-price')!;
    expect(set.data.vatRate, 'the stated rate is not overwritten with «not stated»').toBe(10);
    const stated = oneIngredient({ supplierCode: '', vatRate: 4 });
    const set4 = flat(ingredientWrites(planOne(stated, ctx), stated, '')).find((o) => o.type === 'set-current-price')!;
    expect(set4.data.vatRate).toBe(4);
    // Nothing stored and nothing in the file: still «not stated», never 0.
    const bare = ctxOf({ ingredients: [existingIng({ id: 'i1', name: 'Farina tipo 00' })] });
    const none = flat(ingredientWrites(planOne(unstated, bare), unstated, '')).find((o) => o.type === 'set-current-price')!;
    expect(none.data.vatRate).toBe(null);
  });

  test('⚠️ a decision is remembered by the prices it left behind: one holder of the row\'s points is the answer', () => {
    const base = [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'zz', name: 'Zucchero' })];
    const file = oneIngredient({ supplierCode: '', name: 'Farina di grano tenero' });
    const asked = planOne(file, ctxOf({ ingredients: base }));
    expect(asked.status, 'with nothing recorded it is a question').toBe('maybe-duplicate');
    const remembered = planOne(file, ctxOf({ ingredients: base, invoicePointIds: knownIds('far', 'inv-18000000001-5') }));
    expect(remembered.status).toBe('unchanged');
    expect(remembered.ingredientId).toBe('far');
    expect(remembered.candidates).toBe(undefined);
    // The same for a new price of an ingredient that already holds an OLDER point of this row.
    const newer = oneIngredient({ supplierCode: '', name: 'Farina di grano tenero', prices: [price(), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-30' })] });
    const next = planOne(newer, ctxOf({ ingredients: base, invoicePointIds: knownIds('far', 'inv-18000000001-5') }));
    expect(next.status).toBe('update-price');
    expect(next.ingredientId).toBe('far');
    expect(next.newPoints.map((p: Loose) => p.id)).toStrictEqual(['inv-18000000002-1']);
    // Two holders cannot say which one it was: still a question.
    const two = planOne(file, ctxOf({
      ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'far2', name: 'Farina grano' })],
      invoicePointIds: new Map([['far', new Set(['inv-18000000001-5'])], ['far2', new Set(['inv-18000000001-5'])]]),
    }));
    expect(two.status).toBe('maybe-duplicate');
    // A point held by something that is not a candidate of this row decides nothing.
    const elsewhere = planOne(file, ctxOf({ ingredients: base, invoicePointIds: knownIds('zz', 'inv-18000000001-5') }));
    expect(elsewhere.status).toBe('maybe-duplicate');
  });

  test('an «unisci con» row that points at nobody is remembered the same way', () => {
    const ctx = ctxOf({
      ingredients: [existingIng({ id: 'far', name: 'Farina' }), existingIng({ id: 'zz', name: 'Zucchero' })],
      invoicePointIds: knownIds('far', 'inv-18000000001-5'),
    });
    const row = planOne(oneIngredient({ mergeWith: 'Nowhere' }), ctx);
    expect(row.status).toBe('unchanged');
    expect(row.ingredientId).toBe('far');
  });

  // ── An ingredient the invoices state no trustworthy price for (priceCheck) ──────
  test('prices: [] is valid ONLY together with a priceCheck code', () => {
    const withCode = oneIngredient({ prices: [], priceCheck: 'price-out-of-scale' });
    expect(withCode.invalid).toBe(undefined);
    expect(withCode.priceCheck).toBe('price-out-of-scale');
    expect(withCode.prices).toStrictEqual([]);

    expect(oneIngredient({ prices: [] }).invalid, 'a file from the script never has empty prices').toBe('no-prices');
    expect(oneIngredient({ prices: [], priceCheck: '' }).invalid).toBe('no-prices');
    expect(oneIngredient({ prices: [], priceCheck: 'not-a-code' }).invalid).toBe('no-prices');
    expect(oneIngredient({ prices: [], priceCheck: 42 }).invalid).toBe('no-prices');
    expect('priceCheck' in oneIngredient(), 'an ordinary entry carries none').toBe(false);
    // a code beside real prices is meaningless and dropped
    expect('priceCheck' in oneIngredient({ priceCheck: 'price-out-of-scale' })).toBe(false);
  });

  test('every reason a price is «da verificare» is an accepted priceCheck code', () => {
    const { NOTE, LEFT_OUT } = reasons;
    const { PRICE_CHECK_CODES } = m;
    expect(PRICE_CHECK_CODES.includes(NOTE.PRICE_OUT_OF_SCALE)).toBeTruthy();
    expect(PRICE_CHECK_CODES.includes(NOTE.UNATTRIBUTED_DISCOUNT)).toBeTruthy();
    expect(PRICE_CHECK_CODES.includes(LEFT_OUT.NEEDS_CHECKING)).toBeTruthy();
    expect(!PRICE_CHECK_CODES.includes(NOTE.BY_WEIGHT), 'a note that is not a doubt is not a code').toBeTruthy();
  });

  test('a NEW priceCheck row creates the ingredient with no price document and no points', () => {
    const file = oneIngredient({ prices: [], priceCheck: 'price-out-of-scale' });
    const row = planOne(file, ctxOf());
    expect(row.status).toBe('new');
    expect(row.priceCheck).toBe('price-out-of-scale');
    expect(row.newPoints).toStrictEqual([]);
    const ops = flat(ingredientWrites(row, file, '2026-10-05T10:00:00.000Z', { language: 'it' }));
    expect(ops.map((o) => o.type)).toStrictEqual(['create-ingredient']);
    expect(ops[0].data.name).toBe('Farina tipo 00');
    expect(ops[0].data.supplierId).toBe(SUPPLIER_ID);
    assertNoNaN(ops);
    for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients']) expect(key in ops[0].data).toBeFalsy();
  });

  test('a priceCheck row matched to an existing ingredient writes nothing', () => {
    const file = oneIngredient({ prices: [], priceCheck: 'unattributed-discount' });
    const row = planOne(file, ctxOf({ ingredients: [existingIng({ name: 'Farina tipo 00', supplierCode: 'F00-25' })] }));
    expect(row.status).toBe('unchanged');
    expect(row.ingredientId).toBe('ing-1');
    expect(ingredientWrites(row, file, '2026-10-05T10:00:00.000Z', { language: 'it' })).toStrictEqual([]);
  });

  test('an ordinary row with no new points still writes nothing, and a row without priceCheck is untouched by the change', () => {
    const file = oneIngredient();
    const row = planOne(file, ctxOf());
    expect(row.priceCheck).toBe('');
    expect(flat(ingredientWrites(row, file, '', { language: 'it' })).some((o) => o.type === 'set-current-price')).toBeTruthy();
    const known = planOne(file, ctxOf({
      ingredients: [existingIng({ name: 'Farina tipo 00', supplierCode: 'F00-25' })], invoicePointIds: new Map([['ing-1', new Set(['inv-18000000001-5'])]]),
    }));
    expect(known.status).toBe('unchanged');
    expect(ingredientWrites(known, file, '', { language: 'it' })).toStrictEqual([]);
  });

  // ── One ingredient, several packs (5 Oct 2026) ──────────────────────────────────

  test('matching by article code reads the main code AND every extra pack code, case and spaces ignored', () => {
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Lievito sacco', supplierCode: 'SACCO', supplierCodes: [' pacco ', 'pacco', ''] })] });
    const pacco = planOne(oneIngredient({ name: 'Qualcosa di diverso', supplierCode: 'PACCO' }), ctx);
    expect(pacco.ingredientId).toBe('x');
    expect(pacco.status).not.toBe('maybe-duplicate');
    expect(pacco.patchSupplierCode).toBe(null);
    expect(pacco.setSupplierCodes, 'it already knows that code').toBe(null);
    const main = planOne(oneIngredient({ name: 'Altro ancora', supplierCode: 'sacco' }), ctx);
    expect(main.ingredientId).toBe('x');
  });

  test('a code the ingredient does not know yet is added to supplierCodes (the main code stays), and never twice', () => {
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD', supplierCodes: ['B'] })] });
    const row = planOne(oneIngredient({ supplierCode: 'NEW', mergeWith: 'Farina tipo 00' }), ctx);
    expect(row.ingredientId).toBe('x');
    expect(row.patchSupplierCode).toBe(null);
    expect(row.setSupplierCodes).toStrictEqual(['B', 'NEW']);
    const ops = flat(ingredientWrites(row, oneIngredient({ supplierCode: 'NEW', mergeWith: 'Farina tipo 00' }), ''));
    expect(ops[0]).toStrictEqual({ type: 'patch-ingredient', ingredientId: 'x', data: { supplierCodes: ['B', 'NEW'] } });
    expect(INGREDIENT_KEYS.includes('supplierCodes'), 'the rules accept the key').toBeTruthy();
  });

  test('an ingredient with no main code takes the file code as its main code, as before', () => {
    const row = planOne(oneIngredient({ supplierCode: 'NEW' }), ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: '' })] }));
    expect(row.patchSupplierCode).toBe('NEW');
    expect(row.setSupplierCodes).toBe(null);
  });

  test('a full list (20 extra codes) adds nothing, says so, and the write has no code patch', () => {
    const full = Array.from({ length: MAX_SUPPLIER_CODES }, (_, i) => `C${i}`);
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD', supplierCodes: full })] });
    const file = oneIngredient({ supplierCode: 'NEW', mergeWith: 'Farina tipo 00' });
    const row = planOne(file, ctx);
    expect(row.codesFull).toBe(true);
    expect(row.setSupplierCodes).toBe(null);
    expect(flat(ingredientWrites(row, file, '')).some((o) => o.type === 'patch-ingredient')).toBe(false);
  });

  test('a «Same as» answer to a code-differs question teaches the ingredient the new code', () => {
    const ctx = ctxOf({ ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD' })] });
    const file = oneIngredient({ supplierCode: 'NEW' });
    const asked = planOne(file, ctx);
    expect(asked.status).toBe('maybe-duplicate');
    const answered = resolveRow(asked, { sameAs: 'x' }, ctx);
    expect(answered.setSupplierCodes).toStrictEqual(['NEW']);
  });

  test('an «unchanged» row (every price already in) still learns a new pack code, and writes nothing else', () => {
    const file = oneIngredient({ supplierCode: 'NEW' });
    const ctx = ctxOf({
      ingredients: [existingIng({ id: 'x', name: 'Farina tipo 00', supplierCode: 'OLD' })],
      invoicePointIds: new Map([['x', new Set(['inv-18000000001-5'])]]),
    });
    const row = planOne(file, ctx);
    expect(row.status).toBe('unchanged');
    expect(flat(ingredientWrites(row, file, ''))).toStrictEqual([{ type: 'patch-ingredient', ingredientId: 'x', data: { supplierCodes: ['NEW'] } }]);
  });

  test('every invoice point says which pack it paid for: the name, plus the weight unless the name has it', () => {
    expect(packLabelOf({ name: 'Lievito pacco', weight: '1 kg' })).toBe('Lievito pacco 1 kg');
    expect(packLabelOf({ name: 'Lievito pacco 1kg', weight: '1 kg' })).toBe('Lievito pacco 1kg');
    expect(packLabelOf({ name: 'Lievito pacco', weight: '' })).toBe('Lievito pacco');
    expect(packLabelOf({ name: 'x'.repeat(200), weight: '1 kg' }).length).toBe(120);
    const points = flat(writesFor(oneIngredient({ weight: '25 kg', name: 'Farina tipo 00' })).batches).filter((o) => o.type === 'add-price-point');
    expect(points.length > 0).toBeTruthy();
    points.forEach((p) => expect(p.data.packLabel).toBe('Farina tipo 00 25 kg'));
    expect(POINT_KEYS.includes('packLabel'), 'the rules accept the key').toBeTruthy();
  });

  test('extraCodesOf cleans the list: texts only, trimmed, no repeats, never the main code', () => {
    expect(extraCodesOf({ supplierCode: 'A', supplierCodes: ['a', ' B ', 'b', 4, '', 'C'] })).toStrictEqual(['B', 'C']);
    expect(extraCodesOf({})).toStrictEqual([]);
  });
});
