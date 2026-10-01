// The paging of «Load older orders» and the placement of the foot of the History list,
// tested with injected fakes — no DOM and no Firestore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyFooter, createOlderLoader } from '../js/orders/history-window.js';

const quietly = async fn => {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
};

const rec = id => ({ id, bakery: 'b' });

function fakes({ pages, legacy = [rec('2026-W28')], failPage = [], failLegacy = [] }) {
  const calls = { page: [], legacy: 0 };
  const queue = [...pages];
  return {
    calls,
    fetchPage: async args => {
      calls.page.push(args.cursor);
      if (failPage.shift()) throw new Error('offline');
      return queue.shift();
    },
    fetchLegacy: async () => {
      calls.legacy += 1;
      if (failLegacy.shift()) throw new Error('offline');
      return legacy;
    },
  };
}

test('older loader: a double tap makes one fetch', async () => {
  const f = fakes({ pages: [{ records: [rec('a')], cursor: 'c1', done: false }] });
  const loader = createOlderLoader({ ...f, before: '2026-06-01' });
  await Promise.all([loader.load(), loader.load()]);
  assert.equal(f.calls.page.length, 1);
  assert.deepEqual(loader.state().records.map(r => r.id), ['a']);
  assert.equal(loader.state().cursor, 'c1');
});

test('older loader: a failed page keeps the cursor and the records, and the retry asks for the same page', async () => {
  const f = fakes({
    pages: [{ records: [rec('a')], cursor: 'c1', done: false }, { records: [rec('b')], cursor: 'c2', done: false }],
    failPage: [false, true, false],
  });
  const loader = createOlderLoader({ ...f, before: '2026-06-01' });
  await loader.load();
  await quietly(() => loader.load());
  assert.equal(loader.state().error, true);
  assert.equal(loader.state().loading, false);
  assert.equal(loader.state().cursor, 'c1');
  assert.deepEqual(loader.state().records.map(r => r.id), ['a']);
  await loader.load();
  assert.deepEqual(f.calls.page, [null, 'c1', 'c1']);
  assert.equal(loader.state().error, false);
  assert.deepEqual(loader.state().records.map(r => r.id), ['a', 'b']);
});

test('older loader: legacy is fetched only when a page comes back short', async () => {
  const f = fakes({ pages: [{ records: [rec('a')], cursor: 'c1', done: false }, { records: [rec('b')], cursor: 'c2', done: true }] });
  const loader = createOlderLoader({ ...f, before: '2026-06-01' });
  await loader.load();
  assert.equal(f.calls.legacy, 0);
  assert.equal(loader.state().done, false);
  await loader.load();
  assert.equal(f.calls.legacy, 1);
  assert.equal(loader.state().done, true);
  assert.deepEqual(loader.state().records.map(r => r.id), ['a', 'b', '2026-W28']);
});

test('older loader: a legacy failure leaves done false and the retry fetches only legacy', async () => {
  const f = fakes({ pages: [{ records: [rec('a')], cursor: 'c1', done: true }], failLegacy: [true, false] });
  const loader = createOlderLoader({ ...f, before: '2026-06-01' });
  await quietly(() => loader.load());
  assert.equal(loader.state().done, false);
  assert.equal(loader.state().error, true);
  assert.deepEqual(loader.state().records.map(r => r.id), ['a']);
  await loader.load();
  assert.equal(f.calls.page.length, 1);
  assert.equal(f.calls.legacy, 2);
  assert.equal(loader.state().done, true);
});

test('older loader: done stops further fetches', async () => {
  const f = fakes({ pages: [{ records: [], cursor: null, done: true }] });
  const loader = createOlderLoader({ ...f, before: '2026-06-01' });
  await loader.load();
  await loader.load();
  assert.equal(f.calls.page.length, 1);
  assert.equal(f.calls.legacy, 1);
});

test('older loader: repaints when a load starts and ends, and patches a loaded record', async () => {
  let repaints = 0;
  const f = fakes({ pages: [{ records: [rec('a'), rec('b')], cursor: 'c1', done: false }] });
  const loader = createOlderLoader({ ...f, before: '2026-06-01', onChange: () => { repaints += 1; } });
  await loader.load();
  assert.equal(repaints, 2);
  assert.equal(loader.patch('a', { quantities: { x: 1 } }), true);
  assert.deepEqual(loader.state().records.find(r => r.id === 'a'), { quantities: { x: 1 }, bakery: 'b', id: 'a' });
  assert.equal(loader.patch('b', null), true);
  assert.deepEqual(loader.state().records.map(r => r.id), ['a']);
  assert.equal(loader.patch('zzz', null), false);
});

test('historyFooter: parked days get «Show older», the load button waits behind them', () => {
  const f = historyFooter({ recentCount: 2, olderInMemory: 3, showingOlder: false, older: { done: false } });
  assert.deepEqual(f, { empty: null, days: 'recent', parkedFoot: true, note: false, load: false });
});

test('historyFooter: nothing recent but older in memory adds the note', () => {
  const f = historyFooter({ recentCount: 0, olderInMemory: 3, showingOlder: false, older: { done: false } });
  assert.equal(f.note, true);
  assert.equal(f.parkedFoot, true);
});

test('historyFooter: once the older days are shown the load button follows them', () => {
  const f = historyFooter({ recentCount: 2, olderInMemory: 3, showingOlder: true, older: { done: false } });
  assert.deepEqual(f, { empty: null, days: 'all', parkedFoot: false, note: false, load: true });
});

test('historyFooter: a freshly loaded page is SHOWN, not parked behind «Show older»', () => {
  // The load button sets showingOlder before asking, so the loaded days (all older than the
  // window) are on screen when they arrive and no «Show older» button hides them.
  const f = historyFooter({ recentCount: 2, olderInMemory: 4, showingOlder: true, older: { loading: false, done: false } });
  assert.equal(f.days, 'all');
  assert.equal(f.parkedFoot, false);
});

test('historyFooter: no load button when done, and the empty states', () => {
  assert.equal(historyFooter({ recentCount: 2, olderInMemory: 0, showingOlder: false, older: { done: true } }).load, false);
  assert.equal(historyFooter({ recentCount: 2, olderInMemory: 0, showingOlder: false }).load, false);
  assert.deepEqual(historyFooter({ recentCount: 0, olderInMemory: 0, showingOlder: false, older: { done: false } }),
    { empty: 'recent', days: 'recent', parkedFoot: false, note: false, load: true });
  assert.equal(historyFooter({ recentCount: 0, olderInMemory: 0, showingOlder: false, older: { done: true } }).empty, 'none');
});
