// «Close as not ordered» in the store (checklist item 3 of docs/mise2-port-owed.md, 8 Nov 2026; the current app's v1.143.0, commits
// 9b9fdf3c and a710dcbb): drafts/current.skipped = { supplierId: 'YYYY-MM-DD' }.
//
// Ported from tests/orders-close-not-ordered.test.mjs, which pins the current app's wiring by reading its source: here the same decisions
// are DRIVEN through the store with the fake source —
//   • the close is written ON ITS OWN (one key of `skipped`), never through the autosave, and never with `updatedAt`;
//   • local first: on screen at once, never awaited; a refusal puts the server's word back and is said;
//   • a quantity typed for a supplier closed today reopens it (never a stock count, never a 0), once;
//   • nothing the store writes for typing or placing ever drops `skipped`;
//   • the kiosk lines leave a closed supplier out.

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersMessage } from './ordersStore';
import type { StoredDoc } from './ordersSource';
import type { LensIngredient } from './ordersLens';

// 6 November 2026 is a Friday.
const TODAY = '2026-11-06';
const LAST_FRIDAY = '2026-10-30';

const mill: StoredDoc = { id: 'mill', name: 'Mill', orderDays: ['Friday'] };
const dairy: StoredDoc = { id: 'dairy', name: 'Dairy', orderDays: ['Friday'] };
const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill' };
const milk: StoredDoc = { id: 'milk', name: 'Milk', supplierId: 'dairy' };

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started(init: Parameters<typeof fakeOrdersSource>[0] = {}) {
  const source = fakeOrdersSource({ suppliers: [mill, dairy], ingredients: [flour, milk], ...init });
  let timer: (() => void) | null = null;
  const deps: OrdersDeps = {
    markBusy: () => () => undefined,
    today: () => TODAY,
    draft: {
      nowIso: () => `${TODAY}T09:00:00.000Z`,
      setTimer: run => { timer = run; return 1; },
      clearTimer: () => { timer = null; },
    },
    online: () => true,
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
  store.start();
  stops.push(() => store.stop());
  await settle();
  return { source, store, messages, settle, autosave };
}

const line = (doc: StoredDoc): LensIngredient => doc as unknown as LensIngredient;

describe('ordersStore — closing today\'s order', () => {
  it('reads drafts/current.skipped into the draft the screens draw', async () => {
    const h = await started({ draft: { entries: {}, skipped: { mill: TODAY, dairy: LAST_FRIDAY } } });
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY, dairy: LAST_FRIDAY });
  });

  it('a close made on another phone shows at once', async () => {
    const h = await started({ draft: { entries: {} } });
    h.source.remoteMerge({ skipped: { mill: TODAY } });
    await h.settle();
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
  });

  it('closes ON ITS OWN: one key of `skipped`, no autosave, no updatedAt — and creates the draft on a venue that never typed one', async () => {
    const h = await started({ draft: null });
    h.store.closeToday('mill');
    // Local first: on screen before the write has any answer.
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
    await h.settle();
    expect(h.source.skipWrites).toEqual([{ supplierId: 'mill', day: TODAY }]);
    expect(h.source.writes).toEqual([]);
    expect(h.source.clears).toEqual([]);
    expect(h.source.draft).toEqual({ skipped: { mill: TODAY }, bakery: 'bakery' });
    expect(h.messages).toEqual([]);
  });

  it('⚠️ is on screen at once even while the write waits for a connection (never awaited)', async () => {
    const h = await started({ draft: { entries: {} } });
    const release = h.source.holdWrites();
    h.store.closeToday('mill');
    await h.settle();
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
    release();
    await h.settle();
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
    expect(h.messages).toEqual([]);
  });

  it('a refused close puts the server\'s word back and is said', async () => {
    const h = await started({ draft: { entries: {} } });
    h.source.refuseWrites = true;
    h.store.closeToday('mill');
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
    await h.settle();
    expect(h.store.getSnapshot().draft.skipped).toEqual({});
    expect(h.messages).toEqual([{ kind: 'skip-not-saved' }]);
  });

  it('reopens only that supplier, with no updatedAt; a close another phone made meanwhile survives', async () => {
    const h = await started({ draft: { entries: {}, updatedAt: 'before', skipped: { mill: TODAY, dairy: TODAY } } });
    h.store.reopenToday('mill');
    expect(h.store.getSnapshot().draft.skipped).toEqual({ dairy: TODAY });
    await h.settle();
    expect(h.source.skipWrites).toEqual([{ supplierId: 'mill', day: null }]);
    expect(h.source.draft?.skipped).toEqual({ dairy: TODAY });
    expect(h.source.draft?.updatedAt).toBe('before');
  });

  it('a refused reopen puts the close back on screen and is said', async () => {
    const h = await started({ draft: { entries: {}, skipped: { mill: TODAY } } });
    h.source.refuseWrites = true;
    h.store.reopenToday('mill');
    expect(h.store.getSnapshot().draft.skipped).toEqual({});
    await h.settle();
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
    expect(h.messages).toEqual([{ kind: 'skip-not-saved' }]);
  });

  it('nothing closed, nothing to reopen: no write', async () => {
    const h = await started({ draft: { entries: {} } });
    h.store.reopenToday('mill');
    await h.settle();
    expect(h.source.skipWrites).toEqual([]);
  });
});

describe('ordersStore — ⚠️ a quantity typed for a supplier closed today reopens it', () => {
  it('the first quantity reopens it, once; the typing itself goes through the autosave as ever', async () => {
    const h = await started({ draft: { entries: {}, skipped: { mill: TODAY } } });
    h.store.editLine(mill, line(flour), { qty: 2 });
    expect(h.store.getSnapshot().draft.skipped).toEqual({});
    h.store.editLine(mill, line(flour), { qty: 3 });
    await h.autosave();
    expect(h.source.skipWrites).toEqual([{ supplierId: 'mill', day: null }]);
    expect(h.source.draft?.skipped).toEqual({});
    expect(h.source.writes.map(w => w.entries?.flour?.qty)).toEqual([3]);
  });

  it('a stock count, or a 0, is not an order: the close stays', async () => {
    const h = await started({ draft: { entries: {}, skipped: { mill: TODAY } } });
    h.store.editLine(mill, line(flour), { stock: 4 });
    h.store.editLine(mill, line(flour), { qty: 0 });
    await h.autosave();
    expect(h.source.skipWrites).toEqual([]);
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
  });

  it('a close from another day is not reopened (it means nothing today), nor is another supplier\'s', async () => {
    const h = await started({ draft: { entries: {}, skipped: { mill: LAST_FRIDAY, dairy: TODAY } } });
    h.store.editLine(mill, line(flour), { qty: 1 });
    await h.autosave();
    expect(h.source.skipWrites).toEqual([]);
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: LAST_FRIDAY, dairy: TODAY });
  });

  it('a refused reopen-by-typing is silent and the close comes back, as in the current app', async () => {
    const h = await started({ draft: { entries: {}, skipped: { mill: TODAY } } });
    h.source.refuseWrites = true;
    h.store.editLine(mill, line(flour), { qty: 2 });
    await h.settle();
    expect(h.store.getSnapshot().draft.skipped).toEqual({ mill: TODAY });
    expect(h.messages.filter(m => m.kind === 'skip-not-saved')).toEqual([]);
  });
});

describe('ordersStore — nothing it writes drops `skipped`', () => {
  it('the autosave sends only the changed lines and days: the closes stay as stored', async () => {
    const h = await started({ draft: { entries: {}, skipped: { dairy: TODAY } } });
    h.store.editLine(mill, line(flour), { qty: 2 });
    await h.autosave();
    expect(h.source.writes).toHaveLength(1);
    expect(h.source.writes[0]).not.toHaveProperty('skipped');
    expect(h.source.draft?.skipped).toEqual({ dairy: TODAY });
  });

  it('recording an order clears its lines and its day, never `skipped`', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 2 } }, days: { mill: TODAY }, skipped: { dairy: TODAY } } });
    const report = await h.store.place([{ supplierId: 'mill', date: TODAY, quantities: { flour: 2 }, units: {} }], 'No supplier');
    expect(report).toEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'saved' }] });
    expect(h.source.clears.flatMap(c => c.paths).some(p => p.startsWith('skipped'))).toBe(false);
    expect(h.source.draft?.skipped).toEqual({ dairy: TODAY });
  });

  it('«Clear quantities» never touches `skipped` either', async () => {
    const h = await started({ draft: { entries: { milk: { qty: 2 } }, skipped: { mill: TODAY } } });
    await h.store.clearQuantities(['dairy'], 'No supplier');
    expect(h.source.clears.flatMap(c => c.paths).some(p => p.startsWith('skipped'))).toBe(false);
    expect(h.source.draft?.skipped).toEqual({ mill: TODAY });
  });
});

describe('ordersStore — the kiosk lines', () => {
  it('leave a supplier closed as not ordered today out of «to order»', async () => {
    const h = await started({ draft: { entries: {}, skipped: { dairy: TODAY } } });
    const toOrder = h.store.kioskSections()?.find(s => s.titleKey === 'kiosk.rest.toOrderTitle');
    expect(toOrder?.names).toEqual(['Mill']);
  });

  it('say nothing before the draft has arrived: a closed supplier must not read «to order»', async () => {
    const source = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { skipped: { mill: TODAY } } });
    source.watchDraft = () => () => undefined;
    const store = createOrdersStore(source, {
      markBusy: () => () => undefined,
      today: () => TODAY,
      draft: { nowIso: () => `${TODAY}T09:00:00.000Z`, setTimer: () => 1, clearTimer: () => undefined },
      online: () => true,
    });
    store.start();
    stops.push(() => store.stop());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().historyLoaded).toBe(true);
    expect(store.kioskSections()).toBeNull();
  });
});
