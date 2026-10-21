import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», slice B: an existing supplier's card — what it waits for, what it copies, how it saves and
// where it leaves to.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', {
    name: 'Alpine Mills Ltd', shortName: 'Alpine', category: 'Flour', phone: '07700 900123', email: 'orders@alpine.test',
    deliveryDays: ['Monday', 'Thursday'], orderDays: ['Sunday'], vatNumber: 'IT01234567890',
  }),
  supplier('s-off', { name: 'Old Baker', active: false }),
];

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [item('i-1', { supplierId: 's-alp' })] });
const main = () => within(screen.getByRole('main'));
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });
const cardOf = () => screen.findByRole('region', { name: 'Edit supplier' }, LOAD);
const nameBox = (region: ReturnType<typeof within>) => region.getByRole('textbox', { name: 'Name on invoices' });

// List → supplier → card, the way a person walks.
async function walkToCard(name: RegExp = /^Alpine/, source = seeded(), options = {}) {
  const view = renderSuppliers('/suppliers/suppliers', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  await view.user.click(main().getByRole('button', { name }));
  await screen.findByRole('button', { name: 'Edit' }, LOAD);
  await view.user.click(screen.getByRole('button', { name: 'Edit' }));
  const element = await cardOf();
  return { ...view, source, element, region: within(element) };
}

describe('opening the card', () => {
  it('the supplier\'s screen has «Edit» (a pencil and the word), which opens the card one level below it', async () => {
    const { router, region } = await walkToCard();
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp/edit');
    expect(router.state.historyAction).toBe('PUSH');
    await waitFor(() => { expect(region.getByRole('heading', { level: 2, name: 'Edit supplier' })).toHaveFocus(); });
  });

  it('shows every stored value, the short name included', async () => {
    const { region } = await walkToCard();
    expect(nameBox(region)).toHaveValue('Alpine Mills Ltd');
    expect(region.getByRole('textbox', { name: 'Name in lists' })).toHaveValue('Alpine');
    expect(region.getByRole('textbox', { name: 'Category' })).toHaveValue('Flour');
    expect(region.getByLabelText('Phone (WhatsApp, digits only)')).toHaveValue('07700 900123');
    expect(region.getByLabelText('Email')).toHaveValue('orders@alpine.test');
    expect(region.getByLabelText('VAT number')).toHaveValue('IT01234567890');
    const delivery = within(region.getByRole('group', { name: 'Delivery days — when they deliver' }));
    expect(delivery.getAllByRole('checkbox').filter(box => (box as HTMLInputElement).checked).map(box => box.getAttribute('value'))).toEqual(['Monday', 'Thursday']);
    const order = within(region.getByRole('group', { name: 'Order days — when you place the order' }));
    expect(order.getByRole('checkbox', { name: 'Sun' })).toBeChecked();
  });

  it('is opened by its address too', async () => {
    renderSuppliers('/suppliers/supplier/s-alp/edit', { source: seeded() });
    const region = within(await cardOf());
    expect(nameBox(region)).toHaveValue('Alpine Mills Ltd');
  });

  it('on the split it opens beside the list, whose row stays marked', async () => {
    split();
    const { region } = await walkToCard();
    expect(nameBox(region)).toHaveValue('Alpine Mills Ltd');
    expect(main().getByRole('button', { name: /^Alpine/ })).toHaveAttribute('aria-current', 'true');
  });
});

describe('what the card waits for and copies', () => {
  it('⚠️ waits for the server: «Loading…» first, and the card only after 1.2 seconds when only the phone\'s copy has answered', async () => {
    const source = seeded();
    source.fromCache = true;
    renderSuppliers('/suppliers/supplier/s-alp/edit', { source });
    expect(await screen.findAllByText('Loading…', undefined, LOAD)).not.toHaveLength(0);
    await new Promise<void>(resolve => { setTimeout(resolve, 800); });
    expect(screen.queryByRole('region', { name: 'Edit supplier' })).not.toBeInTheDocument();
    expect(await cardOf()).toBeInTheDocument();
  });

  it('opens at once when the phone is offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const source = seeded();
    source.fromCache = true;
    renderSuppliers('/suppliers/supplier/s-alp/edit', { source });
    expect(await screen.findByRole('region', { name: 'Edit supplier' }, { timeout: 800 })).toBeInTheDocument();
  });

  it('⚠️ copies ONCE: a supplier changed on another phone afterwards never replaces what is on the card', async () => {
    const { region, source, user } = await walkToCard();
    await user.type(region.getByLabelText('Email'), '.uk');
    source.suppliers.set('s-alp', { ...(source.suppliers.get('s-alp') ?? { id: 's-alp' }), phone: '999', email: 'new@alpine.test' });
    act(() => { source.push(); });
    expect(region.getByLabelText('Phone (WhatsApp, digits only)')).toHaveValue('07700 900123');
    expect(region.getByLabelText('Email')).toHaveValue('orders@alpine.test.uk');
  });

  it('says «This supplier no longer exists.» and leaves for the list when the address names none', async () => {
    const { router } = renderSuppliers('/suppliers/supplier/nope/edit', { source: seeded() });
    expect(await screen.findByText('This supplier no longer exists.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: 'Edit supplier' })).not.toBeInTheDocument();
  });

  it('⚠️ does not say it from the phone\'s copy alone: it waits for the server first', async () => {
    const source = seeded();
    source.fromCache = true;
    const { router } = renderSuppliers('/suppliers/supplier/nope/edit', { source });
    await screen.findAllByText('Loading…', undefined, LOAD);
    await new Promise<void>(resolve => { setTimeout(resolve, 600); });
    expect(screen.queryByText('This supplier no longer exists.')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/supplier/nope/edit');
    expect(await screen.findByText('This supplier no longer exists.', undefined, LOAD)).toBeInTheDocument();
  });

  it('keeps the card on screen when the supplier is deleted on another phone meanwhile, and Save puts it back', async () => {
    const { region, source, user } = await walkToCard();
    await user.type(nameBox(region), '!');
    source.suppliers.delete('s-alp');
    act(() => { source.push(); });
    expect(nameBox(region)).toHaveValue('Alpine Mills Ltd!');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toMatchObject({ op: 'save', id: 's-alp' });
  });

  it('says the suppliers could not be read, with a Back, when the stream failed', async () => {
    const source = seeded();
    source.refuse.suppliers = true;
    const { router, user } = renderSuppliers('/suppliers/supplier/s-alp/edit', { source });
    expect(await screen.findAllByText('Could not load the suppliers. Check your connection and try again.', undefined, LOAD)).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
  });
});

describe('leaving the card', () => {
  it('untouched, Back leaves without asking, to the supplier, with the focus on «Edit»', async () => {
    const { region, user, router } = await walkToCard();
    await user.click(region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus(); });
  });

  it('with edits, asks on Back: Cancel keeps them, Discard leaves and writes nothing', async () => {
    const { region, user, router, source } = await walkToCard();
    await user.type(nameBox(region), '!');
    await user.click(region.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp/edit');
    expect(nameBox(region)).toHaveValue('Alpine Mills Ltd!');

    await user.click(region.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp'); });
    expect(source.writes).toEqual([]);
  });

  it('with edits, asks on the rail and on the browser\'s Back too', async () => {
    const { region, user, router } = await walkToCard();
    await user.type(nameBox(region), '!');
    await user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Recipes' }));
    await user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp/edit');

    act(() => { void router.navigate(-1); });
    expect(await dialogOf('Discard changes?')).toBeInTheDocument();
  });

  it('with edits on the split, picking another supplier in the list asks too', async () => {
    split();
    const source = fakeSuppliersSource({ suppliers: [...SUPPLIERS, supplier('s-zed', { name: 'Zed Dairy' })] });
    const { region, user, router } = await walkToCard(/^Alpine/, source);
    await user.type(nameBox(region), '!');
    await user.click(main().getByRole('button', { name: /^Zed/ }));
    expect(await dialogOf('Discard changes?')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp/edit');
  });
});

describe('saving the card', () => {
  it('asks, writes every field to the same id, and returns to the supplier (not the list) with the focus on «Edit»', async () => {
    const { region, user, router, source } = await walkToCard();
    await user.clear(region.getByRole('textbox', { name: 'Name in lists' }));
    await user.type(nameBox(region), ' Group');
    const delivery = within(region.getByRole('group', { name: 'Delivery days — when they deliver' }));
    await user.click(delivery.getByRole('checkbox', { name: 'Thu' }));
    await user.click(delivery.getByRole('checkbox', { name: 'Tue' }));
    await user.click(region.getByRole('button', { name: 'Save' }));
    const dialog = await dialogOf('Save supplier?');
    expect(within(dialog).getByText('Save “Alpine Mills Ltd Group”?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toEqual({
      op: 'save',
      id: 's-alp',
      data: {
        name: 'Alpine Mills Ltd Group',
        // Emptied on purpose: an empty string, so the merge clears the stored short name.
        shortName: '',
        category: 'Flour',
        phone: '07700 900123',
        email: 'orders@alpine.test',
        deliveryDays: ['Monday', 'Tuesday'],
        orderDays: ['Sunday'],
        active: true,
        vatNumber: 'IT01234567890',
      },
    });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp'); });
    // The supplier is drawn from the live list: the new name is already its title.
    expect(await screen.findByRole('heading', { level: 2, name: 'Alpine Mills Ltd Group' })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus(); });
    expect(await screen.findByText('Supplier saved.')).toBeInTheDocument();
  });

  it('⚠️ keeps a switched-off supplier switched off', async () => {
    const { region, user, source } = await walkToCard(/^Old Baker/);
    await user.type(nameBox(region), 's');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toMatchObject({ data: { name: 'Old Bakers', active: false } });
  });

  it('empties nothing it was not asked to: a field left alone is sent as it was', async () => {
    const { region, user, source } = await walkToCard();
    await user.type(region.getByRole('textbox', { name: 'Category' }), 's');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toMatchObject({ data: { name: 'Alpine Mills Ltd', shortName: 'Alpine', category: 'Flours', phone: '07700 900123' } });
  });

  it('a card opened by its address replaces itself with the supplier after a Save', async () => {
    const { user, router } = renderSuppliers('/suppliers/supplier/s-alp/edit', { source: seeded() });
    const region = within(await cardOf());
    await user.type(nameBox(region), '!');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('says it in Italian', async () => {
    renderSuppliers('/suppliers/supplier/s-alp/edit', { source: seeded(), lang: 'it', session: { language: 'it' } });
    const region = within(await screen.findByRole('region', { name: 'Modifica fornitore' }, LOAD));
    expect(region.getByLabelText('P.IVA')).toHaveValue('IT01234567890');
  });
});
