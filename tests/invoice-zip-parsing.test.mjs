// Port of invoice-import/tests/test_parsing.py and the parsing parts of test_review_fixes.py: reading the
// three namespace styles, the metadata files, duplicates, document types, supplier identity, the SDI id,
// a second invoice in one file, file names. Invented invoices only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  isoDate, noVatKey, normaliseVat, redactFileName, METADATA_RE, number, parseXmlBytes, decodeXml,
} from '../js/orders/invoice-zip/fatturapa.js';
import { evaluate, proposeParams } from '../js/orders/invoice-zip/products.js';
import {
  bytesOf, fixtureTexts, invoiceXml, metadataXml, newCase,
} from './helpers/invoice-builders.mjs';
import { parseXmlTree } from './helpers/xml-tree.mjs';

const LINE = { desc: 'FARINA TIPO 00 KG 25', qty: 25, unit: 'KG', total: 14.25 };
const FLOUR = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
const TAX_CODE = 'RSSMRA80A01H501U'; // invented: the classic textbook example

// Everything an object holds, as text, Maps and Sets included — for «this never appears anywhere» checks.
const dump = (value) => JSON.stringify(value, (key, v) => {
  if (v instanceof Map) return [...v.entries()];
  if (v instanceof Set) return [...v];
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  return v;
});

function fixtureCase() {
  const c = newCase();
  for (const [name, content] of Object.entries(fixtureTexts())) c.files.push({ name, bytes: bytesOf(content) });
  return c;
}

// ── the namespace styles ──

test('the three namespace styles and their metadata files', () => {
  const load = fixtureCase().load();
  assert.equal(load.documents.length, 3);
  const byVat = Object.fromEntries(load.documents.map((d) => [d.vatNumber, d]));
  const ns3 = byVat.IT00000000001;
  assert.equal(ns3.supplierName, 'FORNITORE ESEMPIO SRL');
  assert.equal(ns3.sdiId, '18000000001');
  assert.equal(ns3.receptionDate, '2026-09-01');
  assert.equal(ns3.date, '2026-08-31');
  assert.equal(ns3.lines[0].articleCode, 'F00-25');
  assert.equal(ns3.lines[0].quantity, 25.0);
  assert.equal(byVat.IT00000000002.number, '55/A');
  assert.equal(byVat.IT00000000002.sdiId, '18000000002');
  assert.equal(byVat.IT00000000003.docType, 'TD24');
});

test('metadata files are never read as invoices', () => {
  const load = fixtureCase().load();
  assert.equal(load.otherXml, 0);
  assert.deepEqual(load.skipped, []);
  assert.deepEqual(load.documents.map((d) => d.file).sort(), ['invoice_default', 'invoice_ns3', 'invoice_p']);
});

test('the metadata file name pattern', () => {
  assert.deepEqual(METADATA_RE.exec('IT01_00001_MT_001.xml').slice(1, 3), ['IT01_00001', undefined]);
  assert.deepEqual(METADATA_RE.exec('IT01_00001_PAD_MT_002.XML').slice(1, 3), ['IT01_00001', '_PAD']);
  assert.equal(METADATA_RE.exec('IT01_00001.xml'), null);
});

// ── zip ──

test('a zip of the fixtures is read in memory; PDFs are ignored and .p7m counted', () => {
  const c = newCase();
  const members = { ...fixtureTexts(), 'invoice_ns3.pdf': 'not read', 'signed.xml.p7m': 'skipped' };
  c.zipOf('archive.zip', members);
  const load = c.load();
  assert.equal(load.documents.length, 3);
  assert.equal(load.p7mCount, 1);
  assert.deepEqual(load.skipped, []);
});

test('the same invoice in two zips counts once', () => {
  const xml = invoiceXml([LINE]);
  const c = newCase();
  c.zipOf('one.zip', { 'a.xml': xml, 'a_MT_001.xml': metadataXml('111') });
  // the second archive names the file differently: only the SDI id says it is the same
  c.zipOf('two.zip', { 'renamed.xml': xml, 'renamed_MT_001.xml': metadataXml('111') });
  const load = c.load();
  assert.equal(load.documents.length, 1);
  assert.equal(load.duplicates, 1);
});

test('without an SDI id the file name deduplicates', () => {
  const xml = invoiceXml([LINE]);
  const c = newCase();
  c.zipOf('one.zip', { 'same.xml': xml });
  c.zipOf('two.zip', { 'same.xml': xml });
  const load = c.load();
  assert.equal(load.documents.length, 1);
  assert.equal(load.documents[0].docId, 'same');
});

test('a broken zip and broken xml are reported, not fatal', () => {
  const c = newCase();
  c.files.push({ name: 'broken.zip', bytes: bytesOf('not a zip') });
  c.files.push({ name: 'broken.xml', bytes: bytesOf('<a><b></a>') });
  c.add([LINE]);
  const load = c.load();
  assert.equal(load.documents.length, 1);
  assert.deepEqual(new Set(load.skipped.map((s) => s.name)), new Set(['broken.zip', 'broken.xml']));
  assert.match(load.skipped.find((s) => s.name === 'broken.zip').reason, /^zip-unreadable$/);
  assert.match(load.skipped.find((s) => s.name === 'broken.xml').reason, /^xml-unreadable$/);
});

test('a DTD is refused', () => {
  const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><FatturaElettronica>&a;</FatturaElettronica>';
  const c = newCase();
  c.files.push({ name: 'evil.xml', bytes: bytesOf(evil) });
  const load = c.load();
  assert.deepEqual(load.documents, []);
  assert.equal(load.skipped[0].name, 'evil.xml');
  assert.equal(load.skipped[0].reason, 'dtd-not-allowed');
});

test('no files at all gives an empty result', () => {
  const load = newCase().load();
  assert.deepEqual([load.documents, load.skipped, load.p7mCount], [[], [], 0]);
});

test('an XML that is not an invoice is counted, not read', () => {
  const c = newCase();
  c.files.push({ name: 'other.xml', bytes: bytesOf('<?xml version="1.0"?><Other/>') });
  assert.equal(c.load().otherXml, 1);
});

test('a non-UTF-8 declaration is honoured, a BOM is dropped, a plain parser is not needed for bytes', () => {
  const latin1 = Uint8Array.from([...'<?xml version="1.0" encoding="ISO-8859-1"?><A>caff'].map((ch) => ch.charCodeAt(0)).concat([0xe8, 0x3c, 0x2f, 0x41, 0x3e]));
  assert.equal(parseXmlBytes(latin1, parseXmlTree).text, 'caffè');
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<A>è</A>')]);
  assert.equal(parseXmlBytes(bom, parseXmlTree).text, 'è');
  assert.equal(decodeXml(new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><A>€</A>')).includes('€'), true);
  assert.throws(() => parseXmlBytes(new Uint8Array(0), parseXmlTree));
});

test('the small readers: numbers, dates, VAT', () => {
  assert.equal(number('25,50'), 25.5);
  assert.equal(number(''), null);
  assert.equal(number('abc'), null);
  assert.equal(isoDate('2026-09-01T08:30:00+02:00'), '2026-09-01');
  assert.equal(isoDate('Tue, 01 Sep 2026 10:15:00 +0200'), '2026-09-01');
  assert.equal(isoDate('1 Sep 26'), '2026-09-01');
  assert.equal(isoDate('31 Feb 2026'), '');
  assert.equal(isoDate('not a date'), '');
  assert.equal(isoDate(''), '');
  assert.equal(normaliseVat('it', ' 0000 0000 001'), 'IT00000000001');
});

// ── document types ──

test('a credit note is excluded and listed', () => {
  const c = newCase();
  c.add([LINE], { docType: 'TD04', number: '9' });
  c.add([LINE], { date: '2026-09-02', number: '2' });
  const catalogue = c.catalogue();
  assert.equal(catalogue.products.size, 1);
  const docs = catalogue.excluded.filter((e) => e.level === 'document');
  assert.deepEqual(docs.map((e) => e.reason), ['document-type']);
  assert.equal(docs[0].number, '9');
});

test('TD24 and TD25 are kept', () => {
  const c = newCase();
  c.add([LINE], { docType: 'TD24' });
  c.add([LINE], { docType: 'TD25', date: '2026-09-02' });
  assert.deepEqual(c.catalogue().excluded.filter((e) => e.level === 'document'), []);
});

// ── supplier identity ──

test('same VAT, two spellings: one supplier with the latest name', () => {
  const c = newCase();
  c.add([LINE], { name: 'FORNITORE ESEMPIO SRL', date: '2026-09-01' });
  c.add([LINE], { name: 'Fornitore Esempio S.r.l.', date: '2026-09-05', vat: '00000000001' });
  const catalogue = c.catalogue();
  assert.deepEqual([...catalogue.suppliers.keys()], ['IT00000000001']);
  assert.equal(catalogue.suppliers.get('IT00000000001').name, 'Fornitore Esempio S.r.l.');
  assert.equal(catalogue.products.size, 1);
});

test('similar names with different VATs are two suppliers', () => {
  const c = newCase();
  c.add([LINE], { name: 'FORNITORE ESEMPIO SRL', vat: '00000000001' });
  c.add([LINE], { name: 'FORNITORE ESEMPIO SRL', vat: '00000000002' });
  const catalogue = c.catalogue();
  assert.deepEqual([...catalogue.suppliers.keys()].sort(), ['IT00000000001', 'IT00000000002']);
  assert.equal(catalogue.products.size, 2);
});

test('a supplier without VAT gets a hashed key and the tax code never appears anywhere', () => {
  const c = newCase();
  c.add([LINE], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, base: `${TAX_CODE}_00001` });
  const catalogue = c.catalogue();
  const [key] = [...catalogue.suppliers.keys()];
  assert.match(key, /^NOVAT:[0-9a-f]{12}$/);
  assert.equal(catalogue.suppliers.get(key).vatNumber, '');
  // the file name began with the tax code: it is blanked wherever the file is shown
  assert.ok(!catalogue.documents[0].file.toLowerCase().includes(TAX_CODE.toLowerCase()));
  for (const everything of [dump(catalogue), dump(c.build())]) {
    assert.ok(!everything.includes(TAX_CODE));
    assert.ok(!everything.toLowerCase().includes(TAX_CODE.toLowerCase()));
  }
});

test('a personal tax code in a file name is blanked even when there is a VAT number', () => {
  const c = newCase();
  c.add([LINE], { vat: '00000000001', base: `IT${TAX_CODE}_00007` });
  const [doc] = c.catalogue().documents;
  assert.equal(doc.file, 'IT***_00007');
  assert.ok(!doc.docId.includes(TAX_CODE));
});

test('the no-VAT key is stable per tax code', () => {
  assert.equal(noVatKey('ABC', 'x'), noVatKey(' abc ', 'other name'));
  assert.notEqual(noVatKey('ABC', ''), noVatKey('ABD', ''));
});

test('a configured supplier is excluded with its reason', () => {
  const c = newCase();
  c.add([LINE], { vat: '00000000099', name: 'UTENZE ESEMPIO SPA' });
  c.add([LINE], { vat: '00000000001' });
  const catalogue = c.catalogue({ excludedSuppliers: { 'it 00000000099': 'utenze' } });
  assert.equal([...catalogue.suppliers.values()][0].key, 'IT00000000099');
  assert.deepEqual(new Set([...catalogue.products.values()].map((p) => p.supplierKey)), new Set(['IT00000000001']));
  const [docRow] = catalogue.excluded.filter((e) => e.level === 'document');
  assert.deepEqual([docRow.reason, docRow.detail], ['supplier-excluded', 'utenze']);
});

// ── no SDI id, a second invoice in one file, file names ──

test('a document without an SDI id is excluded and listed, never given a file-name id', () => {
  const c = newCase();
  c.writeInvoice('no-metadata', invoiceXml([FLOUR])); // no _MT file: no SDI id
  c.add([{ desc: 'ZUCCHERO SACCHI DA KG 25', qty: 50, unit: 'KG', total: 40 }]);
  const catalogue = c.catalogue();
  assert.equal(catalogue.products.size, 1, 'only the invoice that has an SDI id is read');
  const [docRow] = catalogue.excluded.filter((e) => e.level === 'document');
  assert.equal(docRow.reason, 'no-sdi-id');
  const points = [...catalogue.products.values()]
    .flatMap((p) => evaluate(p, proposeParams(p, catalogue.config), catalogue).points);
  assert.ok(points.length);
  for (const point of points) assert.match(point.invoiceId, /^[0-9]+$/, 'an invoice id is the SDI id, digits only');
});

test('it shows in the documents as excluded', () => {
  const c = newCase();
  c.writeInvoice('no-metadata', invoiceXml([FLOUR]));
  assert.deepEqual([...c.catalogue().docStatus.values()], [{ status: 'excluded', reason: 'no-sdi-id', detail: '' }]);
  assert.deepEqual(c.build().documents.map((d) => [d.status, d.reason]), [['excluded', 'no-sdi-id']]);
});

function twoBodies() {
  const first = invoiceXml([FLOUR], { number: '1', date: '2026-09-01' });
  const second = invoiceXml([FLOUR], { number: '2', date: '2026-09-05' });
  const body = second.slice(second.indexOf('<FatturaElettronicaBody>'), second.indexOf('</p:FatturaElettronica>'));
  return first.replace('</p:FatturaElettronica>', `${body}</p:FatturaElettronica>`);
}

test('line numbers are pushed up per body, so ids stay unique, digits and short', () => {
  const c = newCase();
  c.writeInvoice('two-in-one', twoBodies(), '9000000001');
  const load = c.load();
  assert.equal(load.documents.length, 2);
  assert.equal(load.duplicates, 0, 'the second invoice is not a duplicate of the first');
  assert.deepEqual(load.documents.map((d) => d.lines.map((l) => l.number)), [[1], [100001]]);
  const [catalogue, product] = c.onlyProduct();
  const points = evaluate(product, proposeParams(product, catalogue.config), catalogue).points;
  assert.deepEqual(points.map((p) => [p.invoiceId, p.line]), [['9000000001', 1], ['9000000001', 100001]]);
  for (const p of points) assert.ok(p.line <= 999999);
});

test('a file with too many invoices is listed, not read', () => {
  const first = invoiceXml([FLOUR]);
  const body = first.slice(first.indexOf('<FatturaElettronicaBody>'), first.indexOf('</p:FatturaElettronica>'));
  const c = newCase();
  c.writeInvoice('huge', first.replace('</p:FatturaElettronica>', `${body.repeat(9)}</p:FatturaElettronica>`), '9000000002');
  const load = c.load();
  assert.deepEqual(load.documents, []);
  assert.deepEqual(load.skipped.map((s) => s.name), ['huge.xml']);
  assert.deepEqual([load.skipped[0].reason, load.skipped[0].detail], ['too-many-invoices-in-file', '9']);
});

test('a skipped file is never listed with a personal tax code', () => {
  const c = newCase();
  c.files.push({ name: `IT${TAX_CODE}_00001.xml`, bytes: bytesOf('<a><b></a>') });
  c.files.push({ name: `${TAX_CODE}.zip`, bytes: bytesOf('not a zip') });
  c.add([FLOUR]);
  const load = c.load();
  assert.deepEqual(load.skipped.map((s) => s.name).sort(), ['***.zip', 'IT***_00001.xml']);
  assert.ok(!dump(load.skipped).includes(TAX_CODE));
  assert.ok(!dump(c.build().skippedFiles).includes(TAX_CODE));
});

test('a file too big inside a zip and loose is listed redacted', () => {
  const c = newCase();
  c.zipOf('a.zip', { [`IT${TAX_CODE}_1.xml`]: '<x>0123456789</x>' });
  c.files.push({ name: `IT${TAX_CODE}_2.xml`, bytes: bytesOf('<x>0123456789</x>') });
  const load = c.load({ limits: { maxXmlBytes: 10 } });
  assert.deepEqual(load.skipped.map((s) => s.name).sort(), ['IT***_1.xml', 'IT***_2.xml']);
  assert.equal(redactFileName('nothing personal.xml'), 'nothing personal.xml');
});

// ── the key of a supplier without a VAT number ──

test('the default key is the first 12 hex of SHA-256(salt + tax code)', () => {
  const salt = '0123456789abcdef';
  const c = newCase();
  c.add([FLOUR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, base: `${TAX_CODE}_00001` });
  const expected = `NOVAT:${createHash('sha256').update(salt + TAX_CODE).digest('hex').slice(0, 12)}`;
  const unsalted = `NOVAT:${createHash('sha256').update(TAX_CODE).digest('hex').slice(0, 12)}`;
  const keys = (options) => [...c.catalogue(options).suppliers.keys()];
  assert.deepEqual(keys({ salt }), [expected]);
  assert.notEqual(expected, unsalted, 'an unsalted hash of a tax code could be reversed by trying them all');
  assert.deepEqual(keys({ salt }), [expected], 'the same on a second run');
  assert.deepEqual(keys(), [`NOVAT:${createHash('sha256').update(TAX_CODE).digest('hex').slice(0, 12)}`]);
});

test('two salts give two keys, and a lower-case, spaced tax code gives the same key', () => {
  assert.notEqual(noVatKey(TAX_CODE, '', 'aaaa'), noVatKey(TAX_CODE, '', 'bbbb'));
  assert.equal(noVatKey(TAX_CODE, '', 'aaaa'), noVatKey(` ${TAX_CODE.toLowerCase()} `, 'x', 'aaaa'));
});

test('without a tax code the supplier name is hashed instead', () => {
  assert.equal(noVatKey('', 'Mario  Rossi', 's'), noVatKey('', ' mario rossi ', 's'));
  assert.match(noVatKey('', 'Mario Rossi'), /^NOVAT:[0-9a-f]{12}$/);
});

test('the key function is injectable and receives the tax code and the name', () => {
  const calls = [];
  const c = newCase();
  c.add([FLOUR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE });
  const catalogue = c.catalogue({ noVatKey: (taxCode, name) => { calls.push([taxCode, name]); return 'NOVAT:custom'; } });
  assert.deepEqual([...catalogue.suppliers.keys()], ['NOVAT:custom']);
  assert.deepEqual(calls, [[TAX_CODE, 'Mario Rossi']]);
  assert.ok(!dump(catalogue).includes(TAX_CODE));
});

test('a sole trader named by first and last name', () => {
  const xml = invoiceXml([FLOUR], { vat: '', taxCode: TAX_CODE })
    .replace('<Anagrafica><Denominazione>FORNITORE ESEMPIO SRL</Denominazione></Anagrafica>',
      '<Anagrafica><Nome>Mario</Nome><Cognome>Rossi</Cognome></Anagrafica>');
  const c = newCase();
  c.writeInvoice('sole', xml, '9000000009');
  const [doc] = c.load().documents;
  assert.equal(doc.supplierName, 'Mario Rossi');
  assert.equal(doc.vatNumber, '');
});
