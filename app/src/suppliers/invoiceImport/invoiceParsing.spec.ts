// @vitest-environment node
//
// Reading invoices that come inside zip archives (P15), run against BOTH implementations: the TypeScript port (the zip
// reader in app/, the parser in shared/) and the js/orders/invoice-zip/ files the live app runs today. These are the six
// tests of tests/invoice-zip-parsing.test.mjs that open a zip, which needs fflate, so they cannot run in shared/ (the
// other 25 are in shared/src/invoice-zip/fatturapa.spec.ts).
//
// PORTED: 6 of the 31 tests of tests/invoice-zip-parsing.test.mjs ('a zip of the fixtures…', 'the same invoice in two zips
// counts once', 'without an SDI id the file name deduplicates', 'a broken zip and broken xml are reported, not fatal',
// 'a skipped file is never listed with a personal tax code', 'a file too big inside a zip and loose is listed redacted').
// Invented invoices only.

import { describe, expect, test } from 'vitest';
import {
  bytesOf, dump, fixtureTexts, invoiceXml, metadataXml,
} from '@mise/shared/invoice-zip/testing/invoice-builders';
import type { LineSpec } from '@mise/shared/invoice-zip/testing/invoice-builders';
import { implementations, makeZipCase } from './testing/implementations';

const LINE: LineSpec = { desc: 'FARINA TIPO 00 KG 25', qty: 25, unit: 'KG', total: 14.25 };
const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
const TAX_CODE = 'RSSMRA80A01H501U'; // invented: the classic textbook example

describe.each(implementations)('%s', (_name, impl) => {
  const newCase = () => makeZipCase(impl.caseImpl);

  test('a zip of the fixtures is read in memory; PDFs are ignored and .p7m counted', () => {
    const c = newCase();
    const members = { ...fixtureTexts(), 'invoice_ns3.pdf': 'not read', 'signed.xml.p7m': 'skipped' };
    c.zipOf('archive.zip', members);
    const load = c.load();
    expect(load.documents.length).toBe(3);
    expect(load.p7mCount).toBe(1);
    expect(load.skipped).toStrictEqual([]);
  });

  test('the same invoice in two zips counts once', () => {
    const xml = invoiceXml([LINE]);
    const c = newCase();
    c.zipOf('one.zip', { 'a.xml': xml, 'a_MT_001.xml': metadataXml('111') });
    // the second archive names the file differently: only the SDI id says it is the same
    c.zipOf('two.zip', { 'renamed.xml': xml, 'renamed_MT_001.xml': metadataXml('111') });
    const load = c.load();
    expect(load.documents.length).toBe(1);
    expect(load.duplicates).toBe(1);
  });

  test('without an SDI id the file name deduplicates', () => {
    const xml = invoiceXml([LINE]);
    const c = newCase();
    c.zipOf('one.zip', { 'same.xml': xml });
    c.zipOf('two.zip', { 'same.xml': xml });
    const load = c.load();
    expect(load.documents.length).toBe(1);
    expect((load.documents[0] as { docId: string }).docId).toBe('same');
  });

  test('a broken zip and broken xml are reported, not fatal', () => {
    const c = newCase();
    c.files.push({ name: 'broken.zip', bytes: bytesOf('not a zip') });
    c.files.push({ name: 'broken.xml', bytes: bytesOf('<a><b></a>') });
    c.add([LINE]);
    const load = c.load();
    expect(load.documents.length).toBe(1);
    expect(new Set(load.skipped.map((s) => s.name))).toStrictEqual(new Set(['broken.zip', 'broken.xml']));
    expect((load.skipped.find((s) => s.name === 'broken.zip') as { reason: string }).reason).toMatch(/^zip-unreadable$/);
    expect((load.skipped.find((s) => s.name === 'broken.xml') as { reason: string }).reason).toMatch(/^xml-unreadable$/);
  });

  test('a skipped file is never listed with a personal tax code', () => {
    const c = newCase();
    c.files.push({ name: `IT${TAX_CODE}_00001.xml`, bytes: bytesOf('<a><b></a>') });
    c.files.push({ name: `${TAX_CODE}.zip`, bytes: bytesOf('not a zip') });
    c.add([FLOUR]);
    const load = c.load();
    expect(load.skipped.map((s) => s.name).sort()).toStrictEqual(['***.zip', 'IT***_00001.xml']);
    expect(dump(load.skipped).includes(TAX_CODE)).toBe(false);
    expect(dump(c.build().skippedFiles).includes(TAX_CODE)).toBe(false);
  });

  test('a file too big inside a zip and loose is listed redacted', () => {
    const c = newCase();
    c.zipOf('a.zip', { [`IT${TAX_CODE}_1.xml`]: '<x>0123456789</x>' });
    c.files.push({ name: `IT${TAX_CODE}_2.xml`, bytes: bytesOf('<x>0123456789</x>') });
    const load = c.load({ limits: { maxXmlBytes: 10 } });
    expect(load.skipped.map((s) => s.name).sort()).toStrictEqual(['IT***_1.xml', 'IT***_2.xml']);
    expect(impl.fatturapa.redactFileName('nothing personal.xml')).toBe('nothing personal.xml');
  });
});
