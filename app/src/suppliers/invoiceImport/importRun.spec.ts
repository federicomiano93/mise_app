import { describe, expect, it } from 'vitest';
import { noVatKey } from '@mise/shared/invoice-zip/fatturapa';
import { decisionId } from '@mise/shared/invoice-zip/selection';
import { parseXmlTree } from '@mise/shared/invoice-zip/testing/xml-tree';
import { FLOUR, K_FLOUR, invoiceZip } from './testing/renderImport';
import { NO_TICKS, browserParseXml, chooseFrom, failureKey, readInvoiceFiles } from './importRun';

// The pure steps behind the import screen (part B3a): reading the files (with the venue's id as the salt), choosing from what was
// read, and the sentence a failure gets. (Parity I31, I35, I36.)
//
// PORTS (tests/invoice-import-screen.test.mjs): «the invoices are read in memory after the browser has painted "reading", with the
// platform parser» (the parser and the read; the paint is in the file spec, as «Reading the invoices…» seen while it reads).

const TAX_CODE = 'RSSMRA80A01H501U';
const NAME = 'FORNITORE SENZA PARTITA IVA';

describe('⚠️ reading the files', () => {
  it('the salt of a supplier without a VAT number is the VENUE\'S ID: its key is the hash of the venue\'s id and the tax code', async () => {
    const zip = invoiceZip([FLOUR], { vat: '', taxCode: TAX_CODE, name: NAME });
    const here = await readInvoiceFiles([zip], 'panificio-miano', parseXmlTree);
    const there = await readInvoiceFiles([zip], 'another-venue', parseXmlTree);
    const key = (built: typeof here) => built.importFile.suppliers[0]?.key;
    expect(key(here)).toBe(noVatKey(TAX_CODE, NAME, 'panificio-miano'));
    expect(key(there)).toBe(noVatKey(TAX_CODE, NAME, 'another-venue'));
    expect(key(here)).not.toBe(key(there));
    // The default salt is the empty one: a venue that forgot to pass its id would get this key, the same as every other venue.
    expect(key(here)).not.toBe(noVatKey(TAX_CODE, NAME, ''));
    expect(key(here)).toMatch(/^NOVAT:[0-9a-f]{12}$/);
  });

  it('reads every file it is given, and nothing is written anywhere (it has no database to write to)', async () => {
    const built = await readInvoiceFiles([invoiceZip(), invoiceZip([FLOUR], {}, 'altra.zip', '9000000002')], 'bakery', parseXmlTree);
    expect(built.importFile.suppliers).toHaveLength(1);
    expect(built.documents.length).toBeGreaterThanOrEqual(1);
  });

  it('the platform\'s parser: text → tree, and a broken file is refused (a skipped file, never a crash)', () => {
    expect(browserParseXml('<?xml version="1.0"?><a><b>x</b></a>').children[0]?.text).toBe('x');
    expect(() => browserParseXml('<a><b></a>')).toThrow();
  });
});

describe('choosing from what was read', () => {
  it('gives the file the next steps work on, and remembers the ticks', async () => {
    const built = await readInvoiceFiles([invoiceZip()], 'bakery', parseXmlTree);
    const run = chooseFrom(built, [], NO_TICKS, { suppliers: [], ingredients: [] });
    expect(run.file.suppliers.map(supplier => supplier.name)).toEqual(['FORNITORE ESEMPIO SRL']);
    expect(run.file.ingredients).toHaveLength(2);
    expect(run.selection.counts.invoices).toBe(1);
    expect(run.ticks).toBe(NO_TICKS);
  });

  it('a remembered skip takes a product out, and a tick brings it back', async () => {
    const built = await readInvoiceFiles([invoiceZip()], 'bakery', parseXmlTree);
    const stored = [{ id: decisionId(K_FLOUR), decision: 'skip' }];
    const without = chooseFrom(built, stored, NO_TICKS, { suppliers: [], ingredients: [] });
    expect(without.file.ingredients).toHaveLength(1);
    const back = chooseFrom(built, stored, { overrides: { [K_FLOUR]: 'ingredient' }, supplierOverrides: {} }, { suppliers: [], ingredients: [] });
    expect(back.file.ingredients).toHaveLength(2);
  });
});

describe('the sentence a failure gets', () => {
  it.each([
    ['permission-denied', 'sup.imp.stop.permission'],
    ['firestore/permission-denied', 'sup.imp.stop.permission'],
    ['offline', 'sup.imp.stop.offline'],
    ['unavailable', 'sup.imp.stop.offline'],
    ['timeout', 'sup.imp.stop.offline'],
    ['aborted', 'sup.imp.suppliers.failed'],
  ] as const)('%s', (code, key) => {
    expect(failureKey(Object.assign(new Error(code), { code }), 'sup.imp.suppliers.failed')).toBe(key);
  });

  it('an error without a code gets the screen\'s own sentence', () => {
    expect(failureKey(new Error('boom'), 'sup.imp.file.decisionsFailed')).toBe('sup.imp.file.decisionsFailed');
    expect(failureKey(undefined, 'sup.imp.file.decisionsFailed')).toBe('sup.imp.file.decisionsFailed');
  });
});
