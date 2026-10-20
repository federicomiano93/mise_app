import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», slice A: a supplier's own screen, and the way into it and out of it.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', {
    name: 'Alpine Mills Ltd', shortName: 'Alpine', category: 'Flour', phone: '07700 900123', email: 'orders@alpine.test',
    deliveryDays: ['Monday', 'Thursday'], orderDays: ['Sunday'],
  }),
  supplier('s-zed', { name: 'Zed Dairy', category: 'Dairy' }),
  supplier('s-off', { name: 'Old Baker', active: false }),
];

const ITEMS = [
  item('i-1', { name: 'Flour 00', supplierId: 's-alp', brand: 'Molino' }),
  item('i-2', { name: 'Rye flour', shortName: 'Rye', supplierId: 's-alp' }),
  item('i-3', { name: 'Cake box', kind: 'packaging', supplierId: 's-alp' }),
  item('i-4', { name: 'Milk', supplierId: 's-zed' }),
];

const main = () => within(screen.getByRole('main'));
const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: ITEMS });
const screenOf = (name: string) => screen.findByRole('region', { name }, LOAD);
const rowOf = (name: RegExp | string) => main().getByRole('button', { name });
const back = () => screen.getByRole('button', { name: 'Back' });

async function loaded(path = '/suppliers/suppliers', source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

describe('opening a supplier from the list', () => {
  it('opens its own screen as a new entry, named by the label the app shows', async () => {
    const { router, user } = await loaded();
    const before = router.state.location.key;
    await user.click(rowOf(/^Alpine/));
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp');
    expect(router.state.historyAction).toBe('PUSH');
    expect(router.state.location.key).not.toBe(before);
    const region = await screenOf('Alpine');
    expect(within(region).getByRole('heading', { level: 2, name: 'Alpine' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('puts the focus on the supplier\'s title when it opens from the list', async () => {
    const { user } = await loaded();
    await user.click(rowOf(/^Alpine/));
    const title = await screen.findByRole('heading', { level: 2, name: 'Alpine' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
  });

  it('steps back to the Suppliers tab, keeps what was typed, and hands the focus back to the row', async () => {
    const { router, user } = await loaded();
    await user.type(screen.getByRole('searchbox'), 'alp');
    await waitFor(() => { expect(main().getAllByRole('listitem')).toHaveLength(1); });
    await user.click(rowOf(/^Alpine/));
    await screenOf('Alpine');
    await user.click(back());
    expect(router.state.location.pathname).toBe('/suppliers/suppliers');
    expect(screen.getByRole('searchbox')).toHaveValue('alp');
    await waitFor(() => { expect(rowOf(/^Alpine/)).toHaveFocus(); });
  });

  it('steps back by replacing itself when it was opened by its address', async () => {
    const { router, user } = await loaded('/suppliers/supplier/s-zed');
    await screenOf('Zed Dairy');
    await user.click(back());
    expect(router.state.location.pathname).toBe('/suppliers/suppliers');
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('a supplier\'s details', () => {
  it('shows the invoice name only when the label differs, then category, delivery, order, phone and email', async () => {
    await loaded('/suppliers/supplier/s-alp');
    const region = await screenOf('Alpine');
    expect(within(region).getByText('Alpine Mills Ltd · Flour · delivery Mon, Thu · order Sun · 07700 900123 · orders@alpine.test')).toBeInTheDocument();
  });

  it('leaves out what is not there, and the invoice name when it IS the label', async () => {
    await loaded('/suppliers/supplier/s-zed');
    const region = await screenOf('Zed Dairy');
    expect(within(region).getByText('Dairy')).toBeInTheDocument();
    expect(within(region).queryByText(/delivery|order/)).not.toBeInTheDocument();
  });

  it('writes the days in Italian, and an unknown stored word as it was stored', async () => {
    const source = fakeSuppliersSource({
      suppliers: [supplier('s-1', { name: 'Molino', deliveryDays: ['Monday', 'Thursday', 'Someday'], orderDays: ['Saturday'] })],
    });
    renderSuppliers('/suppliers/supplier/s-1', { source, lang: 'it', session: { language: 'it' } });
    const region = await screenOf('Molino');
    expect(within(region).getByText('consegna lun, gio, Someday · ordine sab')).toBeInTheDocument();
  });

  it('lists what they sell in ONE list, A–Z by the name shown, packaging tagged, and names no supplier', async () => {
    await loaded('/suppliers/supplier/s-alp');
    const region = await screenOf('Alpine');
    expect(within(region).getByRole('heading', { level: 3, name: 'What they sell' })).toBeInTheDocument();
    const rows = within(region).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual(['Cake boxPackaging', 'Flour 00Molinonot declared', 'Ryenot declared']);
    expect(within(rows[0] as HTMLElement).getByText('Packaging')).toBeInTheDocument();
    expect(within(region).queryByText('No supplier')).not.toBeInTheDocument();
    for (const row of rows) {
      expect(within(row as HTMLElement).queryByText(/Alpine/)).not.toBeInTheDocument();
      expect(row.querySelector('button, a, [tabindex]')).toBeNull();
    }
  });

  it('shows the price and «not declared» on those rows too, and the switched-off word', async () => {
    const source = fakeSuppliersSource({
      suppliers: SUPPLIERS,
      ingredients: [item('i-1', { name: 'Flour', supplierId: 's-alp', active: false })],
      prices: { 'i-1': { priceUnit: 'kg', pricePerUnit: 1.2 } },
    });
    await loaded('/suppliers/supplier/s-alp', source, { session: { location: { country: 'GB' } } });
    const row = within(await screenOf('Alpine')).getByRole('listitem');
    expect(within(row).getByText('£1.20 / kg')).toBeInTheDocument();
    expect(within(row).getByText('not declared')).toBeInTheDocument();
    expect(within(row).getByText('Switched off')).toBeInTheDocument();
  });

  it('says «No ingredients yet.» for a supplier that sells nothing', async () => {
    await loaded('/suppliers/supplier/s-off');
    const region = await screenOf('Old Baker');
    expect(within(region).getByText('No ingredients yet.')).toBeInTheDocument();
  });

  it('says «Loading…» until the suppliers have answered', async () => {
    const source = seeded();
    source.hold();
    renderSuppliers('/suppliers/supplier/s-alp', { source });
    expect(await screen.findAllByText('Loading…', undefined, LOAD)).not.toHaveLength(0);
    expect(screen.queryByText('This supplier no longer exists.')).not.toBeInTheDocument();
    act(() => { source.release(); });
    await screenOf('Alpine');
  });

  it('does not believe an empty answer from the browser\'s own database about a supplier', async () => {
    const source = fakeSuppliersSource();
    source.fromCache = true;
    const { router } = renderSuppliers('/suppliers/supplier/s-alp', { source });
    expect(await screen.findAllByText('Loading…', undefined, LOAD)).not.toHaveLength(0);
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 60); }); });
    expect(screen.getAllByText('Loading…')).not.toHaveLength(0);
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp');
  });
});

describe('the star', () => {
  it('is for whoever runs the place, named «Favourite», and not pressed until the supplier is starred', async () => {
    await loaded('/suppliers/supplier/s-alp');
    const region = await screenOf('Alpine');
    const star = within(region).getByRole('button', { name: 'Favourite' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
  });

  it('is not drawn for an employee', async () => {
    await loaded('/suppliers/supplier/s-alp', seeded(), { session: { canManage: false, role: 'employee', isOwner: false } });
    const region = await screenOf('Alpine');
    expect(within(region).queryByRole('button', { name: 'Favourite' })).not.toBeInTheDocument();
  });

  it('stars through the store at once, without waiting for the server, and unstars again', async () => {
    const source = seeded();
    const release = source.holdWrites();
    const { user } = await loaded('/suppliers/supplier/s-alp', source);
    const region = await screenOf('Alpine');
    const star = within(region).getByRole('button', { name: 'Favourite' });
    await user.click(star);
    expect(source.writes).toEqual([{ op: 'favourite', id: 's-alp', on: true }]);
    await waitFor(() => { expect(within(region).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'true'); });
    await user.click(within(region).getByRole('button', { name: 'Favourite' }));
    expect(source.writes.at(-1)).toEqual({ op: 'favourite', id: 's-alp', on: false });
    await waitFor(() => { expect(within(region).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'false'); });
    release();
  });

  it('is pressed for a supplier that is already a favourite', async () => {
    await loaded('/suppliers/supplier/s-alp', fakeSuppliersSource({
      suppliers: SUPPLIERS, ingredients: ITEMS, ordersConfig: { favouriteSuppliers: ['s-alp'] },
    }));
    const region = await screenOf('Alpine');
    expect(within(region).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts the star back and says so when the database refuses it', async () => {
    const source = seeded();
    source.refuseWrites.favourite = true;
    const { user } = await loaded('/suppliers/supplier/s-alp', source);
    const region = await screenOf('Alpine');
    await user.click(within(region).getByRole('button', { name: 'Favourite' }));
    expect(await screen.findByText('Could not save the favourite. Check the connection and try again.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is called «Preferito» in Italian', async () => {
    renderSuppliers('/suppliers/supplier/s-alp', { source: seeded(), lang: 'it', session: { language: 'it' } });
    const region = await screenOf('Alpine');
    expect(within(region).getByRole('button', { name: 'Preferito' })).toBeInTheDocument();
    expect(within(region).getByRole('heading', { level: 3, name: 'Cosa vendono' })).toBeInTheDocument();
  });
});

describe('a supplier that is not there', () => {
  it('leaves for the Suppliers tab and says so once when it is deleted on another phone', async () => {
    const source = seeded();
    const { router, user } = await loaded('/suppliers/suppliers', source);
    await user.click(rowOf(/^Zed/));
    await screenOf('Zed Dairy');

    source.suppliers.delete('s-zed');
    act(() => { source.push(); });

    expect(await screen.findByText('This supplier no longer exists.')).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(screen.getAllByText('This supplier no longer exists.')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Zed Dairy' })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: /^Zed/ })).not.toBeInTheDocument();
  });

  it('does the same for an address that names no supplier, once the suppliers are known', async () => {
    const { router } = renderSuppliers('/suppliers/supplier/nope', { source: seeded() });
    expect(await screen.findByText('This supplier no longer exists.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('says it in Italian', async () => {
    renderSuppliers('/suppliers/supplier/nope', { source: seeded(), lang: 'it', session: { language: 'it' } });
    expect(await screen.findByText('Questo fornitore non esiste più.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says the stream failed, and stays, when the suppliers could not be read', async () => {
    const source = seeded();
    source.refuse.suppliers = true;
    const { router } = renderSuppliers('/suppliers/supplier/s-alp', { source });
    expect(await screen.findAllByText('Could not load the suppliers. Check your connection and try again.', undefined, LOAD)).not.toHaveLength(0);
    expect(screen.queryByText('This supplier no longer exists.')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp');
  });
});

describe('on the tablet\'s split', () => {
  it('has the Suppliers tab\'s prompt on the right while nothing is open, and none beside the other tabs', async () => {
    split();
    const { user } = await loaded('/suppliers/suppliers');
    expect(screen.getByText('Choose a supplier')).toBeInTheDocument();
    expect(screen.getByText(/Tap a supplier on the left/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Ingredients' }));
    expect(screen.queryByText('Choose a supplier')).not.toBeInTheDocument();
  });

  it('draws no prompt beside «No suppliers yet»', async () => {
    split();
    renderSuppliers('/suppliers/suppliers', { source: fakeSuppliersSource() });
    await screen.findByText('No suppliers yet', undefined, LOAD);
    expect(screen.queryByText('Choose a supplier')).not.toBeInTheDocument();
  });

  it('opens the supplier beside the list, marks only its row, and keeps the list mounted', async () => {
    split();
    const { user } = await loaded();
    const list = main().getAllByRole('listitem')[0]?.parentElement;
    await user.click(rowOf(/^Alpine/));
    await screenOf('Alpine');
    expect(rowOf(/^Alpine/)).toHaveAttribute('aria-current', 'true');
    expect(rowOf(/^Zed/)).not.toHaveAttribute('aria-current');
    expect(screen.queryByText('Choose a supplier')).not.toBeInTheDocument();

    await user.click(rowOf(/^Zed/));
    await screenOf('Zed Dairy');
    expect(rowOf(/^Zed/)).toHaveAttribute('aria-current', 'true');
    expect(rowOf(/^Alpine/)).not.toHaveAttribute('aria-current');
    expect(main().getAllByRole('listitem')[0]?.parentElement).toBe(list);
  });

  it('replaces the open supplier with the next one, so Back still leaves for the list in one step', async () => {
    split();
    const { router, user } = await loaded();
    await user.click(rowOf(/^Alpine/));
    await screenOf('Alpine');
    await user.click(rowOf(/^Zed/));
    await screenOf('Zed Dairy');
    expect(router.state.historyAction).toBe('REPLACE');
    await user.click(back());
    expect(router.state.location.pathname).toBe('/suppliers/suppliers');
    await waitFor(() => { expect(rowOf(/^Zed/)).toHaveFocus(); });
  });

  it('does nothing when the open supplier is tapped again', async () => {
    split();
    const { router, user } = await loaded();
    await user.click(rowOf(/^Alpine/));
    await screenOf('Alpine');
    const entry = router.state.location.key;
    await user.click(rowOf(/^Alpine/));
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-alp');
    expect(router.state.location.key).toBe(entry);
  });

  it('shows the tabs and the search above the list while a supplier is open, and a tab replaces the supplier', async () => {
    split();
    const { router, user } = await loaded();
    await user.click(rowOf(/^Alpine/));
    await screenOf('Alpine');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Packaging' }));
    expect(router.state.location.pathname).toBe('/suppliers/packaging');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: 'Alpine' })).not.toBeInTheDocument();
  });

  it('goes to the list when the supplier open beside it is deleted elsewhere, with the sentence', async () => {
    split();
    const source = seeded();
    const { router, user } = await loaded('/suppliers/suppliers', source);
    await user.click(rowOf(/^Zed/));
    await screenOf('Zed Dairy');
    source.suppliers.delete('s-zed');
    act(() => { source.push(); });
    expect(await screen.findByText('This supplier no longer exists.')).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
  });
});
