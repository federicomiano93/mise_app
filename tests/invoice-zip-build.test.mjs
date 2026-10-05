// buildImportFromInvoices: the whole path from the picked files to the import file (the port of
// test_export.py's shape, units, left-out and determinism tests, without the workbook in the middle),
// plus the zip limits and the «the tax code never leaves» guarantee. Invented invoices only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../js/vendor/fflate.esm.js';
import { parseImportFile } from '../js/orders/invoice-import-model.js';
import { MAX_ARCHIVE_ENTRIES } from '../js/orders/invoice-zip/zip-read.js';
import { buildImportFromInvoices } from '../js/orders/invoice-zip/build-import.js';
import { bytesOf, fixtureTexts, invoiceXml, metadataXml, newCase } from './helpers/invoice-builders.mjs';
import { parseXmlTree } from './helpers/xml-tree.mjs';

const FLOUR = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
const SUGAR = { desc: 'ZUCCHERO SACCHI DA KG 25', qty: 50, unit: 'KG', total: 40 };
const BAGS = { desc: 'BUSTE PLASTICA', qty: 2, unit: 'PZ', total: 10 };
const COLA = { desc: 'COCA COLA LATTINA 33 CL', qty: 24, unit: 'PZ', total: 12 };
const EGGS = { desc: 'UOVA FRESCHE DA 30 UOVA', qty: 2, unit: 'CT', total: 36 };
const SPICE = { desc: 'SPEZIA MISTA', qty: 4, unit: 'PZ', total: 20 };
const KEY_FLOUR = 'IT00000000001|code:F00-25';
const TAX_CODE = 'RSSMRA80A01H501U';

const ingredient = (result, part) => {
  const hits = result.importFile.ingredients.filter((i) => i.key.includes(part));
  assert.equal(hits.length, 1, part);
  return hits[0];
};
const product = (result, part) => {
  const hits = result.products.filter((p) => p.key.includes(part));
  assert.equal(hits.length, 1, part);
  return hits[0];
};

test('the file has the agreed shape and only ingredients are in it', () => {
  const c = newCase();
  c.add([FLOUR, SUGAR, BAGS, COLA]);
  const result = c.build();
  const { importFile } = result;
  assert.equal(importFile.format, 'mise-invoice-import');
  assert.equal(importFile.version, 1);
  assert.equal(importFile.generatedAt, '2026-10-03T10:15:00Z');
  assert.deepEqual(importFile.suppliers, [
    { key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }]);
  assert.deepEqual(importFile.ingredients.map((i) => i.key), [KEY_FLOUR, 'IT00000000001|name:zucchero sacchi da kg 25']);
  assert.deepEqual(importFile.ingredients[0], {
    key: KEY_FLOUR, supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00', brand: '', category: '',
    supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null, priceUnit: 'kg', unitWeightKg: null,
    vatRate: 4,
    prices: [{ invoiceId: '9000000001', line: 1, invoiceDate: '2026-09-01', pricePerUnit: 0.57, qty: 25 }],
  });
});

test('products lists EVERY product with what the workbook would show', () => {
  const c = newCase();
  c.add([COLA, BAGS, SUGAR, FLOUR]);
  const result = c.build();
  assert.deepEqual(result.products.map((p) => p.type), ['ingrediente', 'ingrediente', 'packaging', 'rivendita']);
  assert.deepEqual(result.products.map((p) => p.name), ['Farina tipo 00', 'Zucchero', 'Buste plastica', 'Coca cola lattina']);
  const flour = product(result, 'F00-25');
  assert.equal(flour.supplierName, 'FORNITORE ESEMPIO SRL');
  assert.equal(flour.priceUnit, 'kg');
  assert.equal(flour.weight, '25 kg');
  assert.equal(flour.packUnit, 'sacco');
  assert.equal(flour.lastPrice, 0.57);
  assert.equal(flour.reliability, 'alta');
  assert.equal(flour.purchases, 1);
  assert.equal(flour.inImport, true);
  assert.equal(flour.brand, '');
  assert.equal(flour.category, '');
  assert.equal(flour.vatRate, 4);
  assert.deepEqual(product(result, 'buste').leftOutReason, 'not-an-ingredient');
  assert.equal(product(result, 'buste').inImport, false);
  assert.equal(product(result, 'coca').type, 'rivendita');
});

test('price history: last, min, max and the points oldest first', () => {
  const c = newCase();
  c.add([{ ...FLOUR, total: 12.5 }], { date: '2026-09-01' });
  c.add([{ ...FLOUR, total: 15.0 }], { date: '2026-09-15' });
  const flour = product(c.build(), 'F00-25');
  assert.deepEqual([flour.lastPrice, flour.minPrice, flour.maxPrice], [0.6, 0.5, 0.6]);
  assert.equal(flour.purchases, 2);
  assert.equal(flour.lastDate, '2026-09-15');
  assert.equal(flour.totalQty, 50);
  assert.deepEqual(flour.prices.map((p) => p.invoiceDate), ['2026-09-01', '2026-09-15']);
});

test('suppliers are only the referenced ones', () => {
  const c = newCase();
  c.add([FLOUR], { vat: '00000000001', name: 'FORNITORE ESEMPIO SRL' });
  c.add([BAGS], { vat: '00000000002', name: 'ALTRO FORNITORE ESEMPIO SPA' });
  assert.deepEqual(c.build().importFile.suppliers.map((s) => s.key), ['IT00000000001']);
});

test('eggs are pieces with the egg weight; a tray of 30 is a carton of 30 eggs', () => {
  const c = newCase();
  c.add([EGGS]);
  const eggs = ingredient(c.build({ eggWeightG: 50 }), 'uova');
  assert.deepEqual([eggs.priceUnit, eggs.unitWeightKg, eggs.packCount], ['pcs', 0.05, 30]);
  assert.equal(eggs.prices[0].pricePerUnit, 0.6);
  assert.equal(eggs.prices[0].qty, 60);
  assert.equal(eggs.weight, '');
  assert.equal(eggs.packUnit, 'uovo');
  assert.equal(ingredient(c.build({ eggWeightG: 52 }), 'uova').unitWeightKg, 0.052);
});

test('six trays of ten eggs is a pack count of sixty', () => {
  const c = newCase();
  c.add([{ desc: 'UOVA FRESCHE 6 X 10 UOVA', qty: 2, unit: 'CT', total: 72 }]);
  const item = c.build().importFile.ingredients[0];
  assert.deepEqual([item.priceUnit, item.packCount, item.packUnit], ['pcs', 60, 'uovo']);
});

test('pack of packs in the card model, and litres stay litres', () => {
  let c = newCase();
  c.add([{ desc: 'PASSATA kg 2,5 x 4', qty: 3, unit: 'CT', total: 60 }]);
  let item = ingredient(c.build(), 'passata');
  assert.deepEqual([item.weight, item.packCount, item.priceUnit], ['2.5 kg', 4, 'kg']);
  assert.deepEqual([item.prices[0].pricePerUnit, item.prices[0].qty], [2.0, 30.0]);

  c = newCase();
  c.add([{ desc: 'OLIO LT 1', qty: 6, unit: 'NR', total: 30 }]);
  item = ingredient(c.build(), 'olio');
  assert.deepEqual([item.priceUnit, item.weight, item.unitWeightKg], ['l', '1 l', null]);
});

test('a pieces line with no weight stays out with its reason', () => {
  const c = newCase();
  c.add([FLOUR, SPICE]);
  const result = c.build();
  assert.deepEqual(result.importFile.ingredients.map((i) => i.key), [KEY_FLOUR]);
  const spice = product(result, 'spezia');
  assert.equal(spice.inImport, false);
  assert.equal(spice.leftOutReason, 'pieces-need-price-unit-and-weight');
  assert.equal(spice.reliability, 'da verificare');
  assert.deepEqual(spice.prices, []);
});

test('a price «da verificare» is not in the file, it stays in products with its reason', () => {
  const c = newCase();
  c.add([FLOUR, { desc: 'SPEZIA FORTE', qty: 100, unit: 'KG', total: 4 }]);
  const result = c.build();
  assert.deepEqual(result.importFile.ingredients.map((i) => i.key), [KEY_FLOUR]);
  const strong = product(result, 'spezia');
  assert.equal(strong.reliability, 'da verificare');
  assert.equal(strong.note, 'price-out-of-scale');
  assert.equal(strong.leftOutReason, 'price-out-of-scale');
  assert.equal(strong.prices.length, 1, 'its price points are still shown');
});

test('a product with a discount line on its invoice is «da verificare» and out of the file', () => {
  const c = newCase();
  c.add([{ desc: 'FARINA', qty: 10, unit: 'KG', total: 10 }, { desc: 'SCONTO', total: -3 }]);
  const result = c.build();
  assert.deepEqual(result.importFile.ingredients, []);
  assert.equal(result.products[0].note, 'unattributed-discount');
  assert.equal(result.excluded.filter((e) => e.level === 'line').length, 1);
});

test('the product with one bad invoice and one good one is not offered', () => {
  const c = newCase();
  c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6 }], { date: '2026-09-10' });
  c.add([{ desc: 'FARINA', code: 'F', qty: 0, unit: 'KG', total: 5 }], { date: '2026-09-01' });
  const result = c.build();
  assert.deepEqual(result.importFile.ingredients, []);
  assert.equal(result.products[0].prices.length, 1);
  assert.equal(result.products[0].reliability, 'da verificare');
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
  assert.notEqual(first.importFile.generatedAt, second.importFile.generatedAt);
  assert.deepEqual({ ...first.importFile, generatedAt: '' }, { ...second.importFile, generatedAt: '' });
  assert.equal(JSON.stringify(first.products), JSON.stringify(second.products));
  const keys = first.importFile.ingredients.map((i) => i.key);
  assert.deepEqual(keys, [...keys].sort());
  const suppliers = first.importFile.suppliers.map((s) => s.key);
  assert.deepEqual(suppliers, [...suppliers].sort());
  for (const item of first.importFile.ingredients) {
    const order = item.prices.map((p) => [p.invoiceDate, p.invoiceId, p.line].join('|'));
    assert.deepEqual(order, [...order].sort());
  }
});

test('generatedAt comes from the injected now: a Date, a number, a text, or nothing', () => {
  const c = newCase();
  c.add([FLOUR]);
  assert.equal(c.build({ now: Date.UTC(2026, 9, 3, 10, 15, 30) }).importFile.generatedAt, '2026-10-03T10:15:30Z');
  assert.equal(c.build({ now: '2026-10-03T12:00:00+02:00' }).importFile.generatedAt, '2026-10-03T10:00:00Z');
  assert.equal(c.build({ now: null }).importFile.generatedAt, '');
  assert.equal(c.build({ now: 'not a date' }).importFile.generatedAt, '');
});

test('excluded suppliers and documents are listed, not dropped', () => {
  const c = newCase();
  c.add([FLOUR], { vat: '00000000099', name: 'UTENZE ESEMPIO SPA' });
  c.add([SUGAR]);
  c.add([FLOUR], { docType: 'TD04', date: '2026-09-02' });
  const result = c.build({ excludedSuppliers: { 'it 00000000099': 'utenze' } });
  assert.deepEqual(result.importFile.suppliers.map((s) => s.key), ['IT00000000001']);
  assert.deepEqual(result.excluded.filter((e) => e.level === 'document').map((e) => e.reason).sort(),
    ['document-type', 'supplier-excluded']);
  assert.deepEqual(result.documents.map((d) => `${d.status}:${d.reason}:${d.detail}`).sort(),
    ['excluded:document-type:TD04', 'excluded:supplier-excluded:utenze', 'included::']);
  assert.deepEqual(result.excluded.map((e) => e.detail).sort(), ['TD04', 'utenze']);
});

test('what the screen needs besides the file: skipped files, p7m, duplicates, other xml', () => {
  const xml = invoiceXml([FLOUR]);
  const c = newCase();
  c.zipOf('one.zip', { 'a.xml': xml, 'a_MT_001.xml': metadataXml('111'), 'a.xml.p7m': 'x', 'scan.pdf': 'x' });
  c.zipOf('two.zip', { 'b.xml': xml, 'b_MT_001.xml': metadataXml('111') });
  c.files.push({ name: 'broken.xml', bytes: bytesOf('<a>') });
  c.files.push({ name: 'loose.xml.p7m', bytes: bytesOf('x') });
  const result = c.build();
  assert.equal(result.p7mCount, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.documents.length, 1);
  assert.deepEqual(result.skippedFiles.map((s) => s.name), ['broken.xml']);
});

// ── the app's own model accepts what this builds ──

test('parseImportFile accepts the file built from the fixtures with no invalid entry', () => {
  const c = newCase();
  for (const [name, content] of Object.entries(fixtureTexts())) c.files.push({ name, bytes: bytesOf(content) });
  const { importFile } = c.build();
  assert.ok(importFile.ingredients.length > 0);
  const parsed = parseImportFile(JSON.stringify(importFile));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.file.ingredients.length, importFile.ingredients.length);
  assert.deepEqual(parsed.file.ingredients.filter((i) => i.invalid), []);
  assert.deepEqual(parsed.file.suppliers.filter((s) => s.invalid), []);
});

test('parseImportFile accepts every shape this builds: eggs, packs, litres, no-VAT supplier', () => {
  const c = newCase();
  c.add([FLOUR, SUGAR, EGGS, { desc: 'PASSATA kg 2,5 x 4', qty: 3, unit: 'CT', total: 60 },
    { desc: 'OLIO LT 1', qty: 6, unit: 'NR', total: 30 }]);
  c.add([FLOUR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, date: '2026-09-04' });
  const { importFile } = c.build();
  assert.equal(importFile.ingredients.length, 6);
  const parsed = parseImportFile(JSON.stringify(importFile));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.file.ingredients.filter((i) => i.invalid), []);
  assert.deepEqual(parsed.file.suppliers.filter((s) => s.invalid), []);
  assert.ok(importFile.suppliers.some((s) => /^NOVAT:[0-9a-f]{12}$/.test(s.key) && s.vatNumber === ''));
});

test('the tax code never appears in anything the build returns', () => {
  for (const options of [{}, { salt: 'pepper' }, { noVatKey: () => 'NOVAT:fixed' }]) {
    const c = newCase();
    c.add([FLOUR, SUGAR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, base: `IT${TAX_CODE}_00001` });
    c.add([FLOUR], { vat: '00000000001', base: `IT${TAX_CODE}_00002` });
    const text = JSON.stringify(c.build(options));
    assert.ok(!text.includes(TAX_CODE));
    assert.ok(!text.toLowerCase().includes(TAX_CODE.toLowerCase()));
  }
});

// ── the zip limits ──

test('an entry whose declared size is over the limit is refused before it is inflated', () => {
  // 31 MB of zeros is a ~30 KB zip: the declared size, not the compressed one, is what is checked.
  const big = zipSync({ 'huge.xml': new Uint8Array(31_000_000), 'ok.xml': strToU8(invoiceXml([FLOUR])), 'ok_MT_001.xml': strToU8(metadataXml('5')) });
  assert.ok(big.length < 200_000);
  const result = buildImportFromInvoices([{ name: 'a.zip', bytes: big }], { parseXml: parseXmlTree });
  assert.deepEqual(result.skippedFiles, [{ name: 'huge.xml', reason: 'file-too-large', detail: '' }]);
  assert.equal(result.documents.length, 1, 'the other entries are still read');
  assert.equal(result.importFile.ingredients.length, 1);
});

test('the declared size is checked per entry against the configured limit, before inflating', () => {
  const c = newCase();
  c.zipOf('a.zip', { 'small.xml': '<x/>', 'big.xml': `<x>${'a'.repeat(100)}</x>` });
  const read = c.read({ limits: { maxXmlBytes: 50 } });
  assert.deepEqual(Object.keys(read.containers[0].entries), ['small.xml']);
  assert.deepEqual(read.skipped, [{ name: 'big.xml', reason: 'file-too-large', detail: '' }]);
});

test('more than 5000 entries in one archive refuses the whole archive, and says so', () => {
  assert.equal(MAX_ARCHIVE_ENTRIES, 5000);
  const members = {};
  for (let i = 0; i <= 5000; i += 1) members[`n${i}.xml`] = strToU8('<x/>');
  const c = newCase();
  c.files.push({ name: 'many.zip', bytes: zipSync(members) });
  const read = c.read();
  assert.deepEqual(read.containers, []);
  assert.equal(read.skipped.length, 1);
  assert.equal(read.skipped[0].name, 'many.zip');
  assert.deepEqual([read.skipped[0].reason, read.skipped[0].detail], ['too-many-entries', '5000']);
  const exactly = {};
  for (let i = 0; i < 5000; i += 1) exactly[`n${i}.xml`] = strToU8('<x/>');
  const ok = newCase();
  ok.files.push({ name: 'edge.zip', bytes: zipSync(exactly) });
  assert.equal(Object.keys(ok.read().containers[0].entries).length, 5000);
});

test('a total declared size over the archive limit refuses the whole archive, and says so', () => {
  const c = newCase();
  c.zipOf('a.zip', { 'one.xml': `<x>${'a'.repeat(60)}</x>`, 'two.xml': `<x>${'b'.repeat(60)}</x>` });
  const read = c.read({ limits: { maxArchiveBytes: 100 } });
  assert.deepEqual(read.containers, []);
  assert.deepEqual(read.skipped, [{ name: 'a.zip', reason: 'archive-too-large', detail: '' }]);
  assert.equal(c.read({ limits: { maxArchiveBytes: 200 } }).containers[0].source, 'a.zip');
});

test('PDFs and other files are ignored and not counted against the total; .p7m are counted', () => {
  const c = newCase();
  c.zipOf('a.zip', {
    'inv.xml': '<x/>', 'inv.pdf': new Uint8Array(5000), 'notes.txt': 'x', 'signed.XML.P7M': 'x', 'folder/': new Uint8Array(0),
    'folder\\nested.XML': '<y/>', 'folder/two.p7m': 'x',
  });
  const read = c.read({ limits: { maxArchiveBytes: 100 } });
  assert.deepEqual(Object.keys(read.containers[0].entries).sort(), ['inv.xml', 'nested.XML']);
  assert.equal(read.p7mCount, 2);
  assert.deepEqual(read.skipped, []);
});

test('loose files: xml read, p7m counted, the rest ignored, zips first', () => {
  const c = newCase();
  c.files.push({ name: 'B.xml', bytes: bytesOf('<b/>') });
  c.files.push({ name: 'scan.pdf', bytes: bytesOf('x') });
  c.files.push({ name: 'a.p7m', bytes: bytesOf('x') });
  c.zipOf('Z.ZIP', { 'in.xml': '<z/>' });
  const read = c.read();
  assert.deepEqual(read.containers.map((x) => Object.keys(x.entries)), [['in.xml'], ['B.xml']]);
  assert.equal(read.p7mCount, 1);
  assert.deepEqual(read.skipped, []);
});

test('an archive that lies about a size is truncated, never inflated past the declared size', () => {
  const real = strToU8(`<x>${'a'.repeat(200)}</x>`);
  const zip = zipSync({ 'a.xml': real });
  // Rewrite the declared uncompressed size (central directory, offset 24 of the entry) to 50 bytes.
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let at = -1;
  for (let i = 0; i < zip.length - 4; i += 1) if (view.getUint32(i, true) === 0x02014b50) at = i;
  assert.ok(at > 0);
  view.setUint32(at + 24, 50, true);
  const c = newCase();
  c.files.push({ name: 'lie.zip', bytes: zip });
  const read = c.read();
  assert.equal(read.containers[0].entries['a.xml'].length, 50, 'exactly the declared size comes out, not the real 200');
});

test('a corrupt archive is reported, not thrown', () => {
  const c = newCase();
  c.files.push({ name: 'bad.zip', bytes: bytesOf('PK\x03\x04 definitely not a zip') });
  c.files.push({ name: 'empty.zip', bytes: new Uint8Array(0) });
  const read = c.read();
  assert.deepEqual(read.skipped.map((s) => [s.name, s.reason]), [
    ['bad.zip', 'zip-unreadable'], ['empty.zip', 'zip-unreadable']]);
});
