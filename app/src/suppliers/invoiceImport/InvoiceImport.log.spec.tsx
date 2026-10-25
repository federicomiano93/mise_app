import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../../testing/fakeSuppliersSource';
import { supplier } from '../../testing/renderSuppliers';
import { fakeImportSource } from './testing/fakeImportSource';
import type { FakeImportSource } from './testing/fakeImportSource';
import type { StoredDoc } from '../suppliersSource';
import {
  FLOUR, LOAD, chooseFiles, findImportScreen, invoicesZip, renderImport, toIngredients,
} from './testing/renderImport';

// «Import from invoices», the import log: «Invoices already loaded» at the top of step 1, the verdict on a file just read, the
// record written at the end of a run (or at «Done» with nothing to write), and what is said when it cannot be.

beforeAll(async () => {
  await import('../SuppliersSection');
  await import('./InvoiceImportScreen');
}, 60_000);

afterEach(() => { vi.restoreAllMocks(); });

const SUPPLIER = supplier('sup-1', { name: 'Fornitore Esempio', vatNumber: 'IT00000000001' });
const SUGAR = { desc: 'ZUCCHERO VELO KG 10', code: 'Z1', qty: 10, unit: 'KG', total: 12 };

// The record of an earlier import (the shape the rules keep). `importedAt` is at noon UTC so its day is the same everywhere.
const record = (over: Partial<StoredDoc> = {}): StoredDoc => ({
  id: 'r1', fileName: 'agosto.zip', importedAt: '2026-10-01T12:00:00.000Z', firstDate: '2026-08-01', lastDate: '2026-08-31',
  months: ['2026-08'], invoiceIds: ['8000000001'], ...over,
});

// Two invoices: SDI ids 9000000001 (flour, 1 Sep) and 9000000002 (sugar, 10 Sep).
const twoInvoices = (name = 'settembre.zip') => invoicesZip([
  { lines: [FLOUR], spec: { date: '2026-09-01' } },
  { lines: [SUGAR], spec: { date: '2026-09-10' } },
], name);

type Venue = { importing?: FakeImportSource; log?: StoredDoc[]; suppliers?: ReturnType<typeof supplier>[] };

async function open({ importing, log = [], suppliers = [] }: Venue = {}) {
  const source = fakeSuppliersSource({ suppliers, ingredients: [] });
  const server = importing ?? fakeImportSource({ suppliers, importLog: log });
  const view = renderImport('/suppliers/import', { suppliers: source, importing: server });
  await findImportScreen();
  return { ...view, importing: server };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const dialog = () => screen.findByRole('alertdialog', undefined, LOAD);
const logBlock = () => screen.getByRole('region', { name: 'Invoices already loaded' });
const names = (importing: FakeImportSource) => importing.calls.map(call => call[0]);

async function importAll(user: Parameters<typeof toIngredients>[0], label: string) {
  await user.click(button(label));
  await user.click(within(await dialog()).getByRole('button', { name: 'Import' }));
  await screen.findByRole('heading', { level: 3, name: 'Import finished' }, LOAD);
}

describe('the list at the top of step 1', () => {
  it('says it is reading, then lists the past imports newest first, in the interface language', async () => {
    const importing = fakeImportSource({
      importLog: [
        record({ id: 'a', importedAt: '2026-10-01T12:00:00.000Z' }),
        record({ id: 'b', fileName: 'settembre.zip', importedAt: '2026-10-20T12:00:00.000Z', firstDate: '2026-09-03', lastDate: '2026-09-03', months: ['2026-09'] }),
      ],
    });
    const release = importing.hold('loadImportLog');
    await open({ importing });
    expect(await screen.findByText('Reading the list of imports…')).toBeInTheDocument();
    release();
    const items = await within(logBlock()).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toMatch(/^settembre\.zip, 20 Oct 2026 — 1 invoice of 3 \w+ 2026$/);
    expect(items[1]?.textContent).toBe('agosto.zip, 1 Oct 2026 — 1 invoice from 1 Aug 2026 to 31 Aug 2026');
    expect(screen.queryByText('Reading the list of imports…')).not.toBeInTheDocument();
  });

  it('says the list starts with the first import when there is none', async () => {
    await open();
    expect(await screen.findByText('The list starts with the first import made here: earlier imports are not in it.')).toBeInTheDocument();
    expect(within(logBlock()).queryByRole('list')).not.toBeInTheDocument();
  });

  it('says it could not be read, in a plain note: the import can still be tried', async () => {
    const importing = fakeImportSource();
    importing.failWith('loadImportLog', 'internal');
    await open({ importing });
    expect(await screen.findByText('The list of imports could not be read. Check your connection.')).toBeInTheDocument();
    expect(within(logBlock()).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Choose the file', { selector: 'label' })).toBeInTheDocument();
  });

  it('shows the range of invoices loaded and ONE missing month by its name', async () => {
    await open({ log: [record(), record({ id: 'r2', firstDate: '2026-10-05', lastDate: '2026-10-30', months: ['2026-10'], invoiceIds: ['8000000002'] })] });
    expect(await screen.findByText(/^Invoices loaded: from 1 Aug 2026 to 30 Oct 2026$/)).toBeInTheDocument();
    expect(screen.getByText('Missing: September 2026')).toBeInTheDocument();
  });

  it('words several gaps, a run of months included, joined with a semicolon', async () => {
    await open({
      log: [
        record(),
        record({ id: 'r2', firstDate: '2026-10-05', lastDate: '2026-10-30', months: ['2026-10'], invoiceIds: ['8000000002'] }),
        record({ id: 'r3', firstDate: '2027-01-05', lastDate: '2027-01-30', months: ['2027-01'], invoiceIds: ['8000000003'] }),
      ],
    });
    expect(await screen.findByText('Missing: September 2026; from November 2026 to December 2026')).toBeInTheDocument();
  });

  it('draws no missing line when the months are continuous', async () => {
    await open({ log: [record()] });
    await screen.findByText(/^Invoices loaded:/);
    expect(screen.queryByText(/^Missing:/)).not.toBeInTheDocument();
  });

  it('the warning icon is hidden from assistive technology', async () => {
    await open({ log: [record(), record({ id: 'r2', firstDate: '2026-10-05', lastDate: '2026-10-30', months: ['2026-10'], invoiceIds: ['8000000002'] })] });
    const line = (await screen.findByText('Missing: September 2026')).closest('p');
    expect(line?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('choosing a file', () => {
  it('⚠️ reads the log fresh BEFORE the file, then the remembered decisions', async () => {
    const { user, importing } = await open();
    await screen.findByText(/^The list starts with/);
    const before = importing.calls.length;
    await chooseFiles(user, twoInvoices());
    expect(names(importing).slice(before)).toEqual(['loadImportLog', 'loadDecisions']);
  });

  it('⚠️ a log that cannot be read refuses the file: one message, no Next, no decisions read', async () => {
    const { user, importing } = await open();
    await screen.findByText(/^The list starts with/);
    importing.failWith('loadImportLog', 'internal');
    await chooseFiles(user, twoInvoices());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The list of past imports could not be read, so the new invoices cannot be told from those already imported. Check your connection and try again.',
    );
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(names(importing)).not.toContain('loadDecisions');
  });

  it('a file with one old and one new invoice says so, goes on, and counts only the new invoice', async () => {
    const { user } = await open({ log: [record({ invoiceIds: ['9000000001'], firstDate: '2026-09-01', lastDate: '2026-09-01', months: ['2026-09'] })] });
    await screen.findByText(/^Invoices loaded:/);
    await chooseFiles(user, twoInvoices());
    expect(screen.getByText(/^This file: 2 invoices from 1 \w+ 2026 to 10 \w+ 2026 — 1 new, 1 already imported$/)).toBeInTheDocument();
    expect(screen.getByText('1 invoice read · 1 supplier found · 1 ingredient found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('a file of one single day words it as that day', async () => {
    const { user } = await open();
    await screen.findByText(/^The list starts with/);
    await chooseFiles(user, invoicesZip([{ lines: [FLOUR], spec: { date: '2026-09-01' } }]));
    expect(screen.getByText(/^This file: 1 invoice of 1 \w+ 2026 — 1 new, 0 already imported$/)).toBeInTheDocument();
  });

  it('⚠️ a file whose invoices are all old says so with the day, offers no Next, and leaving does not ask', async () => {
    const { user, importing, router } = await open({
      log: [record({ invoiceIds: ['9000000001', '9000000002'], firstDate: '2026-09-01', lastDate: '2026-09-10', months: ['2026-09'], importedAt: '2026-10-20T12:00:00.000Z' })],
    });
    await screen.findByText(/^Invoices loaded:/);
    await chooseFiles(user, twoInvoices());
    const line = screen.getByText('These 2 invoices were already imported on 20 Oct 2026: nothing new.');
    expect(line).toHaveAttribute('role', 'status');
    await waitFor(() => { expect(line).toHaveFocus(); });
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(names(importing)).not.toContain('loadDecisions');
    await user.click(button('Back'));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('the same file, a different file name: the invoices are known by their own ids', async () => {
    const { user } = await open({ log: [record({ invoiceIds: ['9000000001', '9000000002'], firstDate: '2026-09-01', lastDate: '2026-09-10', months: ['2026-09'] })] });
    await screen.findByText(/^Invoices loaded:/);
    await chooseFiles(user, twoInvoices('rinominato.zip'));
    expect(screen.getByText(/^These 2 invoices were already imported on /)).toBeInTheDocument();
  });
});

describe('the record of a run', () => {
  it('⚠️ is written once, with the new invoice only, and the summary says the file is in the list', async () => {
    const { user, importing } = await open({
      log: [record({ invoiceIds: ['9000000001'], firstDate: '2026-09-01', lastDate: '2026-09-01', months: ['2026-09'] })],
    });
    await screen.findByText(/^Invoices loaded:/);
    await toIngredients(user, twoInvoices());
    await importAll(user, 'Import 1 ingredient');
    const records = importing.writes.filter(write => write.kind === 'importLog');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ record: { fileName: 'settembre.zip', invoiceIds: ['9000000002'], firstDate: '2026-09-10', lastDate: '2026-09-10', months: ['2026-09'] } });
    expect(screen.getByText('This file is now in the list of imports.')).toBeInTheDocument();
  });

  it('⚠️ a record that cannot be written is said in an alert line, and the import stays done', async () => {
    const { user, importing } = await open();
    await screen.findByText(/^The list starts with/);
    importing.failWith('saveImportLog', 'internal');
    await toIngredients(user, twoInvoices());
    await importAll(user, 'Import 2 ingredients');
    expect(screen.getByRole('alert')).toHaveTextContent('This file could not be added to the list of imports');
    expect(importing.ingredients).toHaveLength(2);
    expect(screen.queryByText('This file is now in the list of imports.')).not.toBeInTheDocument();
  });
});

describe('«Done» with nothing to write', () => {
  // The first run imports the file; the second screen is opened on what it left, with the log emptied (as if its record had not
  // been kept), so every row is already in Mise and «Done» has nothing to write.
  async function second() {
    const first = await open();
    await screen.findByText(/^The list starts with/);
    await toIngredients(first.user, twoInvoices());
    await importAll(first.user, 'Import 2 ingredients');
    const { importing } = first;
    cleanup();
    importing.importLog = [];
    const source = fakeSuppliersSource({ suppliers: [SUPPLIER], ingredients: [...importing.ingredients] });
    for (const [id, doc] of importing.prices) source.prices.set(id, doc);
    const view = renderImport('/suppliers/import', { suppliers: source, importing });
    await findImportScreen();
    await toIngredients(view.user, twoInvoices());
    return { ...view, importing, written: importing.writes.length };
  }

  it('says the file is added to the list, writes the record, then the screen closes', async () => {
    const { user, importing, router, written } = await second();
    expect(screen.getByText('«Done» adds this file to the list of imports.')).toBeInTheDocument();
    await user.click(button('Done'));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    const after = importing.writes.slice(written);
    expect(after.map(write => write.kind)).toEqual(['importLog']);
    expect(after[0]).toMatchObject({ record: { fileName: 'settembre.zip', invoiceIds: ['9000000001', '9000000002'] } });
  });

  it('⚠️ offline it says so and writes nothing: the screen stays', async () => {
    const { user, importing, router, written } = await second();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await user.click(button('Done'));
    const box = await dialog();
    expect(within(box).getByText(/^There is no connection\./)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'OK' }));
    expect(importing.writes).toHaveLength(written);
    expect(router.state.location.pathname).toBe('/suppliers/import');
  });

  it('a record that cannot be written is said in a dialog, and the screen still closes', async () => {
    const { user, importing, router } = await second();
    importing.failWith('saveImportLog', 'internal');
    await user.click(button('Done'));
    const box = await dialog();
    expect(within(box).getByText(/^This file could not be added to the list of imports/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
  });
});
