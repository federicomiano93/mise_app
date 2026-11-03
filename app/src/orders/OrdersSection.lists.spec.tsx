import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», step 3f-7 slice A: the door to the order lists, the lists, and one list open (ticks, Finish, delete, the hand-off to
// «Order placed»). Sending a list and the mute switch come with slice B.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;

const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills', active: true })];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
];

// A list as the database holds it. `createdAt` decides the order of the waiting ones (newest first).
function list(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: TODAY,
    fromUid: 'u-1',
    fromName: 'Marco',
    quantities: { 'i-flour': 4, 'i-rye': 2 },
    names: { 'i-flour': 'Flour', 'i-rye': 'Rye' },
    supplierOf: { 'i-flour': 's-alp', 'i-rye': 's-alp' },
    supplierNames: { 's-alp': 'Alpine Mills' },
    done: {},
    note: '',
    createdAt: `${TODAY}T10:00:00.000Z`,
    updatedAt: `${TODAY}T10:00:00.000Z`,
    ...extra,
  };
}

const WAITING_NEW = list({ fromName: 'Marco', createdAt: `${TODAY}T11:00:00.000Z` });
const WAITING_OLDER = list({ fromName: 'Elena', createdAt: `${TODAY}T09:00:00.000Z` });
// Finished, and sent by somebody with no name on the roster: ⚠️ never an address, always «Someone».
const FINISHED = list({ fromName: '', done: { 'i-flour': true, 'i-rye': true }, createdAt: `${TODAY}T08:00:00.000Z` });
const OLD = list({ fromName: 'Giulia', date: inDays(-20), createdAt: `${inDays(-20)}T09:00:00.000Z` });

function seeded(requests: Record<string, Record<string, unknown>> = {}, extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, requests, ...extra });
}

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;
const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const lists = () => within(screen.getByRole('region', { name: 'Order lists' }));
const one = () => within(screen.getByRole('region', { name: 'Order list' }));
const cardNames = () => lists().getAllByRole('listitem').map(item => item.textContent ?? '');
const door = (name: string | RegExp = /^Order lists/) => screen.findByRole('button', { name }, LOAD);

async function atList(source: FakeOrdersSource, options: Options = {}) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

async function atLists(source: FakeOrdersSource, options: Options = {}) {
  const view = renderOrders('/orders/lists', { source, ...options });
  await screen.findByRole('region', { name: 'Order lists' }, LOAD);
  return view;
}

async function atOne(source: FakeOrdersSource, id: string, options: Options = {}) {
  const view = renderOrders(`/orders/lists/${id}`, { source, ...options });
  await screen.findByRole('region', { name: 'Order list' }, LOAD);
  return view;
}

const confirmation = () => screen.findByRole('alertdialog', undefined, LOAD);

describe('the door', () => {
  it('is on the list with NOTHING waiting: a button that comes and goes is a button nobody can find', async () => {
    await atList(seeded());
    expect(await door('Order lists')).toBeInTheDocument();
    expect(within(await door('Order lists')).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('is on the list for a person who cannot manage the place: everybody who sends a list must see one', async () => {
    await atList(seeded({ 'r-1': WAITING_NEW }), STAFF);
    expect(await door()).toBeInTheDocument();
  });

  it('is hidden only when the venue turned order lists off', async () => {
    await atList(seeded({ 'r-1': WAITING_NEW }, { ordersConfig: { orderLists: false } }));
    expect(screen.queryByRole('button', { name: /^Order lists/ })).not.toBeInTheDocument();
  });

  it('does not depend on the goods-arrived switch', async () => {
    await atList(seeded({}, { ordersConfig: { deliveryCheck: false } }));
    expect(await door('Order lists')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Incoming' })).not.toBeInTheDocument();
  });

  it('counts only the lists still waiting, on a badge, and says it for a screen reader', async () => {
    await atList(seeded({ 'r-1': WAITING_NEW, 'r-2': WAITING_OLDER, 'r-3': FINISHED }));
    const button = await door('Order lists: 2 order lists to place');
    expect(within(button).getByText('2')).toBeInTheDocument();
  });

  it('says «1 order list to place» in the singular', async () => {
    await atList(seeded({ 'r-1': WAITING_NEW, 'r-3': FINISHED }));
    expect(await door('Order lists: 1 order list to place')).toBeInTheDocument();
  });

  it('opens the lists one level down', async () => {
    const view = await atList(seeded({ 'r-1': WAITING_NEW }));
    await view.user.click(await door());
    await screen.findByRole('region', { name: 'Order lists' }, LOAD);
    expect(path(view)).toBe('/orders/lists');
  });

  it('gives the focus back to the door when Back returns to the list', async () => {
    const view = await atList(seeded({ 'r-1': WAITING_NEW }));
    const button = await door();
    await view.user.click(button);
    await screen.findByRole('region', { name: 'Order lists' }, LOAD);
    await view.user.click(lists().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    await waitFor(() => { expect(button).toHaveFocus(); });
  });

  // ⚠️ PARITY CP2: while the list is drawn from the local copy of the last good lists, the doors that open anything are shut.
  it('is shut while the list is drawn from the local copy: the tap says the wait, nothing opens', async () => {
    const copy = { suppliers: SUPPLIERS, ingredients: ITEMS };
    window.localStorage.clear();
    const { writeListCopy } = await import('@mise/shared/list-copy');
    writeListCopy('bakery', copy.suppliers, copy.ingredients, window.localStorage);
    const source = seeded({ 'r-1': WAITING_NEW });
    const waiting: Array<() => void> = [];
    let released = false;
    const loose = source as unknown as Record<string, (...args: unknown[]) => () => void>;
    for (const name of ['watchSuppliers', 'watchIngredients', 'watchDraft']) {
      const original = (loose[name] as (...args: unknown[]) => () => void).bind(source);
      loose[name] = (onChange, onError) => {
        if (released) return original(onChange, onError);
        let stop: (() => void) | undefined;
        waiting.push(() => { stop = original(onChange, onError); });
        return () => { stop?.(); };
      };
    }
    const view = renderOrders('/orders', { source });
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    await view.user.click(await door());
    expect(path(view)).toBe('/orders');
    expect(await screen.findByText('Just a moment: loading the latest data.')).toBeInTheDocument();
    released = true;
    await act(async () => { waiting.splice(0).forEach(start => { start(); }); await Promise.resolve(); });
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(path(view)).toBe('/orders');
    await view.user.click(await door());
    await waitFor(() => { expect(path(view)).toBe('/orders/lists'); });
    window.localStorage.clear();
  });
});

describe('the lists', () => {
  it('puts the lists still waiting first, newest first, and the finished ones after them', async () => {
    await atLists(seeded({ 'r-3': FINISHED, 'r-2': WAITING_OLDER, 'r-1': WAITING_NEW }));
    const names = cardNames();
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^From Marco.*Today.*0 of 2/);
    expect(names[1]).toMatch(/^From Elena/);
    expect(names[2]).toMatch(/^From Someone.*All ordered/);
  });

  it('says «Someone» for a list with no name, never an address', async () => {
    await atLists(seeded({ 'r-3': { ...FINISHED, fromName: undefined, fromEmail: 'boss@example.test' } }));
    const [card] = cardNames();
    expect(card).toMatch(/^From Someone/);
    expect(document.body.textContent).not.toContain('boss@example.test');
  });

  it('⚠️ an address stored by the current app is never printed: «@» in the name reads «Someone», a real name stays', async () => {
    await atLists(seeded({
      'r-1': list({ fromName: 'marco@example.com', createdAt: `${TODAY}T11:00:00.000Z` }),
      'r-2': list({ fromName: 'Marco Rossi', createdAt: `${TODAY}T09:00:00.000Z` }),
    }));
    const names = cardNames();
    expect(names[0]).toMatch(/^From Someone/);
    expect(names[1]).toMatch(/^From Marco Rossi/);
    expect(document.body.textContent).not.toContain('marco@example.com');
  });

  it('counts the ticked lines in the progress', async () => {
    await atLists(seeded({ 'r-1': list({ done: { 'i-flour': true } }) }));
    expect(cardNames()[0]).toMatch(/1 of 2/);
  });

  it('parks the lists older than 15 days behind a button that says how many, and reveals them', async () => {
    const view = await atLists(seeded({ 'r-1': WAITING_NEW, 'r-old': OLD }));
    expect(cardNames()).toHaveLength(1);
    await view.user.click(lists().getByRole('button', { name: 'Show older lists (1)' }));
    expect(cardNames().some(name => name.startsWith('From Giulia'))).toBe(true);
    expect(lists().queryByRole('button', { name: /Show older lists/ })).not.toBeInTheDocument();
  });

  it('says what it is when nobody ever sent a list, and how to send one', async () => {
    await atLists(seeded());
    expect(lists().getByText('Nobody has sent an order list yet.')).toBeInTheDocument();
    expect(lists().getByText(/tap the Send arrow at the top/)).toBeInTheDocument();
  });

  it('says it differently when there are lists, but none in the last days — and keeps the older ones one tap away', async () => {
    await atLists(seeded({ 'r-old': OLD }));
    expect(lists().getByText('No lists in the last 15 days')).toBeInTheDocument();
    expect(lists().queryByText('Nobody has sent an order list yet.')).not.toBeInTheDocument();
    expect(lists().getByRole('button', { name: 'Show older lists (1)' })).toBeInTheDocument();
  });

  it('says «Loading…», never «Nobody has sent one», until the lists have answered', async () => {
    const source = seeded();
    source.watchOrderRequests = () => () => undefined;
    renderOrders('/orders/lists', { source });
    await screen.findByRole('region', { name: 'Order lists' }, LOAD);
    expect(lists().getByText('Loading…')).toBeInTheDocument();
    expect(lists().queryByText('Nobody has sent an order list yet.')).not.toBeInTheDocument();
  });

  it('says on the page that the lists were lost when their stream dies, and not that nobody sent one', async () => {
    const source = seeded();
    source.refuse.requests = true;
    await atLists(source);
    expect(await screen.findByText(/Lost the live connection for order lists/, undefined, LOAD)).toBeInTheDocument();
    expect(lists().queryByText('Nobody has sent an order list yet.')).not.toBeInTheDocument();
  });

  it('opens a list with the card, and Back gives the focus to that card', async () => {
    const view = await atLists(seeded({ 'r-1': WAITING_NEW }));
    const card = lists().getByRole('button', { name: /^From Marco/ });
    await view.user.click(card);
    await screen.findByRole('region', { name: 'Order list' }, LOAD);
    expect(path(view)).toBe('/orders/lists/r-1');
    await view.user.click(one().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/lists'); });
    await waitFor(() => { expect(lists().getByRole('button', { name: /^From Marco/ })).toHaveFocus(); });
  });

  it('keeps the older lists that were asked for while one list is open over it', async () => {
    const view = await atLists(seeded({ 'r-old': OLD, 'r-1': WAITING_NEW }));
    await view.user.click(lists().getByRole('button', { name: 'Show older lists (1)' }));
    await view.user.click(lists().getByRole('button', { name: /^From Giulia/ }));
    await screen.findByRole('region', { name: 'Order list' }, LOAD);
    await view.user.click(one().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(lists().getByRole('button', { name: /^From Giulia/ })).toBeInTheDocument(); });
  });
});

describe('one list', () => {
  it('shows the sender, the day, the note and the lines under their suppliers with a count', async () => {
    await atOne(seeded({ 'r-1': list({ note: 'Back door, before nine' }) }), 'r-1');
    expect(one().getByText('From Marco')).toBeInTheDocument();
    expect(one().getByText('Today')).toBeInTheDocument();
    expect(one().getByText('Note')).toBeInTheDocument();
    expect(one().getByText('Back door, before nine')).toBeInTheDocument();
    expect(one().getByRole('heading', { level: 3, name: 'Alpine Mills' })).toBeInTheDocument();
    expect(one().getByText('0 of 2')).toBeInTheDocument();
    expect(one().getByRole('checkbox', { name: /^Flour/ })).not.toBeChecked();
  });

  it('says «Someone» for a list with no name', async () => {
    await atOne(seeded({ 'r-1': list({ fromName: '' }) }), 'r-1');
    expect(one().getByText('From Someone')).toBeInTheDocument();
  });

  it('writes one key when a line is ticked, and the box follows what the database holds', async () => {
    const source = seeded({ 'r-1': list() });
    const view = await atOne(source, 'r-1');
    await view.user.click(one().getByRole('checkbox', { name: /^Flour/ }));
    await waitFor(() => { expect(one().getByRole('checkbox', { name: /^Flour/ })).toBeChecked(); });
    expect(source.ticks).toStrictEqual([{ id: 'r-1', done: { 'i-flour': true }, updatedAt: expect.any(String) as string }]);
    expect(one().getByRole('checkbox', { name: /^Rye/ })).not.toBeChecked();
    expect(one().getByText('1 of 2')).toBeInTheDocument();
  });

  it('un-ticks a line the same way', async () => {
    const source = seeded({ 'r-1': list({ done: { 'i-flour': true } }) });
    const view = await atOne(source, 'r-1');
    await view.user.click(one().getByRole('checkbox', { name: /^Flour/ }));
    await waitFor(() => { expect(one().getByRole('checkbox', { name: /^Flour/ })).not.toBeChecked(); });
    expect(source.ticks[0]?.done).toStrictEqual({ 'i-flour': false });
  });

  it('shows a tick another phone made without any action here', async () => {
    const source = seeded({ 'r-1': list() });
    await atOne(source, 'r-1');
    act(() => {
      source.requests.set('r-1', list({ done: { 'i-rye': true } }));
      source.emitRequests();
    });
    await waitFor(() => { expect(one().getByRole('checkbox', { name: /^Rye/ })).toBeChecked(); });
  });

  it('puts the box back and SAYS so when the tick is refused', async () => {
    const source = seeded({ 'r-1': list() });
    const view = await atOne(source, 'r-1');
    source.failRequest = true;
    await view.user.click(one().getByRole('checkbox', { name: /^Flour/ }));
    expect(await screen.findByText('The tick was NOT saved — check the connection.')).toBeInTheDocument();
    await waitFor(() => { expect(one().getByRole('checkbox', { name: /^Flour/ })).not.toBeChecked(); });
  });

  it('Finish asks first, saying how many lines are left, and ticks them all in ONE write', async () => {
    const source = seeded({ 'r-1': list({ done: { 'i-flour': true } }) });
    const view = await atOne(source, 'r-1');
    await view.user.click(one().getByRole('button', { name: 'Finish' }));
    const dialog = within(await confirmation());
    expect(dialog.getByText('Finish this list?')).toBeInTheDocument();
    expect(dialog.getByText('One line has not been ticked. Finishing ticks it too.')).toBeInTheDocument();
    expect(source.ticks).toHaveLength(0);
    await view.user.click(dialog.getByRole('button', { name: 'Finish' }));
    await waitFor(() => { expect(source.ticks).toHaveLength(1); });
    expect(source.ticks[0]?.done).toStrictEqual({ 'i-rye': true });
    await waitFor(() => { expect(one().queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument(); });
    expect(one().getByText('All ordered')).toBeInTheDocument();
  });

  it('Cancel on the Finish question writes nothing', async () => {
    const source = seeded({ 'r-1': list() });
    const view = await atOne(source, 'r-1');
    await view.user.click(one().getByRole('button', { name: 'Finish' }));
    await view.user.click(within(await confirmation()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.ticks).toHaveLength(0);
  });

  it('offers no Finish once every line is ticked', async () => {
    await atOne(seeded({ 'r-1': FINISHED }), 'r-1');
    expect(one().queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it('offers Delete to whoever manages the place, asks first, and steps back to the lists', async () => {
    const source = seeded({ 'r-1': list() });
    const view = renderOrders('/orders/lists', { source });
    await view.user.click(await screen.findByRole('button', { name: /^From Marco/ }, LOAD));
    await screen.findByRole('region', { name: 'Order list' }, LOAD);
    await view.user.click(one().getByRole('button', { name: 'Delete this list' }));
    const dialog = within(await confirmation());
    expect(dialog.getByText('Delete this list?')).toBeInTheDocument();
    await view.user.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(source.requests.has('r-1')).toBe(false); });
    await waitFor(() => { expect(path(view)).toBe('/orders/lists'); });
  });

  it('writes nothing when the Delete question is cancelled', async () => {
    const source = seeded({ 'r-1': list() });
    const view = await atOne(source, 'r-1');
    await view.user.click(one().getByRole('button', { name: 'Delete this list' }));
    await view.user.click(within(await confirmation()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.requests.has('r-1')).toBe(true);
  });

  it('⚠️ a refused delete has already left: the list is back on the lists screen, and the sentence is said there', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded({ 'r-1': list() });
    const view = await atOne(source, 'r-1');
    await view.user.click(one().getByRole('button', { name: 'Delete this list' }));
    source.failRequest = true;
    await view.user.click(within(await confirmation()).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Not deleted — the list is still here.')).toBeInTheDocument();
    await waitFor(() => { expect(path(view)).toBe('/orders/lists'); });
    expect(source.requests.has('r-1')).toBe(true);
    await screen.findByRole('region', { name: 'Order lists' }, LOAD);
    expect(await lists().findByRole('button', { name: /^From Marco/ })).toBeInTheDocument();
  });

  it('⚠️ a delete still in the air leaves at once, with no «Loading…», and nothing moves again when it lands', async () => {
    const source = seeded({ 'r-1': list() });
    const view = await atOne(source, 'r-1');
    await view.user.click(one().getByRole('button', { name: 'Delete this list' }));
    const release = source.holdWrites();
    await view.user.click(within(await confirmation()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/lists'); });
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    // The person goes on to the Orders list before the server answers: the answer moves nobody.
    await screen.findByRole('region', { name: 'Order lists' }, LOAD);
    await view.user.click(lists().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    release();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(path(view)).toBe('/orders');
    expect(source.requests.has('r-1')).toBe(false);
    expect(screen.queryByText('Not deleted — the list is still here.')).not.toBeInTheDocument();
  });

  it('draws no Delete for a person who cannot manage the place', async () => {
    await atOne(seeded({ 'r-1': list() }), 'r-1', STAFF);
    expect(one().getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    expect(one().queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('steps back to the lists when an address names a list nobody sent', async () => {
    const view = renderOrders('/orders/lists/nope', { source: seeded({ 'r-1': list() }) });
    await waitFor(() => { expect(path(view)).toBe('/orders/lists'); }, LOAD);
  });

  it('steps back to the lists when the list is deleted elsewhere while it is open', async () => {
    const source = seeded({ 'r-1': list() });
    const view = renderOrders('/orders/lists', { source });
    await view.user.click(await screen.findByRole('button', { name: /^From Marco/ }, LOAD));
    await screen.findByRole('region', { name: 'Order list' }, LOAD);
    act(() => {
      source.requests.delete('r-1');
      source.emitRequests();
    });
    await waitFor(() => { expect(path(view)).toBe('/orders/lists'); });
    expect(screen.queryByRole('region', { name: 'Order list' })).not.toBeInTheDocument();
  });
});

describe('one list, against the order that moved on', () => {
  it('says the shared order changed where a line not yet ordered now differs, with its number', async () => {
    const draft = { entries: { 'i-flour': { qty: 6 }, 'i-rye': { qty: 2 } }, days: {} };
    await atOne(seeded({ 'r-1': list() }, { draft }), 'r-1');
    expect(await one().findByText('These amounts have changed in the shared order since this list was sent.')).toBeInTheDocument();
    expect(one().getByText('now in the list: 6')).toBeInTheDocument();
    expect(one().getAllByText(/^now in the list/)).toHaveLength(1);
  });

  it('prints the unit only when the order now holds it in another one', async () => {
    const draft = { entries: { 'i-flour': { qty: 2, unit: 'bags' }, 'i-rye': { qty: 2 } }, days: {} };
    await atOne(seeded({ 'r-1': list() }, { draft }), 'r-1');
    expect(await one().findByText('now in the list: 2 × bags')).toBeInTheDocument();
  });

  it('says nothing about a line ticked, and the sentence goes with it', async () => {
    const draft = { entries: { 'i-flour': { qty: 0 }, 'i-rye': { qty: 2 } }, days: {} };
    await atOne(seeded({ 'r-1': list({ done: { 'i-flour': true } }) }, { draft }), 'r-1');
    await one().findByText('1 of 2');
    expect(one().queryByText(/^now in the list/)).not.toBeInTheDocument();
    expect(one().queryByText('These amounts have changed in the shared order since this list was sent.')).not.toBeInTheDocument();
  });

  it('says how many were really ordered where it differs from what was asked — and not «now in the list: 0» on that line', async () => {
    const record = {
      date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 3 }, stock: {}, names: {},
      createdAt: `${TODAY}T12:00:00.000Z`, updatedAt: `${TODAY}T12:00:00.000Z`,
    };
    const draft = { entries: { 'i-flour': { qty: 0 }, 'i-rye': { qty: 2 } }, days: {} };
    await atOne(seeded({ 'r-1': list() }, { draft, records: { [`${TODAY}_s-alp`]: record } }), 'r-1');
    expect(await one().findByText('ordered: 3')).toBeInTheDocument();
    expect(one().queryByText(/^now in the list/)).not.toBeInTheDocument();
  });

  it('⚠️ sees an order that only the older orders already loaded hold: «ordered: n», and no «now in the list» on that line', async () => {
    const day = inDays(-90);
    const record = {
      date: day, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 3 }, stock: {}, names: {},
      createdAt: `${day}T12:00:00.000Z`, updatedAt: `${day}T12:00:00.000Z`,
    };
    const draft = { entries: { 'i-flour': { qty: 0 }, 'i-rye': { qty: 2 } }, days: {} };
    const source = seeded({ 'r-1': list({ date: day, createdAt: `${day}T09:00:00.000Z` }) }, { draft, records: { [`${day}_s-alp`]: record } });
    const view = renderOrders('/orders/history', { source });
    const history = within(await screen.findByRole('region', { name: 'Past orders' }, LOAD));
    await view.user.click(await history.findByRole('button', { name: 'Load older orders' }, LOAD));
    await waitFor(() => { expect(history.queryByRole('button', { name: 'Load older orders' })).not.toBeInTheDocument(); });
    await act(async () => { await view.router.navigate('/orders/lists/r-1'); });
    await screen.findByRole('region', { name: 'Order list' }, LOAD);
    expect(await one().findByText('ordered: 3')).toBeInTheDocument();
    expect(one().queryByText(/^now in the list/)).not.toBeInTheDocument();
  });
});

describe('«Mark as placed»', () => {
  it('is offered under a supplier whose lines are ALL ticked, and not before', async () => {
    await atOne(seeded({ 'r-1': list({ done: { 'i-flour': true } }) }), 'r-1');
    expect(one().queryByRole('button', { name: /^Mark as placed/ })).not.toBeInTheDocument();
  });

  it('opens that supplier’s confirm screen, which brings a recorded order back to this list', async () => {
    const draft = { entries: { 'i-flour': { qty: 4 }, 'i-rye': { qty: 2 } }, days: {} };
    const source = seeded({ 'r-1': FINISHED }, { draft });
    const view = renderOrders('/orders/lists', { source });
    await view.user.click(await screen.findByRole('button', { name: /^From Someone/ }, LOAD));
    await view.user.click(await one().findByRole('button', { name: 'Mark as placed — Alpine Mills' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/supplier/s-alp/confirm'); });
    expect(view.router.state.location.state).toMatchObject({ fromList: true, toList: 1 });
  });
});
