// «Close as not ordered» and «Order placed…» on the order summary (the current app's PR #470, his tablet notes of 2–3 Nov 2026;
// tests/orders-close-not-ordered.test.mjs). drafts/current.skipped = { supplierId: 'YYYY-MM-DD' }: the day it was closed, and
// only that day. These pin what the summary offers, what a close writes and what it does to «Order today».

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = todayISO();
const LAST_WEEK = toISODate(addDays(parseISODate(TODAY), -7));
const TODAY_WEEKDAY = weekdayOf(TODAY) as string;
const OTHER_WEEKDAY = weekdayOf(toISODate(addDays(parseISODate(TODAY), 2))) as string;

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', orderDays: [TODAY_WEEKDAY] }),
  supplier('s-bee', { name: 'Bee Farm', orderDays: [TODAY_WEEKDAY] }),
  supplier('s-cat', { name: 'Cat Foods', orderDays: [OTHER_WEEKDAY] }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', supplierId: 's-alp' }),
  ingredient('i-honey', { name: 'Honey', supplierId: 's-bee' }),
  ingredient('i-food', { name: 'Food', supplierId: 's-cat' }),
];

function record(date: string, supplierId: string) {
  return { date, supplierId, supplierName: supplierId, quantities: { 'i-flour': 1 }, stock: {}, names: {}, createdAt: `${date}T09:12:00.000Z`, updatedAt: `${date}T09:12:00.000Z` };
}

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, draft: { entries: {}, days: {} }, ...extra });
}

type View = ReturnType<typeof renderOrders>;
const path = (view: View) => view.router.state.location.pathname;
const pane = (name = 'Alpine Mills') => within(screen.getByRole('region', { name }));

// The summary opened from the list (its row's summary door is the list's), so the list is the entry behind it.
async function summaryFromList(source: FakeOrdersSource, id = 's-alp', name = 'Alpine Mills') {
  const view = renderOrders('/orders', { source });
  await screen.findAllByRole('listitem', undefined, LOAD);
  await view.router.navigate(`/orders/supplier/${id}/summary`, { state: { keepFocus: true, fromList: true } });
  await screen.findByRole('heading', { level: 2, name }, LOAD);
  return view;
}

async function summaryAt(source: FakeOrdersSource, id = 's-alp', name = 'Alpine Mills') {
  const view = renderOrders(`/orders/supplier/${id}/summary`, { source });
  await screen.findByRole('heading', { level: 2, name }, LOAD);
  return view;
}

describe('the order summary: today\'s order', () => {
  it('with nothing written and the order day today, offers «Close as not ordered» with its hint, and no «Order placed…»', async () => {
    await summaryAt(seeded());
    expect(await pane().findByRole('button', { name: 'Close as not ordered' }, LOAD)).toBeInTheDocument();
    expect(pane().getByText('Nothing needed today? Close it and it leaves “Order today”.')).toBeInTheDocument();
    expect(pane().queryByRole('button', { name: 'Order placed…' })).not.toBeInTheDocument();
  });

  it('asks first; Cancel writes nothing and stays', async () => {
    const source = seeded();
    const view = await summaryAt(source);
    await view.user.click(await pane().findByRole('button', { name: 'Close as not ordered' }, LOAD));
    const ask = await screen.findByRole('alertdialog', { name: 'Close Alpine Mills as not ordered?' });
    expect(ask).toHaveAccessibleDescription('Nothing is ordered from them today. They leave “Order today” on every device, and you can reopen them from this summary.');
    await view.user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(source.skippedWrites).toEqual([]);
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
  });

  it('Close writes today\'s close on its own (never through the autosave, no updatedAt), says so and goes back to the list, where the chip says «not ordered»', async () => {
    const source = seeded();
    const view = await summaryFromList(source);
    await view.user.click(await pane().findByRole('button', { name: 'Close as not ordered' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close' }));

    expect(source.skippedWrites).toEqual([{ op: 'set', supplierId: 's-alp', day: TODAY }]);
    expect(source.writes).toEqual([]); // nothing went through the autosave
    expect(source.draft?.skipped).toEqual({ 's-alp': TODAY });
    expect(source.draft?.updatedAt).toBeUndefined();
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    expect(await screen.findByText('Alpine Mills closed as not ordered.')).toBeInTheDocument();
    // The strip: Alpine is done for today (its chip opens the summary), Bee Farm is still to order.
    const chip = await screen.findByRole('button', { name: 'Alpine Mills · not ordered' }, LOAD);
    expect(screen.getByText('Order today')).toBeInTheDocument();
    await view.user.click(chip);
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/summary'); });
  });

  it('a closed supplier shows the state and «Reopen»; Reopen takes only its key away and offers the close again', async () => {
    const source = seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY, 's-bee': TODAY } } });
    const view = await summaryAt(source);
    expect(await pane().findByText('Closed as not ordered today', undefined, LOAD)).toBeInTheDocument();
    expect(pane().queryByRole('button', { name: 'Close as not ordered' })).not.toBeInTheDocument();
    await view.user.click(pane().getByRole('button', { name: 'Reopen' }));
    expect(source.skippedWrites).toEqual([{ op: 'clear', supplierId: 's-alp' }]);
    expect(source.draft?.skipped).toEqual({ 's-bee': TODAY });
    expect(await screen.findByText('Alpine Mills is back on today’s orders.')).toBeInTheDocument();
    const close = await pane().findByRole('button', { name: 'Close as not ordered' });
    await waitFor(() => { expect(close).toHaveFocus(); }); // the focus goes to what took «Reopen»'s place
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
  });

  it('with quantities written offers «Order placed…» (the supplier screen\'s own confirm), never «not ordered»', async () => {
    const source = seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {} } });
    const view = await summaryFromList(source);
    const place = await pane().findByRole('button', { name: 'Order placed…' }, LOAD);
    expect(pane().queryByRole('button', { name: 'Close as not ordered' })).not.toBeInTheDocument();
    await view.user.click(place);
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/confirm'); });
    // A recorded order goes back to the LIST, two entries behind the confirm screen.
    expect(view.router.state.location.state).toMatchObject({ fromList: true, toList: 2 });
  });

  it('closed and then given quantities: both the state with «Reopen» and «Order placed…»', async () => {
    await summaryAt(seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {}, skipped: { 's-alp': TODAY } } }));
    expect(await pane().findByRole('button', { name: 'Reopen' }, LOAD)).toBeInTheDocument();
    expect(pane().getByRole('button', { name: 'Order placed…' })).toBeInTheDocument();
  });

  it('offline, «Order placed…» says so and opens nothing', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const view = await summaryAt(seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {} } }));
    await view.user.click(await pane().findByRole('button', { name: 'Order placed…' }, LOAD));
    expect(await screen.findByText('You’re offline — reconnect to record this order.')).toBeInTheDocument();
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
  });

  it('nothing to offer when it is not the order day, or the order is already placed today', async () => {
    await summaryAt(seeded(), 's-cat', 'Cat Foods');
    expect(await screen.findByText('No quantities typed', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close as not ordered' })).not.toBeInTheDocument();
  });

  it('already placed today: no close and no reopen, even with a close stored', async () => {
    await summaryAt(seeded({
      draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } },
      records: { [`${TODAY}_s-alp`]: record(TODAY, 's-alp') },
    }));
    await screen.findByText('No quantities typed', undefined, LOAD);
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close as not ordered' })).not.toBeInTheDocument();
  });

  it('a close refused by the server is said, and Firestore puts the supplier back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded();
    source.refuseSkipped = true;
    const view = await summaryFromList(source);
    await view.user.click(await pane().findByRole('button', { name: 'Close as not ordered' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Not saved — check the connection and try again.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Alpine Mills · not ordered' })).not.toBeInTheDocument(); });
  });
});

describe('«Order today» with a supplier closed as not ordered', () => {
  it('every supplier of the day placed or closed: «all placed»', async () => {
    renderOrders('/orders', {
      source: seeded({
        draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } },
        records: { [`${TODAY}_s-bee`]: record(TODAY, 's-bee') },
      }),
    });
    expect(await screen.findByText('Today’s orders are all placed', undefined, LOAD)).toBeInTheDocument();
  });

  it('⚠️ last week\'s close never hides this week\'s order', async () => {
    renderOrders('/orders', { source: seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': LAST_WEEK } } }) });
    await screen.findByText('Order today', undefined, LOAD);
    expect(screen.queryByRole('button', { name: 'Alpine Mills · not ordered' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Alpine Mills' }).length).toBeGreaterThanOrEqual(2);
  });

  it('in Italian', async () => {
    renderOrders('/orders', { source: seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } } }), lang: 'it' });
    expect(await screen.findByRole('button', { name: 'Alpine Mills · non ordinato' }, LOAD)).toBeInTheDocument();
  });
});
