import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, SAVED, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», step 3f-1: a supplier's order screen — typing quantities and stock, the steppers, the unit, the lines
// switched off, and what another phone does to a box that has the focus.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', category: 'Flour' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed' }),
];

const ITEMS = [
  ingredient('i-rye25', { name: 'Rye', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye5', { name: 'Rye', weight: '5kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-barley', { name: 'Barley', supplierId: 's-alp' }),
  ingredient('i-box', { name: 'Cake box', supplierId: 's-alp', unit: 'carton', packUnit: 'bag' }),
  ingredient('i-old', { name: 'Old oats', supplierId: 's-alp', active: false }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
];

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ...extra });
}

async function opened(supplierId = 's-alp', source = seeded(), options = {}) {
  const view = renderOrders(`/orders/supplier/${supplierId}`, { source, ...options });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

const screenOf = (name: string) => within(screen.getByRole('region', { name }));
const box = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const qtyBox = (name: string) => box(`${name} quantity to order`);
const stockBox = (name: string) => box(`${name} stock on hand`);
const lineOf = (text: string) => screen.getByText(text, { selector: 'span' }).closest('li') as HTMLElement;

describe('the screen', () => {
  it('has the supplier’s name for its heading and the column names «Order» and «Stock» over the boxes', async () => {
    await opened();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toBeInTheDocument();
    expect(screenOf('Alpine Mills').getByText('Order')).toBeInTheDocument();
    expect(screenOf('Alpine Mills').getByText('Stock')).toBeInTheDocument();
  });

  it('lists the lines A to Z by the label a person reads, «Rye 5kg» before «Rye 25kg», and the weight on its own line', async () => {
    await opened();
    const lines = screenOf('Alpine Mills').getAllByRole('listitem');
    const names = lines.map(line => line.querySelector('span')?.textContent ?? '');
    expect(names).toEqual(['Barley', 'Cake box', 'Flour 00', 'Rye', 'Rye', 'Old oats']);
    expect(lines.map(line => line.querySelectorAll('span')[1]?.textContent).slice(2, 5)).toEqual(['25kg', '5kg', '25kg']);
    expect(within(lineOf('Flour 00')).getByText('25kg')).toBeInTheDocument();
  });

  it('names each box by the ingredient (and the steppers, the × and the unit menu by the ingredient AND its weight)', async () => {
    const draft = { entries: { 'i-flour': { qty: 2 } }, days: {} };
    await opened('s-alp', seeded({ draft }));
    expect(qtyBox('Flour 00')).toBeInTheDocument();
    expect(stockBox('Flour 00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'One more Flour 00 25kg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'One fewer Flour 00 25kg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear the quantity of Flour 00 25kg' })).toBeInTheDocument();
  });

  it('draws the Order box for numbers: whole, never below 0', async () => {
    await opened();
    const input = qtyBox('Flour 00');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });

  it('says so when a supplier sells nothing', async () => {
    renderOrders('/orders/supplier/s-zed', { source: fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: [] }) });
    expect(await screen.findByText('No ingredients yet.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says so, and offers Back, when the supplier is not in the order list', async () => {
    renderOrders('/orders/supplier/nobody', { source: seeded() });
    expect(await screen.findByText('This supplier is not in the order list.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('works for an employee: nothing in this slice is role-gated', async () => {
    const { user } = await opened('s-alp', seeded(), { session: { canManage: false, role: 'staff', isOwner: false } });
    await user.type(qtyBox('Flour 00'), '3');
    expect(qtyBox('Flour 00')).toHaveValue(3);
  });

  it('says its words in Italian', async () => {
    const draft = { entries: { 'i-flour': { qty: 2 } }, days: {} };
    await opened('s-alp', seeded({ draft }), { lang: 'it' });
    expect(screenOf('Alpine Mills').getByText('Ordine')).toBeInTheDocument();
    expect(screenOf('Alpine Mills').getByText('Giacenza')).toBeInTheDocument();
    expect(box('Quantità da ordinare di Flour 00')).toHaveValue(2);
    expect(box('Giacenza di Flour 00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uno in più: Flour 00 25kg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Azzera la quantità di Flour 00 25kg' })).toBeInTheDocument();
    expect(screen.getByText('Non in uso (1)')).toBeInTheDocument();
  });
});

describe('typing a quantity', () => {
  it('is on screen at once, and saved after the pause with the line and the day', async () => {
    const source = seeded();
    const { user } = await opened('s-alp', source);
    await user.type(qtyBox('Flour 00'), '12');
    expect(qtyBox('Flour 00')).toHaveValue(12);
    expect(source.writes).toHaveLength(0);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    const sent = source.writes.at(-1);
    expect(sent?.entries?.['i-flour']).toMatchObject({ qty: 12 });
    expect(sent?.days).toEqual({ 's-alp': todayISO() });
    // Only the line that changed is sent: a colleague's rows are never rewritten.
    expect(Object.keys(sent?.entries ?? {})).toEqual(['i-flour']);
  });

  it('shows the count on the list the moment a box is filled', async () => {
    const { user } = await opened();
    await user.type(qtyBox('Flour 00'), '3');
    expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveTextContent('1 item');
  });

  it('turns an empty box into 0 and a number into a whole number', async () => {
    const source = seeded({ draft: { entries: { 'i-flour': { qty: 5 } }, days: {} } });
    const { user } = await opened('s-alp', source);
    expect(qtyBox('Flour 00')).toHaveValue(5);
    await user.clear(qtyBox('Flour 00'));
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    expect(source.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 0 });
  });
});

describe('the Stock box', () => {
  it('saves the reading WITHOUT stamping the day', async () => {
    const source = seeded();
    const { user } = await opened('s-alp', source);
    await user.type(stockBox('Flour 00'), '7');
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    const sent = source.writes.at(-1);
    expect(sent?.entries?.['i-flour']).toMatchObject({ stock: 7 });
    expect(sent?.days).toBeUndefined();
  });

  it('is hidden, with its column name, when the venue switched the Stock box off', async () => {
    await opened('s-alp', seeded({ ordersConfig: { showStock: false } }));
    expect(screen.queryByRole('spinbutton', { name: 'Flour 00 stock on hand' })).not.toBeInTheDocument();
    expect(screenOf('Alpine Mills').queryByText('Stock')).not.toBeInTheDocument();
    expect(qtyBox('Flour 00')).toBeInTheDocument();
  });
});

describe('− + and ×', () => {
  it('+ adds one, − takes one away, and − is disabled at 0', async () => {
    const source = seeded();
    const { user } = await opened('s-alp', source);
    const minus = screen.getByRole('button', { name: 'One fewer Flour 00 25kg' });
    const plus = screen.getByRole('button', { name: 'One more Flour 00 25kg' });
    expect(minus).toBeDisabled();
    await user.click(plus);
    await user.click(plus);
    expect(qtyBox('Flour 00')).toHaveValue(2);
    expect(minus).toBeEnabled();
    await user.click(minus);
    expect(qtyBox('Flour 00')).toHaveValue(1);
    await user.click(minus);
    expect(qtyBox('Flour 00')).toHaveValue(null);
    expect(minus).toBeDisabled();
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    // Back to 0 before the pause: an empty line and 0 are the same thing (L26), so the write carries no quantity for it.
    expect(source.writes.at(-1)?.entries?.['i-flour']?.qty ?? 0).toBe(0);
  });

  it('a keyboard − that reaches 0 moves the focus to the box, not to the page', async () => {
    const { user } = await opened('s-alp', seeded({ draft: { entries: { 'i-flour': { qty: 1 } }, days: {} } }));
    const minus = screen.getByRole('button', { name: 'One fewer Flour 00 25kg' });
    minus.focus();
    await user.keyboard('{Enter}');
    expect(qtyBox('Flour 00')).toHaveFocus();
    expect(qtyBox('Flour 00')).toHaveValue(null);
  });

  it('a tap on − that reaches 0 leaves the focus alone (the phone’s keyboard must not pop up)', async () => {
    const { user } = await opened('s-alp', seeded({ draft: { entries: { 'i-flour': { qty: 1 } }, days: {} } }));
    await user.click(screen.getByRole('button', { name: 'One fewer Flour 00 25kg' }));
    expect(qtyBox('Flour 00')).not.toHaveFocus();
  });

  it('shows the × only while there is a quantity; it clears the quantity and the unit in ONE save', async () => {
    const source = seeded({ draft: { entries: { 'i-box': { qty: 4, unit: 'bag' } }, days: { 's-alp': todayISO() } } });
    const { user } = await opened('s-alp', source);
    expect(screen.queryByRole('button', { name: 'Clear the quantity of Flour 00 25kg' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the quantity of Cake box' }));
    expect(qtyBox('Cake box')).toHaveValue(null);
    expect(screen.queryByRole('button', { name: 'Clear the quantity of Cake box' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Unit to order for Cake box' })).toHaveValue('carton');
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    expect(source.writes).toHaveLength(1);
    expect(source.writes[0]?.entries?.['i-box']).toMatchObject({ qty: 0, unit: '' });
  });

  it('a keyboard × puts the focus in the box afterwards; a tap does not', async () => {
    const { user } = await opened('s-alp', seeded({ draft: { entries: { 'i-flour': { qty: 2 }, 'i-barley': { qty: 2 } }, days: {} } }));
    const clearFlour = screen.getByRole('button', { name: 'Clear the quantity of Flour 00 25kg' });
    clearFlour.focus();
    await user.keyboard('{Enter}');
    expect(qtyBox('Flour 00')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Clear the quantity of Barley' }));
    expect(qtyBox('Barley')).not.toHaveFocus();
  });
});

describe('the unit', () => {
  it('has a menu ONLY when the card offers a choice, with the card’s own words', async () => {
    await opened();
    const menu = screen.getByRole('combobox', { name: 'Unit to order for Cake box' });
    expect(within(menu).getAllByRole('option').map(option => option.textContent)).toEqual(['carton', 'bag']);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('shows the card’s unit as a caption on every other row', async () => {
    await opened();
    expect(within(lineOf('Flour 00')).getByText('kg')).toBeInTheDocument();
    expect(within(lineOf('Barley')).queryByText('kg')).not.toBeInTheDocument();
  });

  it('saves the chosen unit, and the card’s own unit as nothing', async () => {
    const source = seeded();
    const { user } = await opened('s-alp', source);
    const menu = screen.getByRole('combobox', { name: 'Unit to order for Cake box' });
    await user.selectOptions(menu, 'bag');
    expect(menu).toHaveValue('bag');
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    expect(source.writes.at(-1)?.entries?.['i-box']).toMatchObject({ unit: 'bag' });
    await user.selectOptions(menu, 'carton');
    await waitFor(() => { expect(source.writes.at(-1)?.entries?.['i-box']).toMatchObject({ unit: '' }); }, SAVED);
  });

  it('shows a unit another phone chose', async () => {
    await opened('s-alp', seeded({ draft: { entries: { 'i-box': { qty: 1, unit: 'bag' } }, days: {} } }));
    expect(screen.getByRole('combobox', { name: 'Unit to order for Cake box' })).toHaveValue('bag');
  });
});

describe('a line ordered elsewhere', () => {
  const draft = { entries: { 'i-flour': { qty: 3, supplierId: 's-zed' } }, days: {} };

  it('shows an EMPTY Order box on its own supplier’s screen, and says where it is ordered this time', async () => {
    await opened('s-alp', seeded({ draft }));
    expect(qtyBox('Flour 00')).toHaveValue(null);
    expect(within(lineOf('Flour 00')).getByText('this time ordered from Zed')).toBeInTheDocument();
  });

  it('is drawn on the other supplier’s screen, with its quantity and «usually from»', async () => {
    await opened('s-zed', seeded({ draft }), { lang: 'en' });
    expect(qtyBox('Flour 00')).toHaveValue(3);
    expect(within(lineOf('Flour 00')).getByText('usually from Alpine Mills')).toBeInTheDocument();
  });

  it('typing a quantity on its own screen takes the line back, in the same write', async () => {
    const source = seeded({ draft });
    const { user } = await opened('s-alp', source);
    await user.type(qtyBox('Flour 00'), '2');
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    expect(source.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 2, supplierId: '' });
    expect(within(lineOf('Flour 00')).queryByText(/this time ordered from/)).not.toBeInTheDocument();
  });

  it('+ on its own screen gives 1 and takes the line back', async () => {
    const source = seeded({ draft });
    const { user } = await opened('s-alp', source);
    await user.click(screen.getByRole('button', { name: 'One more Flour 00 25kg' }));
    expect(qtyBox('Flour 00')).toHaveValue(1);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    expect(source.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 1, supplierId: '' });
  });
});

describe('the «Not in use» group', () => {
  it('is closed, with its count, when none of its lines has a quantity', async () => {
    await opened();
    const group = screen.getByText('Not in use (1)').closest('details') as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(within(group).getByText('Old oats')).toBeInTheDocument();
  });

  it('is OPEN when one of its lines has a quantity', async () => {
    await opened('s-alp', seeded({ draft: { entries: { 'i-old': { qty: 2 } }, days: {} } }));
    const group = screen.getByText('Not in use (1)').closest('details') as HTMLDetailsElement;
    expect(group.open).toBe(true);
    expect(qtyBox('Old oats')).toHaveValue(2);
  });

  it('can be typed into like any other line', async () => {
    const source = seeded();
    const { user } = await opened('s-alp', source);
    await user.click(screen.getByText('Not in use (1)'));
    await user.type(qtyBox('Old oats'), '1');
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, SAVED);
    expect(source.writes.at(-1)?.entries?.['i-old']).toMatchObject({ qty: 1 });
  });

  it('is not drawn when no line is switched off', async () => {
    await opened('s-zed');
    expect(screen.queryByText(/Not in use/)).not.toBeInTheDocument();
  });
});

describe('another phone', () => {
  it('shows a quantity another phone typed, live', async () => {
    const source = seeded();
    await opened('s-alp', source);
    act(() => { source.remoteMerge({ entries: { 'i-flour': { qty: 6 } }, days: { 's-alp': todayISO() } }); });
    await waitFor(() => { expect(qtyBox('Flour 00')).toHaveValue(6); });
  });

  it('never overwrites a box that has the focus, and shows the draft when the focus leaves', async () => {
    const source = seeded();
    const { user } = await opened('s-alp', source);
    const input = qtyBox('Flour 00');
    await user.click(input);
    act(() => { source.remoteMerge({ entries: { 'i-flour': { qty: 9 } } }); });
    // The snapshot has landed (the count on the list says so), the box under the finger has not moved.
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveTextContent('1 item'); });
    expect(input).toHaveFocus();
    expect(input).toHaveValue(null);
    await user.tab();
    await waitFor(() => { expect(qtyBox('Flour 00')).toHaveValue(9); });
  });

  it('keeps the digits being typed when another phone changes the same line', async () => {
    const source = seeded();
    const { user } = await opened('s-alp', source);
    const input = qtyBox('Flour 00');
    await user.type(input, '4');
    act(() => { source.remoteMerge({ entries: { 'i-flour': { qty: 9 } } }); });
    await user.type(input, '5');
    expect(input).toHaveValue(45);
  });
});

describe('the status line', () => {
  it('says the order could not be saved, keeps what was typed, and clears the message when a later save lands', async () => {
    const source = seeded();
    source.refuseWrites = true;
    const { user } = await opened('s-alp', source);
    await user.type(qtyBox('Flour 00'), '3');
    expect(await screen.findByText('Could not save the order — check your network. Keep this page open.', undefined, SAVED)).toBeInTheDocument();
    expect(qtyBox('Flour 00')).toHaveValue(3);
    source.refuseWrites = false;
    await user.type(qtyBox('Flour 00'), '1');
    await waitFor(() => {
      expect(screen.queryByText('Could not save the order — check your network. Keep this page open.')).not.toBeInTheDocument();
    }, SAVED);
    expect(qtyBox('Flour 00')).toHaveValue(31);
  });

  it('says it in Italian', async () => {
    const source = seeded();
    source.refuseWrites = true;
    const { user } = await opened('s-alp', source, { lang: 'it' });
    await user.type(box('Quantità da ordinare di Flour 00'), '3');
    expect(await screen.findByText('Non è stato possibile salvare l’ordine — controlla la rete. Tieni aperta questa pagina.', undefined, SAVED)).toBeInTheDocument();
  });

  it('says the live data was lost when the order’s stream dies', async () => {
    const source = seeded();
    source.refuse.draft = true;
    renderOrders('/orders', { source });
    expect(await screen.findByText(/Lost the live connection for the order in progress/, undefined, LOAD)).toBeInTheDocument();
  });

  it('says the live data was lost, in Italian, when the suppliers’ stream dies', async () => {
    const source = seeded();
    source.refuse.suppliers = true;
    renderOrders('/orders', { source, lang: 'it' });
    expect(await screen.findByText(/Persa la connessione dal vivo per i fornitori/, undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Ancora nessun fornitore')).not.toBeInTheDocument();
  });

  it('has its live region on the page before anything is said', async () => {
    await opened();
    const regions = screen.getAllByRole('status');
    expect(regions.some(region => region.textContent === '')).toBe(true);
  });
});

describe('«What they sell»', () => {
  it('lists the supplier’s own lines A to Z with their weight and unit, and nothing to type into', async () => {
    renderOrders('/orders/supplier/s-alp/items', { source: seeded() });
    expect(await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' }, LOAD)).toBeInTheDocument();
    await screen.findByText('Barley', undefined, LOAD);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('What they sell')).toBeInTheDocument();
    expect(screen.getByText('6 ingredients')).toBeInTheDocument();
    const names = screenOf('Alpine Mills').getAllByRole('listitem').map(item => item.firstElementChild?.textContent);
    expect(names).toEqual(['Barley', 'Cake box', 'Flour 00 25kg', 'Rye 5kg', 'Rye 25kg', 'Old oats']);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('puts the switched-off lines last under «Not in use»', async () => {
    renderOrders('/orders/supplier/s-alp/items', { source: seeded() });
    const group = (await screen.findByText('Not in use (1)', undefined, LOAD)).closest('details') as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(within(group).getByText('Old oats')).toBeInTheDocument();
  });

  it('does not list a line another supplier sends here for this order', async () => {
    const draft = { entries: { 'i-milk': { qty: 2, supplierId: 's-alp' } }, days: {} };
    renderOrders('/orders/supplier/s-alp/items', { source: seeded({ draft }) });
    await screen.findByText('Barley', undefined, LOAD);
    expect(screen.queryByText('Milk')).not.toBeInTheDocument();
  });

  it('writes nothing', async () => {
    const source = seeded();
    const { user } = await (async () => {
      const view = renderOrders('/orders/supplier/s-alp/items', { source });
      await screen.findByText('Barley', undefined, LOAD);
      return view;
    })();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(source.writes).toHaveLength(0);
  });

  it('is said in Italian', async () => {
    renderOrders('/orders/supplier/s-alp/items', { source: seeded(), lang: 'it' });
    expect(await screen.findByText('Cosa vendono', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('6 ingredienti')).toBeInTheDocument();
  });
});

describe('«What they sell» from the supplier screen', () => {
  const door = () => screenOf('Alpine Mills').getByRole('button', { name: 'What they sell' });

  it('has a button for it on the supplier’s order screen, named in the interface language', async () => {
    await opened();
    expect(door()).toBeInTheDocument();
    expect(door().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says it in Italian', async () => {
    await opened('s-alp', seeded(), { lang: 'it' });
    expect(screenOf('Alpine Mills').getByRole('button', { name: 'Cosa vendono' })).toBeInTheDocument();
  });

  it('opens the read-only list, one level down', async () => {
    const { user } = await opened();
    await user.click(door());
    expect(await screen.findByText('6 ingredients', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toBeInTheDocument();
    expect(screen.getByText('What they sell')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('hands the focus back to the button when Back returns to the supplier’s order', async () => {
    const { user } = await opened();
    await user.click(door());
    await screen.findByText('6 ingredients', undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(door()).toHaveFocus(); });
  });

  it('hands the focus back to the button too when the supplier was opened from the list', async () => {
    const { user } = renderOrders('/orders', { source: seeded() });
    await user.click(await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD));
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await user.click(door());
    await screen.findByText('6 ingredients', undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(door()).toHaveFocus(); });
  });

  it('does not take the focus from the title when a supplier is opened from the list', async () => {
    const { user } = renderOrders('/orders', { source: seeded() });
    await user.click(await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD));
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toHaveFocus(); });
  });

  it('is not on the «not in the order list» screen', async () => {
    renderOrders('/orders/supplier/nobody', { source: seeded() });
    expect(await screen.findByText('This supplier is not in the order list.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What they sell' })).not.toBeInTheDocument();
  });
});
