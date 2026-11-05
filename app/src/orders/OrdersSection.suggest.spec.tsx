import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», step 3f-2b: the suggestion under a row's name, the warning for a far-too-large number, the Stock box filling the
// Order box, and the same warning on the confirm screen.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const TODAY = todayISO();
const daysAgo = (n: number): string => toISODate(addDays(parseISODate(TODAY), -n));

const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills' }), supplier('s-zed', { name: 'Zed Dairy' })];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
];

// Four orders of flour, 10 ordered with 2 on the shelf: par 12. Rye has only two orders: too few for a suggestion.
const RECORDS = Object.fromEntries([7, 14, 21, 28].map(n => {
  const date = daysAgo(n);
  const quantities: Record<string, number> = { 'i-flour': 10 };
  const stock: Record<string, number> = { 'i-flour': 2 };
  if (n <= 14) { quantities['i-rye'] = 5; stock['i-rye'] = 1; }
  return [`${date}_s-alp`, { date, supplierId: 's-alp', quantities, stock }];
}));

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, records: RECORDS, ...extra });
}

async function opened(source = seeded(), options = {}) {
  const view = renderOrders('/orders/supplier/s-alp', { source, ...options });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

const box = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const qtyBox = (name: string) => box(`${name} quantity to order`);
const stockBox = (name: string) => box(`${name} stock on hand`);

describe('the line under a row’s name', () => {
  it('shows the suggestion, follows a Stock reading and fills the Order box with it', async () => {
    const view = await opened();
    expect(await screen.findByText('Suggested: 12', undefined, LOAD)).toBeInTheDocument();
    await view.user.type(stockBox('Flour 00'), '5');
    expect(screen.getByText('Suggested: 7')).toBeInTheDocument();
    expect(qtyBox('Flour 00')).toHaveValue(7);
  });

  it('warns about a number far above the usual, instead of the suggestion, and brings the suggestion back when corrected', async () => {
    const view = await opened();
    await screen.findByText('Suggested: 12', undefined, LOAD);
    await view.user.type(qtyBox('Flour 00'), '120');
    expect(screen.getByText('Much more than usual (about 12)')).toBeInTheDocument();
    expect(screen.queryByText(/^Suggested/)).toBeNull();
    await view.user.clear(qtyBox('Flour 00'));
    await view.user.type(qtyBox('Flour 00'), '12');
    expect(screen.queryByText(/Much more/)).toBeNull();
    expect(screen.getByText(/^Suggested: /)).toBeInTheDocument();
  });

  it('shows nothing for an ingredient with fewer than 4 orders', async () => {
    await opened();
    await screen.findByText('Suggested: 12', undefined, LOAD);
    const line = screen.getByText('Rye').closest('li') as HTMLElement;
    expect(within(line).queryByText(/Suggested|Much more/)).toBeNull();
  });

  it('shows nothing for a row ordered from another supplier this time', async () => {
    await opened(seeded({ draft: { entries: { 'i-flour': { qty: 3, supplierId: 's-zed' } } } }));
    expect(screen.getByText('this time ordered from Zed Dairy')).toBeInTheDocument();
    expect(screen.queryByText(/Suggested|Much more/)).toBeNull();
  });

  it('never overwrites a number typed by hand with a later Stock reading', async () => {
    const view = await opened();
    await screen.findByText('Suggested: 12', undefined, LOAD);
    await view.user.type(qtyBox('Flour 00'), '9');
    await view.user.type(stockBox('Flour 00'), '5');
    expect(qtyBox('Flour 00')).toHaveValue(9);
  });

  it('is read out with the Order box', async () => {
    await opened();
    await screen.findByText('Suggested: 12', undefined, LOAD);
    expect(qtyBox('Flour 00')).toHaveAccessibleDescription('Suggested: 12');
  });

  it('says its words in Italian', async () => {
    await opened(seeded(), { lang: 'it' });
    expect(await screen.findByText('Suggerito: 12', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('the confirm screen', () => {
  it('quotes the usual amount and asks for a check while a number is far above it, and stops when corrected', async () => {
    const view = await opened(seeded({ draft: { entries: { 'i-flour': { qty: 120 } }, days: { 's-alp': TODAY } } }));
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await screen.findByText('This is what will be recorded:', undefined, LOAD);
    const field = box('Flour 00 — Order');
    expect(screen.getByText('usually about 12')).toBeInTheDocument();
    expect(screen.getByText('Check it is not an extra digit.')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription('usually about 12');
    expect(field.closest('li')).toHaveAttribute('data-unusual', 'true');
    await view.user.clear(field);
    await view.user.type(field, '12');
    expect(screen.queryByText('usually about 12')).toBeNull();
    expect(screen.queryByText('Check it is not an extra digit.')).toBeNull();
    expect(field.closest('li')).toHaveAttribute('data-unusual', 'false');
  });
});
