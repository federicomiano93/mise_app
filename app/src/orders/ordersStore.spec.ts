// The order list's store (ordersStore.ts) against an in-memory source: what it loads, and what one change to one line
// writes — the day stamp (parity D1, D2), whose order a line is in (js/orders/ingredients.js claimLine), the ×, a refused
// autosave (L37), the busy marker (rule 2) and leaving the section within the debounce.

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersMessage } from './ordersStore';
import type { StoredDoc } from './ordersSource';

// 2026-10-27 is a Tuesday.
const TODAY = '2026-10-27';

function setup(init: Parameters<typeof fakeOrdersSource>[0] = {}) {
  const source = fakeOrdersSource(init);
  let timer: (() => void) | null = null;
  let busy = 0;
  const deps: OrdersDeps = {
    markBusy: () => { busy += 1; return () => { busy -= 1; }; },
    today: () => TODAY,
    draft: {
      nowIso: () => '2026-10-27T09:00:00.000Z',
      setTimer: run => { timer = run; return 1; },
      clearTimer: () => { timer = null; },
    },
  };
  const store = createOrdersStore(source, deps);
  const messages: OrdersMessage[] = [];
  store.onMessage(m => messages.push(m));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const autosave = async () => {
    const run = timer;
    timer = null;
    run?.();
    await settle();
  };
  return { source, store, messages, settle, autosave, busy: () => busy };
}

const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill' };
const mill: StoredDoc = { id: 'mill', name: 'Mill', orderDays: ['Thursday'] };
const shop: StoredDoc = { id: 'shop', name: 'Shop' };

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started(init: Parameters<typeof fakeOrdersSource>[0] = {}) {
  const h = setup(init);
  h.store.start();
  stops.push(() => h.store.stop());
  await h.settle();
  return h;
}

describe('ordersStore — loading', () => {
  it('loads the suppliers, the ingredients, config/orders and the draft, and says when each arrived', async () => {
    const h = await started({
      suppliers: [mill], ingredients: [flour], ordersConfig: { showStock: false },
      draft: { entries: { flour: { qty: 3, stock: 1 } }, days: { mill: TODAY } },
    });
    const snap = h.store.getSnapshot();
    expect(snap.suppliersLoaded && snap.ingredientsLoaded && snap.configLoaded && snap.draftLoaded).toBe(true);
    expect(snap.config.showStock).toBe(false);
    expect(snap.draft.entries.flour).toEqual({ qty: 3, stock: 1 });
    expect(h.source.openListeners()).toBe(4);
  });

  it('a stream that dies is said (no resubscribe) instead of showing an old order as live', async () => {
    const h = setup();
    h.source.refuse.draft = true;
    h.store.start();
    stops.push(() => h.store.stop());
    await h.settle();
    expect(h.store.getSnapshot().draftBroken).toBe(true);
  });

  it('stop() closes every listener (P14)', async () => {
    const h = await started({ suppliers: [mill] });
    h.store.stop();
    expect(h.source.openListeners()).toBe(0);
  });
});

describe('ordersStore — typing a quantity', () => {
  it('is on screen at once and saved 800 ms later as a merge of that line and the supplier\'s day', async () => {
    const h = await started({ suppliers: [mill], ingredients: [flour] });
    h.store.editLine(mill, flour, { qty: 4 });
    expect(h.store.getSnapshot().draft.entries.flour).toEqual({ qty: 4 });
    expect(h.source.writes).toEqual([]);
    await h.autosave();
    // Tuesday is not one of the mill's order days: the line is FOR its next one, Thursday (parity D1).
    expect(h.source.writes).toEqual([{
      updatedAt: '2026-10-27T09:00:00.000Z', entries: { flour: { qty: 4, stock: 0 } }, days: { mill: '2026-10-29' },
    }]);
  });

  it('a supplier with no order days is stamped today', async () => {
    const salt: StoredDoc = { id: 'salt', name: 'Salt', supplierId: 'shop' };
    const h = await started({ suppliers: [shop], ingredients: [salt] });
    h.store.editLine(shop, salt, { qty: 1 });
    expect(h.store.getSnapshot().draft.days.shop).toBe(TODAY);
  });

  it('keeps a stamp that is today or later, and restamps a stale one (parity D1)', async () => {
    const h = await started({
      suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: { mill: '2026-10-20' } },
    });
    h.store.editLine(mill, flour, { qty: 1 });
    expect(h.store.getSnapshot().draft.days.mill).toBe('2026-10-29');
  });

  it('quantities are whole, never negative, never NaN or Infinity (parity L26)', async () => {
    const h = await started({ suppliers: [mill], ingredients: [flour] });
    h.store.editLine(mill, flour, { qty: 2.6 });
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(3);
    h.store.editLine(mill, flour, { qty: -4 });
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(0);
    h.store.editLine(mill, flour, { qty: Infinity });
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(0);
    h.store.editLine(mill, flour, { qty: Number.NaN });
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(0);
  });

  it('⚠️ a stock reading never moves the supplier\'s day (parity L28)', async () => {
    const h = await started({ suppliers: [mill], ingredients: [flour] });
    h.store.editLine(mill, flour, { stock: 6 });
    await h.autosave();
    expect(h.source.writes[0]).toEqual({ updatedAt: '2026-10-27T09:00:00.000Z', entries: { flour: { qty: 0, stock: 6 } } });
  });

  it('the × clears the quantity AND the unit in one write', async () => {
    const h = await started({
      suppliers: [mill], ingredients: [{ ...flour, unit: 'cartone', packUnit: 'busta' }],
      draft: { entries: { flour: { qty: 2, stock: 0, unit: 'busta' } }, days: { mill: '2026-10-29' } },
    });
    h.store.editLine(mill, { ...flour, unit: 'cartone' }, { clear: true });
    await h.autosave();
    expect(h.source.writes[0]?.entries).toEqual({ flour: { qty: 0, stock: 0, unit: '' } });
  });
});

describe('ordersStore — whose order a line is in (js/orders/ingredients.js claimLine)', () => {
  it('a line sent here from its usual supplier stays here while it has a quantity, and goes back at zero', async () => {
    const h = await started({ suppliers: [mill, shop], ingredients: [flour] });
    const sentHere = { ...flour, supplierId: 'shop', usualSupplierId: 'mill' };
    h.store.editLine(shop, sentHere, { qty: 2 });
    expect(h.store.getSnapshot().draft.entries.flour?.supplierId).toBe('shop');
    h.store.editLine(shop, sentHere, { qty: 0 });
    expect(h.store.getSnapshot().draft.entries.flour?.supplierId).toBe('');
  });

  it('typing on a line ordered elsewhere this time takes it back (the override is cleared in the same write)', async () => {
    const h = await started({
      suppliers: [mill, shop], ingredients: [flour],
      draft: { entries: { flour: { qty: 2, stock: 0, supplierId: 'shop' } } },
    });
    h.store.editLine(mill, flour, { qty: 5 });
    await h.autosave();
    expect(h.source.writes[0]?.entries).toEqual({ flour: { qty: 5, stock: 0, supplierId: '' } });
  });
});

describe('ordersStore — saving', () => {
  it('a refused autosave is said, the typing stays on screen, and a later landed save says it is fine again', async () => {
    const h = await started({ suppliers: [mill], ingredients: [flour] });
    h.source.refuseWrites = true;
    h.store.editLine(mill, flour, { qty: 4 });
    await h.autosave();
    expect(h.messages).toEqual([{ kind: 'draft-not-saved' }]);
    expect(h.store.getSnapshot().draftSaveFailed).toBe(true);
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(4);
    h.source.refuseWrites = false;
    h.store.editLine(mill, flour, { stock: 1 });
    await h.autosave();
    expect(h.messages.at(-1)).toEqual({ kind: 'draft-saved' });
    expect(h.source.writes.at(-1)?.entries).toEqual({ flour: { qty: 4, stock: 1 } });
  });

  it('⚠️ another phone\'s write during the debounce does not erase this phone\'s typing', async () => {
    const h = await started({ suppliers: [mill], ingredients: [flour, { id: 'yeast', name: 'Yeast', supplierId: 'mill' }] });
    h.store.editLine(mill, flour, { qty: 7 });
    h.source.remoteMerge({ entries: { yeast: { qty: 1, stock: 0 } } });
    const entries = h.store.getSnapshot().draft.entries;
    expect(entries.flour).toEqual({ qty: 7, stock: 0 });
    expect(entries.yeast).toEqual({ qty: 1, stock: 0 });
  });

  it('holds the busy marker from the keystroke until the write has landed (rule 2)', async () => {
    const h = await started({ suppliers: [mill], ingredients: [flour] });
    const release = h.source.holdWrites();
    h.store.editLine(mill, flour, { qty: 1 });
    expect(h.busy()).toBe(1);
    await h.autosave();
    expect(h.busy()).toBe(1);
    release();
    await h.settle();
    expect(h.busy()).toBe(0);
  });

  it('leaving the section within the debounce sends the change at once', async () => {
    const h = await started({ suppliers: [mill], ingredients: [flour] });
    h.store.editLine(mill, flour, { qty: 9 });
    h.store.stop();
    await h.settle();
    expect(h.source.writes).toHaveLength(1);
    expect(h.source.writes[0]?.entries).toEqual({ flour: { qty: 9, stock: 0 } });
  });
});
