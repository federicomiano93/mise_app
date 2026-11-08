// The draft journal at the store's level (parity F-15): the note is read when the section STARTS, the lines it brings back are
// drawn and counted (`draftCameBack`) and held by the busy marker until they are sent, and the page going out of sight sends what is
// waiting. The note's own rules (what comes back, what stays out) are draftSync.journal.spec.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { DRAFT_JOURNAL_KEY, writeJournal } from '@mise/shared/draft-journal';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { memoryStorage } from '../testing/draftHarness';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';
import type { StoredDoc } from './ordersSource';

const TODAY = '2026-10-27';
const VENUE = 'bakery';
const NOW = Date.parse('2026-10-27T09:00:00Z');

const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill' };
const mill: StoredDoc = { id: 'mill', name: 'Mill', orderDays: ['Thursday'] };

const zero = { qty: 0, unit: '', supplierId: '' };
const note = (qty: number) => ({
  at: NOW - 60 * 1000,
  entries: { flour: { row: { qty, unit: '', supplierId: '' }, base: zero } },
  days: {},
});

function setup({ withNote = true, init = {} as Parameters<typeof fakeOrdersSource>[0] } = {}) {
  const source = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} }, ...init });
  const storage = memoryStorage();
  if (withNote) writeJournal(VENUE, note(5), storage);
  let timer: (() => void) | null = null;
  let busy = 0;
  let hidden: (() => void) | null = null;
  let hiddenListeners = 0;
  const deps: OrdersDeps = {
    markBusy: () => { busy += 1; return () => { busy -= 1; }; },
    today: () => TODAY,
    draft: {
      nowIso: () => '2026-10-27T09:00:00.000Z',
      setTimer: run => { timer = run; return 1; },
      clearTimer: () => { timer = null; },
    },
    online: () => true,
    journal: { storage, now: () => NOW },
    onHidden: run => {
      hidden = run;
      hiddenListeners += 1;
      return () => { hidden = null; hiddenListeners -= 1; };
    },
  };
  const store = createOrdersStore(source, deps, VENUE);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const autosave = async () => {
    const run = timer;
    timer = null;
    run?.();
    await settle();
  };
  return {
    source, store, storage, settle, autosave,
    busy: () => busy, waitingTimer: () => timer !== null,
    hide: () => hidden?.(), hiddenListeners: () => hiddenListeners,
  };
}

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started(options: Parameters<typeof setup>[0] = {}) {
  const h = setup(options);
  h.store.start();
  stops.push(() => h.store.stop());
  await h.settle();
  return h;
}

describe('ordersStore — the journal at start', () => {
  it('the note of the last page comes back once the server has answered, is counted, held by the busy marker and then sent', async () => {
    const h = setup();
    expect(h.store.getSnapshot().draftCameBack).toBe(0);
    h.store.start();
    stops.push(() => h.store.stop());
    await h.settle();
    const snap = h.store.getSnapshot();
    expect(snap.draft.entries.flour?.qty).toBe(5);
    expect(snap.draftCameBack).toBe(1);
    expect(h.busy()).toBe(1);                        // unsaved typing, from the moment it is back
    expect(h.source.writes).toEqual([]);
    await h.autosave();
    expect(h.source.writes[0]?.entries).toEqual({ flour: { qty: 5, unit: '', supplierId: '' } });
    expect(h.busy()).toBe(0);
    expect(h.storage.read(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  it('the orders are asked of the server from a week before the note', async () => {
    const h = await started();
    expect(h.source.recentReads).toEqual(['2026-10-20']);
  });

  it('⚠️ an order placed since names the line: it does not come back, and the page is not told', async () => {
    const h = await started({
      init: { records: { '2026-10-27_mill': { date: '2026-10-27', sends: { s1: { at: '2026-10-27T09:30:00Z', quantities: { flour: 5 } } } } } },
    });
    const snap = h.store.getSnapshot();
    expect(snap.draft.entries.flour).toBeUndefined();
    expect(snap.draftCameBack).toBe(0);
    expect(h.busy()).toBe(0);
    await h.autosave();
    expect(h.source.writes).toEqual([]);
  });

  it('the note of another venue is not read', async () => {
    const h = setup({ withNote: false });
    writeJournal('another-venue', note(5), h.storage);
    h.store.start();
    stops.push(() => h.store.stop());
    await h.settle();
    expect(h.store.getSnapshot().draft.entries.flour).toBeUndefined();
    expect(h.source.recentReads).toEqual([]);
  });

  it('a store made without a venue or without journal deps keeps no note', async () => {
    const source = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } });
    const storage = memoryStorage();
    writeJournal(VENUE, note(5), storage);
    const store = createOrdersStore(source, {
      markBusy: () => () => undefined, today: () => TODAY,
      draft: { nowIso: () => 'x', setTimer: () => 1, clearTimer: () => undefined }, online: () => true,
    }, VENUE);
    store.start();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().draft.entries.flour).toBeUndefined();
    store.editLine(mill, flour, { qty: 2 });
    expect(storage.read(DRAFT_JOURNAL_KEY)).toContain('"qty":5');   // untouched
    store.stop();
  });

  it('typing is noted at once under the open venue', async () => {
    const h = await started({ withNote: false });
    h.store.editLine(mill, flour, { qty: 4 });
    const noted = JSON.parse(h.storage.read(DRAFT_JOURNAL_KEY) ?? 'null');
    expect(noted.lid).toBe(VENUE);
    expect(noted.entries.flour.row.qty).toBe(4);
  });
});

describe('ordersStore — the page going out of sight', () => {
  it('sends what is waiting at once, without waiting for the pause', async () => {
    const h = await started({ withNote: false });
    h.store.editLine(mill, flour, { qty: 3 });
    expect(h.source.writes).toEqual([]);
    expect(h.waitingTimer()).toBe(true);
    h.hide();
    await h.settle();
    expect(h.source.writes).toHaveLength(1);
    expect(h.source.writes[0]?.entries?.flour?.qty).toBe(3);
  });

  it('with nothing waiting it says nothing', async () => {
    const h = await started({ withNote: false });
    h.hide();
    await h.settle();
    expect(h.source.writes).toEqual([]);
  });

  it('listens only while the section is started', async () => {
    const h = setup({ withNote: false });
    expect(h.hiddenListeners()).toBe(0);
    h.store.start();
    expect(h.hiddenListeners()).toBe(1);
    h.store.stop();
    expect(h.hiddenListeners()).toBe(0);
    h.store.start();                                 // React's development mode starts again
    expect(h.hiddenListeners()).toBe(1);
    h.store.stop();
  });
});
