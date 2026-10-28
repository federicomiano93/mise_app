import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, spellLongDate, spellShortDate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», step 3f-2: the day line on a supplier's screen, and recording an order — «Order placed…», the confirm screen with
// its working copy, «Did you send the order?», the several-suppliers picker — and «Clear quantities».

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const WEEKDAY = (n: number): string => weekdayOf(inDays(n)) as string;
const sayEn = (key: string, params?: Record<string, string | number>) => format('en', en[key as keyof typeof en], params);
const short = (iso: string) => spellShortDate(iso, sayEn);
const long = (iso: string) => spellLongDate(iso, sayEn);

const SUPPLIERS = [
  // No order days: the week is offered.
  supplier('s-alp', { name: 'Alpine Mills' }),
  // Order day tomorrow, delivery in three days: «Today» and «Next order», and the expected delivery.
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', orderDays: [WEEKDAY(1)], deliveryDays: [WEEKDAY(3)] }),
  supplier('s-caf', { name: 'Café Bar Srl' }),
];

const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-box', { name: 'Cake box', supplierId: 's-alp', unit: 'carton', packUnit: 'bag' }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
  ingredient('i-cafe', { name: 'Caffè in grani', supplierId: 's-caf' }),
];

function seeded(draft: Record<string, unknown> | null = null): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, draft });
}

const FILLED = {
  entries: { 'i-flour': { qty: 2 }, 'i-rye': { qty: 3 } },
  days: { 's-alp': TODAY },
};
const BOTH = {
  entries: { 'i-flour': { qty: 2 }, 'i-rye': { qty: 3 }, 'i-milk': { qty: 4, stock: 9 } },
  days: { 's-alp': TODAY, 's-zed': inDays(-1) },
};

async function atSupplier(id: string, source: FakeOrdersSource, options = {}) {
  const view = renderOrders(`/orders/supplier/${id}`, { source, ...options });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

async function atList(source: FakeOrdersSource, options = {}) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

const supplierScreen = (name: string) => within(screen.getByRole('region', { name }));
const dialog = () => screen.findByRole('alertdialog');
const dialogButton = async (name: string) => within(await dialog()).getByRole('button', { name });
const recordId = (id: string, date = TODAY) => `${date}_${id}`;

// From a supplier's screen to its confirm screen.
async function toConfirm(view: Awaited<ReturnType<typeof atSupplier>>, name = 'Alpine Mills') {
  await view.user.click(supplierScreen(name).getByRole('button', { name: 'Order placed…' }));
  await screen.findByText('This is what will be recorded:', undefined, LOAD);
}

describe('the day line', () => {
  it('shows «Today» and «Next order» for a supplier with order days, with the expected delivery', async () => {
    await atSupplier('s-zed', seeded());
    const select = screen.getByRole('combobox', { name: 'Order:' });
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Today', `Next order (${short(inDays(1))})`]);
    // With nothing stamped, the rows would be for the NEXT order: that is what the line shows.
    expect(select).toHaveValue('next');
    // Today is not an order day, so the rows are for the NEXT order — the delivery is counted from the order day in effect.
    expect(screen.getByText(`Expected delivery: ${long(inDays(3))}`)).toBeInTheDocument();
  });

  it('writes the chosen day, announces it and keeps the focus on the select', async () => {
    const source = seeded();
    const { user } = await atSupplier('s-zed', source);
    const select = screen.getByRole('combobox', { name: 'Order:' });
    await user.selectOptions(select, 'today');
    await waitFor(() => { expect((source.draft?.days as Record<string, string>)['s-zed']).toBe(TODAY); });
    expect(await screen.findByText('Order for today')).toBeInTheDocument();
    expect(select).toHaveValue('today');
    expect(select).toHaveFocus();
    await user.selectOptions(select, 'next');
    await waitFor(() => { expect((source.draft?.days as Record<string, string>)['s-zed']).toBe(inDays(1)); });
    expect(await screen.findByText(`Order moved to the next order (${short(inDays(1))})`)).toBeInTheDocument();
    expect(select).toHaveValue('next');
  });

  it('offers a week to a supplier with NO order days — «Today», «Tomorrow», then each weekday — always', async () => {
    const source = seeded();
    const { user } = await atSupplier('s-alp', source);
    const select = screen.getByRole('combobox', { name: 'Order:' });
    const options = within(select).getAllByRole('option').map(option => option.textContent);
    expect(options).toHaveLength(7);
    expect(options.slice(0, 2)).toEqual(['Today', 'Tomorrow']);
    expect(options[2]).toBe(long(inDays(2)));
    // No delivery days: no «Expected delivery».
    expect(screen.queryByText(/^Expected delivery/)).not.toBeInTheDocument();

    await user.selectOptions(select, inDays(1));
    await waitFor(() => { expect((source.draft?.days as Record<string, string>)['s-alp']).toBe(inDays(1)); });
    expect(await screen.findByText(`Order for ${short(inDays(1))}`)).toBeInTheDocument();
    expect(select).toHaveValue(inDays(1));
  });

  it('gives the pseudo-supplier «No supplier» the week too', async () => {
    const source = fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: [ingredient('i-stray', { name: 'Stray', supplierId: 'gone' })] });
    await atSupplier('no-supplier', source);
    expect(within(screen.getByRole('combobox', { name: 'Order:' })).getAllByRole('option')).toHaveLength(7);
  });

  it('shows the stored day of a past order that still has rows, and choosing it writes nothing', async () => {
    const source = seeded({ entries: { 'i-flour': { qty: 2 } }, days: { 's-alp': inDays(-2) } });
    const { user } = await atSupplier('s-alp', source);
    const select = screen.getByRole('combobox', { name: 'Order:' });
    expect(select).toHaveValue(inDays(-2));
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent(`From ${short(inDays(-2))}`);
    await user.selectOptions(select, inDays(-2));
    expect(source.writes).toHaveLength(0);
  });

  it('puts the select back and says so when the day is refused', async () => {
    const source = seeded();
    const { user } = await atSupplier('s-alp', source);
    source.refuseWrites = true;
    const select = screen.getByRole('combobox', { name: 'Order:' });
    await user.selectOptions(select, inDays(2));
    expect(await screen.findByText('Could not update the order’s day — check your network and try again.')).toBeInTheDocument();
    await waitFor(() => { expect(select).toHaveValue(TODAY); });
  });

  it('says its words in Italian', async () => {
    await atSupplier('s-zed', seeded(), { lang: 'it' });
    const select = screen.getByRole('combobox', { name: 'Ordine:' });
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent('Oggi');
    expect(within(select).getAllByRole('option')[1]?.textContent).toMatch(/^Prossimo ordine \(/);
    expect(screen.getByText(/^Consegna prevista: /)).toBeInTheDocument();
  });
});

describe('«Order placed…» and «Clear quantities…» on a supplier’s screen', () => {
  it('are drawn after the rows; «Order placed…» is off and «Clear quantities…» absent while nothing is typed', async () => {
    await atSupplier('s-alp', seeded());
    expect(supplierScreen('Alpine Mills').getByRole('button', { name: 'Order placed…' })).toBeDisabled();
    expect(supplierScreen('Alpine Mills').queryByRole('button', { name: 'Clear quantities…' })).not.toBeInTheDocument();
  });

  it('are drawn only when the supplier has lines at all', async () => {
    renderOrders('/orders/supplier/s-caf', { source: fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: [] }) });
    await screen.findByText('No ingredients yet.', undefined, LOAD);
    expect(screen.queryByRole('button', { name: 'Order placed…' })).not.toBeInTheDocument();
  });

  it('turn on with a quantity', async () => {
    await atSupplier('s-alp', seeded(FILLED));
    expect(supplierScreen('Alpine Mills').getByRole('button', { name: 'Order placed…' })).toBeEnabled();
    expect(supplierScreen('Alpine Mills').getByRole('button', { name: 'Clear quantities…' })).toBeEnabled();
  });

  it('refuse «Order placed…» offline and stay', async () => {
    const view = await atSupplier('s-alp', seeded(FILLED));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await view.user.click(supplierScreen('Alpine Mills').getByRole('button', { name: 'Order placed…' }));
    expect(await screen.findByText('You’re offline — reconnect to record this order.')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
  });

  it('clears this supplier’s quantities after a question, keeps the stock, and goes back to the list', async () => {
    const source = seeded({ entries: { 'i-flour': { qty: 2, stock: 5 }, 'i-milk': { qty: 4 } }, days: { 's-alp': TODAY, 's-zed': TODAY } });
    const view = await atList(source);
    await view.user.click(screen.getByRole('button', { name: /^Alpine Mills/ }));
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.click(supplierScreen('Alpine Mills').getByRole('button', { name: 'Clear quantities…' }));
    const asked = await dialog();
    expect(within(asked).getByText(/^Clear everything typed for Alpine Mills\?/)).toBeInTheDocument();
    expect(within(asked).getByText(/^The stock readings stay\./)).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Quantities cleared ✓')).toBeInTheDocument();
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    const entries = source.draft?.entries as Record<string, { qty?: number; stock?: number }>;
    expect(entries['i-flour']?.qty).toBeUndefined();
    expect(entries['i-flour']?.stock).toBe(5);
    expect(entries['i-milk']?.qty).toBe(4);
  });

  it('asks first, and does nothing on Cancel', async () => {
    const source = seeded(FILLED);
    const view = await atSupplier('s-alp', source);
    await view.user.click(supplierScreen('Alpine Mills').getByRole('button', { name: 'Clear quantities…' }));
    await view.user.click(await dialogButton('Cancel'));
    expect(source.clears).toHaveLength(0);
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
  });
});

describe('the confirm screen — one supplier', () => {
  it('shows what will be recorded, A to Z, with a box and the unit on each row, and the hints', async () => {
    const view = await atSupplier('s-alp', seeded(FILLED));
    await toConfirm(view);
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/confirm');
    const confirm = within(screen.getByRole('region', { name: 'Order placed' }));
    expect(confirm.getByRole('heading', { level: 3, name: 'Alpine Mills' })).toBeInTheDocument();
    expect(confirm.getByText('for today')).toBeInTheDocument();
    expect(confirm.getAllByRole('spinbutton').map(box => box.getAttribute('aria-label'))).toEqual(['Flour 00 25kg — Order', 'Rye 25kg — Order']);
    expect(confirm.getByRole('spinbutton', { name: 'Flour 00 25kg — Order' })).toHaveValue(2);
    expect(confirm.getAllByText('kg')).toHaveLength(2);
    expect(confirm.getByText('Set a quantity to 0 to remove that item from the order.')).toBeInTheDocument();
    expect(confirm.getByText('Send the order to the supplier first — recording it clears the rows.')).toBeInTheDocument();
    expect(confirm.queryByText(/already recorded/)).not.toBeInTheDocument();
  });

  it('records the CORRECTED numbers after «Did you send it?», says so and goes back to the list', async () => {
    const source = seeded(FILLED);
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    const rye = screen.getByRole('spinbutton', { name: 'Rye 25kg — Order' });
    await view.user.clear(rye);
    await view.user.type(rye, '7');
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    const asked = await dialog();
    expect(within(asked).getByText('Did you send the order to Alpine Mills?')).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Yes, sent' }));
    expect(await screen.findByText('Alpine Mills — order saved to history ✓')).toBeInTheDocument();
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect(source.records.get(recordId('s-alp'))?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 7 });
    // The rows are gone from the order.
    const entries = source.draft?.entries as Record<string, unknown>;
    expect(entries['i-flour']).toBeUndefined();
  });

  it('records nothing on Cancel and keeps the screen, with the corrections', async () => {
    const source = seeded(FILLED);
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    const rye = screen.getByRole('spinbutton', { name: 'Rye 25kg — Order' });
    await view.user.clear(rye);
    await view.user.type(rye, '7');
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Cancel'));
    expect(source.records.size).toBe(0);
    expect(source.recordAttempts).toBe(0);
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/confirm');
    expect(screen.getByRole('spinbutton', { name: 'Rye 25kg — Order' })).toHaveValue(7);
  });

  it('says «Add to the order» and «Add to it» when today’s record exists, and ADDS to it', async () => {
    const source = seeded(FILLED);
    source.records.set(recordId('s-alp'), {
      date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 1 }, stock: {}, names: { 'i-flour': 'Flour 00 25kg' },
      createdAt: '2026-10-27T07:00:00.000Z', updatedAt: '2026-10-27T07:00:00.000Z',
    });
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    const confirm = within(screen.getByRole('region', { name: 'Add to the order' }));
    expect(confirm.getByText('An order for Alpine Mills is already recorded for today — these amounts will be ADDED to it.')).toBeInTheDocument();
    await view.user.click(confirm.getByRole('button', { name: 'Add to it' }));
    await view.user.click(await dialogButton('Yes, sent'));
    await waitFor(() => { expect(source.records.get(recordId('s-alp'))?.quantities).toEqual({ 'i-flour': 3, 'i-rye': 3 }); });
  });

  it('says a future day is recorded as today’s (decision F3), and files it under today', async () => {
    const source = seeded({ entries: FILLED.entries, days: { 's-alp': inDays(2) } });
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    expect(screen.getByText(`It will be recorded as today’s order, ${long(TODAY)}.`)).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Yes, sent'));
    await waitFor(() => { expect(source.records.has(recordId('s-alp'))).toBe(true); });
    expect(source.records.has(recordId('s-alp', inDays(2)))).toBe(false);
  });

  it('refuses a unit clash with today’s record BEFORE the screen opens, and stays on the supplier', async () => {
    const source = seeded({ entries: { 'i-box': { qty: 2, unit: 'bag' } }, days: { 's-alp': TODAY } });
    source.records.set(recordId('s-alp'), {
      date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-box': 3 }, stock: {}, names: { 'i-box': 'Cake box' },
      units: { 'i-box': 'carton' }, createdAt: '2026-10-27T07:00:00.000Z', updatedAt: '2026-10-27T07:00:00.000Z',
    });
    const view = await atSupplier('s-alp', source);
    await view.user.click(supplierScreen('Alpine Mills').getByRole('button', { name: 'Order placed…' }));
    const alert = await dialog();
    expect(within(alert).getByText(/^Already ordered from this supplier today: Cake box — carton\. To add more, order it in the same unit\./)).toBeInTheDocument();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp'); });
    expect(screen.queryByText('This is what will be recorded:')).not.toBeInTheDocument();
    expect(source.recordAttempts).toBe(0);
  });

  it('says there is nothing to record when every box is 0, and stays', async () => {
    const source = seeded(FILLED);
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    for (const name of ['Flour 00 25kg — Order', 'Rye 25kg — Order']) await view.user.clear(screen.getByRole('spinbutton', { name }));
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    const alert = await dialog();
    expect(within(alert).getByText('Nothing left to record — those rows are already placed or empty.')).toBeInTheDocument();
    expect(within(alert).getByText(/^Every quantity is 0, so there is nothing to record\./)).toBeInTheDocument();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(source.recordAttempts).toBe(0);
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/confirm');
  });

  it('says «NOT recorded» and stays when the record is refused, with the rows still there', async () => {
    const source = seeded(FILLED);
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    source.fail.record = true;
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Yes, sent'));
    expect(await screen.findByText('Alpine Mills — NOT recorded, the rows are still there. Try again.')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/confirm');
    expect(source.records.size).toBe(0);
    expect((source.draft?.entries as Record<string, unknown>)['i-flour']).toBeDefined();
    // And it can be tried again.
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Yes, sent'));
    await waitFor(() => { expect(source.records.has(recordId('s-alp'))).toBe(true); });
  });

  it('says it is saved but not cleared, and leaves for the list', async () => {
    const source = seeded(FILLED);
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    source.fail.clear = true;
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Yes, sent'));
    expect(await screen.findByText(/^Alpine Mills — order saved to History, but the rows could not be cleared\. Reload the page; do NOT record it again\./)).toBeInTheDocument();
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
  });

  it('refuses offline when the order is recorded, and stays', async () => {
    const source = seeded(FILLED);
    const view = await atSupplier('s-alp', source);
    await toConfirm(view);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Yes, sent'));
    expect(await screen.findByText('You’re offline — reconnect to record this order.')).toBeInTheDocument();
    expect(source.recordAttempts).toBe(0);
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/confirm');
  });

  it('asks before a corrected number is thrown away by Back, and not when nothing was touched', async () => {
    const view = await atSupplier('s-alp', seeded(FILLED));
    await toConfirm(view);
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp'); });

    await toConfirm(view);
    const rye = screen.getByRole('spinbutton', { name: 'Rye 25kg — Order' });
    await view.user.clear(rye);
    await view.user.type(rye, '9');
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    const asked = await dialog();
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/confirm');
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await view.user.click(await dialogButton('Discard'));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp'); });
  });

  it('opened by its address with nothing typed, says so and goes to the supplier', async () => {
    const view = renderOrders('/orders/supplier/s-alp/confirm', { source: seeded() });
    expect(await screen.findByText('Nothing left to record — those rows are already placed or empty.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp'); });
  });

  it('says its words in Italian', async () => {
    const view = await atSupplier('s-alp', seeded(FILLED), { lang: 'it' });
    await view.user.click(supplierScreen('Alpine Mills').getByRole('button', { name: 'Ordine fatto…' }));
    await screen.findByText('Sta per essere registrato:', undefined, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Ordine fatto' }));
    const asked = await dialog();
    expect(within(asked).getByText('Hai inviato l’ordine a Alpine Mills?')).toBeInTheDocument();
    expect(within(asked).getByRole('button', { name: 'Sì, inviato' })).toBeInTheDocument();
  });
});

describe('several suppliers at once', () => {
  it('«Order placed…» is drawn under the list from two suppliers with quantities, «Clear quantities…» from one', async () => {
    await atList(seeded(BOTH));
    expect(screen.getByRole('button', { name: 'Order placed…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear quantities…' })).toBeInTheDocument();
  });

  it('draws «Order placed…» from two but not from one supplier with quantities', async () => {
    await atList(seeded({ entries: { 'i-flour': { qty: 2 } }, days: { 's-alp': TODAY } }));
    expect(screen.queryByRole('button', { name: 'Order placed…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear quantities…' })).toBeInTheDocument();
  });

  it('draws neither with nothing typed', async () => {
    await atList(seeded());
    expect(screen.queryByRole('button', { name: 'Order placed…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear quantities…' })).not.toBeInTheDocument();
  });

  it('opens a picker with every supplier that has quantities ticked, and records each under its own day', async () => {
    const source = seeded(BOTH);
    const view = await atList(source);
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    expect(view.router.state.location.pathname).toBe('/orders/place-all');
    const picker = within(screen.getByRole('region', { name: 'Order placed' }));
    const ticks = picker.getAllByRole('checkbox');
    expect(ticks.map(tick => tick.closest('label')?.textContent)).toEqual(['Alpine Mills2 items', 'Zed1 item']);
    expect(ticks.every(tick => (tick as HTMLInputElement).checked)).toBe(true);

    await view.user.click(picker.getByRole('button', { name: 'Order placed' }));
    expect(view.router.state.location.pathname).toBe('/orders/place-all/confirm');
    const confirm = within(screen.getByRole('region', { name: 'Record these orders' }));
    expect(confirm.getByRole('heading', { level: 3, name: 'Alpine Mills' })).toBeInTheDocument();
    expect(confirm.getByRole('heading', { level: 3, name: 'Zed' })).toBeInTheDocument();
    expect(confirm.getByText('for yesterday')).toBeInTheDocument();

    await view.user.click(confirm.getByRole('button', { name: 'Order placed' }));
    const asked = await dialog();
    expect(within(asked).getByText('Did you send the orders to Alpine Mills and Zed?')).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Yes, sent' }));
    expect(await screen.findByText('Alpine Mills and Zed — order saved to history ✓')).toBeInTheDocument();
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect(source.records.get(recordId('s-alp'))?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 3 });
    expect(source.records.get(recordId('s-zed', inDays(-1)))?.quantities).toEqual({ 'i-milk': 4 });
    expect(source.records.has(recordId('s-zed'))).toBe(false);
    // Placing clears the whole entry of every line in it (parity X6).
    expect((source.draft?.entries as Record<string, unknown>)['i-milk']).toBeUndefined();
  });

  it('records only the suppliers that stay ticked', async () => {
    const source = seeded(BOTH);
    const view = await atList(source);
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await view.user.click(screen.getByRole('checkbox', { name: /^Zed/ }));
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Yes, sent'));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect([...source.records.keys()]).toEqual([recordId('s-alp')]);
  });

  it('keeps the saved supplier off the screen when the next one fails, so it is never recorded twice', async () => {
    const source = seeded(BOTH);
    const view = await atList(source);
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    // The first record (Alpine Mills) works; the second (Zed) is refused.
    const recordOrder = source.recordOrder.bind(source);
    let calls = 0;
    source.recordOrder = (id, merge) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('unavailable'));
      return recordOrder(id, merge);
    };
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(await dialogButton('Yes, sent'));
    expect(await screen.findByText('Zed — NOT recorded, the rows are still there. Alpine Mills saved.')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/place-all/confirm');
    const confirm = within(screen.getByRole('region', { name: 'Record these orders' }));
    expect(confirm.queryByRole('heading', { level: 3, name: 'Alpine Mills' })).not.toBeInTheDocument();
    expect(confirm.getByRole('heading', { level: 3, name: 'Zed' })).toBeInTheDocument();
  });

  it('turns the confirm screen into the picker when it is opened by its address (a reload)', async () => {
    const view = renderOrders('/orders/place-all/confirm', { source: seeded(BOTH) });
    await screen.findByRole('region', { name: 'Order placed' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders/place-all');
  });

  it('says «No quantities typed yet» in the picker when there are none', async () => {
    renderOrders('/orders/place-all', { source: seeded() });
    expect(await screen.findByText('No quantities typed yet. Add them first.', undefined, LOAD)).toBeInTheDocument();
  });

  it('goes Back one level at a time: the confirm screen to the picker, the picker to the list', async () => {
    const view = await atList(seeded(BOTH));
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/place-all'); });
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect(screen.getByRole('button', { name: 'Order placed…' })).toHaveFocus();
  });
});

describe('«Clear quantities…» from the list', () => {
  it('opens a picker with NOTHING ticked and the action off, then clears only the ticked suppliers and keeps the stock', async () => {
    const source = seeded(BOTH);
    const view = await atList(source);
    await view.user.click(screen.getByRole('button', { name: 'Clear quantities…' }));
    expect(view.router.state.location.pathname).toBe('/orders/clear');
    const picker = within(screen.getByRole('region', { name: 'Clear quantities' }));
    expect(picker.getAllByRole('checkbox').every(tick => !(tick as HTMLInputElement).checked)).toBe(true);
    expect(picker.getByRole('button', { name: 'Clear' })).toBeDisabled();

    await view.user.click(picker.getByRole('checkbox', { name: /^Zed/ }));
    await view.user.click(picker.getByRole('button', { name: 'Clear' }));
    const asked = await dialog();
    expect(within(asked).getByText(/^Clear everything typed for Zed\?/)).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Quantities cleared ✓')).toBeInTheDocument();
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    const entries = source.draft?.entries as Record<string, { qty?: number; stock?: number }>;
    expect(entries['i-milk']?.qty).toBeUndefined();
    expect(entries['i-milk']?.stock).toBe(9);
    expect(entries['i-flour']?.qty).toBe(2);
    expect(source.records.size).toBe(0);
  });

  it('names several suppliers by count past three, and says how many were cleared', async () => {
    const source = fakeOrdersSource({
      suppliers: [...SUPPLIERS, supplier('s-d', { name: 'Dee' })],
      ingredients: [...ITEMS, ingredient('i-d', { name: 'Dee item', supplierId: 's-d' })],
      draft: { entries: { 'i-flour': { qty: 1 }, 'i-milk': { qty: 1 }, 'i-cafe': { qty: 1 }, 'i-d': { qty: 1 } }, days: {} },
    });
    const view = await atList(source);
    await view.user.click(screen.getByRole('button', { name: 'Clear quantities…' }));
    for (const box of screen.getAllByRole('checkbox')) await view.user.click(box);
    await view.user.click(screen.getByRole('button', { name: 'Clear' }));
    const asked = await dialog();
    expect(within(asked).getByText(/^Clear everything typed for 4 suppliers\?/)).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Quantities cleared for 4 suppliers ✓')).toBeInTheDocument();
  });

  it('is refused offline', async () => {
    const view = await atList(seeded(BOTH));
    await view.user.click(screen.getByRole('button', { name: 'Clear quantities…' }));
    await view.user.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await view.user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('You’re offline — reconnect to clear these quantities.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('says so when the clear is refused', async () => {
    const source = seeded(BOTH);
    const view = await atList(source);
    await view.user.click(screen.getByRole('button', { name: 'Clear quantities…' }));
    await view.user.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    await view.user.click(screen.getByRole('button', { name: 'Clear' }));
    source.fail.clear = true;
    await view.user.click(await dialogButton('Clear'));
    expect(await screen.findByText('Could not clear them — reload the page to see what is really saved.')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/clear');
  });

  it('says «Nothing typed yet.» in the picker when there is nothing', async () => {
    renderOrders('/orders/clear', { source: seeded() });
    expect(await screen.findByText('Nothing typed yet.', undefined, LOAD)).toBeInTheDocument();
  });
});
