// Unit tests for reading an invoice (P15), run against BOTH implementations: the TypeScript port in shared/ and
// js/orders/invoice-zip/fatturapa.js. Ported from tests/invoice-zip-parsing.test.mjs (itself a port of
// invoice-import/tests/test_parsing.py and the parsing parts of test_review_fixes.py) and from the `domToTree` test of
// tests/invoice-zip-support.test.mjs. The module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 25 of the 31 tests of tests/invoice-zip-parsing.test.mjs. The other 6 open zip archives, which is app code
// (the zip reader needs fflate): they are in app/src/suppliers/invoiceImport/invoiceParsing.spec.ts, against both
// readers ('a zip of the fixtures…', 'the same invoice in two zips counts once', 'without an SDI id the file name
// deduplicates', 'a broken zip and broken xml are reported, not fatal', 'a skipped file is never listed with a
// personal tax code', 'a file too big inside a zip and loose is listed redacted'). Also here: 'domToTree converts…'
// (1 of the 9 tests of tests/invoice-zip-support.test.mjs that A1 left; the other two, of the test XML reader, are in
// testing/xml-tree.spec.ts). With these, the nine tests of that file are all ported.
// The port is driven with `looseRead` (testing/invoice-builders.ts) where the original uses its own zip reader: every
// invoice here is a loose file. Two tests that hash with node:crypto use the platform's Web Crypto instead (async).
// Added: the constants, ownerVatOf and the sales invoices, the size limit, a missing parser.

import { describe, expect, test } from 'vitest';
import { implementations } from './testing/implementations';
import {
  bytesOf, dump, fixtureTexts, invoiceXml, makeCase, metadataXml, platformSha256,
} from './testing/invoice-builders';
import type { InvoiceCase, LineSpec } from './testing/invoice-builders';
import { parseXmlTree } from './testing/xml-tree';
import type { InvoiceDocument } from './fatturapa';
import type { ExcludedRow } from './products';

const LINE: LineSpec = { desc: 'FARINA TIPO 00 KG 25', qty: 25, unit: 'KG', total: 14.25 };
const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
const TAX_CODE = 'RSSMRA80A01H501U'; // invented: the classic textbook example

describe.each(implementations)('%s', (_name, impl) => {
  const {
    isoDate, noVatKey, normaliseVat, redactFileName, METADATA_RE, number, parseXmlBytes, decodeXml, domToTree,
  } = impl.fatturapa;
  const { evaluate, proposeParams } = impl.products;
  const newCase = (): InvoiceCase => makeCase(impl.caseImpl);

  function fixtureCase(): InvoiceCase {
    const c = newCase();
    for (const [name, content] of Object.entries(fixtureTexts())) c.files.push({ name, bytes: bytesOf(content) });
    return c;
  }

  // ── the namespace styles ──

  test('the three namespace styles and their metadata files', () => {
    const load = fixtureCase().load();
    expect(load.documents.length).toBe(3);
    const byVat = Object.fromEntries(load.documents.map((d) => [d.vatNumber, d])) as Record<string, InvoiceDocument>;
    const ns3 = byVat['IT00000000001'] as InvoiceDocument;
    expect(ns3.supplierName).toBe('FORNITORE ESEMPIO SRL');
    expect(ns3.sdiId).toBe('18000000001');
    expect(ns3.receptionDate).toBe('2026-09-01');
    expect(ns3.date).toBe('2026-08-31');
    expect((ns3.lines[0] as { articleCode: string }).articleCode).toBe('F00-25');
    expect((ns3.lines[0] as { quantity: number }).quantity).toBe(25.0);
    expect((byVat['IT00000000002'] as InvoiceDocument).number).toBe('55/A');
    expect((byVat['IT00000000002'] as InvoiceDocument).sdiId).toBe('18000000002');
    expect((byVat['IT00000000003'] as InvoiceDocument).docType).toBe('TD24');
  });

  test('metadata files are never read as invoices', () => {
    const load = fixtureCase().load();
    expect(load.otherXml).toBe(0);
    expect(load.skipped).toStrictEqual([]);
    expect(load.documents.map((d) => d.file).sort()).toStrictEqual(['invoice_default', 'invoice_ns3', 'invoice_p']);
  });

  test('the metadata file name pattern', () => {
    expect((METADATA_RE.exec('IT01_00001_MT_001.xml') as RegExpExecArray).slice(1, 3)).toStrictEqual(['IT01_00001', undefined]);
    expect((METADATA_RE.exec('IT01_00001_PAD_MT_002.XML') as RegExpExecArray).slice(1, 3)).toStrictEqual(['IT01_00001', '_PAD']);
    expect(METADATA_RE.exec('IT01_00001.xml')).toBe(null);
  });

  // ── what is not an invoice ──

  test('a DTD is refused', () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><FatturaElettronica>&a;</FatturaElettronica>';
    const c = newCase();
    c.files.push({ name: 'evil.xml', bytes: bytesOf(evil) });
    const load = c.load();
    expect(load.documents).toStrictEqual([]);
    expect((load.skipped[0] as { name: string }).name).toBe('evil.xml');
    expect((load.skipped[0] as { reason: string }).reason).toBe('dtd-not-allowed');
  });

  test('no files at all gives an empty result', () => {
    const load = newCase().load();
    expect([load.documents, load.skipped, load.p7mCount]).toStrictEqual([[], [], 0]);
  });

  test('an XML that is not an invoice is counted, not read', () => {
    const c = newCase();
    c.files.push({ name: 'other.xml', bytes: bytesOf('<?xml version="1.0"?><Other/>') });
    expect(c.load().otherXml).toBe(1);
  });

  test('a non-UTF-8 declaration is honoured, a BOM is dropped, a plain parser is not needed for bytes', () => {
    const latin1 = Uint8Array.from([...'<?xml version="1.0" encoding="ISO-8859-1"?><A>caff'].map((ch) => ch.charCodeAt(0)).concat([0xe8, 0x3c, 0x2f, 0x41, 0x3e]));
    expect(parseXmlBytes(latin1, parseXmlTree).text).toBe('caffè');
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytesOf('<A>è</A>')]);
    expect(parseXmlBytes(bom, parseXmlTree).text).toBe('è');
    expect(decodeXml(bytesOf('<?xml version="1.0" encoding="UTF-8"?><A>€</A>')).includes('€')).toBe(true);
    expect(() => parseXmlBytes(new Uint8Array(0), parseXmlTree)).toThrow();
  });

  test('the small readers: numbers, dates, VAT', () => {
    expect(number('25,50')).toBe(25.5);
    expect(number('')).toBe(null);
    expect(number('abc')).toBe(null);
    expect(isoDate('2026-09-01T08:30:00+02:00')).toBe('2026-09-01');
    expect(isoDate('Tue, 01 Sep 2026 10:15:00 +0200')).toBe('2026-09-01');
    expect(isoDate('1 Sep 26')).toBe('2026-09-01');
    expect(isoDate('31 Feb 2026')).toBe('');
    expect(isoDate('not a date')).toBe('');
    expect(isoDate('')).toBe('');
    expect(normaliseVat('it', ' 0000 0000 001')).toBe('IT00000000001');
  });

  // ── document types ──

  test('a credit note is excluded and listed', () => {
    const c = newCase();
    c.add([LINE], { docType: 'TD04', number: '9' });
    c.add([LINE], { date: '2026-09-02', number: '2' });
    const catalogue = c.catalogue();
    expect(catalogue.products.size).toBe(1);
    const docs = catalogue.excluded.filter((e) => e.level === 'document');
    expect(docs.map((e) => e.reason)).toStrictEqual(['document-type']);
    expect((docs[0] as { number: string }).number).toBe('9');
  });

  test('TD24 and TD25 are kept', () => {
    const c = newCase();
    c.add([LINE], { docType: 'TD24' });
    c.add([LINE], { docType: 'TD25', date: '2026-09-02' });
    expect(c.catalogue().excluded.filter((e) => e.level === 'document')).toStrictEqual([]);
  });

  // ── supplier identity ──

  test('same VAT, two spellings: one supplier with the latest name', () => {
    const c = newCase();
    c.add([LINE], { name: 'FORNITORE ESEMPIO SRL', date: '2026-09-01' });
    c.add([LINE], { name: 'Fornitore Esempio S.r.l.', date: '2026-09-05', vat: '00000000001' });
    const catalogue = c.catalogue();
    expect([...catalogue.suppliers.keys()]).toStrictEqual(['IT00000000001']);
    expect((catalogue.suppliers.get('IT00000000001') as { name: string }).name).toBe('Fornitore Esempio S.r.l.');
    expect(catalogue.products.size).toBe(1);
  });

  test('similar names with different VATs are two suppliers', () => {
    const c = newCase();
    c.add([LINE], { name: 'FORNITORE ESEMPIO SRL', vat: '00000000001' });
    c.add([LINE], { name: 'FORNITORE ESEMPIO SRL', vat: '00000000002' });
    const catalogue = c.catalogue();
    expect([...catalogue.suppliers.keys()].sort()).toStrictEqual(['IT00000000001', 'IT00000000002']);
    expect(catalogue.products.size).toBe(2);
  });

  test('a supplier without VAT gets a hashed key and the tax code never appears anywhere', () => {
    const c = newCase();
    c.add([LINE], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, base: `${TAX_CODE}_00001` });
    const catalogue = c.catalogue();
    const [key] = [...catalogue.suppliers.keys()] as [string];
    expect(key).toMatch(/^NOVAT:[0-9a-f]{12}$/);
    expect((catalogue.suppliers.get(key) as { vatNumber: string }).vatNumber).toBe('');
    // the file name began with the tax code: it is blanked wherever the file is shown
    expect((catalogue.documents[0] as InvoiceDocument).file.toLowerCase().includes(TAX_CODE.toLowerCase())).toBe(false);
    for (const everything of [dump(catalogue), dump(c.build())]) {
      expect(everything.includes(TAX_CODE)).toBe(false);
      expect(everything.toLowerCase().includes(TAX_CODE.toLowerCase())).toBe(false);
    }
  });

  test('a personal tax code in a file name is blanked even when there is a VAT number', () => {
    const c = newCase();
    c.add([LINE], { vat: '00000000001', base: `IT${TAX_CODE}_00007` });
    const [doc] = c.catalogue().documents as [InvoiceDocument];
    expect(doc.file).toBe('IT***_00007');
    expect(doc.docId.includes(TAX_CODE)).toBe(false);
  });

  test('the no-VAT key is stable per tax code', () => {
    expect(noVatKey('ABC', 'x')).toBe(noVatKey(' abc ', 'other name'));
    expect(noVatKey('ABC', '')).not.toBe(noVatKey('ABD', ''));
  });

  test('a configured supplier is excluded with its reason', () => {
    const c = newCase();
    c.add([LINE], { vat: '00000000099', name: 'UTENZE ESEMPIO SPA' });
    c.add([LINE], { vat: '00000000001' });
    const catalogue = c.catalogue({ excludedSuppliers: { 'it 00000000099': 'utenze' } });
    expect(([...catalogue.suppliers.values()][0] as { key: string }).key).toBe('IT00000000099');
    expect(new Set([...catalogue.products.values()].map((p) => p.supplierKey))).toStrictEqual(new Set(['IT00000000001']));
    const docRow = catalogue.excluded.filter((e) => e.level === 'document')[0] as ExcludedRow;
    expect([docRow.reason, docRow.detail]).toStrictEqual(['supplier-excluded', 'utenze']);
  });

  // ── no SDI id, a second invoice in one file, file names ──

  test('a document without an SDI id is excluded and listed, never given a file-name id', () => {
    const c = newCase();
    c.writeInvoice('no-metadata', invoiceXml([FLOUR])); // no _MT file: no SDI id
    c.add([{ desc: 'ZUCCHERO SACCHI DA KG 25', qty: 50, unit: 'KG', total: 40 }]);
    const catalogue = c.catalogue();
    expect(catalogue.products.size, 'only the invoice that has an SDI id is read').toBe(1);
    const docRow = catalogue.excluded.filter((e) => e.level === 'document')[0] as ExcludedRow;
    expect(docRow.reason).toBe('no-sdi-id');
    const points = [...catalogue.products.values()]
      .flatMap((p) => evaluate(p, proposeParams(p, catalogue.config), catalogue).points);
    expect(points.length).toBeTruthy();
    for (const point of points) expect(point.invoiceId, 'an invoice id is the SDI id, digits only').toMatch(/^[0-9]+$/);
  });

  test('it shows in the documents as excluded', () => {
    const c = newCase();
    c.writeInvoice('no-metadata', invoiceXml([FLOUR]));
    expect([...c.catalogue().docStatus.values()]).toStrictEqual([{ status: 'excluded', reason: 'no-sdi-id', detail: '' }]);
    expect(c.build().documents.map((d) => [d.status, d.reason])).toStrictEqual([['excluded', 'no-sdi-id']]);
  });

  function twoBodies(): string {
    const first = invoiceXml([FLOUR], { number: '1', date: '2026-09-01' });
    const second = invoiceXml([FLOUR], { number: '2', date: '2026-09-05' });
    const body = second.slice(second.indexOf('<FatturaElettronicaBody>'), second.indexOf('</p:FatturaElettronica>'));
    return first.replace('</p:FatturaElettronica>', `${body}</p:FatturaElettronica>`);
  }

  test('line numbers are pushed up per body, so ids stay unique, digits and short', () => {
    const c = newCase();
    c.writeInvoice('two-in-one', twoBodies(), '9000000001');
    const load = c.load();
    expect(load.documents.length).toBe(2);
    expect(load.duplicates, 'the second invoice is not a duplicate of the first').toBe(0);
    expect(load.documents.map((d) => d.lines.map((l) => l.number))).toStrictEqual([[1], [100001]]);
    const [catalogue, product] = c.onlyProduct();
    const points = evaluate(product, proposeParams(product, catalogue.config), catalogue).points;
    expect(points.map((p) => [p.invoiceId, p.line])).toStrictEqual([['9000000001', 1], ['9000000001', 100001]]);
    for (const p of points) expect(p.line).toBeLessThanOrEqual(999999);
  });

  test('a file with too many invoices is listed, not read', () => {
    const first = invoiceXml([FLOUR]);
    const body = first.slice(first.indexOf('<FatturaElettronicaBody>'), first.indexOf('</p:FatturaElettronica>'));
    const c = newCase();
    c.writeInvoice('huge', first.replace('</p:FatturaElettronica>', `${body.repeat(9)}</p:FatturaElettronica>`), '9000000002');
    const load = c.load();
    expect(load.documents).toStrictEqual([]);
    expect(load.skipped.map((s) => s.name)).toStrictEqual(['huge.xml']);
    expect([(load.skipped[0] as { reason: string }).reason, (load.skipped[0] as { detail: string }).detail]).toStrictEqual(['too-many-invoices-in-file', '9']);
  });

  // ── the key of a supplier without a VAT number ──

  test('the default key is the first 12 hex of SHA-256(salt + tax code)', async () => {
    const salt = '0123456789abcdef';
    const c = newCase();
    c.add([FLOUR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE, base: `${TAX_CODE}_00001` });
    const expected = `NOVAT:${(await platformSha256(salt + TAX_CODE)).slice(0, 12)}`;
    const unsalted = `NOVAT:${(await platformSha256(TAX_CODE)).slice(0, 12)}`;
    const keys = (options?: { salt: string }): string[] => [...c.catalogue(options).suppliers.keys()];
    expect(keys({ salt })).toStrictEqual([expected]);
    expect(expected, 'an unsalted hash of a tax code could be reversed by trying them all').not.toBe(unsalted);
    expect(keys({ salt }), 'the same on a second run').toStrictEqual([expected]);
    expect(keys()).toStrictEqual([`NOVAT:${(await platformSha256(TAX_CODE)).slice(0, 12)}`]);
  });

  test('two salts give two keys, and a lower-case, spaced tax code gives the same key', () => {
    expect(noVatKey(TAX_CODE, '', 'aaaa')).not.toBe(noVatKey(TAX_CODE, '', 'bbbb'));
    expect(noVatKey(TAX_CODE, '', 'aaaa')).toBe(noVatKey(` ${TAX_CODE.toLowerCase()} `, 'x', 'aaaa'));
  });

  test('without a tax code the supplier name is hashed instead', () => {
    expect(noVatKey('', 'Mario  Rossi', 's')).toBe(noVatKey('', ' mario rossi ', 's'));
    expect(noVatKey('', 'Mario Rossi')).toMatch(/^NOVAT:[0-9a-f]{12}$/);
  });

  test('the key function is injectable and receives the tax code and the name', () => {
    const calls: [string, string][] = [];
    const c = newCase();
    c.add([FLOUR], { name: 'Mario Rossi', vat: '', taxCode: TAX_CODE });
    const catalogue = c.catalogue({ noVatKey: (taxCode, name) => { calls.push([taxCode, name]); return 'NOVAT:custom'; } });
    expect([...catalogue.suppliers.keys()]).toStrictEqual(['NOVAT:custom']);
    expect(calls).toStrictEqual([[TAX_CODE, 'Mario Rossi']]);
    expect(dump(catalogue).includes(TAX_CODE)).toBe(false);
  });

  test('a sole trader named by first and last name', () => {
    const xml = invoiceXml([FLOUR], { vat: '', taxCode: TAX_CODE })
      .replace('<Anagrafica><Denominazione>FORNITORE ESEMPIO SRL</Denominazione></Anagrafica>',
        '<Anagrafica><Nome>Mario</Nome><Cognome>Rossi</Cognome></Anagrafica>');
    const c = newCase();
    c.writeInvoice('sole', xml, '9000000009');
    const [doc] = c.load().documents as [InvoiceDocument];
    expect(doc.supplierName).toBe('Mario Rossi');
    expect(doc.vatNumber).toBe('');
  });

  // ── domToTree (tests/invoice-zip-support.test.mjs) ──

  test('domToTree converts what a DOMParser result exposes and refuses a parsererror document', () => {
    const el = (localName: string, childNodes: { nodeType: number; nodeValue?: string }[]) => ({ nodeType: 1, localName, childNodes });
    const txt = (nodeValue: string, nodeType = 3) => ({ nodeType, nodeValue });
    const document = {
      documentElement: el('A', [txt('hi '), txt('there', 4), el('B', [txt('x')]), txt('tail'), { nodeType: 8, nodeValue: 'c' }]),
      getElementsByTagName: () => [],
    };
    expect(domToTree(document)).toStrictEqual({
      name: 'A', text: 'hi there', children: [{ name: 'B', text: 'x', children: [] }],
    });
    expect(() => domToTree({ documentElement: el('parsererror', []) })).toThrow(/invalid XML/);
    expect(() => domToTree({ documentElement: el('a', []), getElementsByTagName: () => [{}] as unknown as [] })).toThrow(/invalid XML/);
    expect(() => domToTree({ documentElement: null })).toThrow(/empty XML/);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the constants the import relies on', () => {
    expect(impl.fatturapa.KEPT_TYPES).toStrictEqual(['TD01', 'TD24', 'TD25']);
    expect([impl.fatturapa.LINE_BLOCK, impl.fatturapa.MAX_BODIES, impl.fatturapa.MAX_XML_BYTES]).toStrictEqual([100_000, 9, 30_000_000]);
  });

  test('redactFileName blanks anything shaped like a personal tax code, and only that', () => {
    expect(redactFileName(`IT${TAX_CODE}_1.xml`)).toBe('IT***_1.xml');
    expect(redactFileName('nothing personal.xml')).toBe('nothing personal.xml');
  });

  test('a file over the size limit is refused before it is decoded', () => {
    expect(() => parseXmlBytes(new Uint8Array(impl.fatturapa.MAX_XML_BYTES + 1), parseXmlTree)).toThrow('file-too-large');
  });

  test('loadInvoices needs a parser', () => {
    expect(() => impl.fatturapa.loadInvoices({ containers: [], p7mCount: 0, skipped: [] })).toThrow(/parseXml/);
  });

  test('ownerVatOf: only a strict majority of the buyers named is the owner', () => {
    const docs = (...vats: string[]) => vats.map((buyerVat) => ({ buyerVat }));
    expect(impl.fatturapa.ownerVatOf(docs('A', 'A', 'B'))).toBe('A');
    expect(impl.fatturapa.ownerVatOf(docs('A', 'B'))).toBe('');
    expect(impl.fatturapa.ownerVatOf(docs('', ''))).toBe('');
    expect(impl.fatturapa.ownerVatOf([])).toBe('');
  });

  test('an invoice the owner issued himself is a sale, not a price: dropped and counted', () => {
    const c = newCase();
    c.add([LINE], { vat: '00000000001', buyerVat: '00000000099' });
    c.add([LINE], { vat: '00000000002', buyerVat: '00000000099', date: '2026-09-02' });
    c.add([LINE], { vat: '00000000099', buyerVat: '00000000001', date: '2026-09-03' });
    const load = c.load();
    expect(load.salesSkipped).toBe(1);
    expect(load.documents.map((d) => d.vatNumber).sort()).toStrictEqual(['IT00000000001', 'IT00000000002']);
    expect(c.build().salesSkipped).toBe(1);
  });

  test('a metadata file supplies the SDI id and the reception date', () => {
    const c = newCase();
    c.files.push({ name: 'a.xml', bytes: bytesOf(invoiceXml([LINE])) });
    c.files.push({
      name: 'a_PAD_MT_001.xml',
      bytes: bytesOf(`${metadataXml('777').replace('</FileMetadati>', '<PECEmailDate>Tue, 01 Sep 2026 10:15:00 +0200</PECEmailDate></FileMetadati>')}`),
    });
    const [doc] = c.load().documents as [InvoiceDocument];
    expect([doc.sdiId, doc.receptionDate, doc.docId]).toStrictEqual(['777', '2026-09-01', '777']);
  });
});
