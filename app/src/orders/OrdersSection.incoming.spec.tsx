import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», step 3f-5: the debt banner and the two doors, Incoming, «What arrived?», «To re-order» and the goods-arrived switch.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
const ALL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ⚠️ THE WEEK STARTS THREE DAYS AGO whatever day the suite runs on, so «this week» holds the days -3 to today and anything older is
// the debt. Without it the groups below would depend on the weekday of the run.
const WEEK_START = weekdayOf(inDays(-3)) as string;
const CONFIG = { weekStartsOn: WEEK_START };

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', deliveryDays: ALL_DAYS, active: true }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', active: true }),
  supplier('s-bee', { name: 'Bee Farm', active: true }),
  supplier('s-off', { name: 'Closed Co', active: false }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Milk', supplierId: 's-zed', unit: 'l' }),
  ingredient('i-free', { name: 'Loose' }),
  ingredient('i-stop', { name: 'Stopped', supplierId: 's-alp', active: false }),
  ingredient('i-cold', { name: 'Stranded', supplierId: 's-off' }),
];

function record(date: string, supplierId: string, supplierName: string, quantities: Record<string, number>, extra: Record<string, unknown> = {}) {
  return { date, supplierId, supplierName, quantities, stock: {}, names: {}, createdAt: `${date}T09:12:00.000Z`, updatedAt: `${date}T09:12:00.000Z`, ...extra };
}
const idOf = (date: string, supplierId: string): string => `${date}_${supplierId}`;
const UNITS = { units: { 'i-flour': 'kg', 'i-rye': 'kg' } };
const ARRIVED = '2026-10-20T10:00:00.000Z';

function seeded(
  records: Record<string, Record<string, unknown>> = {},
  extra: { ordersConfig?: Record<string, unknown> | null; draft?: Record<string, unknown> | null; suppliers?: typeof SUPPLIERS } = {},
): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, records, ordersConfig: CONFIG, ...extra });
}

// One of each group: the debt (10 days ago), late (ordered 3 days ago, expected 2 days ago), due today (ordered yesterday), coming
// (ordered today), and a supplier with no delivery days (also coming).
function week(): Record<string, Record<string, unknown>> {
  return {
    [idOf(inDays(-10), 's-alp')]: record(inDays(-10), 's-alp', 'Alpine Mills', { 'i-flour': 2 }, UNITS),
    [idOf(inDays(-3), 's-alp')]: record(inDays(-3), 's-alp', 'Alpine Mills', { 'i-flour': 2, 'i-rye': 1 }, UNITS),
    [idOf(inDays(-1), 's-alp')]: record(inDays(-1), 's-alp', 'Alpine Mills', { 'i-rye': 5 }),
    [idOf(TODAY, 's-alp')]: record(TODAY, 's-alp', 'Alpine Mills', { 'i-flour': 1 }),
    [idOf(TODAY, 's-zed')]: record(TODAY, 's-zed', 'Zed', { 'i-milk': 4 }),
  };
}

const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
type View = ReturnType<typeof renderOrders>;

const incoming = () => within(screen.getByRole('region', { name: 'Incoming' }));
const arrivedPicker = () => within(screen.getByRole('region', { name: 'What arrived?' }));
const reorder = () => within(screen.getByRole('region', { name: 'To re-order' }));
const dialog = (role: 'alertdialog' | 'dialog' = 'alertdialog') => screen.findByRole(role, undefined, LOAD);
const door = (name: RegExp | string) => screen.findByRole('button', { name }, LOAD);

async function atList(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

async function atIncoming(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}) {
  const view = renderOrders('/orders/incoming', { source, ...options });
  await screen.findByRole('region', { name: 'Incoming' }, LOAD);
  return view;
}

async function atReorder(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}) {
  const view = renderOrders('/orders/reorder', { source, ...options });
  await screen.findByRole('region', { name: 'To re-order' }, LOAD);
  return view;
}

// Escape, once the focus is inside the open dialog: before that, on a slow runner, the key lands on the page and nothing hears it.
async function escapeFrom(view: View, open: HTMLElement) {
  await waitFor(() => { expect(open.contains(document.activeElement)).toBe(true); }, LOAD);
  await view.user.keyboard('{Escape}');
}

const rowOf = (name: string | RegExp, index = 0) => incoming().getAllByRole('button', { name: new RegExp(typeof name === 'string' ? `^${name}` : name.source) })[index] as HTMLElement;

describe('the debt banner and the two doors', () => {
  it('shows the banner and both doors while the venue checks deliveries, with the debt on «Incoming»', async () => {
    await atList(seeded(week()));
    expect(await screen.findByRole('button', { name: '1 order from before this week — did it arrive?' }, LOAD)).toBeInTheDocument();
    const incomingDoor = screen.getByRole('button', { name: 'Incoming — 1 order owed' });
    expect(incomingDoor).toHaveTextContent('Incoming1');
    // «To re-order» never hides, only its number: nothing is missing here, so it is plain.
    expect(screen.getByRole('button', { name: 'To re-order' })).toHaveTextContent('To re-order');
  });

  it('counts what is still to re-order on its door, and the plain name of «Incoming» when nothing is owed', async () => {
    await atList(seeded({
      [idOf(inDays(-1), 's-alp')]: record(inDays(-1), 's-alp', 'Alpine Mills', { 'i-flour': 3, 'i-rye': 2 }, { deliveredAt: ARRIVED, missing: { 'i-flour': true, 'i-rye': true } }),
    }));
    expect(await screen.findByRole('button', { name: 'To re-order (2)' }, LOAD)).toHaveTextContent('To re-order2');
    expect(screen.getByRole('button', { name: 'Incoming' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /before this week/ })).not.toBeInTheDocument();
  });

  it('draws neither the banner nor the doors when the switch is off, and takes them away when another phone turns it off', async () => {
    const source = seeded(week());
    await atList(source);
    expect(await door(/^Incoming/)).toBeInTheDocument();
    act(() => { source.ordersConfig = { ...CONFIG, deliveryCheck: false }; source.emit(); });
    await waitFor(() => { expect(screen.queryByRole('button', { name: /^Incoming/ })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('button', { name: /^To re-order/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /before this week/ })).not.toBeInTheDocument();
  });

  it('sends the three addresses back to the list while the switch is off', async () => {
    for (const address of ['/orders/incoming', '/orders/incoming/2026-10-27_s-alp', '/orders/reorder']) {
      const view = renderOrders(address, { source: seeded(week(), { ordersConfig: { ...CONFIG, deliveryCheck: false } }) });
      await waitFor(() => { expect(path(view)).toBe('/orders'); }, LOAD);
      expect(view.router.state.historyAction).toBe('REPLACE');
      cleanup();
    }
  });

  it('opens Incoming from the door and from the banner, and Back hands the focus to the door', async () => {
    const view = await atList(seeded(week()));
    await view.user.click(await door(/^Incoming/));
    await screen.findByRole('region', { name: 'Incoming' });
    expect(path(view)).toBe('/orders/incoming');
    await view.user.click(incoming().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Incoming/ })).toHaveFocus(); });

    await view.user.click(screen.getByRole('button', { name: /before this week/ }));
    await screen.findByRole('region', { name: 'Incoming' });
    await view.user.click(incoming().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Incoming/ })).toHaveFocus(); });
  });

  it('opens «To re-order» from its door, and Back hands the focus to the door', async () => {
    const view = await atList(seeded(week()));
    await view.user.click(await door('To re-order'));
    await screen.findByRole('region', { name: 'To re-order' });
    expect(path(view)).toBe('/orders/reorder');
    await view.user.click(reorder().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'To re-order' })).toHaveFocus(); });
  });
});

describe('Incoming', () => {
  it('lists the debt first, then late, due today and coming, each under its heading, with the lines of each row', async () => {
    await atIncoming(seeded(week()));
    await screen.findByRole('heading', { name: 'From before this week' }, LOAD);
    const headings = incoming().getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(headings).toEqual(['From before this week', 'Late', 'Due today', 'Coming']);

    // The debt row has no expected day: only the ordered line. The others say when they are expected.
    const [owed, late, due, comingAlp, comingZed] = incoming().getAllByRole('listitem');
    expect(owed).toHaveTextContent('Alpine Mills');
    expect(owed).toHaveTextContent('Ordered');
    expect(owed).toHaveTextContent('1 item');
    expect(owed).not.toHaveTextContent('Expected');
    expect(late).toHaveTextContent('Expected');
    expect(late).toHaveTextContent('2 items');
    expect(due).toHaveTextContent('1 item');
    expect(comingAlp).toHaveTextContent('Expected');
    expect(comingZed).toHaveTextContent('Zed');
    expect(comingZed).toHaveTextContent('No delivery days set for this supplier');
  });

  it('says «No orders placed yet.» for a venue that never ordered, and «Everything ordered has arrived.» once all are answered', async () => {
    await atIncoming(seeded());
    expect(await incoming().findByText('No orders placed yet.', undefined, LOAD)).toBeInTheDocument();
    cleanup();
    await atIncoming(seeded({ [idOf(inDays(-1), 's-alp')]: record(inDays(-1), 's-alp', 'Alpine Mills', { 'i-flour': 1 }, { deliveredAt: ARRIVED }) }));
    expect(await incoming().findByText('Everything ordered has arrived.', undefined, LOAD)).toBeInTheDocument();
  });

  it('never asks about an order recorded before the day the switch was turned back on', async () => {
    await atIncoming(seeded(week(), { ordersConfig: { ...CONFIG, deliveryCheck: true, deliveryCheckFrom: inDays(-1) } }));
    await screen.findByRole('heading', { name: 'Due today' }, LOAD);
    expect(incoming().queryByRole('heading', { name: 'From before this week' })).not.toBeInTheDocument();
    expect(incoming().queryByRole('heading', { name: 'Late' })).not.toBeInTheDocument();
  });

  it('asks «Has it arrived?», and «Everything arrived» writes the answer without waiting for the server', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Due today' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 2));
    const question = await dialog();
    expect(within(question).getByText('Has it arrived from Alpine Mills?')).toBeInTheDocument();
    const letGo = source.holdWrites();
    await view.user.click(within(question).getByRole('button', { name: 'Everything arrived' }));
    await waitFor(() => { expect(source.deliveryWrites).toHaveLength(1); });
    const write = source.deliveryWrites[0];
    expect(write).toMatchObject({ kind: 'confirm', id: idOf(inDays(-1), 's-alp') });
    expect(write).toMatchObject({ patch: { missing: {} } });
    expect(typeof (write as { patch: Record<string, unknown> }).patch.deliveredAt).toBe('string');
    // The row left at once, on this phone, while the write is still held (offline).
    await waitFor(() => { expect(incoming().queryByRole('heading', { name: 'Due today' })).not.toBeInTheDocument(); });
    letGo();
  });

  it('answers a debt row the same way, one row at a time', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'From before this week' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 0));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Everything arrived' }));
    await waitFor(() => { expect(source.deliveryWrites).toHaveLength(1); });
    expect(source.deliveryWrites[0]).toMatchObject({ kind: 'confirm', id: idOf(inDays(-10), 's-alp') });
    await waitFor(() => { expect(incoming().queryByRole('heading', { name: 'From before this week' })).not.toBeInTheDocument(); });
    expect(incoming().getByRole('heading', { name: 'Late' })).toBeInTheDocument();
  });

  it('«Something is missing» opens «What arrived?» with every line ticked; unticking one and saving writes exactly that id', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Late' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 1));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Something is missing' }));
    await screen.findByRole('region', { name: 'What arrived?' });
    expect(path(view)).toBe(`/orders/incoming/${idOf(inDays(-3), 's-alp')}`);
    expect(screen.getByText('Untick anything that did NOT arrive.')).toBeInTheDocument();

    const boxes = arrivedPicker().getAllByRole('checkbox');
    // Sorted by the name shown, with the quantity and unit.
    expect(arrivedPicker().getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour2 × kg', 'Rye1 × kg']);
    expect(boxes.every(box => (box as HTMLInputElement).checked)).toBe(true);
    await view.user.click(arrivedPicker().getByRole('checkbox', { name: /Rye/ }));
    await view.user.click(arrivedPicker().getByRole('button', { name: 'Save' }));

    // No second question: the screen is the answer. Back on Incoming, the row is answered.
    await waitFor(() => { expect(path(view)).toBe('/orders/incoming'); });
    expect(source.deliveryWrites).toHaveLength(1);
    expect(source.deliveryWrites[0]).toMatchObject({ kind: 'confirm', id: idOf(inDays(-3), 's-alp'), patch: { missing: { 'i-rye': true } } });
    await waitFor(() => { expect(incoming().queryByRole('heading', { name: 'Late' })).not.toBeInTheDocument(); });
  });

  it('opens an order that already carries missing marks straight on the rows, those lines unticked', async () => {
    const source = seeded({
      [idOf(inDays(-1), 's-alp')]: record(inDays(-1), 's-alp', 'Alpine Mills', { 'i-flour': 3, 'i-rye': 2 }, { missing: { 'i-rye': true } }),
    });
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Due today' }, LOAD);
    await view.user.click(rowOf('Alpine Mills'));
    await screen.findByRole('region', { name: 'What arrived?' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect((arrivedPicker().getByRole('checkbox', { name: /Flour/ }) as HTMLInputElement).checked).toBe(true);
    expect((arrivedPicker().getByRole('checkbox', { name: /Rye/ }) as HTMLInputElement).checked).toBe(false);
    // Saved as it stands, the old mark is kept.
    await view.user.click(arrivedPicker().getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.deliveryWrites).toHaveLength(1); });
    expect(source.deliveryWrites[0]).toMatchObject({ patch: { missing: { 'i-rye': true } } });
  });

  it('writes nothing when Escape closes the question, and the row stays', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Due today' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 2));
    await escapeFrom(view, await dialog());
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.deliveryWrites).toEqual([]);
    expect(path(view)).toBe('/orders/incoming');
    expect(incoming().getByRole('heading', { name: 'Due today' })).toBeInTheDocument();
  });

  it('asks before leaving «What arrived?» with a changed tick, and keeps it on Cancel', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Late' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 1));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Something is missing' }));
    await screen.findByRole('region', { name: 'What arrived?' });
    // Nothing changed: Back leaves without a question.
    await view.user.click(arrivedPicker().getByRole('checkbox', { name: /Rye/ }));
    await view.user.click(arrivedPicker().getByRole('button', { name: 'Back' }));
    const asked = await dialog();
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(path(view)).toBe(`/orders/incoming/${idOf(inDays(-3), 's-alp')}`);
    expect((arrivedPicker().getByRole('checkbox', { name: /Rye/ }) as HTMLInputElement).checked).toBe(false);

    await view.user.click(arrivedPicker().getByRole('button', { name: 'Back' }));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/incoming'); });
    expect(source.deliveryWrites).toEqual([]);
  });

  it('leaves «What arrived?» with no question while no tick was changed', async () => {
    const view = await atIncoming(seeded(week()));
    await screen.findByRole('heading', { name: 'Late' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 1));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Something is missing' }));
    await screen.findByRole('region', { name: 'What arrived?' });
    await view.user.click(arrivedPicker().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/incoming'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('says so when the server refuses an answer, and the row comes back', async () => {
    const source = seeded(week());
    source.failDelivery.confirm = true;
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Due today' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 2));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Everything arrived' }));
    expect(await screen.findByText('Not saved. Check the connection and try again.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(incoming().getByRole('heading', { name: 'Due today' })).toBeInTheDocument(); });
  });

  it('opens the rows instead of answering when the order gained missing marks while the question was open', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Due today' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 2));
    const question = await dialog();
    // A same-day second order merged in: the order carries a mark again and is still unanswered.
    const id = idOf(inDays(-1), 's-alp');
    act(() => { source.records.set(id, { ...(source.records.get(id) as Record<string, unknown>), missing: { 'i-rye': true } }); source.emitHistory(); });
    await view.user.click(within(question).getByRole('button', { name: 'Everything arrived' }));
    await screen.findByRole('region', { name: 'What arrived?' });
    expect(source.deliveryWrites).toEqual([]);
    expect(path(view)).toBe(`/orders/incoming/${id}`);
  });

  it('closes the question for good when its order is answered elsewhere, and does not bring it back', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Due today' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 2));
    await dialog();
    const id = idOf(inDays(-1), 's-alp');
    const before = source.records.get(id) as Record<string, unknown>;
    act(() => { source.records.set(id, { ...before, deliveredAt: ARRIVED, missing: {} }); source.emitHistory(); });
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    act(() => { source.records.set(id, before); source.emitHistory(); });
    await screen.findByRole('heading', { name: 'Due today' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.deliveryWrites).toEqual([]);
  });

  it('stays on the loading line, without «no longer there», when the order stream died', async () => {
    const source = seeded(week());
    source.refuse.history = true;
    const view = renderOrders(`/orders/incoming/${idOf(inDays(-1), 's-alp')}`, { source });
    await screen.findByRole('region', { name: 'What arrived?' }, LOAD);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByText('This order is no longer there.')).not.toBeInTheDocument();
    expect(path(view)).toBe(`/orders/incoming/${idOf(inDays(-1), 's-alp')}`);
    expect(arrivedPicker().getByText('Loading…')).toBeInTheDocument();
  });

  it('says «This order is no longer there.» for an order that is not in the window, and goes back to Incoming', async () => {
    const view = renderOrders('/orders/incoming/2026-01-01_s-alp', { source: seeded(week()) });
    expect(await screen.findByText('This order is no longer there.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(path(view)).toBe('/orders/incoming'); });
    expect(view.router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('region', { name: 'Incoming' })).toBeInTheDocument();
  });

  it('hands the focus back to the row, or to the title when the row is gone', async () => {
    const source = seeded(week());
    const view = await atIncoming(source);
    await screen.findByRole('heading', { name: 'Late' }, LOAD);
    await view.user.click(rowOf('Alpine Mills', 1));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Something is missing' }));
    await screen.findByRole('region', { name: 'What arrived?' });
    await view.user.click(arrivedPicker().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(rowOf('Alpine Mills', 1)).toHaveFocus(); });

    await view.user.click(rowOf('Alpine Mills', 1));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Something is missing' }));
    await screen.findByRole('region', { name: 'What arrived?' });
    await view.user.click(arrivedPicker().getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/incoming'); });
    await waitFor(() => { expect(incoming().getByRole('heading', { name: 'Incoming', level: 2 })).toHaveFocus(); });
  });
});

describe('To re-order', () => {
  // Four lines missed ten days ago from Alpine Mills: a live one, one switched off, one whose supplier is closed, one whose
  // ingredient is gone (its name is the one frozen into the order).
  function missed(extra: Record<string, unknown> = {}) {
    return {
      [idOf(inDays(-5), 's-alp')]: record(inDays(-5), 's-alp', 'Alpine Mills', { 'i-flour': 4, 'i-stop': 1, 'i-cold': 2, 'i-ghost': 3 }, {
        deliveredAt: ARRIVED,
        units: { 'i-flour': 'kg' },
        missing: { 'i-flour': true, 'i-stop': true, 'i-cold': true, 'i-ghost': true },
        names: { 'i-ghost': 'Old name' },
        ...extra,
      }),
    };
  }
  const cards = () => reorder().getAllByRole('listitem');
  const cardOf = (name: string) => cards().find(card => within(card).queryByText(name) !== null) as HTMLElement;
  const buttonsOf = (name: string) => within(cardOf(name)).getAllByRole('button').map(button => button.textContent);

  it('draws one card per line, newest first, with the name, the quantity, where it was missed from and when', async () => {
    await atReorder(seeded(missed()));
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    expect(cards().map(card => within(card).getAllByText(/./)[0]?.textContent)).toEqual(['Stranded', 'Flour', 'Old name', 'Stopped']);
    const flour = cardOf('Flour');
    expect(flour).toHaveTextContent('4 × kg');
    expect(flour).toHaveTextContent('from Alpine Mills · did not arrive');
  });

  it('offers each button only where it can work', async () => {
    await atReorder(seeded(missed()));
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    // A live ingredient with an active supplier: all three.
    expect(buttonsOf('Flour')).toEqual(['Put back in Alpine Mills’s order', 'Order from another supplier', 'Resolved']);
    // Its supplier is closed: nowhere to put it back, but it can be ordered elsewhere.
    expect(buttonsOf('Stranded')).toEqual(['Order from another supplier', 'Resolved']);
    // Switched off, or gone: a quantity typed for it would sit on a row nobody can see.
    expect(buttonsOf('Stopped')).toEqual(['Resolved']);
    expect(buttonsOf('Old name')).toEqual(['Resolved']);
  });

  it('offers no other supplier when the ingredient’s own is the only one in use', async () => {
    await atReorder(seeded(missed(), { suppliers: [SUPPLIERS[0] as (typeof SUPPLIERS)[number]] }));
    await waitFor(() => { expect(cards().length).toBeGreaterThan(0); }, LOAD);
    expect(buttonsOf('Flour')).toEqual(['Put back in Alpine Mills’s order', 'Resolved']);
  });

  it('names each button after its line for a screen reader', async () => {
    await atReorder(seeded(missed()));
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    const flour = within(cardOf('Flour'));
    expect(flour.getByRole('button', { name: 'Put back in Alpine Mills’s order — Flour' })).toBeInTheDocument();
    expect(flour.getByRole('button', { name: 'Order from another supplier — Flour' })).toBeInTheDocument();
    expect(flour.getByRole('button', { name: 'Resolved — Flour' })).toBeInTheDocument();
  });

  it('puts a line back in its own supplier’s order, sent at once, and the card leaves', async () => {
    const source = seeded(missed());
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: /^Put back in/ }));
    await waitFor(() => { expect(source.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 4 }); }, LOAD);
    await waitFor(() => { expect(cards()).toHaveLength(3); });
    expect(within(reorder().getByRole('list')).queryByText('Flour')).not.toBeInTheDocument();
  });

  it('ignores a second press on the list right after «Put back», so the next card’s line is not put back too', async () => {
    const source = seeded({
      [idOf(inDays(-5), 's-alp')]: record(inDays(-5), 's-alp', 'Alpine Mills', { 'i-flour': 4, 'i-rye': 2 }, {
        deliveredAt: ARRIVED, units: { 'i-flour': 'kg', 'i-rye': 'kg' }, missing: { 'i-flour': true, 'i-rye': true },
      }),
    });
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(2); }, LOAD);
    const first = () => reorder().getAllByRole('button', { name: /^Put back in/ })[0] as HTMLElement;
    await view.user.click(first());
    await view.user.click(first());
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, LOAD);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(Object.keys(source.writes.at(-1)?.entries ?? {})).toHaveLength(1);
    expect(cards()).toHaveLength(1);
  });

  it('says the line cannot be put back any more, not «Not saved», when its ingredient went off meanwhile', async () => {
    const source = seeded(missed());
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    const button = within(cardOf('Flour')).getByRole('button', { name: /^Put back in/ });
    // The data moves and the press lands before the screen has redrawn: the store, which reads the data as it is, says 'gone'.
    source.ingredients.set('i-flour', { ...(source.ingredients.get('i-flour') as Record<string, unknown>), active: false } as never);
    source.emit();
    button.click();
    expect(await screen.findByText('This line cannot be put back any more: the ingredient or the supplier is no longer in use.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Not saved. Check the connection and try again.')).not.toBeInTheDocument();
    expect(source.writes).toEqual([]);
  });

  it('does not reopen the chooser by itself when the line it was about comes back', async () => {
    const source = seeded(missed());
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: /^Order from another supplier/ }));
    await dialog('dialog');
    const id = idOf(inDays(-5), 's-alp');
    const before = source.records.get(id) as Record<string, unknown>;
    act(() => { source.records.set(id, { ...before, missing: { ...(before.missing as object), 'i-flour': undefined } }); source.emitHistory(); });
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    act(() => { source.records.set(id, before); source.emitHistory(); });
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the chooser with the right suppliers, writes nothing on Escape, and orders from the one chosen for this order only', async () => {
    const source = seeded(missed());
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: /^Order from another supplier/ }));
    const chooser = await dialog('dialog');
    expect(within(chooser).getByText('Choose a supplier')).toBeInTheDocument();
    expect(within(chooser).getByText('Flour goes in the order of the supplier you choose, for this order only. It stays with Alpine Mills.')).toBeInTheDocument();
    // Never the usual supplier, never a closed one, sorted by the name read.
    expect(within(chooser).getAllByRole('button').map(button => button.textContent)).toEqual(['Bee Farm', 'Zed', 'Cancel']);

    await escapeFrom(view, chooser);
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(source.writes).toEqual([]);
    expect(path(view)).toBe('/orders/reorder');

    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: /^Order from another supplier/ }));
    await view.user.click(within(await dialog('dialog')).getByRole('button', { name: 'Order Flour from Zed' }));
    await waitFor(() => { expect(source.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 4, supplierId: 's-zed' }); }, LOAD);
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(source.deliveryWrites).toEqual([]);
  });

  it('leaves out «It stays with …» when the ingredient has no usual supplier, and lists every active one', async () => {
    const view = await atReorder(seeded({
      [idOf(inDays(-5), 's-alp')]: record(inDays(-5), 's-alp', 'Alpine Mills', { 'i-free': 2 }, { deliveredAt: ARRIVED, missing: { 'i-free': true } }),
    }));
    await waitFor(() => { expect(cards()).toHaveLength(1); }, LOAD);
    await view.user.click(within(cardOf('Loose')).getByRole('button', { name: /^Order from another supplier/ }));
    const chooser = await dialog('dialog');
    expect(within(chooser).getByText('Loose goes in the order of the supplier you choose, for this order only.')).toBeInTheDocument();
    expect(within(chooser).getAllByRole('button').map(button => button.textContent)).toEqual(['Alpine Mills', 'Bee Farm', 'Zed', 'Cancel']);
    // …and no «Put back»: it has no supplier of its own to go back to.
    await view.user.click(within(chooser).getByRole('button', { name: 'Cancel' }));
    expect(buttonsOf('Loose')).toEqual(['Order from another supplier', 'Resolved']);
  });

  it('asks before «Resolved», writes nothing on Cancel, and writes the line’s resolution on Resolved', async () => {
    const source = seeded(missed());
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: 'Resolved — Flour' }));
    const asked = await dialog();
    expect(within(asked).getByText('Mark it as resolved?')).toBeInTheDocument();
    expect(within(asked).getByText(/Flour leaves this list/)).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(source.deliveryWrites).toEqual([]);
    expect(cards()).toHaveLength(4);

    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: 'Resolved — Flour' }));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Resolved' }));
    await waitFor(() => { expect(source.deliveryWrites).toHaveLength(1); });
    expect(source.deliveryWrites[0]).toMatchObject({ kind: 'resolve', id: idOf(inDays(-5), 's-alp'), ingredientId: 'i-flour' });
    await waitFor(() => { expect(cards()).toHaveLength(3); });
  });

  it('keeps the card usable and says so when «Resolved» is refused', async () => {
    const source = seeded(missed());
    source.failDelivery.resolve = true;
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: 'Resolved — Flour' }));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Resolved' }));
    expect(await screen.findByText('Not saved. Check the connection and try again.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(cards()).toHaveLength(4); });
    await waitFor(() => {
      for (const button of within(cardOf('Flour')).getAllByRole('button')) expect(button).toBeEnabled();
    });
  });

  it('keeps every button of a card off while its «Resolved» is in the air', async () => {
    const source = seeded(missed());
    const view = await atReorder(source);
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    const letGo = source.holdWrites();
    await view.user.click(within(cardOf('Flour')).getByRole('button', { name: 'Resolved — Flour' }));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Resolved' }));
    await waitFor(() => { expect(source.deliveryWrites).toHaveLength(1); });
    // The card is already gone on this phone (local-first); the other cards are untouched.
    await waitFor(() => { expect(cards()).toHaveLength(3); });
    for (const button of within(cardOf('Stranded')).getAllByRole('button')) expect(button).toBeEnabled();
    letGo();
  });

  it('moves the focus to the next card when the card that held it is answered', async () => {
    const view = await atReorder(seeded(missed()));
    await waitFor(() => { expect(cards()).toHaveLength(4); }, LOAD);
    // Stranded is first, Flour second.
    await view.user.click(within(cardOf('Stranded')).getByRole('button', { name: 'Resolved — Stranded' }));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Resolved' }));
    await waitFor(() => { expect(cards()).toHaveLength(3); });
    await waitFor(() => {
      expect(within(cardOf('Flour')).getAllByRole('button')[0]).toHaveFocus();
    }, LOAD);
  });

  it('moves the focus to the title when the last card goes, and keeps the screen open on its empty text', async () => {
    const view = await atReorder(seeded({
      [idOf(inDays(-5), 's-alp')]: record(inDays(-5), 's-alp', 'Alpine Mills', { 'i-stop': 1 }, { deliveredAt: ARRIVED, missing: { 'i-stop': true } }),
    }));
    await waitFor(() => { expect(cards()).toHaveLength(1); }, LOAD);
    await view.user.click(within(cardOf('Stopped')).getByRole('button', { name: 'Resolved — Stopped' }));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Resolved' }));
    expect(await reorder().findByText('Nothing to re-order.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(reorder().getByRole('heading', { name: 'To re-order' })).toHaveFocus(); }, LOAD);
    expect(path(view)).toBe('/orders/reorder');
  });

  it('shows «Nothing to re-order.» when nothing is missing', async () => {
    await atReorder(seeded(week()));
    expect(await reorder().findByText('Nothing to re-order.', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('the goods-arrived switch in the settings', () => {
  it('lets a manager turn it off, writing only the switch, and the doors go', async () => {
    const source = seeded(week());
    const view = renderOrders('/orders/settings', { source });
    const toggle = await screen.findByRole('switch', { name: 'Check deliveries' }, LOAD);
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.getByText(/Asks “Did it all arrive\?” for every order/)).toBeInTheDocument();
    await view.user.click(toggle);
    await waitFor(() => { expect(source.deliveryWrites).toEqual([{ kind: 'config', patch: { deliveryCheck: false, deliveryCheckOffOn: TODAY } }]); });
    await waitFor(() => { expect(screen.getByRole('switch', { name: 'Check deliveries' })).not.toBeChecked(); });
    await view.user.click(within(screen.getByRole('region', { name: 'Settings' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders'); });
    expect(screen.queryByRole('button', { name: /^Incoming/ })).not.toBeInTheDocument();
  });

  it('asks before turning it back on, and then counts from today', async () => {
    const source = seeded(week(), { ordersConfig: { ...CONFIG, deliveryCheck: false } });
    const view = renderOrders('/orders/settings', { source });
    await view.user.click(await screen.findByRole('switch', { name: 'Check deliveries' }, LOAD));
    const asked = await dialog();
    expect(within(asked).getByText('Turn the check back on?')).toBeInTheDocument();
    expect(within(asked).getByText('Orders placed before today will not be asked about: “Incoming” counts from today.')).toBeInTheDocument();
    expect(source.deliveryWrites).toEqual([]);
    await view.user.click(within(asked).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => { expect(source.deliveryWrites).toEqual([{ kind: 'config', patch: { deliveryCheck: true, deliveryCheckFrom: TODAY } }]); });
  });

  it('writes nothing and leaves the switch off when the question is cancelled', async () => {
    const source = seeded(week(), { ordersConfig: { ...CONFIG, deliveryCheck: false } });
    const view = renderOrders('/orders/settings', { source });
    await view.user.click(await screen.findByRole('switch', { name: 'Check deliveries' }, LOAD));
    await view.user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.deliveryWrites).toEqual([]);
    expect(screen.getByRole('switch', { name: 'Check deliveries' })).not.toBeChecked();
  });

  it('turns it back on the day it went off with no question, keeping the day it counted from', async () => {
    const source = seeded(week(), { ordersConfig: { ...CONFIG, deliveryCheck: false, deliveryCheckOffOn: TODAY, deliveryCheckFrom: inDays(-20) } });
    const view = renderOrders('/orders/settings', { source });
    await view.user.click(await screen.findByRole('switch', { name: 'Check deliveries' }, LOAD));
    await waitFor(() => { expect(source.deliveryWrites).toEqual([{ kind: 'config', patch: { deliveryCheck: true } }]); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the switch off until the config has arrived', async () => {
    const source = seeded(week());
    source.watchOrdersConfig = () => () => {};
    const view = renderOrders('/orders/settings', { source });
    const toggle = await screen.findByRole('switch', { name: 'Check deliveries' }, LOAD);
    expect(toggle).toBeDisabled();
    await view.user.click(toggle);
    expect(source.deliveryWrites).toEqual([]);
  });

  it('shows it switched off for staff, with the sentence, and writes nothing', async () => {
    const source = seeded(week());
    const view = renderOrders('/orders/settings', { source, ...STAFF });
    const toggle = await screen.findByRole('switch', { name: 'Check deliveries' }, LOAD);
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription(/Only an owner or a manager can change this\./);
    expect(screen.getByText('Only an owner or a manager can change this.')).toBeInTheDocument();
    await view.user.click(toggle);
    expect(source.deliveryWrites).toEqual([]);
  });

  it('says the sentence and puts the switch back when the rules refuse it', async () => {
    const source = seeded(week());
    source.failDelivery.config = true;
    // The fake refuses like the rules do (permission-denied): the store calls that 'refused'.
    const view = renderOrders('/orders/settings', { source });
    await view.user.click(await screen.findByRole('switch', { name: 'Check deliveries' }, LOAD));
    expect(await screen.findByText('Only an owner or a manager can change this.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('switch', { name: 'Check deliveries' })).toBeChecked(); });
  });
});

describe('in Italian', () => {
  it('speaks the venue’s words on the doors and the screens', async () => {
    const view = renderOrders('/orders', { source: seeded(week()), lang: 'it' });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(await door('In arrivo — 1 ordine da confermare')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 ordine di prima di questa settimana — è arrivato?' })).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Da riordinare' }));
    expect(await screen.findByRole('region', { name: 'Da riordinare' })).toBeInTheDocument();
  });
});
