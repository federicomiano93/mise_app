import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», step 3e-2, after the review: Back with the supplier dialog open, a card never opened before its
// suppliers, the kind and the supplier kept as opened, the busy bin, Save during the count, a refused new supplier, the packaging
// words.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills Ltd', shortName: 'Alpine' }),
  supplier('s-zed', { name: 'Zed Dairy' }),
];
const FLOUR = item('i-flour', { name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', unit: 'kg' });
const BOX = item('i-box', { name: 'Cake box', kind: 'packaging', supplierId: 's-alp' });
const GONE_SUPPLIER = item('i-odd', { name: 'Odd one', supplierId: 's-gone' });

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [FLOUR, BOX, GONE_SUPPLIER] });
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });
const NEW = '+ New supplier…';

async function open(path: string, source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  const region = within(await screen.findByRole('region', { name: /^(Edit|New|Modifica|Nuovo) (ingredient|ingrediente|packaging|imballaggio)$/ }, LOAD));
  return { ...view, source, region };
}
type View = Awaited<ReturnType<typeof open>>;
const brand = (view: View) => view.region.getByRole('textbox', { name: /^(Brand|Marca)$/ });

async function saveAndConfirm(view: View, question: string) {
  await view.user.click(view.region.getByRole('button', { name: 'Save' }));
  await view.user.click(within(await dialogOf(question)).getByRole('button', { name: 'Save' }));
}

describe('Back while «+ New supplier…» is open', () => {
  async function withDialog(view: View) {
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Supplier' }), NEW);
    return within(await screen.findByRole('dialog', { name: 'New supplier' }));
  }

  it('⚠️ typing in the dialog: the browser\'s Back asks ONE question; Cancel keeps both, Discard leaves', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    const dialog = await withDialog(view);
    await view.user.type(dialog.getByRole('textbox', { name: 'Name on invoices' }), 'Rossi');
    act(() => { void view.router.navigate('/suppliers/packaging'); });
    const question = await dialogOf('Discard changes?');
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await view.user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    expect(screen.getByRole('dialog', { name: 'New supplier' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Name on invoices' })).toHaveValue('Rossi');

    act(() => { void view.router.navigate('/suppliers/packaging'); });
    await view.user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers/packaging'); });
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New supplier' })).not.toBeInTheDocument(); });
    expect(view.source.writes).toEqual([]);
  });

  it('⚠️ typing only underneath: the same question', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.type(brand(view), 'X');
    await withDialog(view);
    act(() => { void view.router.navigate('/suppliers/packaging'); });
    const question = await dialogOf('Discard changes?');
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await view.user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    act(() => { void view.router.navigate('/suppliers/packaging'); });
    await view.user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers/packaging'); });
  });

  it('nothing typed anywhere: leaves in silence; and a dialog closed with its typing discarded no longer holds the page', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    const dialog = await withDialog(view);
    await view.user.type(dialog.getByRole('textbox', { name: 'Name on invoices' }), 'Rossi');
    await view.user.click(dialog.getByRole('button', { name: 'Back' }));
    await view.user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New supplier' })).not.toBeInTheDocument(); });
    act(() => { void view.router.navigate('/suppliers/packaging'); });
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers/packaging'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('an existing item opens only once its suppliers have arrived', () => {
  it('⚠️ ingredients first, suppliers late: no card, then the right supplier, and a rename keeps it', async () => {
    const source = fakeSuppliersSource({ suppliers: [], ingredients: [FLOUR] });
    source.fromCache = true;
    const { user } = renderSuppliers('/suppliers/ingredient/i-flour', { source });
    await screen.findAllByText('Loading…', undefined, LOAD);
    // Well past the 1.2 seconds a copy waits for the server.
    await new Promise<void>(resolve => { setTimeout(resolve, 1500); });
    expect(screen.queryByRole('region', { name: 'Edit ingredient' })).not.toBeInTheDocument();

    for (const one of SUPPLIERS) source.suppliers.set(one.id, one);
    act(() => { source.push(); });
    const region = within(await screen.findByRole('region', { name: 'Edit ingredient' }, LOAD));
    expect(region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('s-alp');

    await user.type(region.getByRole('textbox', { name: 'Brand' }), 'X');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save ingredient?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toMatchObject({ data: { supplierId: 's-alp' } });
  });

  it('a supplier the list does not hold (deleted) is still re-filed under «No supplier»', async () => {
    const view = await open('/suppliers/ingredient/i-odd');
    expect(view.region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('no-supplier');
    await view.user.type(brand(view), 'X');
    await saveAndConfirm(view, 'Save ingredient?');
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { supplierId: 'no-supplier' } });
  });

  it('suppliers that could not be read: the «could not load» panel, no card', async () => {
    const source = seeded();
    source.refuse.suppliers = true;
    renderSuppliers('/suppliers/ingredient/i-flour', { source });
    expect(await screen.findAllByText('Could not load the suppliers. Check your connection and try again.', undefined, LOAD)).not.toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Edit ingredient' })).not.toBeInTheDocument();
  });
});

describe('what the card keeps as it opened', () => {
  it('⚠️ the kind: a packaging item deleted on another phone stays packaging and is saved as packaging', async () => {
    const view = await open('/suppliers/ingredient/i-box');
    view.source.ingredients.delete('i-box');
    act(() => { view.source.push(); });
    expect(screen.getByRole('region', { name: 'Edit packaging' })).toBeInTheDocument();
    await view.user.type(brand(view), 'X');
    await saveAndConfirm(view, 'Save packaging?');
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { kind: 'packaging' } });
  });

  it('⚠️ the supplier: deleted on another phone while selected, its option stays under the label it had, and that is what Save writes', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    view.source.suppliers.delete('s-alp');
    act(() => { view.source.push(); });
    const menu = view.region.getByRole('combobox', { name: 'Supplier' });
    expect(menu).toHaveValue('s-alp');
    expect(within(menu).getByRole('option', { name: 'Alpine' })).toBeInTheDocument();
    await view.user.type(brand(view), 'X');
    await saveAndConfirm(view, 'Save ingredient?');
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { supplierId: 's-alp' } });
  });
});

describe('the bin and Save while the count runs', () => {
  const bin = (view: View) => view.region.getByRole('button', { name: 'Delete ingredient' });

  it('⚠️ the bin is aria-disabled and busy, not disabled; a press does nothing; Cancel gives the focus back to it', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    const release = view.source.holdUsage();
    await view.user.click(bin(view));
    await waitFor(() => { expect(bin(view)).toHaveAttribute('aria-disabled', 'true'); });
    expect(bin(view)).not.toBeDisabled();
    expect(bin(view)).toHaveAttribute('aria-busy', 'true');
    await act(async () => { bin(view).click(); });
    expect(view.source.usageCalls).toEqual(['i-flour']);
    release();
    await view.user.click(within(await dialogOf('Delete “Flour”?')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(bin(view)).toHaveFocus(); });
    expect(bin(view)).not.toHaveAttribute('aria-disabled');
  });

  it('⚠️ Save is ignored while the count runs: no question, no write', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.type(brand(view), 'X');
    const release = view.source.holdUsage();
    await view.user.click(bin(view));
    await waitFor(() => { expect(bin(view)).toHaveAttribute('aria-disabled', 'true'); });
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    release();
    expect(await dialogOf('Delete “Flour”?')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog', { name: 'Save ingredient?' })).not.toBeInTheDocument();
    expect(view.source.writes).toEqual([]);
  });
});

describe('a new supplier the database refuses', () => {
  it('⚠️ the menu goes back to what it showed, the new supplier leaves it, and the store says why', async () => {
    const source = seeded();
    source.refuseWrites.save = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await open('/suppliers/ingredient/i-flour', source);
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Supplier' }), NEW);
    const dialog = within(await screen.findByRole('dialog', { name: 'New supplier' }));
    await view.user.type(dialog.getByRole('textbox', { name: 'Name on invoices' }), 'Latteria Rossi');
    await view.user.click(dialog.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Could not save “Latteria Rossi”. Check your network and try again.')).toBeInTheDocument();
    const menu = view.region.getByRole('combobox', { name: 'Supplier' });
    await waitFor(() => { expect(menu).toHaveValue('s-alp'); });
    expect(within(menu).queryByRole('option', { name: 'Latteria Rossi' })).not.toBeInTheDocument();
    // Nothing is left unsaved on the card: the menu is what it opened on.
    act(() => { void view.router.navigate('/suppliers/packaging'); });
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers/packaging'); });
  });
});

describe('the packaging words and the case sentences', () => {
  it('a packaging item asks «Save packaging?», says «Packaging saved.» and has a «Delete packaging» bin', async () => {
    const view = await open('/suppliers/ingredient/i-box');
    expect(view.region.getByRole('button', { name: 'Delete packaging' })).toBeInTheDocument();
    expect(view.region.queryByRole('button', { name: 'Delete ingredient' })).not.toBeInTheDocument();
    await view.user.type(brand(view), 'X');
    await saveAndConfirm(view, 'Save packaging?');
    expect(await screen.findByText('Packaging saved.')).toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    const view = await open('/suppliers/ingredient/i-box', seeded(), { lang: 'it', session: { language: 'it' } });
    expect(view.region.getByRole('button', { name: 'Elimina imballaggio' })).toBeInTheDocument();
    await view.user.type(brand(view), 'X');
    await view.user.click(view.region.getByRole('button', { name: 'Salva' }));
    const question = await dialogOf('Salvare l’imballaggio?');
    await view.user.click(within(question).getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Imballaggio salvato.')).toBeInTheDocument();
  });

  it('an ingredient keeps its own words', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.type(brand(view), 'X');
    await saveAndConfirm(view, 'Save ingredient?');
    expect(await screen.findByText('Ingredient saved.')).toBeInTheDocument();
  });

  it('⚠️ Case → Single clears a pending count refusal: it does not come back when Case is picked again', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.click(view.region.getByRole('button', { name: 'Case' }));
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    const count = view.region.getByRole('textbox', { name: 'How many in the case' });
    expect(count).toHaveAttribute('aria-invalid', 'true');
    await view.user.click(view.region.getByRole('button', { name: 'Single' }));
    await view.user.click(view.region.getByRole('button', { name: 'Case' }));
    const again = view.region.getByRole('textbox', { name: 'How many in the case' });
    expect(again).not.toHaveAttribute('aria-invalid');
    expect(view.region.queryByText('Write a whole number, e.g. 4')).not.toBeInTheDocument();
  });

  it('⚠️ Case → Single clears a pending new-package-name refusal too', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.click(view.region.getByRole('button', { name: 'Case' }));
    await view.user.type(view.region.getByRole('textbox', { name: 'How many in the case' }), '3');
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'What is inside the case' }), '+ New…');
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    expect(view.region.getByRole('textbox', { name: 'New package name' })).toHaveAttribute('aria-invalid', 'true');
    await view.user.click(view.region.getByRole('button', { name: 'Single' }));
    await view.user.click(view.region.getByRole('button', { name: 'Case' }));
    expect(view.region.queryByText('Write the new package’s name')).not.toBeInTheDocument();
  });
});
