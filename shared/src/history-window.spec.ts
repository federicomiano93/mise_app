// Tests for the live window of orders-history and the paging of older orders (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/orders/history-window.js, which the live app uses today. The module is a FULL port, so
// parity.spec.ts also compares its exports.
//
// PORTED: every test of tests/history-window.test.mjs and tests/older-loader.test.mjs. None left out: all call the pure
// functions with injected fakes.

import { describe, expect, test, vi } from 'vitest';
import * as ported from './history-window';
import * as legacyJs from '../../js/orders/history-window.js';

const legacy = legacyJs as unknown as typeof ported;

// shared/ compiles without DOM or Node types (tsconfig.json); the console exists in both.
declare const console: { error(...args: unknown[]): void };

type Rec = { id: string; bakery?: string; quantities?: Record<string, number> };
const rec = (id: string): Rec => ({ id, bakery: 'b' });

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { return await fn(); } finally { spy.mockRestore(); }
}

type PageResult = { records: Rec[]; cursor: string | null; done: boolean };

function fakes({ pages, legacy = [rec('2026-W28')], failPage = [], failLegacy = [] }: {
  pages: PageResult[]; legacy?: Rec[]; failPage?: boolean[]; failLegacy?: boolean[];
}) {
  const calls = { page: [] as Array<string | null>, legacy: 0 };
  const queue = [...pages];
  return {
    calls,
    fetchPage: async (args: { before: string; cursor: string | null }) => {
      calls.page.push(args.cursor);
      if (failPage.shift()) throw new Error('offline');
      return queue.shift()!;
    },
    fetchLegacy: async () => {
      calls.legacy += 1;
      if (failLegacy.shift()) throw new Error('offline');
      return legacy;
    },
  };
}

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { HISTORY_LIVE_MONTHS, liveHistoryStart, mergeHistory, olderFooterState, historyEmptyKind, historyFooter, createOlderLoader } = m;
  const loaderOf = (f: ReturnType<typeof fakes>, onChange?: () => void) =>
    createOlderLoader<Rec, string | null>({ fetchPage: f.fetchPage, fetchLegacy: f.fetchLegacy, before: '2026-06-01', onChange });

  test('the live window is two calendar months', () => {
    expect(HISTORY_LIVE_MONTHS).toBe(2);
  });

  test('liveHistoryStart: two calendar months back, day clamped to the month', () => {
    expect(liveHistoryStart(new Date(2026, 6, 31))).toBe('2026-05-31');
    expect(liveHistoryStart(new Date(2026, 3, 30))).toBe('2026-02-28');
    expect(liveHistoryStart(new Date(2028, 3, 30))).toBe('2028-02-29');
    expect(liveHistoryStart(new Date(2027, 0, 15))).toBe('2026-11-15');
    expect(liveHistoryStart(new Date(2026, 9, 1))).toBe('2026-08-01');
  });

  test('liveHistoryStart: a clock-change day does not shift the date', () => {
    expect(liveHistoryStart(new Date(2026, 4, 29, 0, 30))).toBe('2026-03-29');
    expect(liveHistoryStart(new Date(2026, 11, 25, 1, 30))).toBe('2026-10-25');
  });

  test('liveHistoryStart reads the LOCAL date, not the UTC one', () => {
    expect(liveHistoryStart(new Date(2026, 6, 31, 23, 30))).toBe('2026-05-31');
    expect(liveHistoryStart(new Date(2026, 7, 1, 0, 30))).toBe('2026-06-01');
  });

  test('mergeHistory: union by id, the live copy wins, inputs untouched', () => {
    const live = [{ id: 'a', v: 'live' }, { id: 'b', v: 'live' }];
    const older = [{ id: 'b', v: 'older' }, { id: 'c', v: 'older' }];
    const liveCopy = JSON.parse(JSON.stringify(live)) as typeof live;
    const olderCopy = JSON.parse(JSON.stringify(older)) as typeof older;
    const merged = mergeHistory(live, older);
    expect(merged.map(r => r.id)).toStrictEqual(['a', 'b', 'c']);
    expect(merged.find(r => r.id === 'b')!.v).toBe('live');
    expect(live).toStrictEqual(liveCopy);
    expect(older).toStrictEqual(olderCopy);
    expect(merged).not.toBe(live);
  });

  test('mergeHistory copes with missing lists', () => {
    expect(mergeHistory(undefined, [{ id: 'x' }])).toStrictEqual([{ id: 'x' }]);
    expect(mergeHistory([{ id: 'x' }], null)).toStrictEqual([{ id: 'x' }]);
    expect(mergeHistory()).toStrictEqual([]);
  });

  test('olderFooterState: button while not done, disabled while loading, retry after a failure', () => {
    expect(olderFooterState({ loading: false, done: false, error: false })).toStrictEqual({ visible: true, disabled: false, failed: false });
    expect(olderFooterState({ loading: true, done: false, error: false })).toStrictEqual({ visible: true, disabled: true, failed: false });
    expect(olderFooterState({ loading: false, done: false, error: true })).toStrictEqual({ visible: true, disabled: false, failed: true });
    expect(olderFooterState({ loading: true, done: false, error: true }).failed).toBe(false);
    expect(olderFooterState({ loading: false, done: true, error: false }).visible).toBe(false);
  });

  test('historyEmptyKind: "no past orders" only once everything older was looked at', () => {
    expect(historyEmptyKind(true, { done: false })).toBe(null);
    expect(historyEmptyKind(false, { done: false })).toBe('recent');
    expect(historyEmptyKind(false, { done: true })).toBe('none');
  });

  // ── tests/older-loader.test.mjs ──
  test('older loader: a double tap makes one fetch', async () => {
    const f = fakes({ pages: [{ records: [rec('a')], cursor: 'c1', done: false }] });
    const loader = loaderOf(f);
    await Promise.all([loader.load(), loader.load()]);
    expect(f.calls.page).toHaveLength(1);
    expect(loader.state().records.map(r => r.id)).toStrictEqual(['a']);
    expect(loader.state().cursor).toBe('c1');
  });

  test('older loader: a failed page keeps the cursor and the records, and the retry asks for the same page', async () => {
    const f = fakes({
      pages: [{ records: [rec('a')], cursor: 'c1', done: false }, { records: [rec('b')], cursor: 'c2', done: false }],
      failPage: [false, true, false],
    });
    const loader = loaderOf(f);
    await loader.load();
    await quietly(() => loader.load());
    expect(loader.state().error).toBe(true);
    expect(loader.state().loading).toBe(false);
    expect(loader.state().cursor).toBe('c1');
    expect(loader.state().records.map(r => r.id)).toStrictEqual(['a']);
    await loader.load();
    expect(f.calls.page).toStrictEqual([null, 'c1', 'c1']);
    expect(loader.state().error).toBe(false);
    expect(loader.state().records.map(r => r.id)).toStrictEqual(['a', 'b']);
  });

  test('older loader: legacy is fetched only when a page comes back short', async () => {
    const f = fakes({ pages: [{ records: [rec('a')], cursor: 'c1', done: false }, { records: [rec('b')], cursor: 'c2', done: true }] });
    const loader = loaderOf(f);
    await loader.load();
    expect(f.calls.legacy).toBe(0);
    expect(loader.state().done).toBe(false);
    await loader.load();
    expect(f.calls.legacy).toBe(1);
    expect(loader.state().done).toBe(true);
    expect(loader.state().records.map(r => r.id)).toStrictEqual(['a', 'b', '2026-W28']);
  });

  test('older loader: a legacy failure leaves done false and the retry fetches only legacy', async () => {
    const f = fakes({ pages: [{ records: [rec('a')], cursor: 'c1', done: true }], failLegacy: [true, false] });
    const loader = loaderOf(f);
    await quietly(() => loader.load());
    expect(loader.state().done).toBe(false);
    expect(loader.state().error).toBe(true);
    expect(loader.state().records.map(r => r.id)).toStrictEqual(['a']);
    await loader.load();
    expect(f.calls.page).toHaveLength(1);
    expect(f.calls.legacy).toBe(2);
    expect(loader.state().done).toBe(true);
  });

  test('older loader: done stops further fetches', async () => {
    const f = fakes({ pages: [{ records: [], cursor: null, done: true }] });
    const loader = loaderOf(f);
    await loader.load();
    await loader.load();
    expect(f.calls.page).toHaveLength(1);
    expect(f.calls.legacy).toBe(1);
  });

  test('older loader: repaints when a load starts and ends, and patches a loaded record', async () => {
    let repaints = 0;
    const f = fakes({ pages: [{ records: [rec('a'), rec('b')], cursor: 'c1', done: false }] });
    const loader = loaderOf(f, () => { repaints += 1; });
    await loader.load();
    expect(repaints).toBe(2);
    expect(loader.patch('a', { id: 'ignored', quantities: { x: 1 } })).toBe(true);
    expect(loader.state().records.find(r => r.id === 'a')).toStrictEqual({ id: 'a', quantities: { x: 1 }, bakery: 'b' });
    expect(loader.patch('b', null)).toBe(true);
    expect(loader.state().records.map(r => r.id)).toStrictEqual(['a']);
    expect(loader.patch('zzz', null)).toBe(false);
  });

  test('historyFooter: parked days get «Show older», the load button waits behind them', () => {
    expect(historyFooter({ recentCount: 2, olderInMemory: 3, showingOlder: false, older: { done: false } }))
      .toStrictEqual({ empty: null, days: 'recent', parkedFoot: true, note: false, load: false });
  });

  test('historyFooter: nothing recent but older in memory adds the note', () => {
    const f = historyFooter({ recentCount: 0, olderInMemory: 3, showingOlder: false, older: { done: false } });
    expect(f.note).toBe(true);
    expect(f.parkedFoot).toBe(true);
  });

  test('historyFooter: once the older days are shown the load button follows them', () => {
    expect(historyFooter({ recentCount: 2, olderInMemory: 3, showingOlder: true, older: { done: false } }))
      .toStrictEqual({ empty: null, days: 'all', parkedFoot: false, note: false, load: true });
  });

  test('historyFooter: a freshly loaded page is SHOWN, not parked behind «Show older»', () => {
    const f = historyFooter({ recentCount: 2, olderInMemory: 4, showingOlder: true, older: { loading: false, done: false } });
    expect(f.days).toBe('all');
    expect(f.parkedFoot).toBe(false);
  });

  test('historyFooter: no load button when done, and the empty states', () => {
    expect(historyFooter({ recentCount: 2, olderInMemory: 0, showingOlder: false, older: { done: true } }).load).toBe(false);
    expect(historyFooter({ recentCount: 2, olderInMemory: 0, showingOlder: false }).load).toBe(false);
    expect(historyFooter({ recentCount: 0, olderInMemory: 0, showingOlder: false, older: { done: false } }))
      .toStrictEqual({ empty: 'recent', days: 'recent', parkedFoot: false, note: false, load: true });
    expect(historyFooter({ recentCount: 0, olderInMemory: 0, showingOlder: false, older: { done: true } }).empty).toBe('none');
  });
});
