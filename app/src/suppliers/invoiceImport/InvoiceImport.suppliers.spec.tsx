import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import { invoiceXml, metadataXml } from '@mise/shared/invoice-zip/testing/invoice-builders';
import { fakeSuppliersSource } from '../../testing/fakeSuppliersSource';
import { supplier } from '../../testing/renderSuppliers';
import { fakeImportSource } from './testing/fakeImportSource';
import {
  FLOUR, LOAD, SUPPLIER_NAME, SUPPLIER_VAT, chooseFiles, findImportScreen, invoiceZip, renderImport, toSuppliers, withBytes,
} from './testing/renderImport';

// «Import from invoices», part B3a: step 2, the suppliers — who each supplier of the file is, what must be decided, the confirmation,
// the fresh check, and what a failure does.
//
// PORTS (tests/invoice-import-flow.test.mjs): «a supplier that may already exist blocks the button until it is answered, and linking
// writes only its VAT number», «a plan drawn before the lists have arrived is refused…» (step 1's half is in the file spec),
// «⚠️ a supplier that appeared while the owner was deciding stops the write and asks again», «a supplier write that never answers ends
// in the offline message, and Back still works», «while rows are being written Back is off and does nothing» (the supplier write's
// half), «a NEW row can be left out…» / «a supplier chosen "do not import anything" is dropped…» (the screen's half: the choice, the
// button and the step on; the decision REMEMBERED is written with the rows, part B3b), «the screen is a modal dialog…» (the frame
// spec), «Back closes at once before a file is loaded, and asks (danger) once there is one» (the frame spec).
// LEFT FOR B3b: «a file goes through every step…», «a skipped supplier makes its ingredients errors that say why», and every test of
// the ingredients step, the rows' write, the remembered decisions and the summary.

beforeAll(async () => {
  await import('../SuppliersSection');
  await import('./InvoiceImportScreen');
}, 60_000);

afterEach(() => { vi.restoreAllMocks(); });

const EXISTING = supplier('s9', { name: 'Fornitore Esempio', shortName: '', vatNumber: '' });

async function open(options: Parameters<typeof renderImport>[1] = {}) {
  const view = renderImport('/suppliers/import', options);
  const screenView = await findImportScreen(options.lang === 'it' ? 'Importa da fatture' : 'Import from invoices');
  return { ...view, ...screenView };
}

const venueWith = (...suppliers: ReturnType<typeof supplier>[]) => fakeSuppliersSource({ suppliers });

// The save button of the step (its name is «Save n suppliers», or «Next»), as the form bar holds it.
const primary = (name: string | RegExp) => screen.getByRole('button', { name });
const saveDialog = () => screen.findByRole('alertdialog', { name: 'Save these suppliers?' });

// A second supplier on the same invoice zip: two invoices, two VAT numbers.
function twoSuppliersZip(): File {
  const members = {
    'inv1.xml': invoiceXml([FLOUR], {}),
    'inv1_MT_001.xml': metadataXml('9000000001'),
    'inv2.xml': invoiceXml([{ desc: 'ZUCCHERO SACCHI DA KG 25', code: 'Z25', qty: 50, unit: 'KG', total: 40 }], { name: 'ALTRO FORNITORE SPA', vat: '00000000002', number: '2' }),
    'inv2_MT_001.xml': metadataXml('9000000002'),
  };
  const bytes = zipSync(Object.fromEntries(Object.entries(members).map(([name, xml]) => [name, Uint8Array.from(strToU8(xml))])));
  return withBytes(new File([bytes.slice().buffer], 'due.zip'), bytes);
}

describe('the step', () => {
  it('names itself, counts itself, and takes the focus on its heading', async () => {
    const { user } = await open();
    await toSuppliers(user);
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('heading', { level: 3, name: 'Suppliers' })).toHaveFocus(); });
  });

  it('a supplier not in Mise yet: its name, VAT number, a WORD in a pill, and the choice to import or not', async () => {
    const { user } = await open();
    await toSuppliers(user);
    const row = screen.getByRole('listitem', { name: SUPPLIER_NAME });
    expect(within(row).getByText(`VAT number ${SUPPLIER_VAT}`)).toBeInTheDocument();
    expect(within(row).getByText('New')).toHaveAttribute('data-tone', 'ok');
    const choice = within(row).getByRole('combobox', { name: 'What should happen?' });
    expect(within(choice).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Import', 'Do not import anything from this supplier (remember)']);
    expect(choice).toHaveValue('import');
    expect(primary('Save 1 supplier')).toBeEnabled();
  });

  it('a supplier already in Mise (same VAT number): the pill says so, «is {name}», and nothing is left to save', async () => {
    const { user, importing } = await open({ suppliers: venueWith(supplier('s1', { name: 'Fornitore Esempio', vatNumber: 'IT 00000000001' })) });
    await toSuppliers(user);
    const row = screen.getByRole('listitem', { name: SUPPLIER_NAME });
    expect(within(row).getByText('Already in Mise')).toHaveAttribute('data-tone', 'ok');
    expect(within(row).getByText(`VAT number ${SUPPLIER_VAT} · is Fornitore Esempio`)).toBeInTheDocument();
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(primary('Next')).toBeEnabled();
    await user.click(primary('Next'));
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
    expect(importing.writes).toEqual([]);
  });

  it('a supplier whose entry cannot be used is an Error, with the reason in words', async () => {
    const { user } = await open();
    const zip = invoiceZip([FLOUR], { vat: '1'.repeat(40) });
    await toSuppliers(user, zip);
    const row = screen.getByRole('listitem', { name: SUPPLIER_NAME });
    expect(within(row).getByText('Error')).toHaveAttribute('data-tone', 'error');
    expect(within(row).getByText('The VAT number is too long.')).toBeInTheDocument();
    expect(primary('Next')).toBeEnabled();
  });

  it('speaks Italian, with the current app’s words', async () => {
    const { user } = await open({ lang: 'it' });
    await chooseFiles(user, invoiceZip());
    await user.click(await screen.findByRole('button', { name: 'Avanti' }, LOAD));
    const row = await screen.findByRole('listitem', { name: SUPPLIER_NAME }, LOAD);
    expect(within(row).getByText('Nuovo')).toBeInTheDocument();
    expect(within(row).getByText(`P.IVA ${SUPPLIER_VAT}`)).toBeInTheDocument();
    expect(screen.getByText('Passo 2 di 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva 1 fornitore' })).toBeInTheDocument();
  });
});

describe('⚠️ a supplier that may already exist blocks the button until it is answered', () => {
  it('says why, to a screen reader too, and linking writes only its VAT number', async () => {
    const { user, importing } = await open({ suppliers: venueWith(EXISTING) });
    await toSuppliers(user);
    const row = screen.getByRole('listitem', { name: SUPPLIER_NAME });
    expect(within(row).getByText('Maybe this one?')).toHaveAttribute('data-tone', 'warn');
    const hint = screen.getByText('Choose what to do with 1 supplier first.');
    expect(primary('Next')).toBeDisabled();
    expect(primary('Next')).toHaveAttribute('aria-describedby', hint.id);
    const choice = within(row).getByRole('combobox', { name: 'What should happen?' });
    expect(within(choice).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Choose…', 'Same as Fornitore Esempio', 'Create a new supplier', 'Skip']);

    await user.selectOptions(choice, 'Same as Fornitore Esempio');
    expect(screen.queryByText(/Choose what to do with/)).not.toBeInTheDocument();
    await user.click(primary('Save 1 supplier'));
    const dialog = await saveDialog();
    expect(within(dialog).getByText('1 existing supplier will get its VAT number added.')).toBeInTheDocument();
    expect(importing.writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD)).toBeInTheDocument();
    expect(importing.writes).toEqual([{ kind: 'linkSupplierVat', supplierId: 's9', vatNumber: SUPPLIER_VAT }]);
  });

  it('«Create a new supplier» and «Skip» are answers too', async () => {
    const { user } = await open({ suppliers: venueWith(EXISTING) });
    await toSuppliers(user);
    const choice = screen.getByRole('combobox', { name: 'What should happen?' });
    await user.selectOptions(choice, 'Create a new supplier');
    expect(primary('Save 1 supplier')).toBeEnabled();
    await user.selectOptions(choice, 'Skip');
    expect(primary('Next')).toBeEnabled();
    await user.selectOptions(choice, 'Choose…');
    expect(primary('Next')).toBeDisabled();
  });

  it('two suppliers with the same VAT number are a question too, and the reason is said', async () => {
    const { user } = await open({ suppliers: venueWith(
      supplier('a', { name: 'Alpha', vatNumber: SUPPLIER_VAT }), supplier('b', { name: 'Beta', vatNumber: SUPPLIER_VAT })) });
    await toSuppliers(user);
    const row = screen.getByRole('listitem', { name: SUPPLIER_NAME });
    expect(within(row).getByText('Two suppliers carry this VAT number.')).toBeInTheDocument();
    expect(within(row).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Choose…', 'Same as Alpha', 'Same as Beta', 'Create a new supplier', 'Skip']);
  });
});

describe('⚠️ the new supplier is written as the model says, after a confirmation', () => {
  it('asks first (and Cancel writes nothing and reads nothing), then creates it with the model\'s exact payload', async () => {
    const { user, importing } = await open();
    await toSuppliers(user);
    await user.click(primary('Save 1 supplier'));
    let dialog = await saveDialog();
    expect(within(dialog).getByText('1 new supplier will be created.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(importing.writes).toEqual([]);
    expect(importing.countOf('freshSuppliers')).toBe(0);
    expect(screen.getByRole('heading', { level: 3, name: 'Suppliers' })).toBeInTheDocument();

    await user.click(primary('Save 1 supplier'));
    dialog = await saveDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(importing.writes).toEqual([{
      kind: 'createSupplier',
      id: 'sup-1',
      data: {
        name: SUPPLIER_NAME, shortName: '', category: '', phone: '', email: '', deliveryDays: [], orderDays: [], active: true, vatNumber: SUPPLIER_VAT,
      },
    }]);
  });

  it('the fresh read comes BEFORE the first write', async () => {
    const { user, importing } = await open();
    await toSuppliers(user);
    await user.click(primary('Save 1 supplier'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(importing.calls.map(call => call[0])).toEqual(['loadDecisions', 'freshSuppliers', 'createSupplier']);
  });

  it('«Do not import anything from this supplier» leaves nothing to save: Next goes on, and nothing is written', async () => {
    const { user, importing } = await open();
    await toSuppliers(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'What should happen?' }), 'Do not import anything from this supplier (remember)');
    expect(primary('Next')).toBeEnabled();
    await user.click(primary('Next'));
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
    expect(importing.writes).toEqual([]);
    expect(importing.calls.map(call => call[0])).toEqual(['loadDecisions']);
  });
});

describe('⚠️ a supplier that appeared while the owner was deciding', () => {
  it('stops the write, clears the answer, and asks again with the fresh plan', async () => {
    const { user, importing } = await open();
    await toSuppliers(user);
    // Another phone adds the same supplier (same VAT number) after the plan was drawn and confirmed on screen.
    importing.beforeFreshSuppliers = () => {
      importing.suppliers.push({ id: 'other-phone', name: 'Fornitore Esempio', shortName: '', vatNumber: SUPPLIER_VAT });
    };
    await user.click(primary('Save 1 supplier'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The supplier list changed: check again.')).toBeInTheDocument();
    expect(importing.writes, 'nothing was written').toEqual([]);
    expect(screen.getByText('Already in Mise')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    await waitFor(() => { expect(primary('Next')).toHaveFocus(); });

    importing.beforeFreshSuppliers = null;
    await user.click(primary('Next'));
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
    expect(importing.suppliers).toHaveLength(1);
  });

  it('forgets the answers of the suppliers that changed, and only those', async () => {
    const { user, importing } = await open({ suppliers: venueWith(EXISTING) });
    await toSuppliers(user, twoSuppliersZip());
    const first = screen.getByRole('listitem', { name: SUPPLIER_NAME });
    await user.selectOptions(within(first).getByRole('combobox'), 'Same as Fornitore Esempio');
    // The OTHER supplier is the one that changes.
    importing.beforeFreshSuppliers = () => {
      importing.suppliers.push({ id: 'other-phone', name: 'Altro Fornitore', shortName: '', vatNumber: '00000000002' });
    };
    await user.click(primary('Save 2 suppliers'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    await screen.findByText('The supplier list changed: check again.');
    expect(importing.writes).toEqual([]);
    // The first answer is still there; the second supplier is now «Already in Mise».
    expect(within(screen.getByRole('listitem', { name: SUPPLIER_NAME })).getByRole('combobox')).toHaveValue('link:s9');
    expect(within(screen.getByRole('listitem', { name: 'ALTRO FORNITORE SPA' })).getByText('Already in Mise')).toBeInTheDocument();
  });
});

describe('⚠️ when the write goes wrong', () => {
  it('a write that never answers ends in the offline message, and Back works again', async () => {
    const { user, importing } = await open();
    await toSuppliers(user);
    importing.failWith('createSupplier', 'timeout');
    await user.click(primary('Save 1 supplier'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no connection.');
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(primary('Save 1 supplier')).toBeEnabled();
    await waitFor(() => { expect(primary('Save 1 supplier')).toHaveFocus(); });
  });

  it.each([
    ['permission-denied', 'Mise was not allowed to save this: your account may not change prices here. The import stopped.'],
    ['unavailable', 'There is no connection. The import stopped: load the same file again when you are online.'],
    ['aborted', 'The suppliers could not be saved. Nothing else was changed. Check your connection and try again.'],
  ])('%s is said in its own words', async (code, words) => {
    const { user, importing } = await open();
    await toSuppliers(user);
    importing.failWith('createSupplier', code);
    await user.click(primary('Save 1 supplier'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('⚠️ a retry after a failure half-way never creates the same supplier twice', async () => {
    const { user, importing } = await open();
    await toSuppliers(user, twoSuppliersZip());
    importing.failWith('createSupplier', 'unavailable', 1);
    await user.click(primary('Save 2 suppliers'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(importing.writes.map(write => write.kind)).toEqual(['createSupplier']);

    importing.failWith('createSupplier', null);
    // One is saved: the button counts what is left.
    await user.click(await screen.findByRole('button', { name: 'Save 1 supplier' }));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(importing.suppliers.map(supplierDoc => supplierDoc.name).sort()).toEqual(['ALTRO FORNITORE SPA', SUPPLIER_NAME].sort());
    expect(importing.countOf('createSupplier')).toBe(3);
  });

  it('⚠️ offline is said BEFORE anything: an alert, no question, no read', async () => {
    const { user, importing } = await open();
    await toSuppliers(user);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await user.click(primary('Save 1 supplier'));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('There is no connection. The import stopped: load the same file again when you are online.')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(importing.countOf('freshSuppliers')).toBe(0);
    expect(importing.writes).toEqual([]);
  });
});

describe('⚠️ while the suppliers are being written', () => {
  it('Back is off and does nothing, nothing can be changed, and everything is back afterwards', async () => {
    const importing = fakeImportSource();
    const { user, router } = await open({ importing });
    await toSuppliers(user);
    const release = importing.hold('createSupplier');
    await user.click(primary('Save 1 supplier'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(importing.countOf('createSupplier')).toBe(1); });

    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toBeDisabled();
    await user.click(back);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(screen.getByRole('combobox', { name: 'What should happen?' })).toBeDisabled();
    expect(primary('Save 1 supplier')).toBeDisabled();
    expect(screen.getByText('Saving suppliers…', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Import from invoices' })).toHaveAttribute('aria-busy', 'true');

    release();
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled(); });
  });

  it('the browser\'s Back is refused too, without a question (a half-sent import cannot be put back by Cancel)', async () => {
    const importing = fakeImportSource();
    const { user, router } = await open({ importing, entries: [{ pathname: '/suppliers' }, { pathname: '/suppliers/import', state: { keepFocus: true, fromList: true } }] });
    await toSuppliers(user);
    const release = importing.hold('createSupplier');
    await user.click(primary('Save 1 supplier'));
    await user.click(within(await saveDialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(importing.countOf('createSupplier')).toBe(1); });
    await act(async () => { await router.navigate('/orders'); });
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    release();
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(router.state.location.pathname).toBe('/suppliers/import');
  });
});
