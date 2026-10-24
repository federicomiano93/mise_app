import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../../testing/fakeSuppliersSource';
import { item, supplier } from '../../testing/renderSuppliers';
import { fakeImportSource } from './testing/fakeImportSource';
import {
  FLOUR, FLOUR_BY_SACK, LOAD, findImportScreen, invoiceZip, invoicesZip, renderImport, toIngredients, toSuppliers,
} from './testing/renderImport';

// «Import from invoices», part B3b, slice 1: step 3, the ingredients — what the plan shows (chips, rows, pills, prices, reasons),
// what the person may answer, what blocks the button, and what a failed check does. Nothing is written yet (the run is slice 2).
//
// PORTS (tests/invoice-import-review.test.mjs, the screen's half): «3 · the summary line exists in English and Italian» (the
// words spec), «4 · the reason sentences exist in both languages, with their holes» (words spec), «4 · the unreadable-weight
// sentence says the price below uses the invoice weight», «7 · a NEW row with the older-invoice reason says it WILL BE CREATED»,
// «10 · the confirm select comes AFTER the “same as” question and has its own label», «11 · a “do not import” answer on a priceCheck
// row keeps the Skipped pill», «R6 · the rescaled sentence names both packs … and the screen passes them», «R7 · a new row
// answered “do not import” does not say it will be created», «S3 · the screen takes the shown price from the effective row»,
// «S4 · a new answer clears the “Use this price” of the row» (the answers' half is in ingredientAnswers.spec.ts).
// PORTS (tests/invoice-import-flow.test.mjs): «a NEW row can be left out…» (the screen's half), the question that blocks the button.
// The confirmation, the run, the summary and every write are in InvoiceImport.run.spec.tsx.

beforeAll(async () => {
  await import('../SuppliersSection');
  await import('./InvoiceImportScreen');
}, 60_000);

afterEach(() => { vi.restoreAllMocks(); });

const VAT = 'IT00000000001';
const SUPPLIER = supplier('sup-1', { name: 'Fornitore Esempio', vatNumber: VAT });
const stored = (fields: Record<string, unknown> = {}) =>
  item('ing-1', { name: 'Farina tipo 00', supplierId: 'sup-1', supplierCode: 'F00', weight: '25 kg', kind: 'ingredient', ...fields });
const priceDoc = (fields: Record<string, unknown> = {}) =>
  ({ priceUnit: 'kg', pricePerUnit: 1, priceUpdatedAt: '2026-01-01T12:00:00.000Z', ...fields });

type Venue = { ingredients?: ReturnType<typeof item>[]; prices?: Record<string, Record<string, unknown>>; suppliers?: ReturnType<typeof supplier>[] };

// The venue the import runs against: the supplier of the invoices is already in Mise unless the spec says otherwise.
async function open(venue: Venue = {}, options: Parameters<typeof renderImport>[1] = {}) {
  const suppliers = venue.suppliers ?? [SUPPLIER];
  const source = fakeSuppliersSource({ suppliers, ingredients: venue.ingredients ?? [] });
  for (const [id, doc] of Object.entries(venue.prices ?? {})) source.prices.set(id, doc);
  const importing = fakeImportSource({ suppliers, ingredients: venue.ingredients ?? [], prices: venue.prices });
  const view = renderImport('/suppliers/import', { suppliers: source, importing, ...options });
  const region = await findImportScreen(options.lang === 'it' ? 'Importa da fatture' : 'Import from invoices');
  return { ...view, ...region, importing };
}

// The step's own rows (the Suppliers section behind the import has a list of its own).
const rows = () => within(screen.getByRole('region', { name: /Import from invoices|Importa da fatture/ })).getAllByRole('listitem');
const row = (name: string) => within(screen.getByRole('region', { name: /Import from invoices|Importa da fatture/ })).getByRole('listitem', { name });
const primary = (name: string | RegExp) => screen.getByRole('button', { name });
// A flour whose weight the venue keeps as «20 kg» while the invoice sells the 25 kg sack: the price is worked out again.
const RESCALED = { venue: { ingredients: [stored({ weight: '20 kg' })] }, zip: () => invoiceZip([FLOUR_BY_SACK]) };

describe('the step', () => {
  it('names itself, counts itself, takes the focus on its heading and says it is checking meanwhile', async () => {
    const { user, importing } = await open({ ingredients: [stored()] });
    const release = importing.hold('invoicePoints');
    await toSuppliers(user);
    await user.click(primary('Next'));
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('heading', { level: 3, name: 'Ingredients' })).toHaveFocus(); });
    expect(screen.getAllByText('Checking what is already in Mise…').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status').some(region => region.textContent === 'Checking what is already in Mise…')).toBe(true);
    // Nothing to press while it checks: the bar has no primary button.
    expect(screen.queryByRole('button', { name: /^Import \d+ ingredients?$/ })).not.toBeInTheDocument();
    release();
    await screen.findByRole('group', { name: 'Show' }, LOAD);
    expect(screen.getAllByRole('status').some(region => region.textContent === 'Checking what is already in Mise…')).toBe(false);
    expect(importing.writes).toEqual([]);
  });

  it('shows the note and the rows of the file: a name, the supplier, the price per unit, the invoices, and a WORD in a pill', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user);
    expect(screen.getByText(/^New ingredients start with allergens not declared/)).toBeInTheDocument();
    const flour = row('Farina tipo 00');
    expect(within(flour).getByText('FORNITORE ESEMPIO SRL · 0,57 € / kg · 1 invoice')).toBeInTheDocument();
    expect(within(flour).getByText('New')).toHaveAttribute('data-tone', 'ok');
  });

  it('the supplier is named as Mise names it when it is already there', async () => {
    const { user } = await open({ suppliers: [supplier('sup-1', { name: 'Fornitore Esempio', shortName: 'Esempio', vatNumber: VAT })] });
    await toIngredients(user);
    expect(within(row('Farina tipo 00')).getByText('Esempio · 0,57 € / kg · 1 invoice')).toBeInTheDocument();
  });
});

describe('the chips', () => {
  it('count the rows, mark the chosen one with aria-pressed, and filter', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user);
    const group = screen.getByRole('group', { name: 'Show' });
    const chips = within(group).getAllByRole('button').map(chip => chip.textContent);
    expect(chips).toEqual(['All (2)', 'New (1)', 'To check (1)']);
    expect(within(group).getByRole('button', { name: 'All (2)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'New (1)' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(group).getByRole('button', { name: 'New (1)' }));
    expect(within(group).getByRole('button', { name: 'New (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All (2)' })).toHaveAttribute('aria-pressed', 'false');
    expect(rows().map(li => li.textContent).join('|')).toContain('Farina tipo 00');
    expect(rows().map(li => li.textContent).join('|')).not.toContain('Spezia forte');

    await user.click(within(group).getByRole('button', { name: 'To check (1)' }));
    expect(rows().map(li => li.textContent).join('|')).toContain('Spezia forte');
    expect(rows().map(li => li.textContent).join('|')).not.toContain('Farina tipo 00');

    await user.click(within(group).getByRole('button', { name: 'All (2)' }));
    expect(rows().map(li => li.textContent).join('|')).toContain('Farina tipo 00');
  });

  it('a chip with nothing under it is not there (Errors, To decide, History only…)', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user);
    const group = screen.getByRole('group', { name: 'Show' });
    for (const name of [/^Errors/, /^To decide/, /^History only/, /^Unchanged/, /^New price/]) {
      expect(within(group).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('in «All» the rows to check sit in a closed group that opens, and stays open while answering', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user);
    const group = screen.getByText('To check (1)', { selector: 'summary' }).closest('details') as HTMLDetailsElement;
    expect(group.open).toBe(false);
    await user.click(screen.getByText('To check (1)', { selector: 'summary' }));
    expect(group.open).toBe(true);
    await user.selectOptions(within(row('Farina tipo 00')).getByRole('combobox'), 'Do not import (remember)');
    expect((screen.getByText('To check (1)', { selector: 'summary' }).closest('details') as HTMLDetailsElement).open).toBe(true);
  });
});

describe('a NEW ingredient', () => {
  it('is created by default and never blocks the button; «Do not import (remember)» leaves it out and keeps it under «New»', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user);
    expect(primary('Import 2 ingredients')).toBeEnabled();
    expect(screen.queryByText(/Choose what to do with/)).not.toBeInTheDocument();
    const flour = row('Farina tipo 00');
    const choice = within(flour).getByRole('combobox', { name: 'What should happen?' });
    expect(within(choice).getAllByRole('option').map(option => option.textContent)).toEqual(['Create', 'Do not import (remember)']);
    expect(choice).toHaveValue('create');

    await user.selectOptions(choice, 'Do not import (remember)');
    expect(primary('Import 1 ingredient')).toBeEnabled();
    expect(within(row('Farina tipo 00')).getByText('Skipped')).toHaveAttribute('data-tone', 'quiet');
    expect(screen.getByRole('button', { name: 'New (1)' })).toBeInTheDocument();
    await user.selectOptions(within(row('Farina tipo 00')).getByRole('combobox'), 'Create');
    expect(primary('Import 2 ingredients')).toBeEnabled();
  });

  it('11 · a «do not import» answer on a row that waits for a price check keeps the Skipped pill', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user);
    const strong = row('Spezia forte');
    expect(within(strong).getByText('To check')).toHaveAttribute('data-tone', 'warn');
    expect(within(strong).getByText('The price looks wrong for this product: check the weight or the pack size.')).toBeInTheDocument();
    await user.selectOptions(within(strong).getByRole('combobox'), 'Do not import (remember)');
    expect(within(row('Spezia forte')).getByText('Skipped')).toHaveAttribute('data-tone', 'quiet');
    expect(within(row('Spezia forte')).queryByText('To check')).not.toBeInTheDocument();
  });

  it('with nothing left to import the button says «Done» and the hint says why', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user);
    for (const name of ['Farina tipo 00', 'Spezia forte']) {
      await user.selectOptions(within(row(name)).getByRole('combobox'), 'Do not import (remember)');
    }
    expect(primary('Done')).toBeEnabled();
    expect(screen.getByText('Nothing to import: everything is already in Mise, skipped or has an error.')).toBeInTheDocument();
    // No row is already in Mise, so there is no price change to record.
    expect(screen.queryByRole('button', { name: 'Record price changes' })).not.toBeInTheDocument();
  });
});

describe('4 · why a price waits for a look, in words (the date in the interface language)', () => {
  const OLD = { ...FLOUR, total: 14.25 };
  const ABSURD = { ...FLOUR, total: 10000 };
  const twoInvoices = () => invoicesZip([{ lines: [OLD], spec: { date: '2026-08-01' } }, { lines: [ABSURD], spec: { date: '2026-09-12' } }]);

  it('7 · a NEW row from an older invoice says it WILL BE CREATED, and once it is left out (R7) it no longer says so', async () => {
    const { user } = await open({ suppliers: [] });
    await toIngredients(user, twoInvoices());
    const flour = row('Farina tipo 00');
    expect(within(flour).getByText('To check')).toHaveAttribute('data-tone', 'warn');
    expect(within(flour).getByText('It will be created with the price of the invoice of 01/08/2026: the most recent one needs checking.')).toBeInTheDocument();
    await user.selectOptions(within(flour).getByRole('combobox'), 'Do not import (remember)');
    expect(within(row('Farina tipo 00')).queryByText(/will be created/)).not.toBeInTheDocument();
    expect(within(row('Farina tipo 00')).getByText('Price from the invoice of 01/08/2026: the most recent one needs checking.')).toBeInTheDocument();
  });

  it('a MATCHED row from an older invoice asks «This price?» and names the date', async () => {
    const { user } = await open({ ingredients: [stored()] });
    await toIngredients(user, twoInvoices());
    const flour = row('Farina tipo 00');
    expect(within(flour).getByText('Price from the invoice of 01/08/2026: the most recent one needs checking.')).toBeInTheDocument();
    expect(within(flour).getByRole('combobox', { name: 'This price?' })).toHaveValue('hold');
  });

  it('speaks Italian, the date as dd/mm/yyyy', async () => {
    const { user } = await open({ suppliers: [] }, { lang: 'it' });
    await chooseAndGo(user, twoInvoices());
    const flour = row('Farina tipo 00');
    expect(within(flour).getByText('Verrà creato con il prezzo della fattura del 01/08/2026: la più recente è da verificare.')).toBeInTheDocument();
    expect(within(flour).getByText('Da controllare')).toBeInTheDocument();
    expect(screen.getByText('Passo 3 di 3')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Mostra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importa 1 ingrediente' })).toBeInTheDocument();
  });

  it('4 · the unreadable-weight sentence says the price below uses the invoice weight', async () => {
    const { user } = await open({ ingredients: [stored({ weight: 'sacco grande' })] });
    await toIngredients(user, invoiceZip([FLOUR_BY_SACK]));
    expect(within(row('Farina tipo 00')).getByText(
      'The pack weight saved in Mise cannot be read: the price per kilo or litre below uses the weight on the invoice. Check it.')).toBeInTheDocument();
  });

  it('a price that moves by more than 30% from a reading of the description says so, with the limit', async () => {
    const { user } = await open({ ingredients: [stored()], prices: { 'ing-1': priceDoc() } });
    await toIngredients(user, invoiceZip([FLOUR_BY_SACK]));
    expect(within(row('Farina tipo 00')).getByText(
      'The price moves by more than 30% and was worked out from the invoice description, not read directly. Check it.')).toBeInTheDocument();
  });

  it('R6 · the rescaled sentence names both packs, in English and in Italian', async () => {
    const { user } = await open(RESCALED.venue);
    await toIngredients(user, RESCALED.zip());
    expect(within(row('Farina tipo 00')).getByText(
      'Price worked out with the pack saved in Mise (20 kg) instead of the one on the invoice (25 kg). Check it.')).toBeInTheDocument();
  });

  it('R6 · … and in Italian', async () => {
    const { user } = await open(RESCALED.venue, { lang: 'it' });
    await chooseAndGo(user, RESCALED.zip());
    expect(within(row('Farina tipo 00')).getByText(
      'Prezzo calcolato con la confezione salvata in Mise (20 kg) invece di quella in fattura (25 kg). Controllalo.')).toBeInTheDocument();
  });
});

// Italian: the buttons are named in Italian.
async function chooseAndGo(user: Parameters<typeof toSuppliers>[0], file: File): Promise<void> {
  const { chooseFiles } = await import('./testing/renderImport');
  await chooseFiles(user, file);
  await user.click(await screen.findByRole('button', { name: 'Avanti' }, LOAD));
  await screen.findByRole('heading', { level: 3, name: 'Fornitori' }, LOAD);
  const next = screen.queryByRole('button', { name: 'Avanti' });
  if (next) {
    await user.click(next);
  } else {
    await user.click(screen.getByRole('button', { name: /^Salva \d+ fornitor/ }));
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
  }
  await screen.findByRole('heading', { level: 3, name: 'Ingredienti' }, LOAD);
  await waitFor(() => { expect(screen.queryByText('Controllo cosa c’è già in Mise…')).not.toBeInTheDocument(); }, LOAD);
}

describe('the price on a row (S3)', () => {
  it('a row that replaces the price in force says «from → to (+10%)»', async () => {
    const { user } = await open({ ingredients: [stored()], prices: { 'ing-1': priceDoc({ pricePerUnit: 0.52 }) } });
    await toIngredients(user);
    const flour = row('Farina tipo 00');
    expect(within(flour).getByText('Fornitore Esempio · 0,52 € / kg → 0,57 € / kg (+10%) · 1 invoice')).toBeInTheDocument();
    expect(within(flour).getByText('New price')).toHaveAttribute('data-tone', 'ok');
  });

  it('a fall is written with a «-»', async () => {
    const { user } = await open({ ingredients: [stored()], prices: { 'ing-1': priceDoc({ pricePerUnit: 0.8 }) } });
    await toIngredients(user);
    expect(within(row('Farina tipo 00')).getByText(/0,80 € \/ kg → 0,57 € \/ kg \(-29%\)/)).toBeInTheDocument();
  });

  it('a stored price in ANOTHER unit shows only the new one (the model keeps it out of the comparison)', async () => {
    const { user } = await open({ ingredients: [stored()], prices: { 'ing-1': priceDoc({ priceUnit: 'pcs', pricePerUnit: 2, unitWeightKg: 1 }) } });
    await toIngredients(user);
    const flour = row('Farina tipo 00');
    expect(within(flour).getByText('Fornitore Esempio · 0,57 € / kg · 1 invoice')).toBeInTheDocument();
    expect(within(flour).getByText('History only')).toHaveAttribute('data-tone', 'quiet');
    expect(within(flour).getByText('The current price is in another unit, so the new prices go to the history only.')).toBeInTheDocument();
  });

  it('S3 · a row held for a look shows the price it would write (the held row), not the planned one', async () => {
    const { user } = await open(RESCALED.venue);
    await toIngredients(user, RESCALED.zip());
    // 14.25 per sack of 25 kg, worked out again with the 20 kg sack of the venue: 0,7125 (the price of the HELD row).
    expect(within(row('Farina tipo 00')).getByText('Fornitore Esempio · 0,7125 € / kg · 1 invoice')).toBeInTheDocument();
  });
});

describe('a question', () => {
  it('blocks the button, says why (to a screen reader too), and is answered from the options the model offers', async () => {
    const { user } = await open({ ingredients: [stored({ supplierCode: 'X99' })] });
    await toIngredients(user, invoiceZip([FLOUR]));
    const flour = row('Farina tipo 00');
    expect(within(flour).getByText('To decide')).toHaveAttribute('data-tone', 'warn');
    expect(within(flour).getByText('Same name, but another article code: is it the same product?')).toBeInTheDocument();
    const button = primary('Import 0 ingredients');
    const hint = screen.getByText('Choose what to do with 1 ingredient first.');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby', hint.id);
    const choice = within(flour).getByRole('combobox', { name: 'What should happen?' });
    expect(within(choice).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Choose…', 'Same as Farina tipo 00', 'Create a new ingredient', 'Skip']);

    await user.selectOptions(choice, 'Same as Farina tipo 00');
    expect(screen.queryByText(/Choose what to do with/)).not.toBeInTheDocument();
    expect(primary('Import 1 ingredient')).toBeEnabled();
    // It stays under «To decide» once answered.
    expect(screen.getByRole('button', { name: 'To decide (1)' })).toBeInTheDocument();
    await user.selectOptions(within(row('Farina tipo 00')).getByRole('combobox', { name: 'What should happen?' }), 'Choose…');
    expect(screen.getByText('Choose what to do with 1 ingredient first.')).toBeInTheDocument();
  });

  it('«Skip» and «Create a new ingredient» are answers too', async () => {
    const { user } = await open({ ingredients: [stored({ supplierCode: 'X99' })] });
    await toIngredients(user, invoiceZip([FLOUR]));
    const choice = () => within(row('Farina tipo 00')).getByRole('combobox', { name: 'What should happen?' });
    await user.selectOptions(choice(), 'Skip');
    expect(primary('Done')).toBeEnabled();
    await user.selectOptions(choice(), 'Create a new ingredient');
    expect(primary('Import 1 ingredient')).toBeEnabled();
  });

  it('10 · «This price?» comes AFTER the question, has its own label, and a new answer clears «Use this price» (S4)', async () => {
    const { user } = await open({
      ingredients: [stored({ weight: '20 kg' }), item('ing-2', { name: 'Farina doppia', supplierId: 'sup-1', supplierCode: 'F00', weight: '25 kg', kind: 'ingredient' })],
    });
    await toIngredients(user, invoiceZip([FLOUR_BY_SACK]));
    const flour = () => row('Farina tipo 00');
    const question = within(flour()).getByRole('combobox', { name: 'What should happen?' });
    expect(within(flour()).queryByRole('combobox', { name: 'This price?' })).not.toBeInTheDocument();

    // Same as the 20 kg one: the price is worked out again with its pack, so it must be looked at.
    await user.selectOptions(question, 'Same as Farina tipo 00');
    const boxes = within(flour()).getAllByRole('combobox');
    expect(boxes.map(box => (box as HTMLSelectElement).labels[0]?.textContent)).toEqual(['What should happen?', 'This price?']);
    await user.selectOptions(within(flour()).getByRole('combobox', { name: 'This price?' }), 'Use this price');
    expect(within(flour()).getByRole('combobox', { name: 'This price?' })).toHaveValue('use');

    // Another answer is another price: the confirmation is gone, and so is its box when the other ingredient has the same pack.
    await user.selectOptions(within(flour()).getByRole('combobox', { name: 'What should happen?' }), 'Same as Farina doppia');
    expect(within(flour()).queryByRole('combobox', { name: 'This price?' })).not.toBeInTheDocument();
    // Back to the first: it asks again, and has NOT kept the confirmation.
    await user.selectOptions(within(flour()).getByRole('combobox', { name: 'What should happen?' }), 'Same as Farina tipo 00');
    expect(within(flour()).getByRole('combobox', { name: 'This price?' })).toHaveValue('hold');
  });
});

describe('«This price?» for a row held for a look', () => {
  it('«Use this price» lets the row write (the button counts it), «Leave it for now» holds it', async () => {
    const { user } = await open(RESCALED.venue);
    await toIngredients(user, RESCALED.zip());
    expect(within(row('Farina tipo 00')).getByText('To check')).toHaveAttribute('data-tone', 'warn');
    // Held: nothing to write yet.
    expect(primary('Done')).toBeEnabled();
    const choice = within(row('Farina tipo 00')).getByRole('combobox', { name: 'This price?' });
    expect(within(choice).getAllByRole('option').map(option => option.textContent)).toEqual(['Leave it for now', 'Use this price']);
    await user.selectOptions(choice, 'Use this price');
    expect(primary('Import 1 ingredient')).toBeEnabled();
    expect(within(row('Farina tipo 00')).getByText('To check')).toBeInTheDocument();
    await user.selectOptions(within(row('Farina tipo 00')).getByRole('combobox', { name: 'This price?' }), 'Leave it for now');
    expect(primary('Done')).toBeEnabled();
  });
});

describe('rows already in Mise', () => {
  it('a price that is all in already is «Unchanged», in a closed group; with nothing else the button is «Done» and prices can be recorded', async () => {
    const { user, importing } = await open({ ingredients: [stored({ invoiceName: 'FARINA TIPO 00 SACCO KG 25' })], prices: { 'ing-1': priceDoc({ pricePerUnit: 0.57, priceUpdatedAt: '2026-09-01T12:00:00.000Z' }) } });
    importing.points.set('ing-1', { ids: new Set(['inv-9000000001-1']), points: [] });
    await toIngredients(user, invoiceZip([FLOUR]));
    expect(screen.getByText('1 unchanged ingredient', { selector: 'summary' })).toBeInTheDocument();
    expect(primary('Done')).toBeEnabled();
    expect(screen.getByText('Nothing to import: everything is already in Mise, skipped or has an error.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record price changes' })).toBeEnabled();
    expect(importing.writes).toEqual([]);
  });
});

describe('a check that fails', () => {
  it('says so in a red line and offers «Try again», which checks again', async () => {
    const { user, importing } = await open({ ingredients: [stored()] });
    importing.failWith('invoicePoints', 'boom');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await toSuppliers(user);
    await user.click(primary('Next'));
    const alert = await screen.findByRole('alert', undefined, LOAD);
    expect(alert).toHaveTextContent('Could not check what is already recorded. Check your connection and try again.');
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();

    importing.failWith('invoicePoints', null);
    await user.click(primary('Try again'));
    await screen.findByRole('group', { name: 'Show' }, LOAD);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Show' })).toBeInTheDocument();
  });

  it('a refusal and a lost connection have their own words', async () => {
    const { user, importing } = await open({ ingredients: [stored()] });
    importing.failWith('invoicePoints', 'permission-denied');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await toSuppliers(user);
    await user.click(primary('Next'));
    expect(await screen.findByRole('alert', undefined, LOAD)).toHaveTextContent('Mise was not allowed to save this');
    importing.failWith('invoicePoints', 'unavailable');
    await user.click(primary('Try again'));
    expect(await screen.findByRole('alert', undefined, LOAD)).toHaveTextContent('There is no connection.');
  });
});

describe('a supplier skipped at step 2', () => {
  it('its ingredients are not offered', async () => {
    const { user } = await open({ suppliers: [] });
    await toSuppliers(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'What should happen?' }), 'Do not import anything from this supplier (remember)');
    await user.click(primary('Next'));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await waitFor(() => { expect(screen.queryByText('Checking what is already in Mise…')).not.toBeInTheDocument(); }, LOAD);
    expect(screen.queryByText('Farina tipo 00')).not.toBeInTheDocument();
    expect(primary('Done')).toBeEnabled();
  });
});
