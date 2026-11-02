import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { LIST_COPY_KEY, LIST_COPY_WRITE_DELAY_MS, writeListCopy } from '@mise/shared/list-copy';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders», the instant list: the supplier rows are drawn from a local copy of the last good lists while the live lists have not
// landed (useListCopy.ts), and NOTHING ELSE reads the copy. A supplier tapped meanwhile is HELD in OrdersLayout (the address does not
// change, the row is busy, the status line says the wait) and opens by itself once everything is live; the doors that open anything
// else are shut; a hold is dropped by moving elsewhere, by a failed stream, by the bell and by the search box.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const WEEKDAY = (n: number): string => weekdayOf(inDays(n)) as string;

// What the copy holds: the lists as they were the last time the section was open.
const COPY_SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', category: 'Milling' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', category: 'Dairy' }),
];
const COPY_ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Milk', supplierId: 's-zed', unit: 'l' }),
];

// What the database holds now: Alpine was renamed, Zed is gone, Bee Farm is new. Prices and contacts are in the documents and
// must never reach the copy.
const LIVE_SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Bakery Supplies', category: 'Milling', phone: '0123 456', email: 'a@b.test' }),
  supplier('s-bee', { name: 'Bee Farm', category: 'Honey' }),
];
const LIVE_ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg', price: 1.2, allergens: ['gluten'], packs: [{ size: 25 }] }),
  ingredient('i-honey', { name: 'Honey', supplierId: 's-bee', unit: 'kg' }),
];

// Both suppliers live (for the specs that open one).
const BOTH_SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', category: 'Milling' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', category: 'Dairy' }),
];

function plant(suppliers: unknown[] = COPY_SUPPLIERS, ingredients: unknown[] = COPY_ITEMS, lid = 'bakery') {
  writeListCopy(lid, suppliers, ingredients, window.localStorage);
}

function stored(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(LIST_COPY_KEY);
  return raw === null ? null : JSON.parse(raw) as Record<string, unknown>;
}

// Keeps the first answer of the named streams back, as a tablet whose Firestore is still waking up: until `release()` the
// section has only what it was handed. A stream opened again after the release (React's development mode starts, stops and
// starts again) is answered at once. `fail(stream)` makes the held ones of that stream die instead.
type Stream = 'watchSuppliers' | 'watchIngredients' | 'watchDraft' | 'watchOrdersConfig';
function holdLive(source: FakeOrdersSource, streams: Stream[] = ['watchSuppliers', 'watchIngredients', 'watchDraft']) {
  const waiting = new Set<{ name: Stream; start: () => void; fail: () => void }>();
  let released = false;
  const loose = source as unknown as Record<Stream, (...args: unknown[]) => () => void>;
  for (const name of streams) {
    const original = loose[name].bind(source);
    loose[name] = (onChange, onError) => {
      if (released) return original(onChange, onError);
      let stop: (() => void) | undefined;
      const entry = {
        name,
        start: () => { stop = original(onChange, onError); },
        fail: () => { (onError as (err: unknown) => void)(new Error('permission-denied')); },
      };
      waiting.add(entry);
      return () => {
        waiting.delete(entry);
        stop?.();
      };
    };
  }
  return {
    async release() {
      released = true;
      await act(async () => {
        for (const entry of [...waiting]) {
          waiting.delete(entry);
          entry.start();
        }
        await Promise.resolve();
      });
    },
    async land(name: Stream) {
      await act(async () => {
        for (const entry of [...waiting]) {
          if (entry.name === name) {
            waiting.delete(entry);
            entry.start();
          }
        }
        await Promise.resolve();
      });
    },
    async fail(name: Stream) {
      await act(async () => {
        for (const entry of [...waiting]) {
          if (entry.name === name) {
            waiting.delete(entry);
            entry.fail();
          }
        }
        await Promise.resolve();
      });
    },
  };
}

function rowButtons() {
  return within(screen.getByRole('main')).queryAllByRole('listitem').map(row => within(row).getAllByRole('button')[0]?.textContent ?? '');
}
const row = (name: RegExp | string) => screen.getByRole('button', { name });
const queryRow = (name: RegExp | string) => screen.queryByRole('button', { name });
const WAIT = 'Just a moment: loading the latest data.';
const waitText = () => screen.queryByText(WAIT);
const busy = () => document.querySelector('[data-waiting="true"]');
const search = () => screen.getByRole('searchbox', { name: 'Search a supplier…' });

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;

// The list on the copy: planted, with the live lists held back.
async function onCopy(source: FakeOrdersSource, options: Options = {}, streams?: Stream[], path = '/orders') {
  const live = holdLive(source, streams);
  const view = renderOrders(path, { source, ...options });
  await screen.findAllByRole('button', { name: /^(Alpine Mills|Bee Farm)/ }, LOAD);
  return { ...view, live };
}

describe('the list before the live lists land', () => {
  it('a copy holding only switched-off suppliers paints nothing: «Loading…», never «No suppliers yet»', async () => {
    plant([supplier('s-off', { name: 'Old Mill', active: false })], [ingredient('i-old', { name: 'Rye', supplierId: 's-off' })]);
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    holdLive(source);
    renderOrders('/orders', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
  });

  it('says «Loading…» as before when there is no copy', async () => {
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    holdLive(source);
    renderOrders('/orders', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(rowButtons()).toEqual([]);
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
  });

  it('waits for the supplier order of the venue: no row before config/orders, then the rows in that order, so none moves under a finger', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS, ordersConfig: { supplierOrder: ['s-zed', 's-alp'] } });
    const live = holdLive(source, ['watchSuppliers', 'watchIngredients', 'watchDraft', 'watchOrdersConfig']);
    renderOrders('/orders', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(rowButtons()).toEqual([]);
    await live.land('watchOrdersConfig');
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    const rows = rowButtons();
    expect(rows.findIndex(text => text.startsWith('Zed'))).toBeLessThan(rows.findIndex(text => text.startsWith('Alpine')));
    expect(rows.findIndex(text => text.startsWith('Zed'))).toBeGreaterThanOrEqual(0);
  });

  it('a config/orders that cannot be read does not keep the copy away', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    source.refuse.config = true;
    await onCopy(source);
    expect(queryRow('Send')).not.toBeInTheDocument();
  });

  it('starts the config/orders listener first: Firestore answers in that order, and the copy waits for it', async () => {
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const started: string[] = [];
    const loose = source as unknown as Record<string, (...args: unknown[]) => () => void>;
    for (const name of ['watchSuppliers', 'watchIngredients', 'watchDraft', 'watchOrdersConfig']) {
      const original = loose[name]?.bind(source) as (...args: unknown[]) => () => void;
      loose[name] = (...args) => { started.push(name); return original(...args); };
    }
    renderOrders('/orders', { source });
    await waitFor(() => { expect(started.length).toBeGreaterThanOrEqual(4); }, LOAD);
    expect(started[0]).toBe('watchOrdersConfig');
  });

  it('draws the rows from the copy before any live answer: no «Loading…», no Send, no bulk buttons, never «No suppliers yet»', async () => {
    plant();
    // The draft has landed with two suppliers' quantities: the bulk buttons would show on a live list, so their absence is real.
    const draft = { entries: { 'i-flour': { qty: 2 }, 'i-milk': { qty: 1 } }, days: {} };
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS, draft });
    await onCopy(source, {}, ['watchSuppliers', 'watchIngredients']);
    await waitFor(() => { expect(rowButtons()).toHaveLength(2); });
    expect(rowButtons()[0]).toMatch(/^Alpine Mills/);
    expect(rowButtons()[1]).toMatch(/^Zed/);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
    expect(queryRow('Send')).not.toBeInTheDocument();
    expect(queryRow('Order placed…')).not.toBeInTheDocument();
    expect(queryRow('Clear quantities…')).not.toBeInTheDocument();
  });

  it('keeps the rows of the copy and the Send button away together, then both arrive with the live lists', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    const { live } = await onCopy(source);
    expect(rowButtons()).toHaveLength(2);
    await live.release();
    // The live rows: Alpine renamed, Zed gone, Bee Farm new.
    expect(await screen.findByRole('button', { name: /^Alpine Bakery Supplies/ }, LOAD)).toBeInTheDocument();
    expect(queryRow(/^Alpine Mills/)).not.toBeInTheDocument();
    expect(queryRow(/^Zed/)).not.toBeInTheDocument();
    expect(row(/^Bee Farm/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});

describe.each([['on the split', true], ['on a phone', false]] as const)('a supplier tapped on the copy, %s', (_where, isSplit) => {
  beforeEach(() => { if (isSplit) split(); });

  it('stays at the same address with the row busy and the wait said, then opens by itself when live lands', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(row(/^Alpine Mills/)).toHaveAttribute('aria-busy', 'true');
    expect(waitText()).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
    expect(waitText()).not.toBeInTheDocument();
    expect(busy()).toBeNull();
    expect(document.querySelector('li [aria-busy="true"]')).toBeNull();
  });

  it('a second tap on another row wins', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    await view.user.click(row(/^Zed/));
    expect(row(/^Zed/)).toHaveAttribute('aria-busy', 'true');
    expect(row(/^Alpine Mills/)).not.toHaveAttribute('aria-busy');
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Milk quantity to order' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Flour quantity to order' })).not.toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-zed');
  });

  it('a supplier gone from the live list: the list stays, nothing opens, nothing is busy and the wait is gone', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Zed/));
    await view.live.release();
    expect(await screen.findByRole('button', { name: 'Send' }, LOAD)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByText('This supplier is not in the order list.')).not.toBeInTheDocument();
    expect(busy()).toBeNull();
    expect(waitText()).not.toBeInTheDocument();
  });

  it('⚠️ the hold is dropped by typing in the search box: the text and the focus stay, nothing opens', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: [...BOTH_SUPPLIERS, supplier('s-bee', { name: 'Bee Farm' })], ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    expect(busy()).not.toBeNull();
    const box = search();
    await view.user.type(box, 'zed');
    expect(busy()).toBeNull();
    expect(waitText()).not.toBeInTheDocument();
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(search()).toBe(box);
    expect(box).toHaveValue('zed');
    expect(box).toHaveFocus();
    expect(rowButtons()).toHaveLength(1);
    expect(rowButtons()[0]).toMatch(/^Zed/);
  });

  it('⚠️ the hold is dropped when the search box takes the focus', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    await view.user.click(search());
    expect(busy()).toBeNull();
    expect(waitText()).not.toBeInTheDocument();
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(search()).toHaveFocus();
  });

  it('⚠️ WebKit: search box focused and text typed BEFORE the tap, a click on the row that moves no focus still opens the supplier', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(search());
    await view.user.type(search(), 'alp');
    expect(search()).toHaveFocus();
    fireEvent.click(row(/^Alpine Mills/));
    expect(search()).toHaveFocus();
    expect(busy()).not.toBeNull();
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
  });

  it('the hold is dropped when the bell’s panel opens, and the bell keeps the focus', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    const bell = screen.getByRole('button', { name: /^Notices/ });
    await view.user.click(bell);
    expect(busy()).toBeNull();
    expect(waitText()).not.toBeInTheDocument();
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it('the hold is dropped when the person goes elsewhere (the address changes): the supplier does not open later', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    await act(async () => { await view.router.navigate('/orders/settings'); });
    expect(busy()).toBeNull();
    await view.live.release();
    await screen.findByText('Past orders', undefined, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders/settings');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it.each([
    ['watchSuppliers', /Lost the live connection for suppliers/],
    ['watchIngredients', /Lost the live connection for ingredients/],
    ['watchDraft', /Lost the live connection for the order in progress/],
  ] as const)('a failed %s stream drops the hold: nothing opens, nothing is busy, the connection-lost line shows', async (stream, lost) => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    expect(busy()).not.toBeNull();
    await view.live.fail(stream);
    expect(await screen.findByText(lost)).toBeInTheDocument();
    expect(busy()).toBeNull();
    expect(waitText()).not.toBeInTheDocument();
    // A list that failed no longer draws its stale rows.
    expect(queryRow(/^Alpine Mills/)).not.toBeInTheDocument();
    await view.live.release();
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 50)); });
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(waitText()).not.toBeInTheDocument();
  });
});

describe('the wait, said over the content', () => {
  it('a tap moves no row: the words are in the status message, outside the list', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    const words = waitText() as HTMLElement;
    expect(words).toBeInTheDocument();
    expect(words.closest('li, ul')).toBeNull();
    expect(words.closest('[data-react-aria-top-layer]')).not.toBeNull();
  });

  it('a shut door says it, and leaving takes the words away at once, for good', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(screen.getByRole('button', { name: 'Orders settings' }));
    expect(waitText()).toBeInTheDocument();
    expect(busy()).toBeNull();
    await act(async () => { await view.router.navigate('/orders/history'); });
    expect(waitText()).not.toBeInTheDocument();
    await act(async () => { await view.router.navigate('/orders'); });
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    expect(waitText()).not.toBeInTheDocument();
  });

  it('the words go the moment the live data lands, with the hold on a shut door too', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(screen.getByRole('button', { name: 'Orders settings' }));
    expect(waitText()).toBeInTheDocument();
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(waitText()).not.toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders');
  });
});

describe('the doors that open anything else, shut on the copy', () => {
  const CONFIG = { ordersConfig: { deliveryCheck: true, deliveryCheckFrom: inDays(-1) } };
  const DOORS: Array<[string, () => HTMLElement]> = [
    ['the row’s list icon', () => screen.getByRole('button', { name: 'Ingredients from Alpine Mills' })],
    ['the settings gear', () => screen.getByRole('button', { name: 'Orders settings' })],
    ['Incoming', () => screen.getByRole('button', { name: 'Incoming' })],
    ['To re-order', () => screen.getByRole('button', { name: 'To re-order' })],
  ];

  it.each(DOORS)('%s: the address is unchanged, the wait is said, nothing opens — then live lands and still nothing opens', async (_name, door) => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS, ...CONFIG });
    const view = await onCopy(source);
    await screen.findByRole('button', { name: 'Incoming' }, LOAD);
    await view.user.click(door());
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(waitText()).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(waitText()).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('are today’s doors again once the list is live', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Orders settings' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/settings'); });
  });
});

describe('a half-landed list', () => {
  it('an «Order today» chip goes through the hold like a row: suppliers and records landed, ingredients held', async () => {
    const days = { orderDays: [WEEKDAY(0)] };
    const alpine = supplier('s-alp', { name: 'Alpine Mills', ...days });
    plant([alpine, COPY_SUPPLIERS[1]]);
    const source = fakeOrdersSource({ suppliers: [alpine, BOTH_SUPPLIERS[1] as never], ingredients: COPY_ITEMS });
    const view = await onCopy(source, {}, ['watchIngredients']);
    await screen.findByText('Order today', undefined, LOAD);
    // Two buttons carry the name: the chip (first, over the list) and the supplier's row.
    await view.user.click(screen.getAllByRole('button', { name: 'Alpine Mills' })[0] as HTMLElement);
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(waitText()).toBeInTheDocument();
    expect(document.querySelector('[data-waiting="true"]')).not.toBeNull();
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
  });

  it('suppliers and ingredients landed, draft held: the rows are the LIVE ones, Send is still hidden, a tap waits for the draft', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    const view = await onCopy(source, {}, ['watchDraft']);
    await screen.findByRole('button', { name: /^Bee Farm/ }, LOAD);
    expect(queryRow(/^Zed/)).not.toBeInTheDocument();
    expect(queryRow(/^Alpine Mills/)).not.toBeInTheDocument();
    expect(queryRow('Send')).not.toBeInTheDocument();
    await view.user.click(row(/^Bee Farm/));
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(waitText()).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Honey quantity to order' }, LOAD)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-bee');
  });
});

describe('a screen opened by its address on the copy', () => {
  it('on the split: «Loading…» in the pane and no quantity box until live, and a tap on another row wins', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source, {}, undefined, '/orders/supplier/s-alp');
    expect(screen.getAllByText('Loading…')).toHaveLength(1);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await view.user.click(row(/^Zed/));
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
    expect(waitText()).toBeInTheDocument();
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Milk quantity to order' }, LOAD)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-zed');
  });

  it('on a phone: «Loading…» until live, then the supplier', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source, {}, undefined, '/orders/supplier/s-alp');
    expect(screen.getAllByText('Loading…')).toHaveLength(1);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD)).toBeInTheDocument();
  });
});

describe('what the copy must not feed', () => {
  // The venue is British: its holidays are the list kept on this phone, so the days are the ones planted here.
  const GB = { session: { location: { country: 'GB' } } } as Options;
  const bell = () => screen.getByRole('button', { name: /^Notices/ });

  it('raises no notice and draws no «Order today» chip while the list is the copy', async () => {
    window.localStorage.setItem('uk-bank-holidays', JSON.stringify([inDays(1)]));
    window.localStorage.setItem('uk-bank-holidays-fetched', TODAY);
    const days = { orderDays: [WEEKDAY(0)], deliveryDays: [WEEKDAY(1)] };
    plant([supplier('s-alp', { name: 'Alpine Mills', ...days })], COPY_ITEMS);
    const source = fakeOrdersSource({ suppliers: [supplier('s-alp', { name: 'Alpine Mills', ...days })], ingredients: COPY_ITEMS });
    const { live } = await onCopy(source, GB);
    expect(bell()).toHaveAccessibleName('Notices');
    expect(screen.queryByText('Order today')).not.toBeInTheDocument();
    // Only the supplier's own row carries the name.
    expect(screen.getAllByRole('button', { name: /^Alpine Mills/ })).toHaveLength(1);
    // The same data, live: the notice and the chip are real, so their absence above was the copy's.
    await live.release();
    expect(await screen.findByText('Order today', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(bell()).toHaveAccessibleName(/^Notices: \d/); }, LOAD);
  });
});

describe('a failed live stream', () => {
  it('takes the copy off the screen: the status line says the connection was lost and «No suppliers yet» does not show', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    source.refuse.suppliers = true;
    renderOrders('/orders', { source });
    expect(await screen.findByText(/Lost the live connection for suppliers/, undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(queryRow(/^Alpine Mills/)).not.toBeInTheDocument(); });
    // (The live list files the ingredients that did arrive under «No supplier»; nothing of the copy is left.)
    expect(rowButtons().filter(name => /Alpine|Zed/.test(name))).toEqual([]);
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
  });
});

describe('a copy that is not for this screen', () => {
  const NOT_USABLE: Array<[string, () => void]> = [
    ['another venue’s copy', () => { plant(COPY_SUPPLIERS, COPY_ITEMS, 'cafe'); }],
    ['a value that is not JSON', () => { window.localStorage.setItem(LIST_COPY_KEY, '{oops'); }],
    ['a copy with no supplier', () => { plant([], COPY_ITEMS); }],
  ];

  it.each(NOT_USABLE)('paints nothing for %s', async (_what, set) => {
    set();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const live = holdLive(source);
    renderOrders('/orders', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(rowButtons()).toEqual([]);
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
    await live.release();
    expect(await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD)).toBeInTheDocument();
  });
});

describe('writing the copy', () => {
  // The write timer is read by hand: a call with the copy's delay is kept instead of started, so a spec decides when it fires and
  // sees how many were ever armed. Every other timer is the real one.
  let pending: Map<number, () => void>;
  let armed: number;
  beforeEach(() => {
    pending = new Map();
    armed = 0;
    let next = 1_000_000;
    const realSet = window.setTimeout.bind(window);
    const realClear = window.clearTimeout.bind(window);
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== LIST_COPY_WRITE_DELAY_MS) return realSet(handler, delay, ...args);
      armed += 1;
      next += 1;
      pending.set(next, handler as () => void);
      return next;
    }) as typeof window.setTimeout);
    vi.spyOn(window, 'clearTimeout').mockImplementation(((id?: number) => {
      if (id !== undefined && pending.has(id)) pending.delete(id);
      else realClear(id);
    }) as typeof window.clearTimeout);
  });
  const fire = () => { act(() => { for (const [id, run] of [...pending]) { pending.delete(id); run(); } }); };

  it('writes the whole copy, with only the whitelisted fields, once live has landed and the delay has passed', async () => {
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    renderOrders('/orders', { source });
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    await waitFor(() => { expect(pending.size).toBe(1); });
    expect(stored()).toBeNull();
    fire();
    expect(stored()).toStrictEqual({
      v: 1,
      lid: 'bakery',
      suppliers: [
        { id: 's-alp', name: 'Alpine Bakery Supplies', category: 'Milling' },
        { id: 's-bee', name: 'Bee Farm', category: 'Honey' },
      ],
      ingredients: [
        { id: 'i-flour', name: 'Flour', supplierId: 's-alp' },
        { id: 'i-honey', name: 'Honey', supplierId: 's-bee' },
      ],
    });
    expect(window.localStorage.getItem(LIST_COPY_KEY)).not.toMatch(/price|phone|email|allergens|packs|0123/);
  });

  it('writes nothing before the live lists have landed', async () => {
    plant();
    const before = window.localStorage.getItem(LIST_COPY_KEY);
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    const { live } = await onCopy(source);
    expect(armed).toBe(0);
    fire();
    expect(window.localStorage.getItem(LIST_COPY_KEY)).toBe(before);
    await live.release();
    await waitFor(() => { expect(pending.size).toBe(1); }, LOAD);
  });

  it('⚠️ writes nothing when a stream failed: a good older copy survives', async () => {
    plant();
    const before = window.localStorage.getItem(LIST_COPY_KEY);
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    source.refuse.suppliers = true;
    renderOrders('/orders', { source });
    await screen.findByText(/Lost the live connection for suppliers/, undefined, LOAD);
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 50)); });
    expect(armed).toBe(0);
    fire();
    expect(window.localStorage.getItem(LIST_COPY_KEY)).toBe(before);
  });

  it('leaving the section before the delay writes nothing', async () => {
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    const view = renderOrders('/orders', { source });
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    await waitFor(() => { expect(pending.size).toBe(1); });
    await act(async () => { await view.router.navigate('/stocktake'); });
    await waitFor(() => { expect(source.openListeners()).toBe(0); }, LOAD);
    expect(pending.size).toBe(0);
    fire();
    expect(stored()).toBeNull();
  });

  it('a change to the order in progress does not re-arm the timer', async () => {
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    renderOrders('/orders', { source });
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    await waitFor(() => { expect(pending.size).toBe(1); });
    const armedBefore = armed;
    act(() => { source.remoteMerge({ entries: { 'i-flour': { qty: 3 } } }); });
    await screen.findByText('1 item', undefined, LOAD);
    expect(armed).toBe(armedBefore);
    expect(pending.size).toBe(1);
  });

  it('⚠️ writes nothing while only cached answers have arrived (this phone’s own database), and writes once the server has answered', async () => {
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    let cached = true;
    const loose = source as unknown as Record<'watchSuppliers' | 'watchIngredients', (...args: unknown[]) => () => void>;
    for (const name of ['watchSuppliers', 'watchIngredients'] as const) {
      const original = loose[name].bind(source);
      loose[name] = (onChange, onError) => original(
        (list: unknown, meta: unknown) => { (onChange as (l: unknown, m: unknown) => void)(list, cached ? { fromServer: false } : meta); },
        onError,
      );
    }
    renderOrders('/orders', { source });
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 50)); });
    expect(armed).toBe(0);
    fire();
    expect(stored()).toBeNull();
    cached = false;
    act(() => { source.emit(); });
    await waitFor(() => { expect(pending.size).toBe(1); }, LOAD);
    fire();
    expect(stored()).not.toBeNull();
  });

  it('⚠️ one list from the server and the other still from this phone’s own database writes nothing: half a fresh answer is not a good copy', async () => {
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    let cached = true;
    const loose = source as unknown as Record<'watchIngredients', (...args: unknown[]) => () => void>;
    const original = loose.watchIngredients.bind(source);
    loose.watchIngredients = (onChange, onError) => original(
      (list: unknown, meta: unknown) => { (onChange as (l: unknown, m: unknown) => void)(list, cached ? { fromServer: false } : meta); },
      onError,
    );
    renderOrders('/orders', { source });
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 50)); });
    expect(armed).toBe(0);
    fire();
    expect(stored()).toBeNull();
    cached = false;
    act(() => { source.emit(); });
    await waitFor(() => { expect(pending.size).toBe(1); }, LOAD);
  });

  describe('while the device moves to another venue', () => {
    async function landed() {
      const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
      renderOrders('/orders', { source });
      await screen.findByRole('button', { name: 'Send' }, LOAD);
      await waitFor(() => { expect(pending.size).toBe(1); });
    }

    it('⚠️ writes nothing when `active-location` already names ANOTHER venue', async () => {
      await landed();
      window.localStorage.setItem('active-location', 'cafe');
      fire();
      expect(stored()).toBeNull();
    });

    it('writes when `active-location` names this venue', async () => {
      await landed();
      window.localStorage.setItem('active-location', 'bakery');
      fire();
      expect(stored()).not.toBeNull();
    });

    it('writes when `active-location` is missing', async () => {
      await landed();
      window.localStorage.removeItem('active-location');
      fire();
      expect(stored()).not.toBeNull();
    });
  });
});

describe('the search box', () => {
  it('keeps what was typed on the copy, in the same input, and still filters when the live rows arrive', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: [...BOTH_SUPPLIERS, supplier('s-bee', { name: 'Bee Farm' })], ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    const box = search();
    await view.user.type(box, 'zed');
    expect(rowButtons()).toHaveLength(1);
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(search()).toBe(box);
    expect(box).toHaveValue('zed');
    expect(rowButtons()).toHaveLength(1);
    expect(rowButtons()[0]).toMatch(/^Zed/);
  });
});
