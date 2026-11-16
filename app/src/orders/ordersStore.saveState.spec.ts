// The iPad order of 14 Nov 2026: what the save line («Saved ✓» / «Not sent yet») reads from the store — { ready, saved } — and the
// store's sendWaitingDraft (leaving a box sends at once). Ported from tests/draft-save-state.test.mjs on origin/main (the live
// app's v1.145.0); the sync half is in draftSync.spec.ts and draftSync.journal.spec.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';
import type { OrdersSource, StoredDoc } from './ordersSource';

const TODAY = '2026-10-27';
const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill' };
const mill: StoredDoc = { id: 'mill', name: 'Mill', orderDays: ['Thursday'] };

const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });
let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

// `pendingWrites` stands for Firestore's own word on drafts/current (snap.metadata.hasPendingWrites): the fake source has no
// queue of its own, so the watcher is wrapped and the flag is the spec's.
function setup() {
  const base = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } });
  const flag = { pending: false };
  const source: OrdersSource = {
    ...base,
    watchDraft: (onChange, onError) => base.watchDraft((data, meta) => { onChange(data, { ...meta, pendingWrites: flag.pending }); }, onError),
  };
  let timer: (() => void) | null = null;
  const deps: OrdersDeps = {
    markBusy: () => () => undefined,
    today: () => TODAY,
    draft: {
      nowIso: () => '2026-10-27T09:00:00.000Z',
      setTimer: run => { timer = run; return 1; },
      clearTimer: () => { timer = null; },
    },
    online: () => true,
  };
  const store = createOrdersStore(source, deps);
  // Every distinct value the line was given, as the screen would see them.
  const told: Array<{ ready: boolean; saved: boolean }> = [];
  let last = store.getSnapshot().saveState;
  told.push(last);
  store.subscribe(() => {
    const next = store.getSnapshot().saveState;
    if (next !== last) { last = next; told.push(next); }
  });
  const pause = async () => {
    const run = timer;
    timer = null;
    run?.();
    await settle();
  };
  return {
    base, store, told, flag, pause,
    now: () => store.getSnapshot().saveState,
    start: async () => { store.start(); stops.push(() => store.stop()); await settle(); },
  };
}

describe('ordersStore — the save state', () => {
  it('nothing is said before the first snapshot of the draft; then «saved»', async () => {
    const h = setup();
    expect(h.now()).toEqual({ ready: false, saved: true });
    await h.start();
    expect(h.now()).toEqual({ ready: true, saved: true });
  });

  it('typed → waiting (not saved) → in the air (not saved) → answered (saved)', async () => {
    const h = setup();
    await h.start();
    const release = h.base.holdWrites();
    h.store.editLine(mill, flour, { qty: 3 });
    expect(h.now()).toEqual({ ready: true, saved: false });

    await h.pause();
    expect(h.base.writes).toHaveLength(1);
    expect(h.now()).toEqual({ ready: true, saved: false });

    release();
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: true });
  });

  it('a snapshot showing this device’s own write while it is in the air never makes it saved', async () => {
    const h = setup();
    await h.start();
    const release = h.base.holdWrites();
    h.store.editLine(mill, flour, { qty: 3 });
    await h.pause();
    // The fake tells every watcher at once, as Firestore shows its own pending write: the snapshot has arrived by now.
    h.base.emit();
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: false });
    release();
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: true });
  });

  it('a refused write stays not saved, and the snapshot that takes it back does not change that', async () => {
    const h = setup();
    await h.start();
    const release = h.base.holdWrites();
    h.base.refuseWrites = true;
    h.store.editLine(mill, flour, { qty: 3 });
    await h.pause();
    release();
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: false });
    expect(h.store.getSnapshot().draftSaveFailed).toBe(true);
    h.base.emit();
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: false });
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(3);
  });

  it('is told only on a change: three keystrokes are one change', async () => {
    const h = setup();
    await h.start();
    const before = h.told.length;
    h.store.editLine(mill, flour, { qty: 3 });
    h.store.editLine(mill, flour, { qty: 4 });
    h.store.editLine(mill, flour, { qty: 5 });
    expect(h.told.length).toBe(before + 1);
    await h.pause();
    expect(h.now()).toEqual({ ready: true, saved: true });
    expect(h.told.length).toBe(before + 2);
  });

  it('keeps the same object while nothing changed, so a keystroke tells the line nothing', async () => {
    const h = setup();
    await h.start();
    h.store.editLine(mill, flour, { qty: 3 });
    const typed = h.store.getSnapshot().saveState;
    h.store.editLine(mill, flour, { qty: 4 });
    expect(h.store.getSnapshot().saveState).toBe(typed);
  });

  it('Firestore’s pending-writes flag true is not saved, false is saved — a snapshot alone changes nothing', async () => {
    const h = setup();
    await h.start();
    h.flag.pending = true;
    h.base.emit();
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: false });
    h.base.remoteMerge({ entries: { flour: { qty: 3, stock: 0 } } });
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: false });
    h.flag.pending = false;
    h.base.emit();
    await settle();
    expect(h.now()).toEqual({ ready: true, saved: true });
    expect(h.base.writes).toHaveLength(0);
  });

  it('the draft and the line land together when the first snapshot has typing waiting on top of it', async () => {
    const h = setup();
    await h.start();
    h.store.editLine(mill, flour, { qty: 3 });
    h.base.remoteMerge({ entries: { salt: { qty: 1, stock: 0 } } });
    await settle();
    const snap = h.store.getSnapshot();
    expect(snap.draft.entries.flour?.qty).toBe(3);
    expect(snap.draft.entries.salt?.qty).toBe(1);
    expect(snap.saveState).toEqual({ ready: true, saved: false });
  });
});

describe('ordersStore — sendWaitingDraft', () => {
  it('sends what waits AT ONCE: one write, and the pause then sends nothing more', async () => {
    const h = setup();
    await h.start();
    h.store.editLine(mill, flour, { qty: 3 });
    expect(h.base.writes).toHaveLength(0);
    h.store.sendWaitingDraft();
    await settle();
    expect(h.base.writes).toHaveLength(1);
    expect(h.base.writes[0]?.entries?.flour).toMatchObject({ qty: 3 });
    await h.pause();
    expect(h.base.writes).toHaveLength(1);
    expect(h.now()).toEqual({ ready: true, saved: true });
  });

  it('with nothing waiting it writes nothing: leaving a box without typing costs no write', async () => {
    const h = setup();
    await h.start();
    h.store.sendWaitingDraft();
    h.store.editLine(mill, flour, { qty: 3 });
    h.store.sendWaitingDraft();
    h.store.sendWaitingDraft(); // the next box left, nothing typed in between
    await settle();
    expect(h.base.writes).toHaveLength(1);
  });
});
