import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { summaryLines } from '@mise/shared/order-text';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';
import { buildOrdersLens } from './ordersLens';
import { draftSendRows } from './sendFlow';

// «Orders», step 3f-8c: the order summary and the order's money (parity L19, L20; choices C1 to C4).

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', category: 'Flour' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed' }),
];

const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', weight: '5kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-barley', { name: 'Barley', supplierId: 's-alp' }),
  ingredient('i-old', { name: 'Old oats', supplierId: 's-alp', active: false, unit: 'kg' }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
];

// Flour: three kilos at 2 a kilo, VAT 4%. Rye: no price. Old oats (switched off, but typed): priced, no VAT stated.
const ENTRIES = { 'i-flour': { qty: 3 }, 'i-rye': { qty: 1 }, 'i-old': { qty: 2 } };
const PRICES = {
  'i-flour': { priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 },
  'i-old': { priceUnit: 'kg', pricePerUnit: 1 },
};

const GB = { country: 'GB' };
const OWNER = { location: GB };
const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({
    suppliers: SUPPLIERS,
    ingredients: ITEMS,
    draft: { entries: ENTRIES, days: {} },
    prices: PRICES,
    ...extra,
  });
}

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;

async function onSupplier(source = seeded(), options: Options = { session: OWNER }) {
  const view = renderOrders('/orders/supplier/s-alp', { ...options, source });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

async function onSummary(source = seeded(), options: Options = { session: OWNER }) {
  const view = renderOrders('/orders/supplier/s-alp/summary', { ...options, source });
  await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' }, LOAD);
  return view;
}

const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const door = (name = 'Summary (3)') => screen.getByRole('button', { name });
const pane = () => within(screen.getByRole('region', { name: 'Alpine Mills' }));
const lineTexts = () => pane().getAllByRole('listitem').map(li => li.textContent ?? '');
const totals = () => screen.queryByRole('group', { name: /^(Order total|Totale ordine)$/ });

describe('the order summary', () => {
  it('opens from the bar of the supplier’s screen, one level down, with the lines of the message and the money', async () => {
    const source = seeded();
    const view = await onSupplier(source);
    await view.user.click(door());
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
    expect(await screen.findByText('Order summary · 3 items')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toBeInTheDocument();

    // The same lines as the message the supplier would receive.
    const lens = buildOrdersLens({ suppliers: SUPPLIERS, suppliersLoaded: true, ingredients: ITEMS, entries: ENTRIES as never, supplierOrder: [], noSupplierName: 'No supplier' });
    const message = draftSendRows(lens, { entries: ENTRIES as never, days: {}, skipped: {}, updatedAt: '', exists: true }).find(row => row.id === 's-alp');
    const labels = summaryLines(message?.items ?? []).map(line => line.label);
    expect(labels).toHaveLength(3);
    const rows = lineTexts();
    expect(rows).toHaveLength(labels.length);
    labels.forEach(label => { expect(rows.some(row => row.startsWith(label))).toBe(true); });

    // The cost of each line, then the box.
    expect(await screen.findByText('3 × £2.00 = £6.00 · VAT 4%')).toBeInTheDocument();
    expect(screen.getByText('no price')).toBeInTheDocument();
    expect(screen.getByText('2 × £1.00 = £2.00 · VAT not stated')).toBeInTheDocument();
    const box = within(screen.getByRole('group', { name: 'Order total' }));
    expect(box.getByText('Net')).toBeInTheDocument();
    expect(box.getByText('£8.00')).toBeInTheDocument();
    expect(box.getByText('VAT 4%')).toBeInTheDocument();
    expect(box.getByText('£8.24')).toBeInTheDocument();
    expect(box.getByText('1 item with no price, not included: the total is lower than the real one')).toBeInTheDocument();
    expect(box.getByText('1 item with no VAT rate stated — its VAT is not in the total above')).toBeInTheDocument();
    // Read-only.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('hands the focus back to the door when Back returns to the supplier’s screen, and writes nothing', async () => {
    const source = seeded();
    const view = await onSupplier(source);
    await view.user.click(door());
    await screen.findByText('Order summary · 3 items');
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    expect(path(view)).toBe('/orders/supplier/s-alp');
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(door()).toHaveFocus(); });
    expect(source.writes).toHaveLength(0);
  });

  it('opened by its address, Back goes up to the supplier’s order', async () => {
    const view = await onSummary();
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(path(view)).toBe('/orders/supplier/s-alp');
  });

  it('is offered also with nothing typed, and says «No quantities typed» with no box', async () => {
    const source = seeded({ draft: { entries: {}, days: {} } });
    const view = await onSupplier(source);
    await view.user.click(door('Summary (0)'));
    expect(await screen.findByText('No quantities typed')).toBeInTheDocument();
    expect(totals()).not.toBeInTheDocument();
    expect(pane().queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Order summary ·/)).not.toBeInTheDocument();
  });

  it('shows the count of the door as the supplier’s lines are typed', async () => {
    const view = await onSupplier();
    expect(door()).toHaveTextContent('Summary (3)');
    expect(door().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await view.user.clear(screen.getByRole('spinbutton', { name: 'Flour 00 25kg quantity to order' }));
    expect(door('Summary (2)')).toBeInTheDocument();
  });

  it('says the supplier is gone when it is deleted while the summary is open', async () => {
    const source = seeded();
    await onSummary(source);
    source.suppliers.delete('s-alp');
    act(() => { source.emit(); });
    expect(await screen.findByText('This supplier is not in the order list.')).toBeInTheDocument();
  });

  it('follows a price that changes while it is open', async () => {
    const source = seeded();
    await onSummary(source);
    expect(await screen.findByText('3 × £2.00 = £6.00 · VAT 4%')).toBeInTheDocument();
    source.prices.set('i-flour', { priceUnit: 'kg', pricePerUnit: 3, vatRate: 4 });
    act(() => { source.emitPrices(); });
    expect(await screen.findByText('3 × £3.00 = £9.00 · VAT 4%')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Order total' })).getByText('£11.00')).toBeInTheDocument();
  });

  it('says only «nothing is priced» when no line has a price', async () => {
    const source = seeded({ prices: {} });
    await onSummary(source);
    expect(await screen.findByText('No item here has a price yet: add it in the ingredient’s card')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Order total' })).toBeInTheDocument();
    expect(screen.queryByText('Net')).not.toBeInTheDocument();
    expect(screen.getAllByText('no price')).toHaveLength(3);
  });

  it('writes the money in the venue’s country and the words in the interface language', async () => {
    const source = seeded();
    await onSummary(source, { lang: 'it', session: { location: { country: 'IT' } } });
    expect(await screen.findByText('Riepilogo ordine · 3 articoli')).toBeInTheDocument();
    const costs = await screen.findAllByText(/^3 × 2,00\s€ = 6,00\s€ · IVA 4%$/);
    expect(costs).toHaveLength(1);
    expect(screen.getByText('senza prezzo')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Totale ordine' })).getByText('Imponibile')).toBeInTheDocument();
  });

  it('says its door in Italian', async () => {
    await onSupplier(seeded(), { lang: 'it', session: { location: { country: 'IT' } } });
    expect(screen.getByRole('button', { name: 'Riepilogo (3)' })).toBeInTheDocument();
  });
});

describe('who sees the money', () => {
  it('⚠️ an employee not shown Food cost sees the lines and no amount, no «no price», no total — and nothing is read', async () => {
    const source = seeded();
    await onSummary(source, { session: { ...EMPLOYEE, location: GB } });
    expect(await screen.findByText('Order summary · 3 items')).toBeInTheDocument();
    expect(lineTexts()).toHaveLength(3);
    expect(screen.queryByText('no price')).not.toBeInTheDocument();
    expect(screen.queryByText(/£/)).not.toBeInTheDocument();
    expect(totals()).not.toBeInTheDocument();
    expect(source.priceWatches).toBe(0);
  });

  it('an employee whose venue shows them Food cost sees the money', async () => {
    const source = seeded();
    await onSummary(source, { session: { ...EMPLOYEE, location: { ...GB, staffShownCards: { foodcost: true } } } });
    expect(await screen.findByText('3 × £2.00 = £6.00 · VAT 4%')).toBeInTheDocument();
    expect(totals()).toBeInTheDocument();
    expect(source.priceWatches).toBe(1);
  });

  // ⚠️ THE KITCHEN OWNER BUYS THE GOODS AND HAS NO FOOD COST SCREEN: the rules still give them the purchase prices
  // (cardAccess(lid, 'foodcost', 'prices')), so the price reader turns on — it used to ask «is Food cost on my rail».
  it('the owner of the kitchen is shown the money, although Food cost is not on their rail', async () => {
    const source = seeded();
    await onSummary(source, { session: { role: 'owner-kitchen', canManage: true, canManageVenue: false, isOwner: false, location: GB } });
    expect(await screen.findByText('3 × £2.00 = £6.00 · VAT 4%')).toBeInTheDocument();
    expect(totals()).toBeInTheDocument();
    expect(source.priceWatches).toBe(1);
  });

  it('⚠️ an owner whose read of the prices is refused sees no money either, not «no price»', async () => {
    const source = seeded();
    source.refusePrices = true;
    await onSummary(source);
    expect(await screen.findByText('Order summary · 3 items')).toBeInTheDocument();
    await waitFor(() => { expect(source.priceWatches).toBe(1); });
    expect(screen.queryByText('no price')).not.toBeInTheDocument();
    expect(screen.queryByText(/£/)).not.toBeInTheDocument();
    expect(totals()).not.toBeInTheDocument();
  });

  it('⚠️ money shown from the browser’s copy goes when the server then refuses the read', async () => {
    const source = seeded();
    source.refusePricesAfterCopy = true;
    await onSummary(source);
    await waitFor(() => { expect(totals()).not.toBeInTheDocument(); });
    expect(screen.queryByText('no price')).not.toBeInTheDocument();
    expect(screen.queryByText(/£/)).not.toBeInTheDocument();
    expect(await screen.findByText('Order summary · 3 items')).toBeInTheDocument();
  });
});

describe('on the split', () => {
  const rowOf = (name: RegExp) => screen.getByRole('button', { name }).closest('li') as HTMLElement;
  const spacerIn = (row: HTMLElement) => [...row.querySelectorAll('span[aria-hidden="true"]')].find(node => node.children.length === 0 && node.textContent === '');

  it('gives a row a summary button while the supplier has quantities, and an invisible spacer when it has none', async () => {
    split();
    renderOrders('/orders', { source: seeded(), session: OWNER });
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    const alpine = rowOf(/^Alpine Mills/);
    const zed = rowOf(/^Zed/);
    expect(within(alpine).getByRole('button', { name: 'Order summary: Alpine Mills' })).toBeInTheDocument();
    expect(within(zed).queryByRole('button', { name: /Order summary/ })).not.toBeInTheDocument();
    expect(zed.querySelectorAll('button')).toHaveLength(2);
    expect(spacerIn(zed)).toBeDefined();
    expect(spacerIn(alpine)).toBeUndefined();
  });

  it('opens the summary in the right-hand pane beside the list, and Back gives the focus to the row’s button', async () => {
    split();
    const view = renderOrders('/orders', { source: seeded(), session: OWNER });
    await view.user.click(await screen.findByRole('button', { name: 'Order summary: Alpine Mills' }, LOAD));
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
    expect(await screen.findByText('Order summary · 3 items')).toBeInTheDocument();
    // The list is still beside it.
    expect(screen.getByRole('button', { name: 'Order summary: Alpine Mills' })).toBeInTheDocument();
    await view.user.click(within(screen.getByRole('region', { name: 'Alpine Mills' })).getByRole('button', { name: 'Back' }));
    expect(path(view)).toBe('/orders');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Order summary: Alpine Mills' })).toHaveFocus(); });
  });

  it('Back gives the focus to the supplier’s row when its summary button went while the summary was open', async () => {
    split();
    const source = seeded();
    const view = renderOrders('/orders', { source, session: OWNER });
    await view.user.click(await screen.findByRole('button', { name: 'Order summary: Alpine Mills' }, LOAD));
    expect(await screen.findByText('Order summary · 3 items')).toBeInTheDocument();
    // Another phone placed or cleared Alpine's order: nothing is left to sum up, so the row loses its button.
    act(() => { source.remoteMerge({ entries: { 'i-flour': { qty: 0 }, 'i-rye': { qty: 0 }, 'i-old': { qty: 0 } } }); });
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Order summary: Alpine Mills' })).not.toBeInTheDocument(); });
    await view.user.click(within(screen.getByRole('region', { name: 'Alpine Mills' })).getByRole('button', { name: 'Back' }));
    expect(path(view)).toBe('/orders');
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveFocus(); });
  });

  it('has neither button nor spacer on a phone', async () => {
    renderOrders('/orders', { source: seeded(), session: OWNER });
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    expect(screen.queryByRole('button', { name: /Order summary/ })).not.toBeInTheDocument();
    expect(rowOf(/^Alpine Mills/).querySelectorAll('button')).toHaveLength(2);
    expect(spacerIn(rowOf(/^Zed/))).toBeUndefined();
  });

  it('puts the totals box alone above «Order placed» for a price reader', async () => {
    split();
    await onSupplier();
    const box = await screen.findByRole('group', { name: 'Order total' });
    const place = screen.getByRole('button', { name: /^Order placed/ });
    expect(box.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(box).getByText('£8.24')).toBeInTheDocument();
    // No cost line under each row.
    expect(screen.queryByText(/ × £/)).not.toBeInTheDocument();
  });

  it('shows the same total in the box as in the summary', async () => {
    split();
    const view = await onSupplier();
    const here = within(await screen.findByRole('group', { name: 'Order total' })).getByText('£8.24').textContent;
    await view.user.click(door());
    await screen.findByText('Order summary · 3 items');
    const there = within(await screen.findByRole('group', { name: 'Order total' })).getByText('£8.24').textContent;
    expect(there).toBe(here);
  });

  it('draws no totals box on a phone', async () => {
    const source = seeded();
    await onSupplier(source);
    await waitFor(() => { expect(source.priceWatchersOpen()).toBe(1); });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(totals()).not.toBeInTheDocument();
  });

  it('⚠️ draws no totals box for an employee who may not read prices, nor reads the prices', async () => {
    split();
    const source = seeded();
    await onSupplier(source, { session: { ...EMPLOYEE, location: GB } });
    expect(totals()).not.toBeInTheDocument();
    expect(source.priceWatches).toBe(0);
  });
});

describe('the package word (Mise 2 only)', () => {
  it('⚠️ the sheet reads «2 bottles» for a typed card, «1 bucket» for the singular, and the bare number for the rest', async () => {
    const source = seeded({
      ingredients: [
        ...ITEMS,
        ingredient('i-cream', { name: 'Cream', supplierId: 's-alp', unit: 'bottle', packUnit: 'bottle' }),
        ingredient('i-lard', { name: 'Lard', supplierId: 's-alp', unit: 'bucket', packUnit: 'bucket' }),
      ],
      draft: { entries: { ...ENTRIES, 'i-cream': { qty: 2 }, 'i-lard': { qty: 1 } }, days: {} },
    });
    await onSummary(source);
    const cream = (await screen.findByText('Cream')).closest('li') as HTMLElement;
    expect(within(cream).getByText('2 bottles')).toBeInTheDocument();
    const lard = screen.getByText('Lard').closest('li') as HTMLElement;
    expect(within(lard).getByText('1 bucket')).toBeInTheDocument();
    const flour = screen.getByText(/^Flour 00/).closest('li') as HTMLElement;
    expect(within(flour).getByText('3')).toBeInTheDocument();
  });
});
