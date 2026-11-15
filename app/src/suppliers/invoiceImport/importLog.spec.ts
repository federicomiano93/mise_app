// @vitest-environment node
//
// The import log (Federico's decision of 21 Oct 2026; Mise 2 only): the records, the summary and its missing months, the reader
// setting aside the invoices imported before, «A new, B already imported», and which invoices a run may record. Invented
// invoices only.

import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { invoiceXml, metadataXml } from '@mise/shared/invoice-zip/testing/invoice-builders';
import type { InvoiceSpec, LineSpec } from '@mise/shared/invoice-zip/testing/invoice-builders';
import { parseXmlTree } from '@mise/shared/invoice-zip/testing/xml-tree';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';
import { NO_TICKS, chooseFrom, readInvoiceFiles } from './importRun';
import {
  MAX_FILE_NAME, fileNameOf, fileVerdict, importedIds, logEntryOf, missingMonths, pastImports, recordOf, recordsOf, summarizeLog,
  unfinishedWithoutRun,
} from './importLog';
import type { ImportRecord } from './importLog';

const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00', qty: 25, unit: 'KG', total: 14.25 };
const SUGAR: LineSpec = { desc: 'ZUCCHERO SACCHI DA KG 25', code: 'Z25', qty: 50, unit: 'KG', total: 40 };
const K_FLOUR = 'IT00000000001|code:F00';
const K_SUGAR = 'IT00000000001|code:Z25';

// A zip of several invoices, each with its SdI metadata file: [lines, spec, sdi].
function zipOf(name: string, invoices: readonly (readonly [readonly LineSpec[], InvoiceSpec, string])[]): File {
  const members: Record<string, Uint8Array> = {};
  invoices.forEach(([lines, spec, sdi], i) => {
    members[`inv${i + 1}.xml`] = strToU8(invoiceXml(lines, spec));
    members[`inv${i + 1}_MT_001.xml`] = strToU8(metadataXml(sdi));
  });
  return new File([zipSync(members).slice().buffer], name);
}

const SEPTEMBER = zipOf('settembre.zip', [
  [[FLOUR], { date: '2026-09-03', number: '1' }, '9000000001'],
  [[SUGAR], { date: '2026-09-28', number: '2' }, '9000000002'],
]);

const record = (over: Partial<ImportRecord> = {}): ImportRecord => ({
  id: 'r1', fileName: 'agosto.zip', importedAt: '2026-10-01T09:00:00.000Z', firstDate: '2026-08-01', lastDate: '2026-08-31',
  months: ['2026-08'], invoiceIds: ['9000000001'], ...over,
});

describe('the records', () => {
  it('a stored document is read tolerantly: a wrong shape is dropped, never fatal', () => {
    const good = { ...record(), id: 'a', invoiceIds: ['1', 2, '', '3'], months: ['2026-08', 'agosto'] };
    expect(recordOf(good)).toEqual({ ...record(), id: 'a', invoiceIds: ['1', '3'], months: ['2026-08'] });
    expect(recordOf({ ...record(), id: 'b', firstDate: '1/8/2026' })).toBeNull();
    expect(recordOf({ ...record(), id: 'c', invoiceIds: [] })).toBeNull();
    expect(recordOf({ id: 'd', fileName: 'x' })).toBeNull();
    expect(recordsOf([good, { id: 'e' }])).toHaveLength(1);
  });

  it('the past imports are listed newest first', () => {
    const list = pastImports([
      record({ id: 'old', importedAt: '2026-09-01T09:00:00.000Z' }),
      record({ id: 'new', importedAt: '2026-10-20T09:00:00.000Z' }),
      record({ id: 'mid', importedAt: '2026-10-01T09:00:00.000Z' }),
    ]);
    expect(list.map(r => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('every imported invoice id, from every record', () => {
    expect([...importedIds([record(), record({ id: 'r2', invoiceIds: ['9000000002', '9000000001'] })])].sort())
      .toEqual(['9000000001', '9000000002']);
  });
});

describe('the summary and the missing months', () => {
  it('nothing imported yet: no summary', () => {
    expect(summarizeLog([])).toBeNull();
  });

  it('his PC zips: Nov 2025 and Aug 2026 imported → missing from December 2025 to July 2026', () => {
    const summary = summarizeLog([
      record({ id: 'a', firstDate: '2025-11-02', lastDate: '2025-11-28', months: ['2025-11'] }),
      record({ id: 'b', firstDate: '2026-08-01', lastDate: '2026-08-30', months: ['2026-08'] }),
    ]);
    expect(summary).toEqual({ firstDate: '2025-11-02', lastDate: '2026-08-30', gaps: [{ from: '2025-12', to: '2026-07' }] });
  });

  it('several holes, a one-month hole, and a record whose own range has a hole in it', () => {
    const summary = summarizeLog([record({ firstDate: '2026-01-10', lastDate: '2026-06-20', months: ['2026-01', '2026-03', '2026-06'] })]);
    expect(summary?.gaps).toEqual([{ from: '2026-02', to: '2026-02' }, { from: '2026-04', to: '2026-05' }]);
  });

  it('nothing missing, across a new year', () => {
    expect(missingMonths('2025-12-05', '2026-01-03', new Set(['2025-12', '2026-01']))).toEqual([]);
  });

  it('a month before the first or after the last invoice is never «missing»', () => {
    expect(summarizeLog([record()])?.gaps).toEqual([]);
  });
});

describe('⚠️ the reader sets aside the invoices imported before (by INVOICE id, never by file name)', () => {
  it('without the log nothing is set aside, and the result carries no such key (the current app\'s result, key for key)', async () => {
    const built = await readInvoiceFiles([SEPTEMBER], 'bakery', parseXmlTree);
    expect('alreadyImported' in built).toBe(false);
    expect(built.documents).toHaveLength(2);
  });

  it('one invoice imported before: it is set aside, and nothing of it reaches the import file', async () => {
    const renamed = new File([await SEPTEMBER.arrayBuffer()], 'un-altro-nome.zip');
    const built = await readInvoiceFiles([renamed], 'bakery', parseXmlTree, new Set(['9000000001']));
    expect(built.alreadyImported).toEqual([{ docId: '9000000001', sdiId: '9000000001', date: '2026-09-03' }]);
    expect(built.documents.map(doc => doc.docId)).toEqual(['9000000002']);
    expect(built.importFile.ingredients.map(i => i.key)).toEqual([K_SUGAR]);
    expect(built.products.some(p => p.key === K_FLOUR)).toBe(false);
    const verdict = fileVerdict(built, [record({ importedAt: '2026-10-05T08:00:00.000Z', invoiceIds: ['9000000001'] })]);
    expect(verdict).toEqual({
      total: 2, newCount: 1, oldCount: 1, firstDate: '2026-09-03', lastDate: '2026-09-28', importedAt: '2026-10-05T08:00:00.000Z',
    });
  });

  it('every invoice imported before: nothing new, and the day they were imported (the latest record that holds one)', async () => {
    const built = await readInvoiceFiles([SEPTEMBER], 'bakery', parseXmlTree, new Set(['9000000001', '9000000002']));
    expect(built.importFile.ingredients).toEqual([]);
    const verdict = fileVerdict(built, [
      record({ id: 'a', importedAt: '2026-10-05T08:00:00.000Z', invoiceIds: ['9000000001'] }),
      record({ id: 'b', importedAt: '2026-10-07T08:00:00.000Z', invoiceIds: ['9000000002'] }),
      record({ id: 'c', importedAt: '2026-10-09T08:00:00.000Z', invoiceIds: ['7'] }),
    ]);
    expect(verdict).toMatchObject({ total: 2, newCount: 0, oldCount: 2, importedAt: '2026-10-07T08:00:00.000Z' });
  });

  it('the twin of an imported invoice in the same file is still a duplicate, counted once', async () => {
    const twice = zipOf('doppio.zip', [
      [[FLOUR], { date: '2026-09-03' }, '9000000001'],
      [[FLOUR], { date: '2026-09-03' }, '9000000001'],
    ]);
    const built = await readInvoiceFiles([twice], 'bakery', parseXmlTree, new Set(['9000000001']));
    expect(built.duplicates).toBe(1);
    expect(built.alreadyImported).toHaveLength(1);
  });

  it('a credit note (an excluded document) is neither new nor counted', async () => {
    const mixed = zipOf('misto.zip', [
      [[FLOUR], { date: '2026-09-03' }, '9000000001'],
      [[FLOUR], { date: '2026-09-04', docType: 'TD04' }, '9000000003'],
    ]);
    const built = await readInvoiceFiles([mixed], 'bakery', parseXmlTree, new Set());
    expect(fileVerdict(built, [])).toMatchObject({ total: 1, newCount: 1, oldCount: 0, importedAt: '' });
  });
});

describe('what a run may record', () => {
  const entry = (key: string, status: string) => ({ planned: { key }, row: { status } }) as unknown as PlanEntry;

  it('the invoices of the file, sorted, with their months and dates — and no «who»', async () => {
    const built = await readInvoiceFiles([SEPTEMBER], 'bakery', parseXmlTree, new Set());
    const run = chooseFrom(built, [], NO_TICKS, { suppliers: [], ingredients: [] });
    const entry = logEntryOf({ built, file: run.file, unfinishedKeys: new Set(), fileNames: ['settembre.zip'], now: new Date('2026-10-25T10:00:00.000Z') });
    expect(entry).toEqual({
      fileName: 'settembre.zip', importedAt: '2026-10-25T10:00:00.000Z', firstDate: '2026-09-03', lastDate: '2026-09-28',
      months: ['2026-09'], invoiceIds: ['9000000001', '9000000002'],
    });
  });

  it('⚠️ a row that was not seen through keeps EVERY invoice it holds a price of out of the record', async () => {
    const built = await readInvoiceFiles([SEPTEMBER], 'bakery', parseXmlTree, new Set());
    const run = chooseFrom(built, [], NO_TICKS, { suppliers: [], ingredients: [] });
    const entry = logEntryOf({ built, file: run.file, unfinishedKeys: new Set([K_FLOUR]), fileNames: ['settembre.zip'], now: new Date() });
    expect(entry?.invoiceIds).toEqual(['9000000002']);
    expect(entry?.firstDate).toBe('2026-09-28');
    expect(logEntryOf({ built, file: run.file, unfinishedKeys: new Set([K_FLOUR, K_SUGAR]), fileNames: ['x.zip'], now: new Date() })).toBeNull();
  });

  it('the invoices set aside are never recorded twice', async () => {
    const built = await readInvoiceFiles([SEPTEMBER], 'bakery', parseXmlTree, new Set(['9000000001']));
    const run = chooseFrom(built, [], NO_TICKS, { suppliers: [], ingredients: [] });
    expect(logEntryOf({ built, file: run.file, unfinishedKeys: new Set(), fileNames: ['x.zip'], now: new Date() })?.invoiceIds).toEqual(['9000000002']);
  });

  it('the file name: a personal tax code blanked, names joined, cut to the rules\' cap', () => {
    expect(fileNameOf(['IT RSSMRA80A01H501U_00001.xml', ' b.zip '])).toBe('IT ***_00001.xml, b.zip');
    const long = fileNameOf(Array.from({ length: 100 }, (_, i) => `fatture-${i}.zip`));
    expect(long.length).toBe(MAX_FILE_NAME);
    expect(long.endsWith('…')).toBe(true);
  });

  it('«Done» with nothing to write: only a row the plan could not handle is unfinished', () => {
    expect([...unfinishedWithoutRun([entry('a', 'skipped'), entry('b', 'unchanged'), entry('c', 'error'), entry('d', 'mystery')])])
      .toEqual(['c', 'd']);
  });

  it('«Done» with nothing to write: a row whose price was held for a look («Lascia per ora») is unfinished, so it comes back', () => {
    const held = { planned: { key: 'h' }, row: { status: 'skipped', held: true } } as unknown as PlanEntry;
    expect([...unfinishedWithoutRun([entry('a', 'skipped'), held])]).toEqual(['h']);
  });
});
