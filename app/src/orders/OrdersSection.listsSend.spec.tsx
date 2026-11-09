import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate } from '@mise/shared/day';
import { MAX_LINES } from '@mise/shared/order-request-model';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';
import { MUTE_KEY, PUSH_TOKEN_KEY } from './phoneMute';

// «Orders», step 3f-7 slice B: sending the order as a list to whoever runs the place, the «nobody will be told» warning, the
// «send the list again» button, «asked» on the confirm screen, and the phone's mute switch.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
// The only road the venue gives an employee is the in-app list: one road, taken in the press, no chooser.
const LIST_ONLY = { sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } };
// A venue that has not touched its send settings: the list and WhatsApp.
const DEFAULT_ROADS = null;

const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills' })];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
];
const DRAFT = { entries: { 'i-flour': { qty: 2 }, 'i-rye': { qty: 3 } }, days: { 's-alp': TODAY } };

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, draft: DRAFT, ordersConfig: LIST_ONLY, ...extra });
}

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;

async function atList(source: FakeOrdersSource, options: Options = STAFF) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}
type View = Awaited<ReturnType<typeof atList>>;

const path = (view: View) => view.router.state.location.pathname;
const arrow = () => screen.getByRole('button', { name: 'Send' });
const sendScreen = () => within(screen.getByRole('region', { name: 'Send order' }));
const sendButton = () => sendScreen().getByRole('button', { name: 'Send' });
const confirmation = () => screen.findByRole('alertdialog', undefined, LOAD);

async function toSend(view: View, ...names: string[]) {
  await view.user.click(arrow());
  await screen.findByRole('region', { name: 'Send order' });
  for (const name of names) await view.user.click(sendScreen().getByRole('checkbox', { name: new RegExp(`^${name}`) }));
}

const SENT = 'List sent ✓ — Everybody who runs this place will be told.';
const BOSS = { uid: 'boss', role: 'owner', firstName: 'Ada', lastName: 'Rossi' };
const SECOND = { uid: 'second', role: 'manager', firstName: 'Giulia', lastName: 'Bianchi' };

describe('the road to whoever runs the place', () => {
  it('is offered to an employee when the venue’s settings say so, beside the other roads, and named for what it is', async () => {
    const view = await atList(seeded({ ordersConfig: DEFAULT_ROADS }));
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    const roads = chooser.getAllByRole('button').map(button => button.textContent ?? '');
    expect(roads[0]).toContain('To whoever runs the place, in the app');
    expect(roads[1]).toContain('WhatsApp — I choose the chat');
    expect(chooser.getByRole('button', { name: /^To whoever runs the place, in the app/ }).querySelector('svg')).not.toBeNull();
  });

  it('is not offered when the venue closed it for employees', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const view = await atList(seeded({ ordersConfig: { sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } } }));
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    // One road left: taken in the press, no chooser.
    await waitFor(() => { expect(open).toHaveBeenCalledTimes(1); });
    expect(screen.queryByRole('dialog', { name: 'How should this order go?' })).not.toBeInTheDocument();
  });

  it('⚠️ is never offered on a re-send from History: that road goes to the one chat, with no chooser', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const record = { date: inDays(-1), supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 5 }, stock: {}, names: {}, createdAt: `${inDays(-1)}T09:00:00.000Z`, updatedAt: `${inDays(-1)}T09:00:00.000Z` };
    const source = seeded({ ordersConfig: DEFAULT_ROADS, records: { [`${inDays(-1)}_s-alp`]: record } });
    const view = renderOrders('/orders/history', { source, ...STAFF });
    const history = within(await screen.findByRole('region', { name: 'History' }, LOAD));
    await waitFor(() => { expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); }, LOAD);
    await view.user.click(await history.findByRole('button', { name: /^Alpine Mills/ }));
    act(() => { history.getByRole('button', { name: 'Send again' }).click(); });
    for (let hop = 0; hop < 60; hop++) await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'How should this order go?' })).not.toBeInTheDocument();
  });

  it('⚠️ sent: says who will be told, leaves for the Orders list, and the order is NOT cleared and NOT recorded', async () => {
    const source = seeded();
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    expect(source.requests.size).toBe(1);
    const [stored] = [...source.requests.values()];
    expect(stored).toMatchObject({ date: TODAY, fromUid: 'u1', quantities: { 'i-flour': 2, 'i-rye': 3 } });
    // The shared order is as it was: the row still counts its two lines, and nothing was recorded or asked.
    expect(await screen.findByText('2 items')).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('This is what will be recorded:')).not.toBeInTheDocument();
  });

  it('skips the same-day unit check: a clash with today’s record does not stop a list', async () => {
    const items = [...ITEMS, ingredient('i-box', { name: 'Cake box', supplierId: 's-alp', unit: 'carton', packUnit: 'bag' })];
    const record = { date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-box': 3 }, units: { 'i-box': 'carton' }, stock: {}, names: {}, createdAt: `${TODAY}T08:00:00.000Z`, updatedAt: `${TODAY}T08:00:00.000Z` };
    const source = seeded({
      ingredients: items,
      draft: { entries: { 'i-box': { qty: 2, unit: 'bag' } }, days: { 's-alp': TODAY } },
      records: { [`${TODAY}_s-alp`]: record },
    });
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.requests.size).toBe(1);
  });

  it('queued (offline): says it will go when the connection is back, and leaves', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const source = seeded();
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText('It will go when the connection comes back.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    expect(screen.queryByText(SENT)).not.toBeInTheDocument();
  });

  it('nothing left: says so and stays on the screen', async () => {
    const source = seeded();
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    // Another phone clears the order in the very tick of the press, before this screen's rows have caught up.
    const button = sendButton();
    act(() => {
      source.remoteMerge({ entries: { 'i-flour': { qty: 0 }, 'i-rye': { qty: 0 } } });
      button.click();
    });
    expect(await screen.findByText('Nothing left to record — those rows are already placed or empty.', undefined, LOAD)).toBeInTheDocument();
    expect(path(view)).toBe('/orders/send');
    expect(source.requests.size).toBe(0);
  });

  it('too many lines: says the most, sends nothing and stays', async () => {
    const entries: Record<string, { qty: number }> = {};
    const many = Array.from({ length: MAX_LINES + 1 }, (_, n) => {
      entries[`x${n}`] = { qty: 1 };
      return ingredient(`x${n}`, { name: `Item ${n}`, supplierId: 's-alp', unit: 'kg' });
    });
    const source = seeded({ ingredients: many, draft: { entries, days: { 's-alp': TODAY } } });
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText(`This order has too many lines to send as one list (the most is ${MAX_LINES}). Send it in parts.`, undefined, LOAD)).toBeInTheDocument();
    expect(path(view)).toBe('/orders/send');
    expect(source.requests.size).toBe(0);
  }, 30_000);

  it('failed: says the list was NOT sent, stays, and the order is untouched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = seeded();
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    source.failRequest = true;
    await view.user.click(sendButton());
    expect(await screen.findByText('The list was NOT sent — it is still here. Check the connection and try again.', undefined, LOAD)).toBeInTheDocument();
    expect(path(view)).toBe('/orders/send');
    expect(source.requests.size).toBe(0);
    expect(sendButton()).toBeEnabled();
    expect(sendScreen().getByRole('checkbox', { name: /^Alpine Mills/ })).toBeChecked();
  });
});

describe('«Nobody will be told»', () => {
  const away = (...rows: Array<{ uid: string }>) => rows.map(row => ({ id: row.uid, uid: row.uid, until: inDays(10) }));

  it('names the people who are away, agrees the verb with how many they are, and Send anyway sends', async () => {
    const source = seeded();
    source.roster = [BOSS, SECOND, { uid: 'u1', role: 'staff', firstName: 'Bo', lastName: '' }];
    source.awayDays = away(BOSS, SECOND);
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const dialog = within(await confirmation());
    expect(dialog.getByText('Nobody will be told')).toBeInTheDocument();
    expect(dialog.getByText(/^Ada Rossi, Giulia Bianchi are away, so no phone will ring for this list\./)).toBeInTheDocument();
    expect(source.requests.size).toBe(0);
    await view.user.click(dialog.getByRole('button', { name: 'Send anyway' }));
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
    expect(source.requests.size).toBe(1);
  });

  it('says «is» for one person', async () => {
    const source = seeded();
    source.roster = [BOSS, { uid: 'u1', role: 'staff', firstName: 'Bo', lastName: '' }];
    source.awayDays = away(BOSS);
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(within(await confirmation()).getByText(/^Ada Rossi is away, so no phone will ring/)).toBeInTheDocument();
  });

  it('prints «Someone» for a person with no name, never an address', async () => {
    const source = seeded();
    source.roster = [{ uid: 'boss', role: 'owner', firstName: '', lastName: '' }, { uid: 'u1', role: 'staff', firstName: 'Bo', lastName: '' }];
    source.awayDays = away(BOSS);
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(within(await confirmation()).getByText(/^Someone is away, so no phone will ring/)).toBeInTheDocument();
  });

  it('Cancel sends nothing and stays on the send screen with the ticks kept', async () => {
    const source = seeded();
    source.roster = [BOSS, { uid: 'u1', role: 'staff', firstName: 'Bo', lastName: '' }];
    source.awayDays = away(BOSS);
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await view.user.click(within(await confirmation()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.requests.size).toBe(0);
    expect(path(view)).toBe('/orders/send');
    expect(sendScreen().getByRole('checkbox', { name: /^Alpine Mills/ })).toBeChecked();
    expect(sendButton()).toBeEnabled();
  });

  it('⚠️ a roster that cannot be read goes straight on: no evidence is no warning', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = seeded();
    source.failRead = true;
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('says it in Italian, with the count deciding the verb', async () => {
    const source = seeded();
    source.roster = [BOSS, SECOND, { uid: 'u1', role: 'staff', firstName: 'Bo', lastName: '' }];
    source.awayDays = away(BOSS, SECOND);
    const view = await atList(source, { ...STAFF, lang: 'it' });
    await view.user.click(screen.getByRole('button', { name: 'Manda' }));
    const form = within(await screen.findByRole('region', { name: 'Manda l’ordine' }, LOAD));
    await view.user.click(form.getByRole('checkbox', { name: /^Alpine Mills/ }));
    await view.user.click(form.getByRole('button', { name: 'Manda' }));
    const dialog = within(await confirmation());
    expect(dialog.getByText('Non verrà avvisato nessuno')).toBeInTheDocument();
    expect(dialog.getByText(/^Ada Rossi, Giulia Bianchi sono in ferie/)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Manda lo stesso' })).toBeInTheDocument();
  });
});

describe('leaving during a send, and what is said while it waits', () => {
  type Reads<K extends 'getRoster' | 'readOwnMember'> = Awaited<ReturnType<FakeOrdersSource[K]>>;
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };
  const back = () => sendScreen().getByRole('button', { name: 'Back' });
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

  it('⚠️ Back during the away read: no list, no sentence, and sending again makes exactly one list', async () => {
    const source = seeded();
    const roster = deferred<Reads<'getRoster'>>();
    source.getRoster = () => roster.promise;
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText('Sending…')).toBeInTheDocument();
    await view.user.click(back());
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    roster.resolve([]);
    await settle();
    expect(source.requests.size).toBe(0);
    expect(screen.queryByText(SENT)).not.toBeInTheDocument();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
    expect(source.requests.size).toBe(1);
  });

  it('⚠️ Back during the name read: no list, and sending again makes exactly one list', async () => {
    const source = seeded();
    const member = deferred<Reads<'readOwnMember'>>();
    source.readOwnMember = () => member.promise;
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await waitFor(() => { expect(source.reads).toBeGreaterThan(1); });
    await view.user.click(back());
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    member.resolve({ firstName: 'Ada', lastName: 'Rossi' });
    await settle();
    expect(source.requests.size).toBe(0);
    expect(screen.queryByText(SENT)).not.toBeInTheDocument();
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
    expect(source.requests.size).toBe(1);
    expect([...source.requests.values()][0]).toMatchObject({ fromName: 'Ada Rossi' });
  });

  it('⚠️ Back after the write began: one list, its sentence is still said, and nobody is moved', async () => {
    const source = seeded();
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    const release = source.holdWrites();
    await view.user.click(sendButton());
    await waitFor(() => { expect(source.requests.size).toBe(1); });
    await view.user.click(back());
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    release();
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
    expect(path(view)).toBe('/orders');
    expect(source.requests.size).toBe(1);
  });

  it('⚠️ «Sending…» does not stay above the question; Cancel leaves nothing said', async () => {
    const source = seeded();
    source.roster = [BOSS, { uid: 'u1', role: 'staff', firstName: 'Bo', lastName: '' }];
    source.awayDays = [{ id: 'boss', uid: 'boss', until: inDays(10) }];
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const dialog = within(await confirmation());
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    await view.user.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(source.requests.size).toBe(0);
  });

  it('⚠️ «Sending…» is told again when the person says yes', async () => {
    const source = seeded();
    source.roster = [BOSS, { uid: 'u1', role: 'staff', firstName: 'Bo', lastName: '' }];
    source.awayDays = [{ id: 'boss', uid: 'boss', until: inDays(10) }];
    const view = await atList(source);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const dialog = within(await confirmation());
    const release = source.holdWrites();
    await view.user.click(dialog.getByRole('button', { name: 'Send anyway' }));
    expect(await screen.findByText('Sending…')).toBeInTheDocument();
    release();
    expect(await screen.findByText(SENT, undefined, LOAD)).toBeInTheDocument();
  });

  it('announces the statistic once for a list that is in the app, and not for one that failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const names: string[] = [];
    const listen = (event: Event) => { names.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      const source = seeded();
      const view = await atList(source);
      await toSend(view, 'Alpine Mills');
      source.failRequest = true;
      await view.user.click(sendButton());
      await screen.findByText('The list was NOT sent — it is still here. Check the connection and try again.', undefined, LOAD);
      expect(names).toStrictEqual([]);
      source.failRequest = false;
      await view.user.click(sendButton());
      await screen.findByText(SENT, undefined, LOAD);
      await waitFor(() => { expect(path(view)).toBe('/orders'); });
      expect(names).toStrictEqual(['order-request']);
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });
});

describe('«Send the list again» and what nobody was told', () => {
  // Flour was recorded today; rye was not, and 3 are typed: an addition nobody was told about.
  const record = { date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 2 }, stock: {}, names: {}, createdAt: `${TODAY}T09:00:00.000Z`, updatedAt: `${TODAY}T09:00:00.000Z` };
  const records = { [`${TODAY}_s-alp`]: record };
  const list = {
    date: TODAY, fromUid: 'u-1', fromName: 'Marco', quantities: { 'i-flour': 2, 'i-rye': 3 }, names: { 'i-flour': 'Flour', 'i-rye': 'Rye' },
    supplierOf: { 'i-flour': 's-alp', 'i-rye': 's-alp' }, supplierNames: { 's-alp': 'Alpine Mills' }, done: {}, note: '',
    createdAt: `${TODAY}T10:00:00.000Z`, updatedAt: `${TODAY}T10:00:00.000Z`,
  };
  const bell = () => screen.getByRole('button', { name: /^Notices/ });
  const panel = () => within(screen.getByRole('region', { name: 'Notices' }));

  it('offers the button to an employee whose venue has the road, in the panel, and it opens the send screen', async () => {
    const view = await atList(seeded({ ordersConfig: DEFAULT_ROADS, records }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await view.user.click(bell());
    await view.user.click(panel().getByRole('button', { name: 'Send the list again' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/send'); });
  });

  it('is NOT counted as a notice', async () => {
    await atList(seeded({ ordersConfig: DEFAULT_ROADS, records }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
  });

  it('is not shown to whoever runs the place, who is the person the list goes TO', async () => {
    const view = await atList(seeded({ ordersConfig: DEFAULT_ROADS, records }), {});
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await view.user.click(bell());
    expect(panel().queryByRole('button', { name: 'Send the list again' })).not.toBeInTheDocument();
  });

  it('is not shown to an employee whose venue closed the road', async () => {
    const closed = { sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } };
    const view = await atList(seeded({ ordersConfig: closed, records }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await view.user.click(bell());
    expect(panel().queryByRole('button', { name: 'Send the list again' })).not.toBeInTheDocument();
  });

  it('is not shown when the venue turned order lists off', async () => {
    const off = { orderLists: false, sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: false, email: false } };
    const view = await atList(seeded({ ordersConfig: off, records }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await view.user.click(bell());
    expect(panel().queryByRole('button', { name: 'Send the list again' })).not.toBeInTheDocument();
  });

  it('is not shown with nothing untold', async () => {
    const view = await atList(seeded({ ordersConfig: DEFAULT_ROADS, draft: { entries: { 'i-flour': { qty: 2 } }, days: { 's-alp': TODAY } }, records }));
    await view.user.click(bell());
    expect(await panel().findByText('No notices right now.')).toBeInTheDocument();
    expect(panel().queryByRole('button', { name: 'Send the list again' })).not.toBeInTheDocument();
  });

  it('⚠️ a number that a sent list carried is not flagged as untold', async () => {
    const source = seeded({ ordersConfig: DEFAULT_ROADS, records, requests: { 'r-1': list } });
    await atList(source);
    // The list has arrived once the Orders list says one is waiting.
    await screen.findByRole('button', { name: /^Order lists: 1 order list to place/ }, LOAD);
    expect(bell()).toHaveAccessibleName('Notices');
  });

  it('⚠️ is not guessed before the lists have arrived: no «nobody was told» from an unread list', async () => {
    const source = seeded({ ordersConfig: DEFAULT_ROADS, records, requests: { 'r-1': list } });
    source.watchOrderRequests = () => () => undefined;
    await atList(source);
    await waitFor(() => { expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0); });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(bell()).toHaveAccessibleName('Notices');
  });
});

describe('«asked» on the confirm screen', () => {
  const list = (quantities: Record<string, number>, extra: Record<string, unknown> = {}) => ({
    date: TODAY, fromUid: 'u-1', fromName: 'Marco', quantities, names: { 'i-flour': 'Flour', 'i-rye': 'Rye' },
    supplierOf: Object.fromEntries(Object.keys(quantities).map(id => [id, 's-alp'])), supplierNames: { 's-alp': 'Alpine Mills' },
    done: {}, note: '', createdAt: `${TODAY}T10:00:00.000Z`, updatedAt: `${TODAY}T10:00:00.000Z`, ...extra,
  });

  async function atConfirm(requests: Record<string, Record<string, unknown>>) {
    const view = renderOrders('/orders/supplier/s-alp/confirm', { source: seeded({ requests }), ...STAFF });
    await screen.findByText('This is what will be recorded:', undefined, LOAD);
    return view;
  }
  const row = (name: string) => screen.getByRole('spinbutton', { name }).closest('li') as HTMLElement;

  it('says what the list asked for beside a row it differs from, and only that row', async () => {
    // Flour: asked 5, 2 typed. Rye: asked 3, 3 typed — the same, so nothing is said.
    await atConfirm({ 'r-1': list({ 'i-flour': 5, 'i-rye': 3 }) });
    expect(within(row('Flour — Order')).getByText('asked: 5')).toBeInTheDocument();
    expect(within(row('Rye — Order')).queryByText(/asked/)).not.toBeInTheDocument();
  });

  it('says nothing for a row no list carried — «nobody asked» is not «asked for none»', async () => {
    await atConfirm({ 'r-1': list({ 'i-flour': 5 }) });
    expect(within(row('Rye — Order')).queryByText(/asked/)).not.toBeInTheDocument();
  });

  it('reads the highest of the day’s lists, and ignores a list of another day', async () => {
    await atConfirm({
      'r-1': list({ 'i-flour': 4 }),
      'r-2': list({ 'i-flour': 6 }, { createdAt: `${TODAY}T11:00:00.000Z` }),
      'r-3': list({ 'i-flour': 99 }, { date: inDays(-1) }),
    });
    expect(within(row('Flour — Order')).getByText('asked: 6')).toBeInTheDocument();
  });

  it('links «asked» and «usually» to the number box, each when it is there, so a screen reader reads both', async () => {
    await atConfirm({ 'r-1': list({ 'i-flour': 5 }) });
    const box = screen.getByRole('spinbutton', { name: 'Flour — Order' });
    expect(box).toHaveAccessibleDescription(/asked: 5/);
    const ids = (box.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id !== '');
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids.every(id => document.getElementById(id) !== null)).toBe(true);
  });

  it('says it in Italian', async () => {
    const view = renderOrders('/orders/supplier/s-alp/confirm', { source: seeded({ requests: { 'r-1': list({ 'i-flour': 5 }) } }), ...STAFF, lang: 'it' });
    await screen.findByText('Sta per essere registrato:', undefined, LOAD);
    expect(view.source.requests.size).toBe(1);
    expect(screen.getByText('chiesti: 5')).toBeInTheDocument();
  });
});

describe('the mute switch for this phone', () => {
  const atSettings = (source = seeded(), options: Options = STAFF) => {
    const view = renderOrders('/orders/settings', { source, ...options });
    return view;
  };
  const muteSwitch = () => screen.findByRole('switch', { name: 'Do not buzz this phone about order lists' }, LOAD);

  it('writes the token’s document and remembers on this phone when saved, with the line that the list still appears', async () => {
    window.localStorage.setItem(PUSH_TOKEN_KEY, 'tok-1');
    const source = seeded();
    const view = atSettings(source);
    const toggle = await muteSwitch();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('The list still appears in the app — this only silences the alert.')).toBeInTheDocument();
    await view.user.click(toggle);
    await waitFor(() => { expect(source.mutes).toStrictEqual([{ token: 'tok-1', mute: true }]); });
    await waitFor(() => { expect(window.localStorage.getItem(MUTE_KEY)).toBe('1'); });
    expect(toggle).toBeChecked();
    await view.user.click(toggle);
    await waitFor(() => { expect(source.mutes.at(-1)).toStrictEqual({ token: 'tok-1', mute: false }); });
    await waitFor(() => { expect(window.localStorage.getItem(MUTE_KEY)).toBe('0'); });
  });

  it('starts as this phone remembers it', async () => {
    window.localStorage.setItem(PUSH_TOKEN_KEY, 'tok-1');
    window.localStorage.setItem(MUTE_KEY, '1');
    atSettings();
    expect(await muteSwitch()).toBeChecked();
  });

  it('⚠️ a refusal says so, comes back, and remembers nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.localStorage.setItem(PUSH_TOKEN_KEY, 'tok-1');
    const source = seeded();
    const view = atSettings(source);
    const toggle = await muteSwitch();
    source.failRequest = true;
    await view.user.click(toggle);
    expect(await screen.findByText('Not saved. Check the connection and try again.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(toggle).not.toBeChecked(); });
    expect(window.localStorage.getItem(MUTE_KEY)).toBeNull();
  });

  it('⚠️ with no token on this phone it is off and disabled, and says this phone receives no alerts yet', async () => {
    const source = seeded();
    atSettings(source);
    const toggle = await muteSwitch();
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('This phone does not receive alerts yet, so there is nothing to silence.')).toBeInTheDocument();
    expect(source.mutes).toHaveLength(0);
  });

  it('is hidden when the venue turned order lists off', async () => {
    window.localStorage.setItem(PUSH_TOKEN_KEY, 'tok-1');
    atSettings(seeded({ ordersConfig: { orderLists: false } }));
    await screen.findByRole('region', { name: 'Settings' }, LOAD);
    await waitFor(() => { expect(screen.getByRole('switch', { name: /Check deliveries|goods/i })).toBeInTheDocument(); }, LOAD);
    expect(screen.queryByRole('switch', { name: 'Do not buzz this phone about order lists' })).not.toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    window.localStorage.setItem(PUSH_TOKEN_KEY, 'tok-1');
    atSettings(seeded(), { ...STAFF, lang: 'it' });
    expect(await screen.findByRole('switch', { name: 'Non far suonare questo telefono per le liste d’ordine' }, LOAD)).toBeInTheDocument();
    expect(screen.getByText('La lista compare comunque nell’app — questo toglie solo l’avviso sonoro.')).toBeInTheDocument();
  });
});
