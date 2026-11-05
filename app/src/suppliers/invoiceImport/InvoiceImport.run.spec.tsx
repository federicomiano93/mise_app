import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../../testing/fakeSuppliersSource';
import { item, supplier } from '../../testing/renderSuppliers';
import { fakeImportSource } from './testing/fakeImportSource';
import type { FakeImportSource } from './testing/fakeImportSource';
import {
  FLOUR, FLOUR_BY_SACK, LOAD, findImportScreen, invoiceZip, invoicesZip, renderImport, toIngredients,
} from './testing/renderImport';

// «Import from invoices», part B3b, slice 2: the confirmation, the run row by row, the remembered decisions, the price changes and
// the summary — against a fake database that really applies what is written, so a second load sees what the first one left.
//
// PORTS (tests/invoice-import-flow.test.mjs), the zip path: «a file goes through every step and writes suppliers and ingredients,
// each behind a confirmation», «loading the same file again plans no write at all», «while rows are being written Back is off and
// does nothing», «a refusal stops the run at once…», «losing the connection stops the run too», «any other failure is recorded
// with its reason and the run goes on», «a row that matches an ingredient created moments ago becomes a question, never a
// duplicate», «two NEW products with different article codes are both created», «a write that failed DOES say to load the same
// file again», «the decision is written BEFORE the rows», «declining the question on Done keeps the screen and writes nothing»,
// «a failure while remembering stops nothing else and is reported in the summary», «three invoices at 1.00 → 1.10 → 1.10 write
// exactly ONE price change, and the same file again writes nothing new», «nothing is written without a confirmation: Done only
// closes, the price-change button asks first», «the progress line never says 1 of 0», «a renamed product writes nothing by
// default; choosing “Save the new name” is a write of the primary action, and the summary says so», «a renamed product left on
// “Keep the old name” is never written», «a skipped supplier makes its ingredients errors that say why» (slice 1's spec: they are not offered).
// NOT PORTED, F6: «a file that is not an import file…», «one .json beside zips…», «a .json file still takes the old path…», and
// every assertion about the workbook advice (summary.fixFile / summary.remember). The rest of the flow file (the held price with
// a chosen rename, a held price that loses its reason, the shared price written by another pack) is model behaviour: it is
// pinned in shared/src/invoice-import-*.spec.ts and in ingredientsRun.spec.ts, which also holds «a row that matches an ingredient
// created moments ago» (an invoice reader never hands two products with such names).

beforeAll(async () => {
  await import('../SuppliersSection');
  await import('./InvoiceImportScreen');
}, 60_000);

afterEach(() => { vi.restoreAllMocks(); });

const SUPPLIER = supplier('sup-1', { name: 'Fornitore Esempio', vatNumber: 'IT00000000001' });
const SUGAR = { desc: 'ZUCCHERO VELO KG 10', code: 'Z1', qty: 10, unit: 'KG', total: 12 };
const SALT = { desc: 'SALE MARINO KG 25', code: 'S1', qty: 25, unit: 'KG', total: 5 };
const stored = (fields: Record<string, unknown> = {}) =>
  item('ing-1', { name: 'Farina tipo 00', supplierId: 'sup-1', supplierCode: 'F00', weight: '25 kg', kind: 'ingredient', ...fields });

type Venue = { ingredients?: ReturnType<typeof item>[]; prices?: Record<string, Record<string, unknown>>; suppliers?: ReturnType<typeof supplier>[] };

async function open(venue: Venue = {}, importing?: FakeImportSource) {
  const suppliers = venue.suppliers ?? [SUPPLIER];
  const source = fakeSuppliersSource({ suppliers, ingredients: venue.ingredients ?? [] });
  for (const [id, doc] of Object.entries(venue.prices ?? {})) source.prices.set(id, doc);
  const server = importing ?? fakeImportSource({ suppliers, ingredients: venue.ingredients ?? [], prices: venue.prices });
  const view = renderImport('/suppliers/import', { suppliers: source, importing: server });
  await findImportScreen();
  return { ...view, importing: server };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const dialog = () => screen.findByRole('alertdialog', undefined, LOAD);
const summaryText = () => screen.getByRole('heading', { level: 3, name: 'Import finished' }).parentElement?.textContent ?? '';
const batchesOf = (importing: FakeImportSource) => importing.writes.filter(write => write.kind === 'batches');

// Drives to the end: chooses «Import n ingredients», confirms, waits for the summary.
async function importAll(user: Parameters<typeof toIngredients>[0], label: string) {
  await user.click(button(label));
  await user.click(within(await dialog()).getByRole('button', { name: 'Import' }));
  await screen.findByRole('heading', { level: 3, name: 'Import finished' }, LOAD);
}

describe('the confirmation', () => {
  it('asks first, in words, and Cancel writes nothing and keeps the screen', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR, SUGAR]));
    await user.click(button('Import 2 ingredients'));
    const box = await dialog();
    expect(within(box).getByText('Import these ingredients?')).toBeInTheDocument();
    expect(within(box).getByText('2 new ingredients will be created.')).toBeInTheDocument();
    expect(within(box).getByText('2 prices will be added.')).toBeInTheDocument();
    expect(within(box).getByText('Price changes are recorded too.')).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
    expect(batchesOf(importing)).toEqual([]);
    expect(importing.writes.filter(write => write.kind !== 'createSupplier')).toEqual([]);
  });

  it('says «no connection» before asking anything when the browser is offline', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR]));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await user.click(button('Import 1 ingredient'));
    const box = await dialog();
    expect(within(box).getByText(/^There is no connection\./)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'OK' }));
    expect(screen.queryByText('Import these ingredients?')).not.toBeInTheDocument();
    expect(batchesOf(importing)).toEqual([]);
  });

  it('says how many remembered choices will be written', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR, SUGAR]));
    await user.selectOptions(within(screen.getByRole('listitem', { name: 'Zucchero velo' })).getByRole('combobox'), 'Do not import (remember)');
    await user.click(button('Import 1 ingredient'));
    expect(within(await dialog()).getByText('1 choice will be remembered for the next imports.')).toBeInTheDocument();
  });
});

describe('a file goes through every step', () => {
  it('writes the ingredients as the model says, ends on the summary, and «Done» leaves to the list with the focus on the door', async () => {
    const { user, importing, router } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR, SUGAR]));
    await importAll(user, 'Import 2 ingredients');
    expect(summaryText()).toContain('2 ingredients created');
    expect(summaryText()).toContain('2 prices added');
    expect(summaryText()).toContain('Price changes recorded: 0');
    expect(screen.queryByText(/Step \d of 3/)).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('heading', { level: 3, name: 'Import finished' })).toHaveFocus(); });
    expect(importing.ingredients).toHaveLength(2);
    for (const created of importing.ingredients) {
      expect(created.supplierId).toBe('sup-1');
      for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients']) expect(created).not.toHaveProperty(key);
    }
    expect(importing.prices.size).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Import from invoices' })).toHaveFocus(); });
  });

  it('Back after the import is over leaves without a question', async () => {
    const { user, router } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR]));
    await importAll(user, 'Import 1 ingredient');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('⚠️ loading the same file again plans no write at all: everything is Unchanged', async () => {
    const first = await open({ suppliers: [] });
    await toIngredients(first.user, invoiceZip([FLOUR, SUGAR]));
    await importAll(first.user, 'Import 2 ingredients');
    const importing = first.importing;
    cleanup();
    const written = importing.writes.length;

    const venue = { ingredients: [...importing.ingredients], prices: Object.fromEntries(importing.prices), suppliers: [SUPPLIER] };
    const second = await open(venue, importing);
    await toIngredients(second.user, invoiceZip([FLOUR, SUGAR]));
    expect(screen.getByText('2 unchanged ingredients', { selector: 'summary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing to import: everything is already in Mise, skipped or has an error.')).toBeInTheDocument();
    await second.user.click(button('Done'));
    await waitFor(() => { expect(second.router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(importing.writes).toHaveLength(written);
    expect(importing.ingredients).toHaveLength(2);
  });
});

describe('while the rows are written', () => {
  it('Back is off, the router refuses without asking, the bar moves, and the live line counts', async () => {
    const { user, importing, router } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR, SUGAR]));
    const release = importing.hold('runImportBatches');
    await user.click(button('Import 2 ingredients'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Import' }));
    const heading = await screen.findByRole('heading', { level: 3, name: 'Importing…' });
    await waitFor(() => { expect(heading).toHaveFocus(); });
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    const bar = screen.getByRole('progressbar', { name: 'Importing…' });
    expect(bar).toHaveAttribute('max', '2');
    expect(screen.getAllByRole('status').some(region => region.textContent === 'Importing 1 of 2…')).toBe(true);
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();

    await router.navigate('/orders');
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    release();
    await screen.findByRole('heading', { level: 3, name: 'Import finished' }, LOAD);
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });
});

describe('what goes wrong', () => {
  const THREE = () => invoiceZip([FLOUR, SUGAR, SALT]);

  it('⚠️ a refusal stops the run at once, says so, and says how many were not tried', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, THREE());
    importing.failWith('runImportBatches', 'permission-denied');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await importAll(user, 'Import 3 ingredients');
    expect(importing.countOf('runImportBatches')).toBe(1);
    expect(importing.ingredients).toHaveLength(0);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Mise was not allowed to save this');
    expect(alert).toHaveTextContent('2 ingredients were not tried.');
    expect(summaryText()).toContain('1 ingredient not imported');
    expect(summaryText()).toContain('Load the same file again to finish');
  });

  it('losing the connection stops the run too; the row before it stays', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, THREE());
    importing.failWith('runImportBatches', 'unavailable', 1);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await importAll(user, 'Import 3 ingredients');
    expect(importing.ingredients).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('There is no connection.');
    expect(screen.getByRole('alert')).toHaveTextContent('1 ingredient was not tried.');
    expect(summaryText()).toContain('1 ingredient created');
  });

  it('any other failure is recorded with its reason and the run goes on with the next row', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, THREE());
    importing.failWith('runImportBatches', 'invalid-argument');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await importAll(user, 'Import 3 ingredients');
    expect(importing.countOf('runImportBatches')).toBe(3);
    expect(summaryText()).toContain('3 ingredients not imported');
    expect(screen.getAllByText('Could not be saved (invalid-argument).')).toHaveLength(3);
    expect(summaryText()).toContain('Load the same file again to finish');
    expect(screen.queryByText(/were not tried/)).not.toBeInTheDocument();
  });

  it('⚠️ two NEW products with different article codes are both created, however alike their names', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([
      { desc: 'ACETO BIANCO 1 L', code: 'AC-B', qty: 10, unit: 'LT', total: 8 },
      { desc: 'ACETO ROSSO 1 L', code: 'AC-R', qty: 10, unit: 'LT', total: 9 },
    ]));
    await importAll(user, 'Import 2 ingredients');
    expect(importing.ingredients.map(created => created.supplierCode).sort()).toEqual(['AC-B', 'AC-R']);
    expect(screen.queryByText(/A similar ingredient appeared/)).not.toBeInTheDocument();
  });
});

describe('the usage count', () => {
  it('counts an import that ran to the end', async () => {
    const names: string[] = [];
    const listener = (event: Event) => { names.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listener);
    const { user } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR]));
    await importAll(user, 'Import 1 ingredient');
    window.removeEventListener('mise:action', listener);
    expect(names).toContain('invoice-imported');
  });

  it('does not count an import the rules stopped', async () => {
    const names: string[] = [];
    const listener = (event: Event) => { names.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listener);
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR]));
    importing.failWith('runImportBatches', 'permission-denied');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await importAll(user, 'Import 1 ingredient');
    window.removeEventListener('mise:action', listener);
    expect(names).not.toContain('invoice-imported');
  });
});

describe('the remembered choices', () => {
  const SKIP = 'Do not import (remember)';

  it('⚠️ are written BEFORE the rows, and the summary counts them', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR, SUGAR]));
    await user.selectOptions(within(screen.getByRole('listitem', { name: 'Zucchero velo' })).getByRole('combobox'), SKIP);
    await importAll(user, 'Import 1 ingredient');
    const kinds = importing.writes.map(write => write.kind);
    expect(kinds.indexOf('decisions')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('decisions')).toBeLessThan(kinds.indexOf('batches'));
    expect(importing.decisions).toHaveLength(1);
    expect(summaryText()).toContain('Choices remembered: 1');
  });

  it('a failure while remembering stops nothing else and is reported in the summary', async () => {
    const { user, importing } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR, SUGAR]));
    await user.selectOptions(within(screen.getByRole('listitem', { name: 'Zucchero velo' })).getByRole('combobox'), SKIP);
    importing.failWith('writeDecisions', 'invalid-argument');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await importAll(user, 'Import 1 ingredient');
    expect(importing.ingredients).toHaveLength(1);
    expect(screen.getByText('Your choices could not be remembered. The import itself is not affected.')).toBeInTheDocument();
    expect(summaryText()).not.toContain('Choices remembered');
  });

  it('«Done» with nothing to import and nothing to remember just leaves: no question, no write', async () => {
    const { user, importing, router } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR]));
    await user.selectOptions(within(screen.getByRole('listitem', { name: 'Farina tipo 00' })).getByRole('combobox'), SKIP);
    // The «do not import» answer is a remembered choice, so this one asks; declining writes nothing.
    await user.click(button('Done'));
    const box = await dialog();
    expect(within(box).getByText('Remember your choices?')).toBeInTheDocument();
    expect(within(box).getByText('1 choice will be remembered for the next imports.')).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(importing.writes.filter(write => write.kind === 'decisions')).toEqual([]);

    await user.click(button('Done'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(importing.decisions).toHaveLength(1);
    expect(batchesOf(importing)).toEqual([]);
  });

  it('a failure on «Done» is said in an alert and the screen stays', async () => {
    const { user, importing, router } = await open({ suppliers: [] });
    await toIngredients(user, invoiceZip([FLOUR]));
    await user.selectOptions(within(screen.getByRole('listitem', { name: 'Farina tipo 00' })).getByRole('combobox'), SKIP);
    importing.failWith('writeDecisions', 'invalid-argument');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await user.click(button('Done'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Save' }));
    const box = await dialog();
    expect(within(box).getByText('Your choices could not be remembered. The import itself is not affected.')).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'OK' }));
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });
});

describe('price changes', () => {
  const invoiceOn = (date: string, total: number, sdi: number) =>
    ({ lines: [{ ...FLOUR, total }], spec: { date, number: String(sdi) } });

  it('⚠️ three invoices at 1.00 → 1.10 → 1.10 write exactly ONE price change, and the same file again writes nothing new', async () => {
    const zip = () => invoicesZip([invoiceOn('2026-09-01', 25, 1), invoiceOn('2026-09-10', 27.5, 2), invoiceOn('2026-09-20', 27.5, 3)]);
    const first = await open({ suppliers: [] });
    await toIngredients(first.user, zip());
    await importAll(first.user, 'Import 1 ingredient');
    const importing = first.importing;
    expect(summaryText()).toContain('3 prices added');
    expect(summaryText()).toContain('Price changes recorded: 1');
    expect(importing.priceChanges.size).toBe(1);
    cleanup();

    const written = importing.writes.length;
    const second = await open({ ingredients: [...importing.ingredients], prices: Object.fromEntries(importing.prices), suppliers: [SUPPLIER] }, importing);
    await toIngredients(second.user, zip());
    expect(screen.getByRole('button', { name: 'Record price changes' })).toBeEnabled();
    await second.user.click(button('Record price changes'));
    await second.user.click(within(await dialog()).getByRole('button', { name: 'Record' }));
    await screen.findByRole('heading', { level: 3, name: 'Import finished' }, LOAD);
    expect(summaryText()).toContain('Price changes recorded: 0');
    expect(importing.priceChanges.size).toBe(1);
    expect(importing.writes.slice(written).filter(write => write.kind === 'batches')).toEqual([]);
  });

  it('⚠️ nothing is written without a confirmation: the price-change button asks first, and Cancel writes nothing', async () => {
    const first = await open({ suppliers: [] });
    await toIngredients(first.user, invoiceZip([FLOUR]));
    await importAll(first.user, 'Import 1 ingredient');
    const importing = first.importing;
    cleanup();
    const second = await open({ ingredients: [...importing.ingredients], prices: Object.fromEntries(importing.prices), suppliers: [SUPPLIER] }, importing);
    await toIngredients(second.user, invoiceZip([FLOUR]));
    const written = importing.writes.length;
    await second.user.click(button('Record price changes'));
    const box = await dialog();
    expect(within(box).getByText('Record the price changes?')).toBeInTheDocument();
    expect(within(box).getByText('No ingredient or price changes: only the price changes found in the invoices are recorded.')).toBeInTheDocument();
    await second.user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(importing.writes).toHaveLength(written);
    expect(screen.getByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
  });

  it('the live line never says «of 0» when only rows already in Mise are looked at (the counts themselves are pinned in ingredientsRun.spec.ts)', async () => {
    const importing = fakeImportSource({ suppliers: [SUPPLIER], ingredients: [stored({ invoiceName: 'FARINA TIPO 00 SACCO KG 25' })] });
    importing.points.set('ing-1', { ids: new Set(['inv-9000000001-1']), points: [] });
    const { user } = await open({ ingredients: [stored({ invoiceName: 'FARINA TIPO 00 SACCO KG 25' })], prices: { 'ing-1': { priceUnit: 'kg', pricePerUnit: 0.57, priceUpdatedAt: '2026-09-01T12:00:00.000Z' } } }, importing);
    await toIngredients(user, invoiceZip([FLOUR]));
    const lines: string[] = [];
    const watcher = new MutationObserver(() => { lines.push(...screen.getAllByRole('status').map(region => region.textContent ?? '')); });
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
    await user.click(button('Record price changes'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Record' }));
    await screen.findByRole('heading', { level: 3, name: 'Import finished' }, LOAD);
    watcher.disconnect();
    expect(lines.some(line => /of 0…/.test(line))).toBe(false);
  });
});

describe('a renamed product', () => {
  const venue = () => ({
    ingredients: [stored({ invoiceName: 'FARINA 00 VECCHIO NOME' })],
    prices: { 'ing-1': { priceUnit: 'kg', pricePerUnit: 0.57, priceUpdatedAt: '2026-09-01T12:00:00.000Z' } },
  });
  const seeded = (): FakeImportSource => {
    const importing = fakeImportSource({ suppliers: [SUPPLIER], ingredients: venue().ingredients, prices: venue().prices });
    importing.points.set('ing-1', { ids: new Set(['inv-9000000001-1']), points: [] });
    return importing;
  };

  it('⚠️ writes nothing by default; «Save the new name» is a write of the primary action, and the summary says so', async () => {
    const importing = seeded();
    const { user } = await open(venue(), importing);
    await toIngredients(user, invoiceZip([FLOUR]));
    expect(screen.getByText(/^The name on the invoice has changed: «FARINA 00 VECCHIO NOME» → «/)).toBeInTheDocument();
    expect(button('Done')).toBeEnabled();
    const choice = within(screen.getByRole('listitem', { name: 'Farina tipo 00' })).getByRole('combobox', { name: 'Name on the invoice' });
    expect(choice).toHaveValue('keep');
    await user.selectOptions(choice, 'Save the new name');
    await user.click(button('Import 1 ingredient'));
    expect(within(await dialog()).getByText('1 name on the invoice will be saved')).toBeInTheDocument();
    await user.click(within(await dialog()).getByRole('button', { name: 'Import' }));
    await screen.findByRole('heading', { level: 3, name: 'Import finished' }, LOAD);
    expect(summaryText()).toContain('1 name on the invoice saved');
    expect(importing.ingredients[0]?.invoiceName).toBe('FARINA TIPO 00 SACCO KG 25');
  });

  it('left on «Keep the old name» it is never written', async () => {
    const importing = seeded();
    const { user } = await open(venue(), importing);
    await toIngredients(user, invoiceZip([FLOUR]));
    await user.click(button('Done'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(batchesOf(importing)).toEqual([]);
    expect(importing.ingredients[0]?.invoiceName).toBe('FARINA 00 VECCHIO NOME');
  });
});

describe('a held price', () => {
  it('is not written until «Use this price» is chosen', async () => {
    const importing = fakeImportSource({ suppliers: [SUPPLIER], ingredients: [stored({ weight: '20 kg' })] });
    const { user } = await open({ ingredients: [stored({ weight: '20 kg' })] }, importing);
    await toIngredients(user, invoiceZip([FLOUR_BY_SACK]));
    expect(button('Done')).toBeEnabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'This price?' }), 'Use this price');
    await importAll(user, 'Import 1 ingredient');
    expect(summaryText()).toContain('1 existing ingredient got new prices');
    expect(importing.prices.get('ing-1')?.pricePerUnit).toBe(0.7125);
  });
});
