// «Close as not ordered» and «Order placed…» on the order summary (the current app's PR #470, his tablet notes of 2–3 Nov 2026;
// tests/orders-close-not-ordered.test.mjs). drafts/current.skipped = { supplierId: 'YYYY-MM-DD' }: the day it was closed, and
// only that day. These pin what the summary offers, what a close writes and what it does to the list's «To order» group (the
// «Order today» strip and its chips are gone since the redesign of 16 Nov 2026: «Reopen» is reached from the supplier's row).

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

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
// The list's groups: the names of the suppliers under a group's heading.
const group = (heading: string) => {
  const title = screen.getByRole('heading', { level: 2, name: heading });
  return within(title.parentElement as HTMLElement).getAllByRole('listitem').map(item => item.querySelector('button')?.textContent ?? '');
};
const groupHeadings = () => screen.queryAllByRole('heading', { level: 2 }).map(heading => heading.textContent);

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
    expect(pane().getByText('Nothing needed today? Close it and it leaves “To order”.')).toBeInTheDocument();
    expect(pane().queryByRole('button', { name: 'Order placed…' })).not.toBeInTheDocument();
  });

  it('asks first; Cancel writes nothing and stays', async () => {
    const source = seeded();
    const view = await summaryAt(source);
    await view.user.click(await pane().findByRole('button', { name: 'Close as not ordered' }, LOAD));
    const ask = await screen.findByRole('alertdialog', { name: 'Close Alpine Mills as not ordered?' });
    expect(ask).toHaveAccessibleDescription('Nothing is ordered from them today. They leave “To order” on every device, and you can reopen them from this summary.');
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
    // The groups: Alpine is done for today and left «To order»; Bee Farm is still in it.
    await waitFor(() => { expect(group('To order')).toEqual([expect.stringMatching(/^Bee Farm/)]); }, LOAD);
    expect(group('Other suppliers').some(name => name.startsWith('Alpine Mills'))).toBe(true);
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

  it('⚠️ quantities that arrive while the question is open: nothing is closed', async () => {
    const source = seeded();
    const view = await summaryAt(source);
    await view.user.click(await pane().findByRole('button', { name: 'Close as not ordered' }, LOAD));
    const ask = await screen.findByRole('alertdialog');
    act(() => { source.remoteMerge({ entries: { 'i-flour': { qty: 2 } } }); }); // a colleague types
    await view.user.click(within(ask).getByRole('button', { name: 'Close' }));
    expect(source.skippedWrites).toEqual([]);
    expect(path(view)).toBe('/orders/supplier/s-alp/summary');
    expect(await pane().findByRole('button', { name: 'Order placed…' })).toBeInTheDocument();
  });

  it('Back from the confirm screen opened from the summary hands the focus back to its «Order placed…»', async () => {
    const view = await summaryFromList(seeded({ draft: { entries: { 'i-flour': { qty: 3 } }, days: {} } }));
    await view.user.click(await pane().findByRole('button', { name: 'Order placed…' }, LOAD));
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/confirm'); });
    await view.user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/summary'); });
    await waitFor(() => { expect(pane().getByRole('button', { name: 'Order placed…' })).toHaveFocus(); });
  });

  it('after «Reopen» the focus waits for the screen to change, then goes to «Close as not ordered»', async () => {
    const source = seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } } });
    // Real Firestore reports the reopen a moment after the tap: the fake tells its listeners only later.
    const clear = source.clearSupplierSkipped.bind(source);
    let release: () => void = () => undefined;
    source.clearSupplierSkipped = id => new Promise<void>(resolve => { release = () => { void clear(id).then(resolve); }; });
    const view = await summaryAt(source);
    await view.user.click(await pane().findByRole('button', { name: 'Reopen' }, LOAD));
    act(() => { release(); });
    const close = await pane().findByRole('button', { name: 'Close as not ordered' });
    await waitFor(() => { expect(close).toHaveFocus(); });
  });

  it('a close refused by the server is said, and Firestore puts the supplier back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded();
    source.refuseSkipped = true;
    const view = await summaryFromList(source);
    await view.user.click(await pane().findByRole('button', { name: 'Close as not ordered' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Not saved — try again in a moment.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(group('To order').some(name => name.startsWith('Alpine Mills'))).toBe(true); }, LOAD);
  });
});

describe('the «To order» group with a supplier closed as not ordered', () => {
  it('a supplier closed today leaves «To order»; one placed today leaves it too', async () => {
    renderOrders('/orders', {
      source: seeded({
        draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } },
        records: { [`${TODAY}_s-bee`]: record(TODAY, 's-bee') },
      }),
    });
    await screen.findAllByRole('listitem', undefined, LOAD);
    await waitFor(() => { expect(groupHeadings()).not.toContain('To order'); });
  });

  it('⚠️ last week\'s close never hides this week\'s order', async () => {
    renderOrders('/orders', { source: seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': LAST_WEEK } } }) });
    await waitFor(() => { expect(group('To order')[0]).toMatch(/^Alpine Mills/); }, LOAD);
  });

  it('in Italian', async () => {
    renderOrders('/orders', { source: seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } } }), lang: 'it' });
    await waitFor(() => { expect(group('Da ordinare')).toEqual([expect.stringMatching(/^Bee Farm/)]); }, LOAD);
  });
});

// The second port of this item (PR #496, closed as a duplicate of #495): what it did that the merged one did not.
describe('close as not ordered: the second port\'s extras', () => {
  // drafts/current answers only when `letIn` is called: the records and the suppliers are there, the draft is not yet.
  function draftLate(source: FakeOrdersSource): { letIn: () => void } {
    const watch = source.watchDraft.bind(source);
    const gate = { letIn: () => undefined as void };
    source.watchDraft = (onChange, onError) => {
      let stop = () => undefined as void;
      gate.letIn = () => { stop = watch(onChange, onError); };
      return () => { stop(); };
    };
    return gate;
  }
  const pause = () => act(() => new Promise<void>(resolve => { setTimeout(resolve, 100); }));

  it('⚠️ «To order» waits for the draft: a supplier closed this morning never flashes in it', async () => {
    const source = seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } } });
    const gate = draftLate(source);
    renderOrders('/orders', { source });
    await waitFor(() => { expect(source.historyFrom).not.toBeNull(); }, LOAD);
    await pause();
    expect(groupHeadings()).not.toContain('To order');
    act(() => { gate.letIn(); });
    await waitFor(() => { expect(group('To order')).toEqual([expect.stringMatching(/^Bee Farm/)]); }, LOAD);
  });

  it('⚠️ the summary offers no close and no «Reopen» over a draft stream dead from the start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded();
    source.refuse.draft = true;
    await summaryAt(source);
    await pause();
    expect(screen.queryByRole('button', { name: 'Close as not ordered' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  // «Reopen»'s door used to be the strip's chip: on the split it is the row's summary button, drawn for a supplier closed today even
  // with nothing typed; on a phone the supplier's own «Summary» (SupplierOrderScreen) — the row has no summary button there.
  it('on the split the closed supplier\'s row offers its summary, with «Reopen»; Back hands the focus to that button', async () => {
    split();
    const view = renderOrders('/orders', { source: seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } } }) });
    const door = await screen.findByRole('button', { name: 'Order summary: Alpine Mills' }, LOAD);
    // Bee Farm, still to order with nothing typed, has no summary button.
    expect(screen.queryByRole('button', { name: 'Order summary: Bee Farm' })).not.toBeInTheDocument();
    await view.user.click(door);
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/summary'); });
    expect(await pane().findByRole('button', { name: 'Reopen' }, LOAD)).toBeInTheDocument();
    await view.user.click(pane().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Order summary: Alpine Mills' })).toHaveFocus(); });
  });

  it('reopened from that summary, its button is gone: Back hands the focus to the supplier\'s row', async () => {
    split();
    const source = seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } } });
    const view = renderOrders('/orders', { source });
    await view.user.click(await screen.findByRole('button', { name: 'Order summary: Alpine Mills' }, LOAD));
    await view.user.click(await pane().findByRole('button', { name: 'Reopen' }, LOAD));
    await pane().findByRole('button', { name: 'Close as not ordered' });
    await view.user.click(pane().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    await waitFor(() => { expect(document.activeElement).toHaveAccessibleName(expect.stringMatching(/^Alpine Mills/) as string); });
    const focused = document.activeElement as HTMLElement;
    expect(focused.closest('li')?.querySelector('button')).toBe(focused);
    expect(screen.queryByRole('button', { name: 'Order summary: Alpine Mills' })).not.toBeInTheDocument();
  });

  it('⚠️ a draft stream that dies after its first answer: its closes are read as none, the list errs on the side of the reminder', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded({ draft: { entries: {}, days: {}, skipped: { 's-alp': TODAY } } });
    const watch = source.watchDraft.bind(source);
    let kill = () => undefined as void;
    source.watchDraft = (onChange, onError) => {
      kill = () => { onError(new Error('unavailable')); };
      return watch(onChange, onError);
    };
    renderOrders('/orders', { source });
    await waitFor(() => { expect(group('To order')).toEqual([expect.stringMatching(/^Bee Farm/)]); }, LOAD);
    act(() => { kill(); });
    await waitFor(() => { expect(group('To order')[0]).toMatch(/^Alpine Mills/); });
  });
});
