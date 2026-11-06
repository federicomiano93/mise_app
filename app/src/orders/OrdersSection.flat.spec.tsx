import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, SAVED, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders», step 3f-8b: the flat view, «by ingredient» (parity L17, L18, L21; decisions F-1 to F-5).

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', category: 'Flour' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed' }),
];

const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-butter', { name: 'Butter', supplierId: 's-zed' }),
  ingredient('i-milk', { name: 'Milk', supplierId: 's-zed', unit: 'l' }),
  ingredient('i-barley', { name: 'Barley', supplierId: 's-alp' }),
  ingredient('i-apple', { name: 'Apple', supplierId: 's-zed' }),
  ingredient('i-old', { name: 'Old oats', supplierId: 's-alp', active: false }),
];

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ...extra });
}

async function flat(source = seeded(), options: Parameters<typeof renderOrders>[1] = {}) {
  const view = renderOrders('/orders/ingredients', { ...options, source });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const box = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const qtyBox = (name: string) => box(`${name} quantity to order`);
// The name on the first line of each row, in the order drawn.
const rowNames = () => screen.getAllByRole('listitem').map(row => row.querySelector('span')?.textContent ?? '');
const letters = () => screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent);
const lineOf = (name: string) => screen.getByText(name, { selector: 'span' }).closest('li') as HTMLElement;
const count = (text: string) => screen.getByText(text);

describe('the swap button', () => {
  it('goes from the supplier list to the flat view and back, REPLACING the entry, with the focus on the swap button of the new view', async () => {
    const view = renderOrders('/orders', { source: seeded() });
    const toFlat = await screen.findByRole('button', { name: 'Ingredients' }, LOAD);
    expect(toFlat).toHaveTextContent('Ingredients');
    await view.user.click(toFlat);
    expect(path(view)).toBe('/orders/ingredients');
    expect(view.router.state.historyAction).toBe('REPLACE');
    const toSuppliers = await screen.findByRole('button', { name: 'Suppliers' });
    await waitFor(() => { expect(toSuppliers).toHaveFocus(); });
    expect(screen.queryByRole('button', { name: 'Ingredients' })).not.toBeInTheDocument();
    await view.user.click(toSuppliers);
    expect(path(view)).toBe('/orders');
    expect(view.router.state.historyAction).toBe('REPLACE');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Ingredients' })).toHaveFocus(); });
  });

  it('names the other view in Italian too', async () => {
    const view = renderOrders('/orders', { source: seeded(), lang: 'it' });
    await view.user.click(await screen.findByRole('button', { name: 'Ingredienti' }, LOAD));
    expect(await screen.findByRole('button', { name: 'Fornitori' })).toHaveTextContent('Fornitori');
    expect(screen.getByRole('searchbox', { name: 'Cerca un ingrediente…' })).toBeInTheDocument();
  });

  it('is not drawn until the lists have arrived, nor when there is no supplier', async () => {
    renderOrders('/orders', { source: fakeOrdersSource() });
    await screen.findByText('No suppliers yet', undefined, LOAD);
    expect(screen.queryByRole('button', { name: 'Ingredients' })).not.toBeInTheDocument();
  });

  it('is not drawn on the flat view while the data is still loading', async () => {
    const source = seeded();
    const watchDraft = source.watchDraft.bind(source);
    source.watchDraft = (onChange, onError) => watchDraft(() => undefined, onError);
    renderOrders('/orders/ingredients', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('No ingredients yet — add them in Ingredients & suppliers.')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suppliers' })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search an ingredient…' })).toBeInTheDocument();
  });
});

describe('the rows', () => {
  it('lists every line in use A to Z across the suppliers, each under its own supplier’s name; «Not in use» stays out of the rows', async () => {
    await flat();
    expect(rowNames()).toEqual(['Apple', 'Barley', 'Butter', 'Flour 00', 'Milk', 'Old oats']);
    expect(within(lineOf('Apple')).getByText('Zed')).toBeInTheDocument();
    expect(within(lineOf('Barley')).getByText('Alpine Mills')).toBeInTheDocument();
    expect(within(lineOf('Flour 00')).getByText('Alpine Mills')).toBeInTheDocument();
    expect(within(lineOf('Flour 00')).getByText('25kg')).toBeInTheDocument();
  });

  it('is one main, one h1, with the column names «Order» and «Stock» over the rows once', async () => {
    await flat();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByText('Order')).toHaveLength(1);
    expect(screen.getAllByText('Stock')).toHaveLength(1);
  });

  it('draws a letter before each run, and the letters follow what the search leaves', async () => {
    const { user } = await flat();
    expect(letters()).toEqual(['A', 'B', 'F', 'M']);
    await user.type(screen.getByRole('searchbox', { name: 'Search an ingredient…' }), 'zed');
    expect(rowNames().slice(0, 3)).toEqual(['Apple', 'Butter', 'Milk']);
    expect(letters()).toEqual(['A', 'B', 'M']);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'ALPINE');
    expect(letters()).toEqual(['B', 'F']);
  });

  it('keeps its search to itself: the supplier list has its own', async () => {
    const view = renderOrders('/orders', { source: seeded() });
    await view.user.type(await screen.findByRole('searchbox', { name: 'Search a supplier…' }, LOAD), 'zed');
    await view.user.click(screen.getByRole('button', { name: 'Ingredients' }));
    expect(await screen.findByRole('searchbox', { name: 'Search an ingredient…' })).toHaveValue('');
  });

  it('writes a typed quantity into the draft of the supplier the row sits under', async () => {
    const source = seeded();
    const { user } = await flat(source);
    await user.type(qtyBox('Butter'), '3');
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    const sent = source.writes.at(-1);
    expect(sent?.entries?.['i-butter']).toMatchObject({ qty: 3 });
    expect(sent?.days).toEqual({ 's-zed': todayISO() });
  });

  it('files a line sent to another supplier under THAT supplier, saying where it is usually from, and writes for it', async () => {
    const source = seeded({ draft: { entries: { 'i-milk': { qty: 2, supplierId: 's-alp' } }, days: {} } });
    const { user } = await flat(source);
    const milk = lineOf('Milk');
    expect(within(milk).getByText('Alpine Mills')).toBeInTheDocument();
    expect(within(milk).getByText('usually from Zed')).toBeInTheDocument();
    expect(qtyBox('Milk')).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'One more Milk' }));
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    const sent = source.writes.at(-1);
    expect(sent?.entries?.['i-milk']).toMatchObject({ qty: 3, supplierId: 's-alp' });
    expect(sent?.days).toEqual({ 's-alp': todayISO() });
  });

  it('shows the Stock box only while the venue keeps stock', async () => {
    await flat(seeded({ ordersConfig: { showStock: false } }));
    expect(screen.queryByRole('spinbutton', { name: 'Butter stock on hand' })).not.toBeInTheDocument();
    expect(screen.queryByText('Stock')).not.toBeInTheDocument();
  });
});

describe('«Ordering», frozen', () => {
  const draft = { entries: { 'i-butter': { qty: 2 }, 'i-milk': { qty: 1 } }, days: {} };

  it('is not offered while nothing is being ordered', async () => {
    await flat();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('keeps a line taken to 0 on screen, refreshes when chosen again, and «All» drops it', async () => {
    const { user } = await flat(seeded({ draft }));
    const group = screen.getByRole('radiogroup', { name: 'Which ingredients to show' });
    expect(within(group).getByRole('radio', { name: 'All (5)' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(group).getByRole('radio', { name: 'Ordering (2)' }));
    expect(rowNames().slice(0, 2)).toEqual(['Butter', 'Milk']);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Taken to 0: the row stays, the live count drops.
    await user.click(screen.getByRole('button', { name: 'Clear the quantity of Butter' }));
    expect(rowNames()).toEqual(['Butter', 'Milk']);
    expect(screen.getByRole('radio', { name: 'Ordering (1)' })).toHaveAttribute('aria-checked', 'true');
    // Chosen again: the set is taken again.
    await user.click(screen.getByRole('radio', { name: 'Ordering (1)' }));
    expect(rowNames()).toEqual(['Milk']);
    // «All» drops it.
    await user.click(screen.getByRole('radio', { name: 'All (5)' }));
    expect(rowNames().slice(0, 5)).toEqual(['Apple', 'Barley', 'Butter', 'Flour 00', 'Milk']);
  });

  it('counts only the lines it can show: a line of a stopped supplier with a quantity is not in «Ordering»', async () => {
    const source = seeded({
      suppliers: [...SUPPLIERS, supplier('s-off', { name: 'Closed Co', active: false })],
      ingredients: [...ITEMS, ingredient('i-cheese', { name: 'Cheese', supplierId: 's-off' })],
      draft: { entries: { 'i-butter': { qty: 2 }, 'i-cheese': { qty: 5 } }, days: {} },
    });
    const { user } = await flat(source);
    await user.click(screen.getByRole('radio', { name: 'Ordering (1)' }));
    expect(count('1 ingredient in this order')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Butter']);
  });

  it('can still be left once nothing is ordered', async () => {
    const { user } = await flat(seeded({ draft: { entries: { 'i-butter': { qty: 1 } }, days: {} } }));
    await user.click(screen.getByRole('radio', { name: 'Ordering (1)' }));
    await user.click(screen.getByRole('button', { name: 'Clear the quantity of Butter' }));
    await user.click(screen.getByRole('radio', { name: 'Ordering (0)' }));
    expect(screen.getByRole('radio', { name: 'All (5)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ordering (0)' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'All (5)' }));
    await waitFor(() => { expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument(); });
  });

  it('moves with the arrow keys, like the supplier filter', async () => {
    const { user } = await flat(seeded({ draft }));
    screen.getByRole('radio', { name: 'All (5)' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Ordering (2)' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Ordering (2)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'All (5)' })).toHaveAttribute('tabindex', '-1');
  });

  it('is not remembered when the section is left and entered again', async () => {
    const view = await flat(seeded({ draft }));
    await view.user.click(screen.getByRole('radio', { name: 'Ordering (2)' }));
    await act(async () => { await view.router.navigate('/stocktake'); });
    await waitFor(() => { expect(view.source.openListeners()).toBe(0); }, LOAD);
    await act(async () => { await view.router.navigate('/orders/ingredients'); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(screen.getByRole('radio', { name: 'All (5)' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('the count line and the empty texts', () => {
  it('says the four whole phrases, in English', async () => {
    const draft = { entries: { 'i-butter': { qty: 2 }, 'i-milk': { qty: 1 } }, days: {} };
    const { user } = await flat(seeded({ draft }));
    expect(count('5 ingredients')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'zed');
    expect(count('3 of 5')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('radio', { name: 'Ordering (2)' }));
    expect(count('2 ingredients in this order')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'butter');
    expect(count('1 of 2 in this order')).toBeInTheDocument();
  });

  it('says them in Italian', async () => {
    const draft = { entries: { 'i-butter': { qty: 2 }, 'i-milk': { qty: 1 } }, days: {} };
    const { user } = await flat(seeded({ draft }), { lang: 'it' });
    expect(count('5 ingredienti')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'zed');
    expect(count('3 di 5')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('radio', { name: 'Da ordinare (2)' }));
    expect(count('2 ingredienti in questo ordine')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'butter');
    expect(count('1 di 2 in questo ordine')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Quali ingredienti mostrare' })).toBeInTheDocument();
  });

  it('says «No ingredients yet» only when there are none at all', async () => {
    renderOrders('/orders/ingredients', { source: fakeOrdersSource({ suppliers: SUPPLIERS }) });
    expect(await screen.findByText('No ingredients yet — add them in Ingredients & suppliers.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says so when the search matches nothing, and in «Ordering» says nothing in this order matches', async () => {
    const draft = { entries: { 'i-butter': { qty: 2 } }, days: {} };
    const { user } = await flat(seeded({ draft }));
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('No ingredient matches your search.')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('radio', { name: 'Ordering (1)' }));
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('Nothing in this order matches your search.')).toBeInTheDocument();
  });
});

describe('«Not in use»', () => {
  const group = () => screen.getByText('Not in use (1)').closest('details') as HTMLDetailsElement;

  it('is a folded group at the foot, closed', async () => {
    await flat();
    expect(group().open).toBe(false);
    expect(within(group()).getByText('Old oats')).toBeInTheDocument();
    expect(within(group()).getByText('Alpine Mills')).toBeInTheDocument();
  });

  it('opens by itself when one of its lines has a quantity', async () => {
    await flat(seeded({ draft: { entries: { 'i-old': { qty: 4 } }, days: {} } }));
    expect(group().open).toBe(true);
  });

  it('follows the search', async () => {
    const { user } = await flat();
    await user.type(screen.getByRole('searchbox'), 'butter');
    expect(screen.queryByText(/^Not in use/)).not.toBeInTheDocument();
  });
});

describe('the doors out of the head', () => {
  it('opens History from the flat view and Back returns to it, with the focus on the door and the search kept', async () => {
    const view = await flat();
    await view.user.type(screen.getByRole('searchbox'), 'zed');
    await view.user.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByRole('region', { name: 'History' }, LOAD);
    expect(path(view)).toBe('/orders/history');
    await view.user.click(within(screen.getByRole('region', { name: 'History' })).getByRole('button', { name: 'Back' }));
    expect(path(view)).toBe('/orders/ingredients');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'History' })).toHaveFocus(); });
    expect(screen.getByRole('searchbox', { name: 'Search an ingredient…' })).toHaveValue('zed');
  });

  it('opens the send screen and the settings the same way', async () => {
    const view = await flat();
    await view.user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('region', { name: /Send/ }, LOAD);
    expect(path(view)).toBe('/orders/send');
    await act(async () => { await view.router.navigate(-1); });
    expect(path(view)).toBe('/orders/ingredients');
    await view.user.click(screen.getByRole('button', { name: 'Orders settings' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/settings'); });
  });
});

describe('on the split', () => {
  it('takes the whole width: no prompt beside it, and the layout says so', async () => {
    split();
    const view = renderOrders('/orders', { source: seeded() });
    expect(await screen.findByText('Pick a supplier', undefined, LOAD)).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Ingredients' }));
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(screen.queryByText('Pick a supplier')).not.toBeInTheDocument();
    expect(screen.getByRole('main').querySelector('[data-view="ingredients"]')).not.toBeNull();
  });

  it('opens History from the flat view, and Back returns to the flat view', async () => {
    split();
    const view = await flat();
    await view.user.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByRole('region', { name: 'History' }, LOAD);
    expect(path(view)).toBe('/orders/history');
    await view.user.click(within(screen.getByRole('region', { name: 'History' })).getByRole('button', { name: 'Back' }));
    expect(path(view)).toBe('/orders/ingredients');
    await screen.findAllByRole('spinbutton', undefined, LOAD);
  });
});

describe('the sticky head (L21)', () => {
  it('measures the head and the column names for the sticky offsets, and ends its observers when the view goes', async () => {
    const watched: Array<{ node: Element | null; disconnected: boolean }> = [];
    class FakeObserver {
      private readonly mine = { node: null as Element | null, disconnected: false };
      constructor(private readonly callback: () => void) { watched.push(this.mine); }
      observe(node: Element) { this.mine.node = node; this.callback(); }
      unobserve() { /* unused */ }
      disconnect() { this.mine.disconnected = true; }
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const view = await flat();
    // The column names stick under the head, the letters under both: their `top` is set inline from the measured heights.
    expect(screen.getByText('Order').parentElement).toHaveStyle({ top: '0px' });
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveStyle({ top: '0px' });
    expect(watched.filter(w => w.node !== null)).toHaveLength(2);
    await view.user.click(screen.getByRole('button', { name: 'Suppliers' }));
    await screen.findByRole('searchbox', { name: 'Search a supplier…' });
    expect(watched.every(w => w.disconnected)).toBe(true);
  });
});

describe('the address', () => {
  it('is not remembered: entering the section lands on «by supplier»', async () => {
    const view = await flat();
    await act(async () => { await view.router.navigate('/stocktake'); });
    await waitFor(() => { expect(view.source.openListeners()).toBe(0); }, LOAD);
    await act(async () => { await view.router.navigate('/orders'); });
    expect(await screen.findByRole('searchbox', { name: 'Search a supplier…' }, LOAD)).toBeInTheDocument();
    expect(path(view)).toBe('/orders');
  });

  it('sends an address below the flat view back to the list', async () => {
    const view = renderOrders('/orders/ingredients/nonsense', { source: seeded() });
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
  });
});
