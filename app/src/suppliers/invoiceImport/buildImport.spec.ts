// @vitest-environment node
//
// buildImportFromInvoices: the whole path from the picked files to the import file (the port of test_export.py's shape,
// units, left-out and determinism tests, without the workbook in the middle), plus the zip limits and the «the tax code
// never leaves» guarantee (P15). Run against BOTH implementations: app/src/suppliers/invoiceImport/buildImport.ts (the
// zip reader of app/ joined to `buildImportFromRead` of shared/) and js/orders/invoice-zip/build-import.js, which the
// live app runs today. Ported from tests/invoice-zip-build.test.mjs. Invented invoices only.
//
// PORTED: 29 of 29 tests of tests/invoice-zip-build.test.mjs. Two of them ('parseImportFile accepts…') hand the file that
// was built to the CURRENT app's model of the import file (js/orders/invoice-import-model.js), for both implementations:
// Mise 2's own model of that file comes with its screen. The zip reader's pre-check on forged archives is in
// zipRead.spec.ts.

import { describe, expect, test } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  bytesOf, fixtureTexts, invoiceXml, metadataXml,
} from '@mise/shared/invoice-zip/testing/invoice-builders';
import type { LineSpec } from '@mise/shared/invoice-zip/testing/invoice-builders';
import { parseXmlTree } from '@mise/shared/invoice-zip/testing/xml-tree';
import type { ImportResult } from '@mise/shared/invoice-zip/build-import';
import { implementations, legacyImportModel, makeZipCase } from './testing/implementations';

const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
const SUGAR: LineSpec = { desc: 'ZUCCHERO SACCHI DA KG 25', qty: 50, unit: 'KG', total: 40 };
const BAGS: LineSpec = { desc: 'BUSTE PLASTICA', qty: 2, unit: 'PZ', total: 10 };
const COLA: LineSpec = { desc: 'COCA COLA LATTINA 33 CL', qty: 24, unit: 'PZ', total: 12 };
const EGGS: LineSpec = { desc: 'UOVA FRESCHE DA 30 UOVA', qty: 2, unit: 'CT', total: 36 };
const SPICE: LineSpec = { desc: 'SPEZIA MISTA', qty: 4, unit: 'PZ', total: 20 };
const KEY_FLOUR = 'IT00000000001|code:F00-25';
const TAX_CODE = 'RSSMRA80A01H501U';

describe.each(implementations)('%s', (_name, impl) => {
  const newCase = () => makeZipCase(impl.caseImpl);
  const { MAX_ARCHIVE_ENTRIES } = impl.zipRead;

  const ingredient = (result: ImportResult, part: string) => {
    const hits = result.importFile.ingredients.filter((i) => i.key.includes(part));
    expect(hits.length, part).toBe(1);
    return hits[0] as ImportResult['importFile']['ingredients'][number];
  };
  const product = (result: ImportResult, part: string) => {
    const hits = result.products.filter((p) => p.key.includes(part));
    expect(hits.length, part).toBe(1);
    return hits[0] as ImportResult['products'][number];
  };

  test('the file has the agreed shape and only ingredients are in it', () => {
    const c = newCase();
    c.add([FLOUR, SUGAR, BAGS, COLA]);
    const result = c.build();
    const { importFile } = result;
    expect(importFile.format).toBe('mise-invoice-import');
    expect(importFile.version).toBe(1);
    expect(importFile.generatedAt).toBe('2026-10-03T10:15:00Z');
    expect(importFile.suppliers).toStrictEqual([
      { key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }]);
    expect(importFile.ingredients.map((i) => i.key)).toStrictEqual([KEY_FLOUR, 'IT00000000001|name:zucchero sacchi da kg 25']);
    expect(importFile.ingredients[0]).toStrictEqual({
      key: KEY_FLOUR, supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00', invoiceName: 'FARINA TIPO 00 SACCO KG 25', brand: '', category: '',
      supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null, priceUnit: 'kg', unitWeightKg: null,
      vatRate: 4,
      prices: [{
        invoiceId: '9000000001', line: 1, invoiceDate: '2026-09-01', pricePerUnit: 0.57, qty: 25, reliability: 'alta',
      }],
    });
  });

  test('products lists EVERY product with what the workbook would show', () => {
    const c = newCase();
    c.add([COLA, BAGS, SUGAR, FLOUR]);
    const result = c.build();
    expect(result.products.map((p) => p.type)).toStrictEqual(['ingrediente', 'ingrediente', 'packaging', 'rivendita']);
    expect(result.products.map((p) => p.name)).toStrictEqual(['Farina tipo 00', 'Zucchero', 'Buste plastica', 'Coca cola lattina']);
    const flour = product(result, 'F00-25');
    expect(flour.supplierName).toBe('FORNITORE ESEMPIO SRL');
    expect(flour.priceUnit).toBe('kg');
    expect(flour.weight).toBe('25 kg');
    expect(flour.packUnit).toBe('sacco');
    expect(flour.lastPrice).toBe(0.57);
    expect(flour.reliability).toBe('alta');
    expect(flour.purchases).toBe(1);
    expect(flour.inImport).toBe(true);
    expect(flour.brand).toBe('');
    expect(flour.category).toBe('');
    expect(flour.vatRate).toBe(4);
    expect(product(result, 'buste').leftOutReason).toBe('not-an-ingredient');
    expect(product(result, 'buste').inImport).toBe(false);
    expect(product(result, 'coca').type).toBe('rivendita');
  });

  test('price history: last, min, max and the points oldest first', () => {
    const c = newCase();
    c.add([{ ...FLOUR, total: 12.5 }], { date: '2026-09-01' });
    c.add([{ ...FLOUR, total: 15.0 }], { date: '2026-09-15' });
    const flour = product(c.build(), 'F00-25');
    expect([flour.lastPrice, flour.minPrice, flour.maxPrice]).toStrictEqual([0.6, 0.5, 0.6]);
    expect(flour.purchases).toBe(2);
    expect(flour.lastDate).toBe('2026-09-15');
    expect(flour.totalQty).toBe(50);
    expect(flour.prices.map((p) => p.invoiceDate)).toStrictEqual(['2026-09-01', '2026-09-15']);
  });

  test('suppliers are only the referenced ones', () => {
    const c = newCase();
    c.add([FLOUR], { vat: '00000000001', name: 'FORNITORE ESEMPIO SRL' });
    c.add([BAGS], { vat: '00000000002', name: 'ALTRO FORNITORE ESEMPIO SPA' });
    expect(c.build().importFile.suppliers.map((s) => s.key)).toStrictEqual(['IT00000000001']);
  });

  test('eggs are pieces with the egg weight; a tray of 30 is a carton of 30 eggs', () => {
    const c = newCase();
    c.add([EGGS]);
    const eggs = ingredient(c.build({ eggWeightG: 50 }), 'uova');
    expect([eggs.priceUnit, eggs.unitWeightKg, eggs.packCount]).toStrictEqual(['pcs', 0.05, 30]);
    expect((eggs.prices[0] as { pricePerUnit: number }).pricePerUnit).toBe(0.6);
    expect((eggs.prices[0] as { qty: number }).qty).toBe(60);
    expect(eggs.weight).toBe('');
    expect(eggs.packUnit).toBe('uovo');
    expect(ingredient(c.build({ eggWeightG: 52 }), 'uova').unitWeightKg).toBe(0.052);
  });

  test('six trays of ten eggs is a pack count of sixty', () => {
    const c = newCase();
    c.add([{ desc: 'UOVA FRESCHE 6 X 10 UOVA', qty: 2, unit: 'CT', total: 72 }]);
    const item = c.build().importFile.ingredients[0] as { priceUnit: string; packCount: number; packUnit: string };
    expect([item.priceUnit, item.packCount, item.packUnit]).toStrictEqual(['pcs', 60, 'uovo']);
  });

  test('pack of packs in the card model, and litres stay litres', () => {
    let c = newCase();
    c.add([{ desc: 'PASSATA kg 2,5 x 4', qty: 3, unit: 'CT', total: 60 }]);
    let item = ingredient(c.build(), 'passata');
    expect([item.weight, item.packCount, item.priceUnit]).toStrictEqual(['2.5 kg', 4, 'kg']);
    expect([(item.prices[0] as { pricePerUnit: number }).pricePerUnit, (item.prices[0] as { qty: number }).qty]).toStrictEqual([2.0, 30.0]);

    c = newCase();
    c.add([{ desc: 'OLIO LT 1', qty: 6, unit: 'NR', total: 30 }]);
    item = ingredient(c.build(), 'olio');
    expect([item.priceUnit, item.weight, item.unitWeightKg]).toStrictEqual(['l', '1 l', null]);
  });

  test('a pieces line with no weight stays out with its reason', () => {
    const c = newCase();
    c.add([FLOUR, SPICE]);
    const result = c.build();
    expect(result.importFile.ingredients.map((i) => i.key)).toStrictEqual([KEY_FLOUR]);
    const spice = product(result, 'spezia');
    expect(spice.inImport).toBe(false);
    expect(spice.leftOutReason).toBe('pieces-need-price-unit-and-weight');
    expect(spice.reliability).toBe('da verificare');
    expect(spice.prices).toStrictEqual([]);
  });

  test('a price «da verificare» keeps the product in the file with no price and a priceCheck code', () => {
    const c = newCase();
    c.add([FLOUR, { desc: 'SPEZIA FORTE', qty: 100, unit: 'KG', total: 4 }]);
    const result = c.build();
    expect(result.importFile.ingredients.map((i) => i.key)).toStrictEqual([KEY_FLOUR, 'IT00000000001|name:spezia forte']);
    const entry = ingredient(result, 'spezia');
    expect(entry.prices, 'the doubtful price is not imported').toStrictEqual([]);
    expect(entry.priceCheck).toBe('price-out-of-scale');
    expect('priceCheck' in ingredient(result, 'F00-25'), 'a good product carries no priceCheck').toBe(false);
    const strong = product(result, 'spezia');
    expect(strong.reliability).toBe('da verificare');
    expect(strong.note).toBe('price-out-of-scale');
    expect(strong.inImport).toBe(true);
    expect(strong.prices.length, 'its price points are still shown').toBe(1);
    expect((strong.prices[0] as { good: boolean }).good).toBe(false);
  });

  test('a product with a discount line on its invoice is imported without a price', () => {
    const c = newCase();
    c.add([{ desc: 'FARINA', qty: 10, unit: 'KG', total: 10 }, { desc: 'SCONTO', total: -3 }]);
    const result = c.build();
    expect(result.importFile.ingredients.length).toBe(1);
    expect((result.importFile.ingredients[0] as { prices: unknown[] }).prices).toStrictEqual([]);
    expect((result.importFile.ingredients[0] as { priceCheck: string }).priceCheck).toBe('unattributed-discount');
    expect((result.products[0] as { note: string }).note).toBe('unattributed-discount');
    expect(result.excluded.filter((e) => e.level === 'line').length).toBe(1);
  });

  test('one bad invoice and one good one: the product keeps the good point', () => {
    const c = newCase();
    c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6 }], { date: '2026-09-10' });
    c.add([{ desc: 'FARINA', code: 'F', qty: 0, unit: 'KG', total: 5 }], { date: '2026-09-01' });
    const result = c.build();
    expect(result.importFile.ingredients.length).toBe(1);
    expect((result.importFile.ingredients[0] as { prices: { invoiceDate: string }[] }).prices.map((p) => p.invoiceDate)).toStrictEqual(['2026-09-10']);
    expect('priceCheck' in (result.importFile.ingredients[0] as object)).toBe(false);
    expect((result.products[0] as { reliability: string }).reliability).toBe('da verificare');
  });

  test('a product with a good and an out-of-scale invoice keeps only the good point', () => {
    const c = newCase();
    c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6 }], { date: '2026-09-01' });
    c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6000 }], { date: '2026-09-10' });
    const entry = c.build().importFile.ingredients[0] as { prices: { invoiceDate: string }[] };
    expect(entry.prices.map((p) => p.invoiceDate)).toStrictEqual(['2026-09-01']);
    expect('priceCheck' in entry).toBe(false);
  });

  test('candidates also holds the packaging and resale that could be imported, but the file does not', () => {
    const c = newCase();
    c.add([FLOUR, BAGS, COLA]);
    const result = c.build();
    expect(result.importFile.ingredients.map((i) => i.key)).toStrictEqual([KEY_FLOUR]);
    expect(result.candidates.map((i) => i.key).sort()).toStrictEqual([KEY_FLOUR, 'IT00000000001|name:coca cola lattina 33 cl']);
    const cola = product(result, 'coca');
    expect(cola.canImport).toBe(true);
    expect(cola.inImport).toBe(false);
    expect(cola.leftOutReason).toBe('not-an-ingredient');
    expect(product(result, 'buste').canImport, 'bags counted by piece have no weight to price by').toBe(false);
  });

  test('a product that cannot be read has no candidate and says why', () => {
    const c = newCase();
    c.add([SPICE]);
    const result = c.build();
    expect(result.candidates).toStrictEqual([]);
    expect(product(result, 'spezia').canImport).toBe(false);
    expect(product(result, 'spezia').unreadableReason).toBe('pieces-need-price-unit-and-weight');
  });

  test('the same inputs give the same file apart from generatedAt', () => {
    const make = () => {
      const c = newCase();
      c.add([FLOUR, SUGAR, EGGS], { vat: '00000000002', name: 'ALTRO FORNITORE ESEMPIO SPA', date: '2026-09-03' });
      c.add([{ ...FLOUR, total: 15 }, SUGAR], { date: '2026-09-10' });
      c.add([FLOUR], { vat: '00000000001', date: '2026-09-03', number: '7' });
      return c;
    };
    const first = make().build({ now: new Date('2026-10-03T10:15:00Z') });
    const second = make().build({ now: new Date('2026-10-03T18:00:00Z') });
    expect(first.importFile.generatedAt).not.toBe(second.importFile.generatedAt);
    expect({ ...first.importFile, generatedAt: '' }).toStrictEqual({ ...second.importFile, generatedAt: '' });
    expect(JSON.stringify(first.products)).toBe(JSON.stringify(second.products));
    const keys = first.importFile.ingredients.map((i) => i.key);
    expect(keys).toStrictEqual([...keys].sort());
    const suppliers = first.importFile.suppliers.map((s) => s.key);
    expect(suppliers).toStrictEqual([...suppliers].sort());
    for (const item of first.importFile.ingredients) {
      const order = item.prices.map((p) => [p.invoiceDate, p.invoiceId, p.line].join('|'));
      expect(order).toStrictEqual([...order].sort());
    }
  });

  test('generatedAt comes from the injected now: a Date, a number, a text, or nothing', () => {
    const c = newCase();
    c.add([FLOUR]);
    expect(c.build({ now: Date.UTC(2026, 9, 3, 10, 15, 30) }).importFile.generatedAt).toBe('2026-10-03T10:15:30Z');
    expect(c.build({ now: '2026-10-03T12:00:00+02:00' }).importFile.generatedAt).toBe('2026-10-03T10:00:00Z');
    expect(c.build({ now: null }).importFile.generatedAt).toBe('');
    expect(c.build({ now: 'not a date' }).importFile.generatedAt).toBe('');
  });

  test('excluded suppliers and documents are listed, not dropped', () => {
    const c = newCase();
    c.add([FLOUR], { vat: '00000000099', name: 'UTENZE ESEMPIO SPA' });
    c.add([SUGAR]);
    c.add([FLOUR], { docType: 'TD04', date: '2026-09-02' });
    const result = c.build({ excludedSuppliers: { 'it 00000000099': 'utenze' } });
    expect(result.importFile.suppliers.map((s) => s.key)).toStrictEqual(['IT00000000001']);
    expect(result.excluded.filter((e) => e.level === 'document').map((e) => e.reason).sort())
      .toStrictEqual(['document-type', 'supplier-excluded']);
    expect(result.documents.map((d) => `${d.status}:${d.reason}:${d.detail}`).sort())
      .toStrictEqual(['excluded:document-type:TD04', 'excluded:supplier-excluded:utenze', 'included::']);
    expect(result.excluded.map((e) => e.detail).sort()).toStrictEqual(['TD04', 'utenze']);
  });

  test('what the screen needs besides the file: skipped files, p7m, duplicates, other xml', () => {
    const xml = invoiceXml([FLOUR]);
    const c = newCase();
    c.zipOf('one.zip', { 'a.xml': xml, 'a_MT_001.xml': metadataXml('111'), 'a.xml.p7m': 'x', 'scan.pdf': 'x' });
    c.zipOf('two.zip', { 'b.xml': xml, 'b_MT_001.xml': metadataXml('111') });
    c.files.push({ name: 'broken.xml', bytes: bytesOf('<a>') });
    c.files.push({ name: 'loose.xml.p7m', bytes: bytesOf('x') });
    const result = c.build();
    expect(result.p7mCount).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(result.documents.length).toBe(1);
    expect(result.skippedFiles.map((s) => s.name)).toStrictEqual(['broken.xml']);
  });

  // ── the app's own model accepts what this builds ──

  test('parseImportFile accepts the file built from the fixtures with no invalid entry', () => {
    const c = newCase();
    for (const [name, content] of Object.entries(fixtureTexts())) c.files.push({ name, bytes: bytesOf(content) });
    const { importFile } = c.build();
    expect(importFile.ingredients.length).toBeGreaterThan(0);
    const parsed = legacyImportModel.parseImportFile(JSON.stringify(importFile));
    expect(parsed.ok).toBe(true);
    expect(parsed.file.ingredients.length).toBe(importFile.ingredients.length);
    expect(parsed.file.ingredients.filter((i) => i.invalid)).toStrictEqual([]);
    expect(parsed.file.suppliers.filter((s) => s.invalid)).toStrictEqual([]);
  });

  test('parseImportFile accepts every shape this builds: eggs, packs, litres, no-VAT supplier', () => {
    const c = newCase();
    c.add([FLOUR, SUGAR, EGGS, { desc: 'PASSATA kg 2,5 x 4', qty: 3, unit: 'CT', total: 60 },
      { desc: 'OLIO LT 1', qty: 6, unit: 'NR', total: 30 }]);
    c.add([FLOUR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, date: '2026-09-04' });
    const { importFile } = c.build();
    expect(importFile.ingredients.length).toBe(6);
    const parsed = legacyImportModel.parseImportFile(JSON.stringify(importFile));
    expect(parsed.ok).toBe(true);
    expect(parsed.file.ingredients.filter((i) => i.invalid)).toStrictEqual([]);
    expect(parsed.file.suppliers.filter((s) => s.invalid)).toStrictEqual([]);
    expect(importFile.suppliers.some((s) => /^NOVAT:[0-9a-f]{12}$/.test(s.key) && s.vatNumber === '')).toBeTruthy();
  });

  test('the tax code never appears in anything the build returns', () => {
    for (const options of [{}, { salt: 'pepper' }, { noVatKey: () => 'NOVAT:fixed' }]) {
      const c = newCase();
      c.add([FLOUR, SUGAR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, base: `IT${TAX_CODE}_00001` });
      c.add([FLOUR], { vat: '00000000001', base: `IT${TAX_CODE}_00002` });
      const text = JSON.stringify(c.build(options));
      expect(text.includes(TAX_CODE)).toBe(false);
      expect(text.toLowerCase().includes(TAX_CODE.toLowerCase())).toBe(false);
    }
  });

  // ── the zip limits ──

  test('an entry whose declared size is over the limit is refused before it is inflated', () => {
    // 31 MB of zeros is a ~30 KB zip: the declared size, not the compressed one, is what is checked.
    const big = zipSync({ 'huge.xml': new Uint8Array(31_000_000), 'ok.xml': strToU8(invoiceXml([FLOUR])), 'ok_MT_001.xml': strToU8(metadataXml('5')) });
    expect(big.length).toBeLessThan(200_000);
    const result = impl.buildImportFromInvoices([{ name: 'a.zip', bytes: big }], { parseXml: parseXmlTree });
    expect(result.skippedFiles).toStrictEqual([{ name: 'huge.xml', reason: 'file-too-large', detail: '' }]);
    expect(result.documents.length, 'the other entries are still read').toBe(1);
    expect(result.importFile.ingredients.length).toBe(1);
  });

  test('the declared size is checked per entry against the configured limit, before inflating', () => {
    const c = newCase();
    c.zipOf('a.zip', { 'small.xml': '<x/>', 'big.xml': `<x>${'a'.repeat(100)}</x>` });
    const read = c.read({ limits: { maxXmlBytes: 50 } });
    expect(Object.keys((read.containers[0] as { entries: object }).entries)).toStrictEqual(['small.xml']);
    expect(read.skipped).toStrictEqual([{ name: 'big.xml', reason: 'file-too-large', detail: '' }]);
  });

  test('more than 5000 entries in one archive refuses the whole archive, and says so', () => {
    expect(MAX_ARCHIVE_ENTRIES).toBe(5000);
    const members: Record<string, Uint8Array> = {};
    for (let i = 0; i <= 5000; i += 1) members[`n${i}.xml`] = strToU8('<x/>');
    const c = newCase();
    c.files.push({ name: 'many.zip', bytes: zipSync(members) });
    const read = c.read();
    expect(read.containers).toStrictEqual([]);
    expect(read.skipped.length).toBe(1);
    expect((read.skipped[0] as { name: string }).name).toBe('many.zip');
    expect([(read.skipped[0] as { reason: string }).reason, (read.skipped[0] as { detail: string }).detail]).toStrictEqual(['too-many-entries', '5000']);
    const exactly: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5000; i += 1) exactly[`n${i}.xml`] = strToU8('<x/>');
    const ok = newCase();
    ok.files.push({ name: 'edge.zip', bytes: zipSync(exactly) });
    expect(Object.keys((ok.read().containers[0] as { entries: object }).entries).length).toBe(5000);
  });

  test('a total declared size over the archive limit refuses the whole archive, and says so', () => {
    const c = newCase();
    c.zipOf('a.zip', { 'one.xml': `<x>${'a'.repeat(60)}</x>`, 'two.xml': `<x>${'b'.repeat(60)}</x>` });
    const read = c.read({ limits: { maxArchiveBytes: 100 } });
    expect(read.containers).toStrictEqual([]);
    expect(read.skipped).toStrictEqual([{ name: 'a.zip', reason: 'archive-too-large', detail: '' }]);
    expect((c.read({ limits: { maxArchiveBytes: 200 } }).containers[0] as { source: string }).source).toBe('a.zip');
  });

  test('PDFs and other files are ignored and not counted against the total; .p7m are counted', () => {
    const c = newCase();
    c.zipOf('a.zip', {
      'inv.xml': '<x/>', 'inv.pdf': new Uint8Array(5000), 'notes.txt': 'x', 'signed.XML.P7M': 'x', 'folder/': new Uint8Array(0),
      'folder\\nested.XML': '<y/>', 'folder/two.p7m': 'x',
    });
    const read = c.read({ limits: { maxArchiveBytes: 100 } });
    expect(Object.keys((read.containers[0] as { entries: object }).entries).sort()).toStrictEqual(['inv.xml', 'nested.XML']);
    expect(read.p7mCount).toBe(2);
    expect(read.skipped).toStrictEqual([]);
  });

  test('loose files: xml read, p7m counted, the rest ignored, zips first', () => {
    const c = newCase();
    c.files.push({ name: 'B.xml', bytes: bytesOf('<b/>') });
    c.files.push({ name: 'scan.pdf', bytes: bytesOf('x') });
    c.files.push({ name: 'a.p7m', bytes: bytesOf('x') });
    c.zipOf('Z.ZIP', { 'in.xml': '<z/>' });
    const read = c.read();
    expect(read.containers.map((x) => Object.keys(x.entries))).toStrictEqual([['in.xml'], ['B.xml']]);
    expect(read.p7mCount).toBe(1);
    expect(read.skipped).toStrictEqual([]);
  });

  test('an archive that lies about a size is truncated, never inflated past the declared size', () => {
    const real = strToU8(`<x>${'a'.repeat(200)}</x>`);
    const zip = zipSync({ 'a.xml': real });
    // Rewrite the declared uncompressed size (central directory, offset 24 of the entry) to 50 bytes.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let at = -1;
    for (let i = 0; i < zip.length - 4; i += 1) if (view.getUint32(i, true) === 0x02014b50) at = i;
    expect(at).toBeGreaterThan(0);
    view.setUint32(at + 24, 50, true);
    const c = newCase();
    c.files.push({ name: 'lie.zip', bytes: zip });
    const read = c.read();
    expect(((read.containers[0] as { entries: Record<string, Uint8Array> }).entries['a.xml'] as Uint8Array).length, 'exactly the declared size comes out, not the real 200').toBe(50);
  });

  test('a corrupt archive is reported, not thrown', () => {
    const c = newCase();
    c.files.push({ name: 'bad.zip', bytes: bytesOf('PK\x03\x04 definitely not a zip') });
    c.files.push({ name: 'empty.zip', bytes: new Uint8Array(0) });
    const read = c.read();
    expect(read.skipped.map((s) => [s.name, s.reason])).toStrictEqual([
      ['bad.zip', 'zip-unreadable'], ['empty.zip', 'zip-unreadable']]);
  });
});
