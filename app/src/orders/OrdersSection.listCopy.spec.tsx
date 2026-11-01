import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { LIST_COPY_KEY, LIST_COPY_WRITE_DELAY_MS, writeListCopy } from '@mise/shared/list-copy';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders», the instant list: the supplier rows are drawn from a local copy of the last good lists while the live lists have not
// landed (useListCopy.ts), and NOTHING ELSE reads the copy. THE HOLD IS THE ADDRESS: a tap on a row navigates as ever, and the
// pane says «Loading…» until suppliers, ingredients and the draft have all landed, then the screen opens by itself.

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
// starts again) is answered at once.
type Stream = 'watchSuppliers' | 'watchIngredients' | 'watchDraft';
function holdLive(source: FakeOrdersSource, streams: Stream[] = ['watchSuppliers', 'watchIngredients', 'watchDraft']) {
  const waiting = new Set<() => void>();
  let released = false;
  const loose = source as unknown as Record<Stream, (...args: unknown[]) => () => void>;
  for (const name of streams) {
    const original = loose[name].bind(source);
    loose[name] = (onChange, onError) => {
      if (released) return original(onChange, onError);
      let stop: (() => void) | undefined;
      const start = () => { stop = original(onChange, onError); };
      waiting.add(start);
      return () => {
        waiting.delete(start);
        stop?.();
      };
    };
  }
  return {
    async release() {
      released = true;
      await act(async () => {
        for (const start of [...waiting]) {
          waiting.delete(start);
          start();
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
const search = () => screen.getByRole('searchbox', { name: 'Search a supplier…' });

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;

// The list on the copy: planted, with the live lists held back.
async function onCopy(source: FakeOrdersSource, options: Options = {}, streams?: Stream[]) {
  const live = holdLive(source, streams);
  const view = renderOrders('/orders', { source, ...options });
  await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
  return { ...view, live };
}

describe('the list before the live lists land', () => {
  it('says «Loading…» as before when there is no copy', async () => {
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    holdLive(source);
    renderOrders('/orders', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(rowButtons()).toEqual([]);
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
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

describe('a tap before the live lists land', () => {
  it('on the split: «Loading…» in the pane and no quantity box until live, then the supplier opens by itself', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
    expect(screen.getAllByText('Loading…')).toHaveLength(1);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('on the split: a second tap on another row before live wins', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    await view.user.click(row(/^Zed/));
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-zed');
    await view.live.release();
    expect(await screen.findByRole('spinbutton', { name: 'Milk quantity to order' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Flour quantity to order' })).not.toBeInTheDocument();
  });

  it('on a phone: tap a row, go back, then live lands: no supplier screen opens', async () => {
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
    await act(async () => { await view.router.navigate(-1); });
    expect(view.router.state.location.pathname).toBe('/orders');
    await view.live.release();
    await screen.findByRole('button', { name: 'Send' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('«What they sell» on a row: only «Loading…» in the pane until live', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(screen.getByRole('button', { name: 'Ingredients from Alpine Mills' }));
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/items');
    expect(screen.getAllByText('Loading…')).toHaveLength(1);
    expect(screen.queryByText('Flour')).not.toBeInTheDocument();
    await view.live.release();
    await waitFor(() => { expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); }, LOAD);
    expect(await screen.findByText('Flour', undefined, LOAD)).toBeInTheDocument();
  });

  it('the settings gear: only «Loading…» in the pane until live', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(screen.getByRole('button', { name: 'Orders settings' }));
    expect(view.router.state.location.pathname).toBe('/orders/settings');
    expect(screen.getAllByText('Loading…')).toHaveLength(1);
    expect(screen.queryByText('Past orders')).not.toBeInTheDocument();
    await view.live.release();
    expect(await screen.findByText('Past orders', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('a supplier gone from the live list: the «supplier gone» message and nothing to type', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: LIVE_SUPPLIERS, ingredients: LIVE_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Zed/));
    await view.live.release();
    expect(await screen.findByText('This supplier is not in the order list.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
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
});

describe('the search box and the focus', () => {
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

  it('does not steal the focus from the search box when the supplier screen opens by itself', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    await view.user.click(search());
    expect(search()).toHaveFocus();
    await view.live.release();
    await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD);
    expect(search()).toHaveFocus();
  });

  it('without typing, the title of the supplier takes the focus as it always did', async () => {
    split();
    plant();
    const source = fakeOrdersSource({ suppliers: BOTH_SUPPLIERS, ingredients: COPY_ITEMS });
    const view = await onCopy(source);
    await view.user.click(row(/^Alpine Mills/));
    await view.live.release();
    await screen.findByRole('spinbutton', { name: 'Flour quantity to order' }, LOAD);
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toHaveFocus(); });
  });
});
