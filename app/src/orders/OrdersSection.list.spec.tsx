import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders», step 3f-1: the supplier list.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', category: 'Dairy' }),
  supplier('s-caf', { name: 'Café Bar Srl', category: 'Drinks' }),
  supplier('s-alp', { name: 'Alpine Mills', category: 'Flour', deliveryDays: ['Monday', 'Thursday'] }),
  supplier('s-off', { name: 'Closed Co', active: false }),
];

const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
  ingredient('i-cafe', { name: 'Caffè in grani', supplierId: 's-caf' }),
  ingredient('i-lost', { name: 'Lost item', supplierId: 'gone' }),
];

const main = () => within(screen.getByRole('main'));
// The name each row of the list opens: the first line of its wide button.
const rowNames = () => main().getAllByRole('listitem').map(row => within(row).getAllByRole('button')[0]?.textContent ?? '');

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ...extra });
}

async function loaded(path = '/orders', source = seeded(), options = {}) {
  const view = renderOrders(path, { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

const inDays = (n: number): string => toISODate(addDays(parseISODate(todayISO()), n));

describe('the frame', () => {
  it('is one main and one h1, «Orders»', async () => {
    await loaded();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
  });

  it('says «Loading…», never «No suppliers yet», until suppliers, ingredients and the draft have all arrived', async () => {
    const source = seeded();
    const release = vi.fn();
    // The draft's first answer is held back: the rest has arrived, the screen must still wait.
    const watchDraft = source.watchDraft.bind(source);
    source.watchDraft = (onChange, onError) => {
      release.mockImplementation(() => onChange(null, { fromServer: true }));
      return watchDraft(() => undefined, onError);
    };
    renderOrders('/orders', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    act(() => { release(); });
    expect(await screen.findByText('Zed')).toBeInTheDocument();
  });

  it('says «No suppliers yet» once everything has arrived and there is nothing', async () => {
    renderOrders('/orders', { source: fakeOrdersSource() });
    expect(await screen.findByText('No suppliers yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(/Add your suppliers and ingredients in Ingredients & suppliers/)).toBeInTheDocument();
  });

  it('opens the four listeners and closes them when the section closes', async () => {
    const source = seeded();
    const view = await loaded('/orders', source);
    expect(source.openListeners()).toBe(5);
    await act(async () => { await view.router.navigate('/stocktake'); });
    await waitFor(() => { expect(source.openListeners()).toBe(0); }, LOAD);
  });

  it('sends an address it does not draw back to the list', async () => {
    const { router } = await loaded('/orders/nonsense/here');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders'); });
  });
});

describe('the supplier list', () => {
  it('lists the active suppliers in the venue’s order and «No supplier» last, when something is filed under it', async () => {
    await loaded('/orders', seeded({ ordersConfig: { supplierOrder: ['s-zed', 's-alp'] } }));
    const names = rowNames();
    expect(names[0]).toMatch(/^Zed/);
    expect(names[1]).toMatch(/^Alpine Mills/);
    expect(names[2]).toMatch(/^Café Bar Srl/);
    expect(names[3]).toMatch(/^No supplier/);
    expect(names).toHaveLength(4);
    expect(screen.queryByText(/Closed Co/)).not.toBeInTheDocument();
  });

  it('has no «No supplier» row when nothing is filed under it', async () => {
    await loaded('/orders', seeded({ ingredients: ITEMS.filter(item => item.id !== 'i-lost') }));
    expect(rowNames().some(name => name.startsWith('No supplier'))).toBe(false);
  });

  it('writes the category and the delivery days under the name, in the interface language', async () => {
    await loaded();
    const row = screen.getByRole('button', { name: /^Alpine Mills/ });
    expect(row).toHaveTextContent('Flour · Mon, Thu');
  });

  it('draws each row as ONE opening button and a SEPARATE sibling button, never one inside the other', async () => {
    await loaded();
    const row = screen.getByRole('button', { name: /^Alpine Mills/ });
    const list = screen.getByRole('button', { name: 'Ingredients from Alpine Mills' });
    expect(row).not.toContainElement(list);
    expect(list).not.toContainElement(row);
    expect(row.parentElement).toBe(list.parentElement);
    expect(row.querySelector('button')).toBeNull();
  });

  it('names the whole list «No supplier» in Italian on an Italian screen', async () => {
    await loaded('/orders', seeded(), { lang: 'it' });
    expect(screen.getByRole('heading', { level: 1, name: 'Ordini' })).toBeInTheDocument();
    expect(rowNames().at(-1)).toMatch(/^Nessun fornitore/);
    expect(screen.getByRole('searchbox', { name: 'Cerca un fornitore…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ingredienti di Alpine Mills' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveTextContent('Flour · lun, gio');
  });
});

describe('search', () => {
  it('finds a supplier by name, ignoring accents and capitals', async () => {
    const { user } = await loaded();
    await user.type(screen.getByRole('searchbox', { name: 'Search a supplier…' }), 'CAFE');
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toMatch(/^Café Bar Srl/);
  });

  it('finds a supplier by category', async () => {
    const { user } = await loaded();
    await user.type(screen.getByRole('searchbox'), 'flour');
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toMatch(/^Alpine Mills/);
  });

  it('says so when nothing matches', async () => {
    const { user } = await loaded();
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('No supplier matches your search.')).toBeInTheDocument();
  });

  it('keeps the box and its text when a snapshot lands mid-typing', async () => {
    const source = seeded();
    const { user } = await loaded('/orders', source);
    const box = screen.getByRole('searchbox');
    await user.type(box, 'Al');
    act(() => { source.emit(); });
    expect(screen.getByRole('searchbox')).toBe(box);
    expect(box).toHaveValue('Al');
    expect(box).toHaveFocus();
  });
});

describe('the Ordering filter', () => {
  it('is hidden while nothing is being ordered', async () => {
    await loaded();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('appears as a radio group with the counts once something is typed, and narrows the list', async () => {
    const draft = { entries: { 'i-milk': { qty: 2 } }, days: { 's-zed': todayISO() } };
    const { user } = await loaded('/orders', seeded({ draft }));
    const group = screen.getByRole('radiogroup', { name: 'Which suppliers to show' });
    const all = within(group).getByRole('radio', { name: 'All (4)' });
    const ordering = within(group).getByRole('radio', { name: 'Ordering (1)' });
    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(ordering).toHaveAttribute('aria-checked', 'false');
    await user.click(ordering);
    expect(ordering).toHaveAttribute('aria-checked', 'true');
    expect(all).toHaveAttribute('aria-checked', 'false');
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toMatch(/^Zed/);
  });

  it('stays on screen while it is on, even when nothing is ordered any more, so it can be left', async () => {
    const draft = { entries: { 'i-milk': { qty: 2 } }, days: { 's-zed': todayISO() } };
    const source = seeded({ draft });
    const { user } = await loaded('/orders', source);
    await user.click(screen.getByRole('radio', { name: 'Ordering (1)' }));
    act(() => { source.remoteMerge({ entries: { 'i-milk': { qty: 0 } } }); });
    await waitFor(() => { expect(screen.getByRole('radio', { name: 'Ordering (0)' })).toBeInTheDocument(); });
    expect(screen.getByText('Nothing is being ordered yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All (4)' }));
    expect(rowNames()).toHaveLength(4);
  });

  it('moves between its two choices with the arrow keys', async () => {
    const draft = { entries: { 'i-milk': { qty: 2 } }, days: { 's-zed': todayISO() } };
    const { user } = await loaded('/orders', seeded({ draft }));
    screen.getByRole('radio', { name: 'All (4)' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Ordering (1)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Ordering (1)' })).toHaveFocus();
  });
});

describe('favourites', () => {
  it('puts the starred suppliers first under their own heading, the rest under «Other suppliers»', async () => {
    await loaded('/orders', seeded({ ordersConfig: { favouriteSuppliers: ['s-alp'] } }));
    expect(screen.getByRole('heading', { level: 2, name: 'Favourites' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Other suppliers' })).toBeInTheDocument();
    expect(rowNames()[0]).toMatch(/^Alpine Mills/);
  });

  it('draws no headings when no supplier is starred', async () => {
    await loaded();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('says the headings in Italian', async () => {
    await loaded('/orders', seeded({ ordersConfig: { favouriteSuppliers: ['s-alp'] } }), { lang: 'it' });
    expect(screen.getByRole('heading', { level: 2, name: 'Preferiti' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Altri fornitori' })).toBeInTheDocument();
  });
});

describe('the count and the «for later» tag', () => {
  it('shows how many lines are filled, only when some are', async () => {
    const draft = { entries: { 'i-milk': { qty: 2 }, 'i-cafe': { qty: 0, stock: 4 } }, days: {} };
    await loaded('/orders', seeded({ draft }));
    expect(screen.getByRole('button', { name: /^Zed/ })).toHaveTextContent('1 item');
    expect(screen.getByRole('button', { name: /^Café Bar Srl/ })).not.toHaveTextContent('item');
  });

  it('counts a plural in Italian', async () => {
    const draft = { entries: { 'i-milk': { qty: 2 }, 'i-extra': { qty: 1 } }, days: {} };
    const items = [...ITEMS, ingredient('i-extra', { name: 'Cream', supplierId: 's-zed' })];
    await loaded('/orders', seeded({ draft, ingredients: items }), { lang: 'it' });
    expect(screen.getByRole('button', { name: /^Zed/ })).toHaveTextContent('2 articoli');
  });

  it('tells «for Thu 8» when something is filled and the day it is for has not come', async () => {
    const day = inDays(3);
    const draft = { entries: { 'i-milk': { qty: 2 } }, days: { 's-zed': day } };
    await loaded('/orders', seeded({ draft }));
    const label = /for (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+/;
    expect(screen.getByRole('button', { name: /^Zed/ })).toHaveTextContent(label);
  });

  it('tells the delivery day instead when the supplier has delivery days', async () => {
    const day = inDays(2);
    const draft = { entries: { 'i-flour': { qty: 1 } }, days: { 's-alp': day } };
    await loaded('/orders', seeded({ draft }));
    expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveTextContent(/delivery (Mon|Thu) \d+/);
  });

  it('says nothing when the day is today, or when nothing is filled', async () => {
    const draft = { entries: { 'i-milk': { qty: 2 } }, days: { 's-zed': todayISO(), 's-alp': inDays(3) } };
    await loaded('/orders', seeded({ draft }));
    expect(screen.getByRole('button', { name: /^Zed/ })).not.toHaveTextContent(/for |delivery /);
    expect(screen.getByRole('button', { name: /^Alpine Mills/ })).not.toHaveTextContent(/for |delivery /);
  });

  it('says the tag in Italian', async () => {
    const draft = { entries: { 'i-milk': { qty: 2 } }, days: { 's-zed': inDays(3) } };
    await loaded('/orders', seeded({ draft }), { lang: 'it' });
    expect(screen.getByRole('button', { name: /^Zed/ })).toHaveTextContent(/per (dom|lun|mar|mer|gio|ven|sab) \d+/);
  });
});

describe('opening a supplier', () => {
  it('opens the order screen and Back returns to the list with the focus on the row that opened it', async () => {
    const { user, router } = await loaded();
    const row = screen.getByRole('button', { name: /^Alpine Mills/ });
    await user.click(row);
    expect(router.state.location.pathname).toBe('/orders/supplier/s-alp');
    expect(await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/orders');
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveFocus(); });
  });

  it('opens «What they sell» from the list icon and Back returns the focus to that icon', async () => {
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: 'Ingredients from Alpine Mills' }));
    expect(router.state.location.pathname).toBe('/orders/supplier/s-alp/items');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/orders');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Ingredients from Alpine Mills' })).toHaveFocus(); });
  });

  it('opens the «No supplier» pseudo-supplier like any other', async () => {
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: /^No supplier/ }));
    expect(router.state.location.pathname).toBe('/orders/supplier/no-supplier');
    expect(await screen.findByRole('heading', { level: 2, name: 'No supplier' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Lost item quantity to order' })).toBeInTheDocument();
  });

  it('opened by its address, Back replaces the entry with the list', async () => {
    const { user, router } = await loaded('/orders/supplier/s-alp');
    await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders'); });
  });
});

describe('the tablet’s split', () => {
  it('draws the list beside the supplier and picking another supplier replaces the one open', async () => {
    split();
    const { user, router } = await loaded();
    expect(screen.getByText('Pick a supplier')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Alpine Mills/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Zed/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveAttribute('aria-current', 'true');
    await user.click(screen.getByRole('button', { name: /^Zed/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Zed' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/orders/supplier/s-zed');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('Back from a supplier picked beside another reaches the list, with the focus on its row', async () => {
    split();
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Alpine Mills/ }));
    await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' });
    await user.click(screen.getByRole('button', { name: /^Zed/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Zed' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Zed/ })).toHaveFocus(); });
  });

  it('Back from a supplier picked beside «What they sell» reaches the list, not the supplier before it', async () => {
    split();
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Alpine Mills/ }));
    await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' });
    await user.click(screen.getByRole('button', { name: /What they sell/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders/supplier/s-alp/items'); });
    await user.click(screen.getByRole('button', { name: /^Zed/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Zed' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/orders/supplier/s-zed');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Zed/ })).toHaveFocus(); });
  });
});
