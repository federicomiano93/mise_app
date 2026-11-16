import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// The redesign of Orders on the lab tablet (16 Nov 2026, docs/mockups/orders-tablet-2026-11.md): the title band (item 3), the doors and
// «Choose a supplier» in the top-right of the split (item 4) and the bell's notices in the bottom-right pane (item 6). The groups of the
// list are pinned in OrdersSection.list.spec.tsx and ordersLens.spec.ts, the tabs in OrdersSection.flat.spec.tsx.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);
afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills' }),
  supplier('s-bee', { name: 'Bee Farm' }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp' }),
  ingredient('i-honey', { name: 'Honey', supplierId: 's-bee' }),
];

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ...extra });
}

async function loaded(path = '/orders', source = seeded(), options = {}) {
  const view = renderOrders(path, { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const band = () => screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
// The controls of the band, in the order they are drawn, by their accessible names.
const bandNames = () => within(band()).getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent);

describe('the title band (item 3)', () => {
  it('holds «Orders», then settings · history · bell · «Order lists», and the send icon at the far right', async () => {
    await loaded();
    await waitFor(() => { expect(bandNames()).toEqual(['Orders settings', 'History', 'Notices', 'Order lists', 'Send']); }, LOAD);
    // Icons alone, each named; «Order lists» shows its words.
    expect(within(band()).getByRole('button', { name: 'Order lists' })).toHaveTextContent('Order lists');
    expect(within(band()).getByRole('button', { name: 'Send' })).toHaveTextContent('');
  });

  it('says them in Italian', async () => {
    await loaded('/orders', seeded(), { lang: 'it' });
    await waitFor(() => { expect(bandNames()).toEqual(['Impostazioni degli ordini', 'Storico', 'Avvisi', 'Liste d’ordine', 'Manda']); }, LOAD);
  });

  it('counts the lists waiting on «Order lists», in its name too', async () => {
    const requests = { r1: {
      date: todayISO(), fromName: 'Marco', quantities: { 'i-flour': 4 }, names: { 'i-flour': 'Flour' }, supplierOf: { 'i-flour': 's-alp' },
      supplierNames: { 's-alp': 'Alpine Mills' }, done: {}, note: '', createdAt: `${todayISO()}T10:00:00.000Z`, updatedAt: `${todayISO()}T10:00:00.000Z`,
    } };
    await loaded('/orders', seeded({ requests }));
    const door = await within(band()).findByRole('button', { name: 'Order lists: 1 order list to place' }, LOAD);
    expect(door).toHaveTextContent('Order lists1');
  });

  it('hides the send icon while a supplier is open — the supplier\'s own send is the one to use — and brings it back', async () => {
    split();
    const view = await loaded();
    await within(band()).findByRole('button', { name: 'Send' }, LOAD);
    await view.user.click(screen.getAllByRole('button', { name: /^Alpine Mills/ })[0] as HTMLElement);
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp'); });
    expect(within(band()).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await act(async () => { await view.router.navigate(-1); });
    expect(await within(band()).findByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('draws no send icon before the lists are live, nor with no supplier', async () => {
    renderOrders('/orders', { source: fakeOrdersSource() });
    await screen.findByText('No suppliers yet', undefined, LOAD);
    expect(within(band()).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('removes the word row, the «Order today» strip and the All / Ordering filter', async () => {
    const draft = { entries: { 'i-flour': { qty: 2 } }, days: {} };
    await loaded('/orders', seeded({ draft }));
    const main = within(screen.getByRole('main'));
    // «Send» and «History» are only the band's icons now: no worded buttons in the column.
    expect(main.getAllByRole('button', { name: 'Send' })).toHaveLength(1);
    expect(main.getAllByRole('button', { name: 'History' })).toHaveLength(1);
    expect(screen.queryByText('Order today')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('gives the focus back to its buttons on Back (settings, history, order lists, send)', async () => {
    split();
    const view = await loaded();
    for (const [name, at] of [['Orders settings', '/orders/settings'], ['History', '/orders/history'], ['Order lists', '/orders/lists'], ['Send', '/orders/send']] as const) {
      const button = await within(band()).findByRole('button', { name }, LOAD);
      await view.user.click(button);
      await waitFor(() => { expect(path(view)).toBe(at); });
      await act(async () => { await view.router.navigate(-1); });
      await waitFor(() => { expect(path(view)).toBe('/orders'); });
      await waitFor(() => { expect(within(band()).getByRole('button', { name })).toHaveFocus(); });
    }
  });
});

describe('the top right of the split (item 4)', () => {
  // The two doors, by the words drawn.
  const doors = () => screen.queryAllByRole('button').filter(button => /^(Incoming|To re-order)/.test(button.textContent ?? ''));

  it('puts «Incoming» and «To re-order» beside the list, not in it, and «Choose a supplier» under them while none is open', async () => {
    split();
    const view = await loaded();
    await waitFor(() => { expect(doors()).toHaveLength(2); }, LOAD);
    const list = screen.getByRole('searchbox', { name: 'Search a supplier…' }).closest('[class*="list"]') as HTMLElement;
    for (const door of doors()) expect(list).not.toContainElement(door);
    expect(screen.getByText('Pick a supplier')).toBeInTheDocument();
    // A supplier open: the doors stay, the line goes.
    await view.user.click(screen.getAllByRole('button', { name: /^Alpine Mills/ })[0] as HTMLElement);
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp'); });
    expect(doors()).toHaveLength(2);
    expect(screen.queryByText('Pick a supplier')).not.toBeInTheDocument();
  });

  it('keeps the doors on the flat view too', async () => {
    split();
    renderOrders('/orders/ingredients', { source: seeded() });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(doors()).toHaveLength(2); });
    expect(screen.queryByText('Pick a supplier')).not.toBeInTheDocument();
  });

  it('on a phone puts the doors under the search box, in the list column', async () => {
    await loaded();
    await waitFor(() => { expect(doors()).toHaveLength(2); }, LOAD);
    const search = screen.getByRole('searchbox', { name: 'Search a supplier…' });
    for (const door of doors()) expect(search.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Pick a supplier')).not.toBeInTheDocument();
  });

  it('draws no doors while the venue does not check deliveries', async () => {
    split();
    await loaded('/orders', seeded({ ordersConfig: { deliveryCheck: false } }));
    await screen.findByText('Pick a supplier', undefined, LOAD);
    expect(doors()).toHaveLength(0);
  });
});

describe('the notices in the pane (item 6)', () => {
  const pane = () => screen.queryByRole('region', { name: 'Notices' });

  it('take the bottom-right pane in place of the open supplier, which comes back as it was when they close', async () => {
    split();
    const view = await loaded('/orders/supplier/s-alp');
    await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD);
    const bell = within(band()).getByRole('button', { name: 'Notices' });
    await view.user.click(bell);
    const notices = await screen.findByRole('region', { name: 'Notices' });
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    // The supplier is still mounted, hidden behind them.
    expect(screen.queryByRole('spinbutton', { name: 'Flour quantity to order' })).not.toBeInTheDocument();
    expect(within(notices).getByRole('heading', { level: 2, name: 'Notices' })).toBeInTheDocument();
    await view.user.click(within(notices).getByRole('button', { name: 'Close notices' }));
    expect(pane()).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Flour quantity to order' })).toBeInTheDocument();
    expect(bell).toHaveFocus();
    expect(path(view)).toBe('/orders/supplier/s-alp');
  });

  it('are not above the list on the split', async () => {
    split();
    const view = await loaded();
    await view.user.click(within(band()).getByRole('button', { name: 'Notices' }));
    const notices = await screen.findByRole('region', { name: 'Notices' });
    const list = screen.getByRole('searchbox', { name: 'Search a supplier…' }).closest('[class*="list"]') as HTMLElement;
    expect(list).not.toContainElement(notices);
  });

  it('give the pane back when a supplier is opened from the list', async () => {
    split();
    const view = await loaded();
    await view.user.click(within(band()).getByRole('button', { name: 'Notices' }));
    await screen.findByRole('region', { name: 'Notices' });
    await view.user.click(screen.getAllByRole('button', { name: /^Bee Farm/ })[0] as HTMLElement);
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-bee'); });
    expect(await screen.findByRole('spinbutton', { name: 'Honey quantity to order' }, LOAD)).toBeInTheDocument();
    expect(pane()).not.toBeInTheDocument();
  });

  it('on a phone open above the list, with the same X', async () => {
    const view = await loaded();
    await view.user.click(within(band()).getByRole('button', { name: 'Notices' }));
    const notices = await screen.findByRole('region', { name: 'Notices' });
    const search = screen.getByRole('searchbox', { name: 'Search a supplier…' });
    expect(search.compareDocumentPosition(notices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notices.compareDocumentPosition(screen.getAllByRole('listitem')[0] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await view.user.click(within(notices).getByRole('button', { name: 'Close notices' }));
    expect(pane()).not.toBeInTheDocument();
  });
});
