import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», step 3f-4: the settings, «Past orders» (History) with its cards, the older orders on demand, «Send again» and «Send all»,
// and the editor that corrects or deletes a recorded order.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', phone: '+44 7700 900123' }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', weight: '5kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-big', { name: 'Rye', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-box', { name: 'Cake box', supplierId: 's-alp', unit: 'carton', packUnit: 'bag' }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
  ingredient('i-orphan', { name: 'Loose string', supplierId: 's-gone', unit: 'm' }),
];

const at = (date: string, hours: number, minutes: number): string => {
  const day = parseISODate(date);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).toISOString();
};
const clock = (iso: string, locale = 'en-GB'): string => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

function record(date: string, supplierId: string, supplierName: string, quantities: Record<string, number>, extra: Record<string, unknown> = {}) {
  return {
    date, supplierId, supplierName, quantities, stock: {}, names: {},
    createdAt: at(date, 9, 12), updatedAt: at(date, 9, 12), ...extra,
  };
}
const idOf = (date: string, supplierId: string): string => `${date}_${supplierId}`;

function seeded(records: Record<string, Record<string, unknown>> = {}, extra: { ordersConfig?: Record<string, unknown> | null } = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, records, ...extra });
}

// A normal fortnight: two suppliers today, one yesterday.
function fortnight(): Record<string, Record<string, unknown>> {
  return {
    [idOf(TODAY, 's-zed')]: record(TODAY, 's-zed', 'Zed', { 'i-milk': 4 }, { stock: { 'i-milk': 2 } }),
    [idOf(TODAY, 's-alp')]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-flour': 2, 'i-rye': 3, 'i-big': 1 }),
    [idOf(inDays(-1), 's-alp')]: record(inDays(-1), 's-alp', 'Alpine Mills', { 'i-flour': 5 }),
  };
}

async function atHistory(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}) {
  const view = renderOrders('/orders/history', { source, ...options });
  await screen.findByRole('region', { name: /^(Past orders|Ordini passati)$/ }, LOAD);
  await waitFor(() => { expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); }, LOAD);
  return view;
}
type View = Awaited<ReturnType<typeof atHistory>>;

const history = () => within(screen.getByRole('region', { name: 'Past orders' }));
const card = (name: string, index = 0) => history().getAllByRole('button', { name: new RegExp(`^${name}`) })[index] as HTMLElement;
const editor = () => within(screen.getByRole('region', { name: 'Correct order' }));
const dialog = () => screen.findByRole('alertdialog', undefined, LOAD);
const dialogButton = async (name: string) => within(await dialog()).getByRole('button', { name });
const spyOpen = () => vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
const path = (view: View) => view.router.state.location.pathname;

// ⚠️ A press and what follows it IN THE SAME TASK: the click, then only microtasks. A window opened by a later task would be a
// blocked pop-up in a real browser.
async function pressThenMicrotasks(button: HTMLElement) {
  act(() => { button.click(); });
  for (let hop = 0; hop < 60; hop++) await Promise.resolve();
}

const bodyOf = (head: HTMLElement): HTMLElement => document.getElementById(head.getAttribute('aria-controls') ?? '') as HTMLElement;

async function openCard(view: View, name: string, index = 0) {
  const head = card(name, index);
  await view.user.click(head);
  return head;
}

describe('the settings and the way to History', () => {
  it('opens the settings from the gear, History from its door, and Back steps up ONE level handing the focus back each time', async () => {
    const source = seeded(fortnight(), { ordersConfig: { historyDays: 30 } });
    const view = renderOrders('/orders', { source });
    await screen.findAllByRole('listitem', undefined, LOAD);
    const gear = screen.getByRole('button', { name: 'Orders settings' });
    await view.user.click(gear);
    const settings = within(await screen.findByRole('region', { name: 'Settings' }));
    expect(path(view)).toBe('/orders/settings');
    expect(settings.getByText('Shows the last 30 days')).toBeInTheDocument();

    await view.user.click(settings.getByRole('button', { name: /^Past orders/ }));
    await screen.findByRole('region', { name: 'Past orders' });
    expect(path(view)).toBe('/orders/history');

    await view.user.click(history().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/settings'); });
    // The settings are drawn again, and the door that opened History has the focus.
    const again = within(await screen.findByRole('region', { name: 'Settings' }));
    await waitFor(() => { expect(again.getByRole('button', { name: /^Past orders/ })).toHaveFocus(); });

    await view.user.click(again.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    await waitFor(() => { expect(gear).toHaveFocus(); });
  });

  it('says «the last day» for a window of one', async () => {
    renderOrders('/orders/settings', { source: seeded({}, { ordersConfig: { historyDays: 1 } }) });
    expect(await screen.findByText('Shows the last day', undefined, LOAD)).toBeInTheDocument();
  });

  it('opened by its address, Back replaces it with the level above instead of piling up entries', async () => {
    const view = renderOrders('/orders/history', { source: seeded() });
    await screen.findByRole('region', { name: 'Past orders' }, LOAD);
    await view.user.click(history().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/settings'); });
    expect(view.router.state.historyAction).toBe('REPLACE');
  });

  it('sends «/orders/history/day» alone back to the list', async () => {
    const view = renderOrders('/orders/history/day', { source: seeded() });
    await waitFor(() => { expect(path(view)).toBe('/orders'); }, LOAD);
  });
});

describe('the History list', () => {
  it('shows the days newest first, a day’s suppliers by name, and «Send all» only on a day with two or more orders', async () => {
    await atHistory(seeded(fortnight()));
    const days = history().getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(days).toEqual(['Today', 'Yesterday']);
    const heads = history().getAllByRole('button', { name: /items?$/ }).map(button => button.textContent);
    expect(heads).toEqual(['Alpine Mills3 items', 'Zed1 item', 'Alpine Mills1 item']);
    expect(history().getAllByRole('button', { name: 'Send all' })).toHaveLength(1);
  });

  it('keeps every card collapsed, opens one on its button, and lists its lines by name with the unit it was ordered in', async () => {
    const view = await atHistory(seeded({
      [idOf(TODAY, 's-alp')]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-flour': 2, 'i-rye': 3, 'i-big': 1, 'i-box': 4 }, { units: { 'i-box': 'bag' } }),
    }));
    const head = card('Alpine Mills');
    expect(head).toHaveAttribute('aria-expanded', 'false');
    const body = document.getElementById(head.getAttribute('aria-controls') ?? '');
    expect(body).toHaveAttribute('hidden');
    await view.user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(body).not.toHaveAttribute('hidden');
    const lines = within(body as HTMLElement).getAllByRole('listitem').map(line => line.textContent);
    // Numeric-aware: «Rye 5kg» before «Rye 25kg».
    expect(lines).toEqual(['Cake box4 bag', 'Flour 00 25kg2 kg', 'Rye 5kg3 kg', 'Rye 25kg1 kg']);
    await view.user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows an ingredient deleted since under the name the order was placed with, or «Deleted ingredient»', async () => {
    const view = await atHistory(seeded({
      [idOf(TODAY, 's-alp')]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-gone': 2, 'i-lost': 1 }, { names: { 'i-gone': 'Old sourdough' } }),
    }));
    await openCard(view, 'Alpine Mills');
    expect(history().getByText('Old sourdough')).toBeInTheDocument();
    expect(history().getByText('Deleted ingredient')).toBeInTheDocument();
  });

  it('shows a record with no supplier name as «Unknown supplier» and one with no lines as «No items recorded.»', async () => {
    const view = await atHistory(seeded({
      [idOf(TODAY, 's-x')]: record(TODAY, 's-x', '', {}),
    }));
    await openCard(view, 'Unknown supplier');
    expect(history().getByText('No items recorded.')).toBeInTheDocument();
  });

  it('draws each send of the day with its time, then the day’s total', async () => {
    const first = at(TODAY, 9, 12);
    const later = at(TODAY, 15, 40);
    const edit = at(TODAY, 16, 20);
    const view = await atHistory(seeded({
      [idOf(TODAY, 's-alp')]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-flour': 5 }, {
        sends: {
          a: { at: first, kind: 'order', quantities: { 'i-flour': 2 } },
          b: { at: later, kind: 'order', quantities: { 'i-flour': 3 } },
          c: { at: edit, kind: 'edit', quantities: { 'i-flour': 5 } },
        },
      }),
    }));
    await openCard(view, 'Alpine Mills');
    const headings = history().getAllByRole('heading', { level: 4 }).map(heading => heading.textContent);
    expect(headings).toEqual([`Order · ${clock(first)}`, `Added · ${clock(later)}`, `Corrected · ${clock(edit)}`, 'Day total']);
    expect(history().getAllByText('Flour 00 25kg')).toHaveLength(4);
  });

  it('puts «Earlier orders» over a send with no time, and just the time over a lone send', async () => {
    const lone = at(TODAY, 8, 5);
    const view = await atHistory(seeded({
      [idOf(TODAY, 's-alp')]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-flour': 2 }, { sends: { a: { at: lone, kind: 'order', quantities: { 'i-flour': 2 } } } }),
      [idOf(TODAY, 's-zed')]: record(TODAY, 's-zed', 'Zed', { 'i-milk': 3 }, {
        sends: { a: { at: '', quantities: { 'i-milk': 1 } }, b: { at: at(TODAY, 11, 0), quantities: { 'i-milk': 2 } } },
      }),
    }));
    const alpine = bodyOf(await openCard(view, 'Alpine Mills'));
    expect(within(alpine).getByRole('heading', { level: 4, name: `Order · ${clock(lone)}` })).toBeInTheDocument();
    expect(within(alpine).queryByText('Day total')).not.toBeInTheDocument();
    const zed = bodyOf(await openCard(view, 'Zed'));
    expect(within(zed).getByRole('heading', { level: 4, name: 'Earlier orders' })).toBeInTheDocument();
    expect(within(zed).getByText('Day total')).toBeInTheDocument();
  });

  it('groups the legacy weekly record by each line’s CURRENT supplier, with «No supplier» and «Unknown supplier» told apart', async () => {
    const source = seeded({
      [idOf(inDays(-90), 's-alp')]: record(inDays(-90), 's-alp', 'Alpine Mills', { 'i-flour': 1 }),
      '2026-W28': { weekStart: inDays(-100), quantities: { 'i-flour': 9, 'i-milk': 2, 'i-orphan': 1, 'i-vanished': 4 }, stock: {}, names: { 'i-vanished': 'Vanished item' } },
    });
    const view = await atHistory(source);
    await view.user.click(history().getByRole('button', { name: 'Load older orders' }));
    await waitFor(() => { expect(history().queryByRole('button', { name: 'Load older orders' })).not.toBeInTheDocument(); });
    const head = card('Whole week — all suppliers');
    expect(head).toHaveTextContent('4 items');
    await view.user.click(head);
    const headings = history().getAllByRole('heading', { level: 4 }).map(heading => heading.textContent);
    expect(headings).toEqual(['Alpine Mills', 'Zed', 'No supplier', 'Unknown supplier']);
    expect(history().getByText('Vanished item')).toBeInTheDocument();
    expect(history().getByText('9 kg')).toBeInTheDocument();
  });
});

describe('older orders', () => {
  it('parks the days beyond the window behind «Show older orders (N)» and reveals them, focusing the first revealed card', async () => {
    const view = await atHistory(seeded({
      ...fortnight(),
      [idOf(inDays(-30), 's-alp')]: record(inDays(-30), 's-alp', 'Alpine Mills', { 'i-flour': 1 }),
      [idOf(inDays(-31), 's-zed')]: record(inDays(-31), 's-zed', 'Zed', { 'i-milk': 1 }),
    }));
    expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(2);
    await view.user.click(history().getByRole('button', { name: 'Show older orders (2)' }));
    expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(4);
    expect(history().queryByRole('button', { name: /^Show older orders/ })).not.toBeInTheDocument();
    await waitFor(() => { expect(card('Alpine Mills', 2)).toHaveFocus(); });
  });

  it('says «No orders in the last 15 days.» over the parked button when nothing is recent', async () => {
    await atHistory(seeded({ [idOf(inDays(-30), 's-alp')]: record(inDays(-30), 's-alp', 'Alpine Mills', { 'i-flour': 1 }) }));
    expect(history().getByText('No orders in the last 15 days.')).toBeInTheDocument();
    expect(history().getByRole('button', { name: 'Show older orders (1)' })).toBeInTheDocument();
  });

  it('folds the older orders away again when the number of days is changed', async () => {
    const source = seeded({ ...fortnight(), [idOf(inDays(-30), 's-alp')]: record(inDays(-30), 's-alp', 'Alpine Mills', { 'i-flour': 1 }) });
    const view = await atHistory(source);
    await view.user.click(history().getByRole('button', { name: 'Show older orders (1)' }));
    expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(3);
    // Another phone changes the setting: it wins over the earlier «show me everything».
    act(() => { source.ordersConfig = { historyDays: 20 }; source.emit(); });
    expect(await history().findByRole('button', { name: 'Show older orders (1)' })).toBeInTheDocument();
    expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(2);
    // A window that takes it in shows it with no button.
    act(() => { source.ordersConfig = { historyDays: 60 }; source.emit(); });
    await waitFor(() => { expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(3); });
    expect(history().queryByRole('button', { name: /^Show older orders/ })).not.toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/history');
  });

  it('loads older orders page by page, says «Loading…» meanwhile, and keeps the focus on the button', async () => {
    const source = seeded({
      ...fortnight(),
      [idOf(inDays(-90), 's-alp')]: record(inDays(-90), 's-alp', 'Alpine Mills', { 'i-flour': 1 }),
      [idOf(inDays(-91), 's-zed')]: record(inDays(-91), 's-zed', 'Zed', { 'i-milk': 1 }),
    });
    source.pageSize = 1;
    const real = source.getOlderHistory.bind(source);
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    source.getOlderHistory = async args => { await gate; return real(args); };
    const view = await atHistory(source);
    const load = history().getByRole('button', { name: 'Load older orders' });
    load.focus();
    await view.user.click(load);
    const loading = await history().findByRole('button', { name: 'Loading…' });
    expect(loading).toBeDisabled();
    release();
    await waitFor(() => { expect(history().getByRole('button', { name: 'Load older orders' })).toBeEnabled(); });
    expect(history().getByRole('button', { name: 'Load older orders' })).toHaveFocus();
    // The first page is in; the second page is another press.
    expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(3);
    await view.user.click(history().getByRole('button', { name: 'Load older orders' }));
    await waitFor(() => { expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(4); });
    expect(source.olderReads.length).toBeGreaterThanOrEqual(2);
  });

  it('says the load failed in a live region, keeps what is there, and the same button is the retry', async () => {
    const source = seeded({ ...fortnight(), [idOf(inDays(-90), 's-alp')]: record(inDays(-90), 's-alp', 'Alpine Mills', { 'i-flour': 1 }) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await atHistory(source);
    const region = history().getAllByRole('status')[0] as HTMLElement;
    expect(region).toBeEmptyDOMElement();
    source.failHistory.older = true;
    await view.user.click(history().getByRole('button', { name: 'Load older orders' }));
    expect(await history().findByText('Couldn’t load older orders. Check the connection and try again.')).toBeInTheDocument();
    // The same element was there before it spoke.
    expect(region.isConnected).toBe(true);
    expect(region).toHaveTextContent('Couldn’t load older orders.');
    await view.user.click(history().getByRole('button', { name: 'Load older orders' }));
    await waitFor(() => { expect(history().getAllByRole('heading', { level: 3 })).toHaveLength(3); });
    expect(history().queryByText(/^Couldn’t load older orders/)).not.toBeInTheDocument();
  });

  it('tells «none in the last 2 months» from «none at all»: the first has the load button, the second does not', async () => {
    const view = await atHistory(seeded({}));
    expect(history().getByText('No orders in the last 2 months.')).toBeInTheDocument();
    await view.user.click(history().getByRole('button', { name: 'Load older orders' }));
    expect(await history().findByText('No past orders yet.')).toBeInTheDocument();
    expect(history().queryByRole('button', { name: /older orders/ })).not.toBeInTheDocument();
    await waitFor(() => { expect(history().getByText('No past orders yet.').closest('[tabindex="-1"]')).toHaveFocus(); });
  });
});

describe('«Send again»', () => {
  it('opens the one road in the very tick of the press, with no unit check against today’s record, and records nothing', async () => {
    const open = spyOpen();
    const source = seeded({
      // Today's record in `carton`, the older one in `bag`: a send from the draft would be refused for the clash.
      [idOf(TODAY, 's-alp')]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-box': 3 }, { units: { 'i-box': 'carton' }, names: { 'i-box': 'Cake box' } }),
      [idOf(inDays(-1), 's-alp')]: record(inDays(-1), 's-alp', 'Alpine Mills', { 'i-box': 2 }, { units: { 'i-box': 'bag' }, names: { 'i-box': 'Cake box' } }),
    });
    const view = await atHistory(source, STAFF);
    await openCard(view, 'Alpine Mills', 1);
    const before = source.recordAttempts;
    await pressThenMicrotasks(history().getByRole('button', { name: 'Send again' }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]?.[0]);
    expect(decodeURIComponent(url)).toContain('- Cake box: 2 × bag');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await Promise.resolve();
    expect(source.recordAttempts).toBe(before);
    expect(path(view)).toBe('/orders/history');
  });

  it('ignores a second press while the first is pending and frees the button when the send throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('blocked by the browser'); });
    const view = await atHistory(seeded(fortnight()), STAFF);
    await openCard(view, 'Zed');
    const again = history().getAllByRole('button', { name: 'Send again' })[0] as HTMLElement;
    await view.user.click(again);
    expect(await screen.findByText('Something went wrong while sending. Try again.')).toBeInTheDocument();
    await view.user.click(again);
    await waitFor(() => { expect(open).toHaveBeenCalledTimes(2); });
  });

  it('says so when the browser blocked the window: a send that reached nobody is never silent', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const view = await atHistory(seeded(fortnight()), STAFF);
    await openCard(view, 'Zed');
    await view.user.click(history().getAllByRole('button', { name: 'Send again' })[0] as HTMLElement);
    expect(open).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/^Nothing was opened/)).toBeInTheDocument();
  });
});

describe('«Send all» for a day', () => {
  it('opens the day’s orders with nothing ticked, sends them, steps back to History and gives the focus back to the button', async () => {
    const open = spyOpen();
    const source = seeded(fortnight());
    const view = await atHistory(source, STAFF);
    const sendAll = history().getByRole('button', { name: 'Send all' });
    await view.user.click(sendAll);
    const day = within(await screen.findByRole('region', { name: 'Send today' }));
    expect(path(view)).toBe(`/orders/history/day/${TODAY}`);
    expect(day.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true);
    expect(day.getByRole('button', { name: 'Send' })).toBeDisabled();
    await view.user.click(day.getByRole('checkbox', { name: 'Select all suppliers' }));
    expect(day.getByText('3 items')).toBeInTheDocument();
    await view.user.click(day.getByRole('radio', { name: 'One list' }));
    await view.user.click(day.getByRole('button', { name: 'Send' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    const text = decodeURIComponent(String(open.mock.calls[0]?.[0]));
    expect(text).toContain('Flour 00');
    expect(text).toContain('Whole milk');
    expect(source.recordAttempts).toBe(0);
    await waitFor(() => { expect(history().getByRole('button', { name: 'Send all' })).toHaveFocus(); });
  });

  it('stays where it is when the send reached nobody', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    const view = await atHistory(seeded(fortnight()), STAFF);
    await view.user.click(history().getByRole('button', { name: 'Send all' }));
    const day = within(await screen.findByRole('region', { name: 'Send today' }));
    await view.user.click(day.getByRole('checkbox', { name: 'Select all suppliers' }));
    await view.user.click(day.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/^Nothing was opened/)).toBeInTheDocument();
    expect(path(view)).toBe(`/orders/history/day/${TODAY}`);
  });

  it('says there is nothing to send for a day without orders, and Back replaces it with History when it was opened by address', async () => {
    const view = renderOrders(`/orders/history/day/${inDays(-5)}`, { source: seeded(fortnight()) });
    expect(await screen.findByText('Nothing to send for that day.', undefined, LOAD)).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
  });
});

describe('the editor', () => {
  const ID = idOf(TODAY, 's-alp');

  async function toEditor(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}) {
    const view = await atHistory(source, options);
    const head = await openCard(view, 'Alpine Mills');
    const correct = history().getAllByRole('button', { name: 'Correct' })[0] as HTMLElement;
    await view.user.click(correct);
    await screen.findByRole('region', { name: 'Correct order' });
    return { view, head, correct };
  }

  const box = (name: string) => editor().getByRole('spinbutton', { name }) as HTMLInputElement;

  it('opens from a card’s «Correct» with the order’s own lines, quantity and stock in two boxes each, and the hint', async () => {
    const { view } = await toEditor(seeded(fortnight()));
    expect(path(view)).toBe(`/orders/history/${ID}`);
    expect(editor().getByText(`Alpine Mills · Today`)).toBeInTheDocument();
    expect(box('Flour 00 25kg quantity ordered').value).toBe('2');
    expect(box('Rye 5kg quantity ordered').value).toBe('3');
    expect(box('Flour 00 25kg stock on hand').value).toBe('');
    expect(editor().getByText('Set a quantity to 0 to remove that item from the order.')).toBeInTheDocument();
    expect(editor().getByRole('button', { name: 'Delete this order' })).toBeInTheDocument();
    expect(editor().getByText('Order')).toBeInTheDocument();
    expect(editor().getByText('Stock')).toBeInTheDocument();
  });

  it('edits a COPY taken when it opened: another phone adding to the order does not move the numbers under the finger', async () => {
    const source = seeded(fortnight());
    await toEditor(source);
    act(() => {
      const stored = source.records.get(ID) as { quantities: Record<string, number> };
      source.records.set(ID, { ...stored, quantities: { ...stored.quantities, 'i-flour': 9 } });
      source.emitHistory();
    });
    await Promise.resolve();
    expect(box('Flour 00 25kg quantity ordered').value).toBe('2');
  });

  it('saves after a confirm, writes the corrected order, says so, goes back to History and hands the focus to the card’s button', async () => {
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    await view.user.clear(box('Flour 00 25kg quantity ordered'));
    await view.user.type(box('Flour 00 25kg quantity ordered'), '7');
    await view.user.clear(box('Rye 5kg quantity ordered'));
    await view.user.type(box('Rye 5kg quantity ordered'), '0');
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    const asked = await dialog();
    expect(within(asked).getByText('Save changes')).toBeInTheDocument();
    expect(within(asked).getByText('Update Alpine Mills’s order for today?')).toBeInTheDocument();
    await view.user.click(await dialogButton('Save'));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    const stored = source.records.get(ID) as { quantities: Record<string, number> };
    expect(stored.quantities).toEqual({ 'i-flour': 7, 'i-big': 1 });
    expect(await screen.findByText('Order updated ✓')).toBeInTheDocument();
    // No question about discarding what was just saved.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(history().getAllByRole('button', { name: 'Correct' })[0]).toHaveFocus(); });
    // The card is still open where it was left.
    expect(card('Alpine Mills')).toHaveAttribute('aria-expanded', 'true');
  });

  it('goes back to History writing nothing when Save is pressed with nothing changed', async () => {
    const source = seeded(fortnight());
    const before = structuredClone(source.records.get(ID));
    const { view } = await toEditor(source);
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.rewrites).toEqual([]);
    expect(source.records.get(ID)).toEqual(before);
  });

  it('keeps Cancel on the save question quiet: nothing written, still on the editor', async () => {
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    await view.user.clear(box('Flour 00 25kg quantity ordered'));
    await view.user.type(box('Flour 00 25kg quantity ordered'), '7');
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    await view.user.click(await dialogButton('Cancel'));
    expect(source.rewrites).toEqual([]);
    expect(path(view)).toBe(`/orders/history/${ID}`);
  });

  it('refuses to save an order with every quantity at 0 and points at «Delete this order»', async () => {
    const source = seeded({ [ID]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-flour': 2 }) });
    const { view } = await toEditor(source);
    await view.user.clear(box('Flour 00 25kg quantity ordered'));
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    const alert = await dialog();
    expect(within(alert).getByText('Nothing left to save')).toBeInTheDocument();
    expect(within(alert).getByText(/^This order would have no items left\. Use “Delete this order”/)).toBeInTheDocument();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(source.rewrites).toEqual([]);
    expect(source.records.has(ID)).toBe(true);
  });

  it('writes nothing and says so when the order changed while it was being corrected, then goes back to History', async () => {
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    await view.user.clear(box('Flour 00 25kg quantity ordered'));
    await view.user.type(box('Flour 00 25kg quantity ordered'), '7');
    source.duringRewrite = () => {
      const stored = source.records.get(ID) as { quantities: Record<string, number> };
      source.records.set(ID, { ...stored, quantities: { ...stored.quantities, 'i-flour': 4 } });
    };
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    await view.user.click(await dialogButton('Save'));
    const alert = await dialog();
    expect(within(alert).getByText(/^This order changed while you were correcting it: another phone added to it or corrected it\. Nothing was saved/)).toBeInTheDocument();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    expect((source.records.get(ID) as { quantities: Record<string, number> }).quantities['i-flour']).toBe(4);
  });

  it('says the order is gone when another phone deleted it, then goes back to History', async () => {
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    await view.user.clear(box('Flour 00 25kg quantity ordered'));
    await view.user.type(box('Flour 00 25kg quantity ordered'), '7');
    source.duringRewrite = () => { source.records.delete(ID); };
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    await view.user.click(await dialogButton('Save'));
    const alert = await dialog();
    expect(within(alert).getByText('This order is no longer there: another phone deleted it.')).toBeInTheDocument();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
  });

  it('says it when offline and stays, edits kept', async () => {
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    await view.user.clear(box('Flour 00 25kg quantity ordered'));
    await view.user.type(box('Flour 00 25kg quantity ordered'), '7');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    await view.user.click(await dialogButton('Save'));
    expect(await screen.findByText('You are offline: the order was not changed. Try again when connected.')).toBeInTheDocument();
    expect(path(view)).toBe(`/orders/history/${ID}`);
    expect(box('Flour 00 25kg quantity ordered').value).toBe('7');
    expect(source.rewrites).toEqual([]);
  });

  it('says it could not update the order when the write fails, and stays with the edits kept', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    await view.user.clear(box('Flour 00 25kg quantity ordered'));
    await view.user.type(box('Flour 00 25kg quantity ordered'), '7');
    source.failHistory.rewrite = true;
    await view.user.click(editor().getByRole('button', { name: 'Save' }));
    await view.user.click(await dialogButton('Save'));
    expect(await screen.findByText('Could not update the order — check your network and try again.')).toBeInTheDocument();
    expect(path(view)).toBe(`/orders/history/${ID}`);
    expect(box('Flour 00 25kg quantity ordered').value).toBe('7');
    await waitFor(() => { expect(editor().getByRole('button', { name: 'Save' })).toBeEnabled(); });
  });

  it('deletes after a danger confirm that says what is lost, then says so and goes back to History', async () => {
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    await view.user.click(editor().getByRole('button', { name: 'Delete this order' }));
    const asked = await dialog();
    expect(within(asked).getByText(/^Delete Alpine Mills’s order for today\?/)).toBeInTheDocument();
    expect(within(asked).getByText(/learn from the last 2 months of orders/)).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    expect(source.records.has(ID)).toBe(false);
    expect(await screen.findByText('Order deleted')).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Past orders' });
    expect(history().queryByRole('button', { name: /^Alpine Mills3 items/ })).not.toBeInTheDocument();
    // The «Correct» that opened the editor went with the order: History's title takes the focus, never the page.
    await waitFor(() => { expect(history().getByRole('heading', { name: 'Past orders' })).toHaveFocus(); });
  });

  it('writes nothing on a delete when the order changed meanwhile, says so, and goes back', async () => {
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    source.duringRewrite = () => {
      const stored = source.records.get(ID) as { quantities: Record<string, number> };
      source.records.set(ID, { ...stored, quantities: { ...stored.quantities, 'i-flour': 4 } });
    };
    await view.user.click(editor().getByRole('button', { name: 'Delete this order' }));
    await view.user.click(await dialogButton('Delete'));
    const alert = await dialog();
    expect(within(alert).getByText(/Nothing was deleted — open it again to see it as it is now\.$/)).toBeInTheDocument();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    expect(source.records.has(ID)).toBe(true);
  });

  it('says it could not delete the order and stays when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded(fortnight());
    const { view } = await toEditor(source);
    source.failHistory.rewrite = true;
    await view.user.click(editor().getByRole('button', { name: 'Delete this order' }));
    await view.user.click(await dialogButton('Delete'));
    expect(await screen.findByText('Could not delete the order — check your network and try again.')).toBeInTheDocument();
    expect(path(view)).toBe(`/orders/history/${ID}`);
    expect(source.records.has(ID)).toBe(true);
  });

  it('asks before leaving with a number changed, on every way out, and leaves quietly when nothing was changed', async () => {
    const { view } = await toEditor(seeded(fortnight()));
    await view.user.click(editor().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await view.user.click(history().getAllByRole('button', { name: 'Correct' })[0] as HTMLElement);
    await screen.findByRole('region', { name: 'Correct order' });
    await view.user.type(box('Flour 00 25kg quantity ordered'), '5');
    await view.user.click(editor().getByRole('button', { name: 'Back' }));
    const asked = await dialog();
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(path(view)).toBe(`/orders/history/${ID}`);
    expect(box('Flour 00 25kg quantity ordered').value).toBe('25');

    // The browser's own Back asks too.
    act(() => { void view.router.navigate(-1); });
    await view.user.click(await dialogButton('Discard'));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
  });

  it('opened by its address waits for the records, shows the order, and Back replaces it with History', async () => {
    const view = renderOrders(`/orders/history/${ID}`, { source: seeded(fortnight()) });
    await screen.findByRole('region', { name: 'Correct order' }, LOAD);
    await screen.findByRole('spinbutton', { name: 'Flour 00 25kg quantity ordered' }, LOAD);
    await view.user.click(editor().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
  });

  it('sends an unknown record, opened by its address, to History once the records are in', async () => {
    const view = renderOrders('/orders/history/2026-01-01_nobody', { source: seeded(fortnight()) });
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); }, LOAD);
    expect(view.router.state.historyAction).toBe('REPLACE');
  });

  it('corrects a legacy weekly record under «Week of …»', async () => {
    const source = seeded({
      [idOf(inDays(-90), 's-alp')]: record(inDays(-90), 's-alp', 'Alpine Mills', { 'i-flour': 1 }),
      '2026-W28': { weekStart: inDays(-100), quantities: { 'i-flour': 9 }, stock: {}, names: {} },
    });
    const view = await atHistory(source);
    await view.user.click(history().getByRole('button', { name: 'Load older orders' }));
    await waitFor(() => { expect(history().queryByRole('button', { name: 'Load older orders' })).not.toBeInTheDocument(); });
    await openCard(view, 'Whole week');
    await view.user.click(history().getByRole('button', { name: 'Correct' }));
    await screen.findByRole('region', { name: 'Correct order' });
    expect(editor().getByText(/^Week of /)).toBeInTheDocument();
  });
});

describe('the place in History on a phone', () => {
  const main = () => screen.getByRole('main');
  // The shell's scroll area, scrolled to a place down the list.
  function scrolledTo(top: number): HTMLElement {
    const area = main();
    Object.defineProperty(area, 'scrollTop', { value: top, writable: true });
    return area;
  }
  function week(): Record<string, Record<string, unknown>> {
    const records: Record<string, Record<string, unknown>> = {};
    for (let n = 0; n < 6; n++) records[idOf(inDays(-n), 's-alp')] = record(inDays(-n), 's-alp', 'Alpine Mills', { 'i-flour': n + 1 });
    return records;
  }

  it('keeps History where it was, cards open and all, while the editor is open, and puts the place back on Back', async () => {
    const view = await atHistory(seeded(week()));
    await openCard(view, 'Alpine Mills', 3);
    const area = scrolledTo(640);
    await view.user.click(history().getByRole('button', { name: 'Correct' }));
    await screen.findByRole('region', { name: 'Correct order' });
    // The editor starts at the top; History is not drawn but it is still there.
    expect(area.scrollTop).toBe(0);
    expect(screen.queryByRole('region', { name: 'Past orders' })).not.toBeInTheDocument();
    await view.user.click(editor().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
    await waitFor(() => { expect(area.scrollTop).toBe(640); });
    expect(card('Alpine Mills', 3)).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => { expect(history().getByRole('button', { name: 'Correct' })).toHaveFocus(); });
  });

  it('starts every other new screen at the top', async () => {
    const view = await atHistory(seeded(fortnight()));
    const area = scrolledTo(300);
    await view.user.click(history().getByRole('button', { name: 'Send all' }));
    await screen.findByRole('region', { name: 'Send today' });
    expect(area.scrollTop).toBe(0);
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/history'); });
  });
});

describe('in Italian', () => {
  it('speaks Italian on every new screen', async () => {
    const view = renderOrders('/orders/settings', { source: seeded(fortnight()), lang: 'it' });
    await screen.findByRole('region', { name: 'Impostazioni' }, LOAD);
    await view.user.click(screen.getByRole('button', { name: /^Ordini passati/ }));
    const list = within(await screen.findByRole('region', { name: 'Ordini passati' }));
    expect(list.getByRole('button', { name: 'Manda tutti' })).toBeInTheDocument();
    await view.user.click(list.getAllByRole('button', { name: /^Alpine Mills/ })[0] as HTMLElement);
    expect(list.getAllByRole('button', { name: 'Manda di nuovo' }).length).toBeGreaterThan(0);
    await view.user.click(list.getAllByRole('button', { name: 'Correggi' })[0] as HTMLElement);
    const edit = within(await screen.findByRole('region', { name: 'Correggi l’ordine' }));
    expect(edit.getByRole('button', { name: 'Elimina questo ordine' })).toBeInTheDocument();
    expect(edit.getByText('Metti una quantità a 0 per togliere quella voce dall’ordine.')).toBeInTheDocument();
    expect(edit.getByRole('spinbutton', { name: 'Quantità ordinata di Flour 00 25kg' })).toBeInTheDocument();
  });
});
