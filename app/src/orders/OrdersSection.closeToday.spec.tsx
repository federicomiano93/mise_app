import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders», checklist item 3 of docs/mise2-port-owed.md (8 Nov 2026): the order summary's «Order placed…», «Close as not ordered» and
// «Reopen», and a closed supplier in «Order today» — the current app's v1.143.0 (Federico's tablet notes of 2–3 Nov 2026).
//
// Ported from the view tests of tests/orders-close-not-ordered.test.mjs (the sheet's buttons, the strip's dashed chip), driven here
// through the real section with the fake source.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const WEEKDAY = (n: number): string => weekdayOf(inDays(n)) as string;

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', orderDays: [WEEKDAY(0)] }),
  supplier('s-bee', { name: 'Bee Farm', orderDays: [WEEKDAY(0)] }),
  supplier('s-cat', { name: 'Not today', orderDays: [WEEKDAY(2)] }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-honey', { name: 'Honey', supplierId: 's-bee', unit: 'kg' }),
  ingredient('i-milk', { name: 'Milk', supplierId: 's-cat', unit: 'l' }),
];

function record(date: string, supplierId: string, quantities: Record<string, number>) {
  return { date, supplierId, supplierName: supplierId, quantities, stock: {}, names: {}, createdAt: `${date}T09:12:00.000Z`, updatedAt: `${date}T09:12:00.000Z` };
}

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, draft: { entries: {}, days: {} }, ...extra });
}

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;

async function onSummary(id = 's-alp', source = seeded(), options: Options = {}, name = 'Alpine Mills') {
  const view = renderOrders(`/orders/supplier/${id}/summary`, { ...options, source });
  await screen.findByRole('heading', { level: 2, name }, LOAD);
  return view;
}

async function atList(source: FakeOrdersSource, options: Options = {}) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const closeButton = () => screen.queryByRole('button', { name: 'Close as not ordered' });
const placeButton = () => screen.queryByRole('button', { name: 'Order placed…' });
const reopenButton = () => screen.queryByRole('button', { name: 'Reopen' });

describe('the order summary — what it offers about today', () => {
  it('nothing typed and its order day today: the hint and «Close as not ordered», no «Order placed…»', async () => {
    await onSummary();
    expect(await screen.findByRole('button', { name: 'Close as not ordered' }, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Nothing needed today? Close it and it leaves “Order today”.')).toBeInTheDocument();
    expect(placeButton()).not.toBeInTheDocument();
    expect(reopenButton()).not.toBeInTheDocument();
  });

  it('with quantities: «Order placed…», never «Close as not ordered» over written quantities', async () => {
    await onSummary('s-alp', seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {} } }));
    expect(await screen.findByRole('button', { name: 'Order placed…' }, LOAD)).toBeInTheDocument();
    expect(closeButton()).not.toBeInTheDocument();
  });

  it('not its order day, or already ordered today: nothing to close', async () => {
    await onSummary('s-cat', seeded(), {}, 'Not today');
    expect(await screen.findByText('No quantities typed', undefined, LOAD)).toBeInTheDocument();
    expect(closeButton()).not.toBeInTheDocument();
    expect(reopenButton()).not.toBeInTheDocument();
  });

  it('already ordered today: nothing to close and nothing to reopen, even over a close', async () => {
    await onSummary('s-alp', seeded({
      draft: { entries: {}, skipped: { 's-alp': TODAY } },
      records: { [`${TODAY}_s-alp`]: record(TODAY, 's-alp', { 'i-flour': 1 }) },
    }));
    expect(await screen.findByText('No quantities typed', undefined, LOAD)).toBeInTheDocument();
    expect(closeButton()).not.toBeInTheDocument();
    expect(reopenButton()).not.toBeInTheDocument();
  });

  it('⚠️ offers nothing before the records have arrived: a supplier placed this morning must not be offered the close', async () => {
    const source = seeded();
    source.watchRecentHistory = () => () => undefined;
    await onSummary('s-alp', source);
    expect(await screen.findByText('No quantities typed', undefined, LOAD)).toBeInTheDocument();
    expect(closeButton()).not.toBeInTheDocument();
  });

  it('in Italian, with the current app\'s words', async () => {
    await onSummary('s-alp', seeded(), { lang: 'it' });
    expect(await screen.findByRole('button', { name: 'Chiudi come non ordinato' }, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Oggi non serve niente? Chiudilo e sparisce da “Ordina oggi”.')).toBeInTheDocument();
  });
});

describe('«Close as not ordered»', () => {
  it('asks first in Mise 2\'s own dialog; Cancel writes nothing and stays', async () => {
    const source = seeded();
    const view = await onSummary('s-alp', source);
    await view.user.click(await screen.findByRole('button', { name: 'Close as not ordered' }, LOAD));
    const dialog = await screen.findByRole('alertdialog', { name: 'Close Alpine Mills as not ordered?' });
    expect(within(dialog).getByText(/They leave “Order today” on every device/)).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.skipWrites).toEqual([]);
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
  });

  it('Close: written on its own (no autosave, no updatedAt), back to the list, said, and the chip says «not ordered»', async () => {
    const source = seeded({ draft: { entries: {}, days: {}, updatedAt: 'before' } });
    const view = await onSummary('s-alp', source);
    await view.user.click(await screen.findByRole('button', { name: 'Close as not ordered' }, LOAD));
    const dialog = await screen.findByRole('alertdialog');
    await view.user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    expect(source.skipWrites).toEqual([{ supplierId: 's-alp', day: TODAY }]);
    expect(source.writes).toEqual([]);
    expect(source.draft?.updatedAt).toBe('before');
    expect(await screen.findByText('Alpine Mills closed as not ordered.')).toBeInTheDocument();
    // The dashed chip: its visible words are its name.
    expect(await screen.findByRole('button', { name: 'Alpine Mills not ordered' }, LOAD)).toBeInTheDocument();
  });

  it('from a supplier\'s screen: Close goes back past it, to the list', async () => {
    const source = seeded();
    const view = renderOrders('/orders', { source });
    await screen.findAllByRole('listitem', undefined, LOAD);
    await view.user.click(screen.getAllByRole('button', { name: 'Alpine Mills' }).at(-1) as HTMLElement);
    await view.user.click(await screen.findByRole('button', { name: 'Summary (0)' }, LOAD));
    await view.user.click(await screen.findByRole('button', { name: 'Close as not ordered' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    // Walked back through the history, not pushed: one more Back would leave Orders, not reopen the supplier.
    expect(view.router.state.historyAction).toBe('POP');
  });

  it('a refused close comes back off the strip, and is said', async () => {
    const source = seeded();
    const view = await onSummary('s-alp', source);
    source.refuseWrites = true;
    await view.user.click(await screen.findByRole('button', { name: 'Close as not ordered' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Not saved — try again in a moment.', undefined, LOAD)).toBeInTheDocument();
    expect(source.draft?.skipped).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Alpine Mills not ordered' })).not.toBeInTheDocument();
  });
});

describe('«Order today» with a closed supplier', () => {
  it('a closed chip is a dashed button that opens the summary, where «Reopen» puts it back with no question', async () => {
    const source = seeded({ draft: { entries: {}, skipped: { 's-alp': TODAY } } });
    const view = await atList(source);
    const chip = await screen.findByRole('button', { name: 'Alpine Mills not ordered' }, LOAD);
    await view.user.click(chip);
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/summary'); });
    expect(await screen.findByText('Closed as not ordered today', undefined, LOAD)).toBeInTheDocument();
    const reopen = screen.getByRole('button', { name: 'Reopen' });
    await view.user.click(reopen);
    expect(source.skipWrites).toEqual([{ supplierId: 's-alp', day: null }]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Alpine Mills is back on today’s orders.')).toBeInTheDocument();
    // The summary stays, now offering the close again — and the focus is on it, never dropped on the page.
    const close = await screen.findByRole('button', { name: 'Close as not ordered' });
    await waitFor(() => { expect(close).toHaveFocus(); });
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
  });

  it('a close from another day means nothing today: an ordinary chip', async () => {
    await atList(seeded({ draft: { entries: {}, skipped: { 's-alp': inDays(-7) } } }));
    await screen.findByText('Order today', undefined, LOAD);
    expect(screen.queryByRole('button', { name: 'Alpine Mills not ordered' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Alpine Mills' })).toHaveLength(2);
  });

  it('⚠️ «all placed» only when every one was PLACED: one placed and one closed keep the chips', async () => {
    await atList(seeded({
      draft: { entries: {}, skipped: { 's-bee': TODAY } },
      records: { [`${TODAY}_s-alp`]: record(TODAY, 's-alp', { 'i-flour': 1 }) },
    }));
    expect(await screen.findByText('Order today', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Today’s orders are all placed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bee Farm not ordered' })).toBeInTheDocument();
  });

  it('a real order recorded after the close wins: placed, not «not ordered»', async () => {
    await atList(seeded({
      suppliers: [SUPPLIERS[0] as (typeof SUPPLIERS)[number]],
      draft: { entries: {}, skipped: { 's-alp': TODAY } },
      records: { [`${TODAY}_s-alp`]: record(TODAY, 's-alp', { 'i-flour': 1 }) },
    }));
    expect(await screen.findByText('Today’s orders are all placed', undefined, LOAD)).toBeInTheDocument();
  });

  it('a close made on another phone shows on the strip at once', async () => {
    const source = seeded();
    await atList(source);
    await screen.findByText('Order today', undefined, LOAD);
    source.remoteMerge({ skipped: { 's-bee': TODAY } });
    expect(await screen.findByRole('button', { name: 'Bee Farm not ordered' }, LOAD)).toBeInTheDocument();
  });

  it('⚠️ typing a quantity for a supplier closed today reopens it', async () => {
    const source = seeded({ draft: { entries: {}, skipped: { 's-alp': TODAY } } });
    const view = renderOrders('/orders/supplier/s-alp', { source });
    const [box] = await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.type(box as HTMLElement, '2');
    await waitFor(() => { expect(source.skipWrites).toEqual([{ supplierId: 's-alp', day: null }]); });
    expect(source.draft?.skipped).toEqual({});
  });
});

describe('«Order placed…» on the summary', () => {
  it('opens the supplier\'s own confirm screen on top of the summary; Back comes back to it', async () => {
    const view = await onSummary('s-alp', seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {} } }));
    await view.user.click(await screen.findByRole('button', { name: 'Order placed…' }, LOAD));
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/confirm'); });
    await screen.findByRole('button', { name: 'Order placed' }, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/summary'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Order placed…' })).toHaveFocus(); });
  });

  it('a closed supplier given quantities on another phone shows both the close and «Order placed…»', async () => {
    await onSummary('s-alp', seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, skipped: { 's-alp': TODAY } } }));
    expect(await screen.findByRole('button', { name: 'Reopen' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Order placed…' })).toBeInTheDocument();
  });

  it('offline it says so and opens nothing, as on the supplier\'s screen', async () => {
    const view = await onSummary('s-alp', seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {} } }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await view.user.click(await screen.findByRole('button', { name: 'Order placed…' }, LOAD));
    expect(await screen.findByText('You’re offline — reconnect to record this order.')).toBeInTheDocument();
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
  });

  it('on the split, a placed order from a summary opened from the list goes back to the list', async () => {
    split();
    const source = seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {} } });
    const view = await atList(source);
    await view.user.click(await screen.findByRole('button', { name: 'Order summary: Alpine Mills' }, LOAD));
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/summary'); });
    await view.user.click(await screen.findByRole('button', { name: 'Order placed…' }, LOAD));
    await view.user.click(await screen.findByRole('button', { name: 'Order placed' }, LOAD));
    await view.user.click(await screen.findByRole('button', { name: /^Yes/ }, LOAD));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    await waitFor(() => { expect(source.records.has(`${TODAY}_s-alp`)).toBe(true); });
  });
});
