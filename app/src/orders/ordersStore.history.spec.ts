// History in the store (ordersStore.ts, step 3f-4): the older pages fetched on demand from before the live window (parity
// H8), and the editor's correction and delete (H12) — written only when the stored record is still the order the editor
// opened (difference E1), never offline, and kept in step in an older page that no listener watches.

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';
import type { StoredDoc } from './ordersSource';

const TODAY = '2026-10-27';
const NOW = '2026-10-27T15:00:00.000Z';
// Two calendar months before TODAY (@mise/shared/history-window liveHistoryStart).
const WINDOW = '2026-08-27';

function record(date: string, supplierId: string, quantities: Record<string, number>): Record<string, unknown> {
  return {
    date, supplierId, supplierName: supplierId, quantities, stock: {}, names: {},
    sends: { s1: { at: `${date}T09:00:00.000Z`, quantities } }, createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`,
  };
}

function setup(records: Record<string, Record<string, unknown>> = {}, { online = true } = {}) {
  const source = fakeOrdersSource({ records });
  let busy = 0;
  let connected = online;
  let today = TODAY;
  const deps: OrdersDeps = {
    markBusy: () => { busy += 1; return () => { busy -= 1; }; },
    today: () => today,
    draft: { nowIso: () => NOW, setTimer: () => 1, clearTimer: () => {} },
    online: () => connected,
  };
  const store = createOrdersStore(source, deps);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return { source, store, settle, busy: () => busy, goOffline: () => { connected = false; }, setToday: (day: string) => { today = day; } };
}

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

function started(records: Record<string, Record<string, unknown>> = {}, options: { online?: boolean } = {}) {
  const s = setup(records, options);
  s.store.start();
  stops.push(() => s.store.stop());
  return s;
}

const opened = (s: ReturnType<typeof setup>, id: string): StoredDoc => {
  const found = [...s.store.getSnapshot().history, ...s.store.getSnapshot().olderHistory].find(r => r.id === id);
  if (!found) throw new Error(`no record ${id}`);
  return found;
};

describe('the live window has answered', () => {
  it('an empty copy from the phone alone is not an answer: History waits for the server’s word, then knows it is empty', async () => {
    const s = setup();
    s.source.historyCached = true;
    s.store.start();
    stops.push(() => s.store.stop());
    await s.settle();
    expect(s.store.getSnapshot().historyLoaded).toBe(false);
    s.source.historyCached = false;
    s.source.emitHistory();
    expect(s.store.getSnapshot().historyLoaded).toBe(true);
  });

  it('records in the phone’s copy are shown at once', async () => {
    const s = setup({ '2026-10-20_mill': record('2026-10-20', 'mill', { flour: 1 }) });
    s.source.historyCached = true;
    s.store.start();
    stops.push(() => s.store.stop());
    await s.settle();
    expect(s.store.getSnapshot().historyLoaded).toBe(true);
  });

  it('the window’s start stays the one fixed at the first start once older pages are loaded (the two must meet)', async () => {
    const s = started({ '2026-08-01_mill': record('2026-08-01', 'mill', { flour: 3 }) });
    await s.settle();
    await s.store.loadOlderHistory();
    s.setToday('2026-11-15');
    s.store.stop();
    s.store.start();
    await s.settle();
    expect(s.source.historyFrom).toBe(WINDOW);
  });
});

describe('older orders, on demand', () => {
  it('pages from BEFORE the live window, newest first, then the legacy record, and says where it stands', async () => {
    const records: Record<string, Record<string, unknown>> = {
      '2026-10-20_mill': record('2026-10-20', 'mill', { flour: 1 }),
      '2026-08-26_mill': record('2026-08-26', 'mill', { flour: 2 }),
      '2026-08-01_mill': record('2026-08-01', 'mill', { flour: 3 }),
      '2026-07-15_dairy': record('2026-07-15', 'dairy', { butter: 1 }),
      '2026-W28': { weekStart: '2026-07-06', quantities: { flour: 9 }, stock: {} },
    };
    const s = started(records);
    s.source.pageSize = 2;
    await s.settle();
    expect(s.source.historyFrom).toBe(WINDOW);
    expect(s.store.getSnapshot().historyLoaded).toBe(true);
    expect(s.store.getSnapshot().history.map(r => r.id)).toStrictEqual(['2026-10-20_mill']);
    expect(s.store.getSnapshot().older).toStrictEqual({ loading: false, done: false, error: false });

    const first = s.store.loadOlderHistory();
    expect(s.store.getSnapshot().older.loading).toBe(true);
    await first;
    expect(s.source.olderReads).toStrictEqual([{ before: WINDOW, cursor: null }]);
    expect(s.store.getSnapshot().olderHistory.map(r => r.id)).toStrictEqual(['2026-08-26_mill', '2026-08-01_mill']);
    expect(s.store.getSnapshot().older).toStrictEqual({ loading: false, done: false, error: false });

    // The second page comes back short: the paging is over, and the legacy record follows at once.
    await s.store.loadOlderHistory();
    expect(s.source.olderReads[1]).toStrictEqual({ before: WINDOW, cursor: '2026-08-01_mill' });
    expect(s.source.legacyReads).toBe(1);
    expect(s.store.getSnapshot().olderHistory.map(r => r.id)).toStrictEqual(['2026-08-26_mill', '2026-08-01_mill', '2026-07-15_dairy', '2026-W28']);
    expect(s.store.getSnapshot().older).toStrictEqual({ loading: false, done: true, error: false });

    // Nothing more is asked once it is done.
    await s.store.loadOlderHistory();
    expect(s.source.olderReads).toHaveLength(2);
  });

  it('a failed page keeps what was loaded, says so, and the retry asks for the SAME page', async () => {
    const s = started({ '2026-08-01_mill': record('2026-08-01', 'mill', { flour: 3 }) });
    s.source.pageSize = 1;
    await s.settle();
    await s.store.loadOlderHistory();
    expect(s.store.getSnapshot().olderHistory).toHaveLength(1);
    s.source.failHistory.older = true;
    await s.store.loadOlderHistory();
    expect(s.store.getSnapshot().older).toStrictEqual({ loading: false, done: false, error: true });
    expect(s.store.getSnapshot().olderHistory).toHaveLength(1);
    await s.store.loadOlderHistory();
    expect(s.source.olderReads.slice(1)).toStrictEqual([
      { before: WINDOW, cursor: '2026-08-01_mill' }, { before: WINDOW, cursor: '2026-08-01_mill' },
    ]);
    expect(s.store.getSnapshot().older).toStrictEqual({ loading: false, done: true, error: false });
  });

  it('a second press while a page is on its way asks for nothing more', async () => {
    const s = started({});
    await s.settle();
    const a = s.store.loadOlderHistory();
    const b = s.store.loadOlderHistory();
    await Promise.all([a, b]);
    expect(s.source.olderReads).toHaveLength(1);
  });
});

describe('correcting a recorded order', () => {
  const ID = '2026-10-27_mill';

  it('writes the correction over the stored record, keeping the delivery answer, and the live window shows it', async () => {
    const s = started({ [ID]: { ...record(TODAY, 'mill', { flour: 2, semola: 1 }), missing: { semola: true } } });
    await s.settle();
    const outcome = await s.store.correctRecord(opened(s, ID), { qty: { flour: 3, semola: 0 }, stock: { flour: 1 } });
    expect(outcome).toBe('saved');
    const stored = s.source.records.get(ID)!;
    expect(stored.quantities).toStrictEqual({ flour: 3 });
    expect(stored.missing).toStrictEqual({ semola: true });
    expect(stored.updatedAt).toBe(NOW);
    expect(Object.values(stored.sends as Record<string, { kind?: string }>).map(x => x.kind)).toStrictEqual([undefined, 'edit']);
    await s.settle();
    expect(opened(s, ID).quantities).toStrictEqual({ flour: 3 });
    expect(s.busy()).toBe(0);
  });

  it('⚠️ refuses, writing NOTHING, when a colleague added to the record since the editor opened it', async () => {
    const s = started({ [ID]: record(TODAY, 'mill', { flour: 2 }) });
    await s.settle();
    const seen = opened(s, ID);
    s.source.duringRewrite = () => {
      s.source.records.set(ID, { ...record(TODAY, 'mill', { flour: 5 }), sends: { s1: {}, s2: {} } });
    };
    expect(await s.store.correctRecord(seen, { qty: { flour: 1 }, stock: {} })).toBe('changed');
    expect(s.source.records.get(ID)!.quantities).toStrictEqual({ flour: 5 });
  });

  it('a record deleted meanwhile is «gone», and nothing is created', async () => {
    const s = started({ [ID]: record(TODAY, 'mill', { flour: 2 }) });
    await s.settle();
    const seen = opened(s, ID);
    s.source.duringRewrite = () => { s.source.records.delete(ID); };
    expect(await s.store.correctRecord(seen, { qty: { flour: 1 }, stock: {} })).toBe('gone');
    expect(s.source.records.has(ID)).toBe(false);
  });

  it('every line at 0 is «empty»: nothing is written, the record is NOT deleted', async () => {
    const s = started({ [ID]: record(TODAY, 'mill', { flour: 2 }) });
    await s.settle();
    expect(await s.store.correctRecord(opened(s, ID), { qty: { flour: 0 }, stock: {} })).toBe('empty');
    expect(s.source.rewrites).toStrictEqual([]);
    expect(s.source.records.get(ID)!.quantities).toStrictEqual({ flour: 2 });
  });

  it('offline: refused before trying; a refused write: «failed», and the record is as it was', async () => {
    const s = started({ [ID]: record(TODAY, 'mill', { flour: 2 }) });
    await s.settle();
    const seen = opened(s, ID);
    s.goOffline();
    expect(await s.store.correctRecord(seen, { qty: { flour: 1 }, stock: {} })).toBe('offline');
    expect(s.source.rewrites).toStrictEqual([]);

    const t = started({ [ID]: record(TODAY, 'mill', { flour: 2 }) });
    await t.settle();
    t.source.failHistory.rewrite = true;
    expect(await t.store.correctRecord(opened(t, ID), { qty: { flour: 1 }, stock: {} })).toBe('failed');
    expect(t.source.records.get(ID)!.quantities).toStrictEqual({ flour: 2 });
    expect(t.busy()).toBe(0);
  });

  it('a record in an older page, which no listener watches, is brought in step after the write', async () => {
    const OLD = '2026-07-15_dairy';
    const s = started({ [OLD]: record('2026-07-15', 'dairy', { butter: 1 }) });
    await s.settle();
    await s.store.loadOlderHistory();
    expect(await s.store.correctRecord(opened(s, OLD), { qty: { butter: 4 }, stock: {} })).toBe('saved');
    expect(s.store.getSnapshot().olderHistory.find(r => r.id === OLD)!.quantities).toStrictEqual({ butter: 4 });
    expect(await s.store.deleteRecord(opened(s, OLD))).toBe('deleted');
    expect(s.store.getSnapshot().olderHistory.find(r => r.id === OLD)).toBeUndefined();
  });
});

describe('deleting a recorded order', () => {
  const ID = '2026-10-27_mill';

  it('deletes it, and the live window lets it go', async () => {
    const s = started({ [ID]: record(TODAY, 'mill', { flour: 2 }) });
    await s.settle();
    expect(await s.store.deleteRecord(opened(s, ID))).toBe('deleted');
    expect(s.source.records.has(ID)).toBe(false);
    await s.settle();
    expect(s.store.getSnapshot().history).toStrictEqual([]);
  });

  it('⚠️ refuses when a colleague added to it since it was opened: their order is not deleted with it', async () => {
    const s = started({ [ID]: record(TODAY, 'mill', { flour: 2 }) });
    await s.settle();
    const seen = opened(s, ID);
    s.source.duringRewrite = () => { s.source.records.set(ID, record(TODAY, 'mill', { flour: 3 })); };
    expect(await s.store.deleteRecord(seen)).toBe('changed');
    expect(s.source.records.get(ID)!.quantities).toStrictEqual({ flour: 3 });
  });
});
