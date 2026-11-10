import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { todayISO, weekdayOf } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders»: the suppliers STILL TO ORDER TODAY are tagged «To order today», tinted and listed first (item 12 of
// docs/mise2-port-owed.md; the first-in-the-list order is Mise 2's own, his note of 9 Nov 2026). The rule is reminders'
// dueTodayIds, the one the «Order today» strip above the list uses.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const TODAY = todayISO();
const WEEKDAY = weekdayOf(TODAY) as string;
const NOT_TODAY = WEEKDAY === 'Monday' ? 'Tuesday' : 'Monday';

// A..E in the usual A–Z order. Bee and Cat are ordered today; Dee was already ordered this morning; Eve was closed as not
// ordered; Alpine has no order day.
const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', orderDays: [NOT_TODAY] }),
  supplier('s-bee', { name: 'Bee Farm', orderDays: [WEEKDAY] }),
  supplier('s-cat', { name: 'Cat Dairy', orderDays: [WEEKDAY] }),
  supplier('s-dee', { name: 'Dee Eggs', orderDays: [WEEKDAY] }),
  supplier('s-eve', { name: 'Eve Fish', orderDays: [WEEKDAY] }),
];
const ITEMS = [ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' })];
const PLACED = { [`${TODAY}_s-dee`]: { date: TODAY, supplierId: 's-dee', supplierName: 'Dee Eggs', quantities: { 'i-flour': 1 }, stock: {}, names: {} } };
const CLOSED = { entries: {}, days: {}, skipped: { 's-eve': TODAY } };

function seeded(extra: { draft?: Record<string, unknown> | null; records?: Record<string, Record<string, unknown>>; suppliers?: typeof SUPPLIERS } = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, records: PLACED, draft: CLOSED, ...extra });
}

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;
async function atList(source: FakeOrdersSource, options: Options = {}) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

// The supplier rows (the strip's chips are not rows), top to bottom.
const rowNames = () => Array.from(document.querySelectorAll('li[data-open]')).map(row => row.querySelector('button')?.textContent ?? '');
const rowOf = (name: string) => Array.from(document.querySelectorAll('li[data-open]')).find(row => row.textContent?.startsWith(name)) as HTMLElement;

// The list is drawn from the phone's copy of the last good lists while the live data has not landed (OrdersList `earlyLens`): the
// rows are on screen BEFORE the records and the draft, which is exactly when nobody may be lit. A first opening writes the copy.
async function withCopy(source: FakeOrdersSource) {
  await atList(seeded());
  await waitFor(() => { expect(window.localStorage.getItem('orders-list-copy')).not.toBeNull(); }, LOAD);
  cleanup();
  return atList(source);
}

describe('the suppliers to order today in the Orders list', () => {
  it('tags only the suppliers still to order, and puts them first in their usual order, the rest after them unchanged', async () => {
    await atList(seeded());
    await waitFor(() => { expect(screen.getAllByText('To order today')).toHaveLength(2); }, LOAD);
    await waitFor(() => { expect(rowNames()).toEqual([
      'Bee Farm To order today', 'Cat Dairy To order today', 'Alpine Mills', 'Dee Eggs', 'Eve Fish',
    ]); });
    // Not the one placed this morning, not the one closed as not ordered, not the one with another order day.
    for (const name of ['Alpine Mills', 'Dee Eggs', 'Eve Fish']) {
      expect(rowOf(name)).not.toHaveTextContent('To order today');
      expect(rowOf(name)).not.toHaveAttribute('data-due');
    }
    expect(rowOf('Bee Farm')).toHaveAttribute('data-due', 'true');
  });

  it('puts the tag in the row button, so it is part of its accessible name', async () => {
    await atList(seeded());
    expect(await screen.findByRole('button', { name: 'Bee Farm To order today' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cat Dairy To order today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpine Mills' })).toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    await atList(seeded(), { lang: 'it' });
    expect(await screen.findAllByText('Da ordinare oggi', undefined, LOAD)).not.toHaveLength(0);
    expect(screen.queryByText('To order today')).not.toBeInTheDocument();
  });

  it('⚠️ lights nobody and keeps the usual order until the records have arrived', async () => {
    const source = seeded({ draft: null });
    source.watchRecentHistory = () => () => undefined;
    await withCopy(source);
    expect(screen.queryByText('To order today')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy', 'Dee Eggs', 'Eve Fish']);
  });

  it('⚠️ lights nobody and keeps the usual order until the draft has arrived', async () => {
    const source = seeded();
    source.watchDraft = () => () => undefined;
    await withCopy(source);
    expect(screen.queryByText('To order today')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy', 'Dee Eggs', 'Eve Fish']);
  });

  it('a dead draft counts as arrived with no closes: the closed supplier is lit again, the safe side', async () => {
    const source = seeded();
    source.refuse.draft = true;
    await atList(source);
    await waitFor(() => { expect(screen.getAllByText('To order today')).toHaveLength(3); }, LOAD);
    expect(rowOf('Eve Fish')).toHaveAttribute('data-due', 'true');
  });

  it('a dead records stream lights nobody', async () => {
    const source = seeded();
    source.refuse.history = true;
    await atList(source);
    expect(screen.queryByText('To order today')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy', 'Dee Eggs', 'Eve Fish']);
  });

  it('never lights a switched-off supplier', async () => {
    const off = [...SUPPLIERS.slice(0, 1), supplier('s-bee', { name: 'Bee Farm', orderDays: [WEEKDAY], active: false }), ...SUPPLIERS.slice(2)];
    await atList(seeded({ suppliers: off }));
    await waitFor(() => { expect(screen.getAllByText('To order today')).toHaveLength(1); }, LOAD);
    expect(rowNames()[0]).toBe('Cat Dairy To order today');
  });

  it('follows a supplier being placed or closed on another phone, and back when it is reopened', async () => {
    const source = seeded();
    await atList(source);
    await waitFor(() => { expect(screen.getAllByText('To order today')).toHaveLength(2); }, LOAD);
    act(() => { source.remoteMerge({ skipped: { 's-bee': TODAY } }); });
    await waitFor(() => { expect(rowNames()).toEqual(['Cat Dairy To order today', 'Alpine Mills', 'Bee Farm', 'Dee Eggs', 'Eve Fish']); });
    act(() => { source.records.set(`${TODAY}_s-cat`, { date: TODAY, supplierId: 's-cat', supplierName: 'Cat', quantities: { 'i-flour': 1 }, stock: {}, names: {} }); source.emitHistory(); });
    await waitFor(() => { expect(screen.queryByText('To order today')).not.toBeInTheDocument(); });
    expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy', 'Dee Eggs', 'Eve Fish']);
  });

  it('does not redraw the rows when the draft changes without changing who is due', async () => {
    const source = seeded();
    await atList(source);
    await waitFor(() => { expect(screen.getAllByText('To order today')).toHaveLength(2); }, LOAD);
    const bee = rowOf('Bee Farm');
    act(() => { source.remoteMerge({ entries: { 'i-flour': { qty: 3 } }, days: { 's-alp': TODAY } }); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(rowOf('Bee Farm')).toBe(bee);
    expect(rowNames().slice(0, 2)).toEqual(['Bee Farm To order today', 'Cat Dairy To order today']);
  });

  // ⚠️ The FOCUSED row is the one pushed DOWN: [Alpine, Bee, Cat] with nobody due, Alpine focused; Bee becomes due and goes first, so
  // Alpine's node is the one React moves — and a moved node loses the focus in a browser. useFocusAcrossReorder hands it back (the hook
  // itself is proved against a simulated loss in shell/useFocusAcrossReorder.spec.tsx; jsdom keeps the focus of a moved node, so this
  // spec pins the behaviour of the whole list: the same node, still current, still focused).
  it('keeps the focus and the open row when the order change pushes the focused row down', async () => {
    split();
    const suppliers = [
      supplier('s-alp', { name: 'Alpine Mills', orderDays: [NOT_TODAY] }),
      supplier('s-bee', { name: 'Bee Farm', orderDays: [NOT_TODAY] }),
      supplier('s-cat', { name: 'Cat Dairy', orderDays: [NOT_TODAY] }),
    ];
    const source = fakeOrdersSource({ suppliers, ingredients: ITEMS });
    const view = renderOrders('/orders/supplier/s-alp', { source });
    await screen.findAllByRole('listitem', undefined, LOAD);
    await waitFor(() => { expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy']); }, LOAD);
    const alpine = rowOf('Alpine Mills').querySelector('button') as HTMLButtonElement;
    expect(alpine).toHaveAttribute('aria-current', 'true');
    act(() => { alpine.focus(); });
    expect(alpine).toHaveFocus();
    act(() => { source.suppliers.set('s-bee', { ...suppliers[1]!, orderDays: [WEEKDAY] }); source.emit(); });
    await waitFor(() => { expect(rowNames()).toEqual(['Bee Farm To order today', 'Alpine Mills', 'Cat Dairy']); });
    expect(rowOf('Alpine Mills').querySelector('button')).toBe(alpine);
    expect(alpine).toHaveAttribute('aria-current', 'true');
    expect(alpine).toHaveFocus();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
  });

  it('⚠️ a saved copy that lacks this morning’s record lights nobody until the SERVER answers (no flash, no jump)', async () => {
    const source = seeded({ records: {}, draft: null });
    source.historyCached = true;
    await atList(source);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(screen.queryByText('To order today')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy', 'Dee Eggs', 'Eve Fish']);
    // Bee was ordered this morning on another phone: the server's snapshot has it, and Bee never shows as due.
    source.records.set(`${TODAY}_s-bee`, { date: TODAY, supplierId: 's-bee', supplierName: 'Bee', quantities: { 'i-flour': 1 }, stock: {}, names: {} });
    source.historyCached = false;
    act(() => { source.emitHistory(); });
    await waitFor(() => { expect(screen.getAllByText('To order today')).not.toHaveLength(0); });
    expect(rowOf('Bee Farm')).not.toHaveAttribute('data-due');
    expect(rowNames()[0]).toBe('Cat Dairy To order today');
  });

  it('offline, with no word from the server for the records: nobody is lit and the usual order stays', async () => {
    const source = seeded();
    source.historyCached = true;
    await atList(source);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(screen.queryByText('To order today')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy', 'Dee Eggs', 'Eve Fish']);
  });

  it('works the lit set out again when the day changes at midnight', async () => {
    const monday = new Date(2026, 10, 9, 23, 59, 0);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(monday);
    const suppliers = [
      supplier('s-alp', { name: 'Alpine Mills', orderDays: ['Tuesday'] }),
      supplier('s-bee', { name: 'Bee Farm', orderDays: ['Monday'] }),
    ];
    await atList(fakeOrdersSource({ suppliers, ingredients: ITEMS }));
    await waitFor(() => { expect(rowNames()).toEqual(['Bee Farm To order today', 'Alpine Mills']); }, LOAD);
    vi.setSystemTime(new Date(2026, 10, 10, 0, 0, 30));
    act(() => { vi.advanceTimersByTime(60_000); });
    await waitFor(() => { expect(rowNames()).toEqual(['Alpine Mills To order today', 'Bee Farm']); });
  });
});
