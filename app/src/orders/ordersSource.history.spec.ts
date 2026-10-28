// The live window of orders-history must stay BOUNDED (P14): without the `where`, every opening of Orders would read the whole
// collection, which grows by hundreds of records a year and is never pruned — and every spec that uses the fake source would
// stay green. The current app pins the same query in tests/history-bounded-read.test.mjs. This spec drives the REAL Firestore
// half (ordersSource.ts) with a recording stand-in for the SDK.

import { describe, expect, it } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreOrdersSource } from './ordersSource';

function recordingKit() {
  const calls: Array<[string, ...unknown[]]> = [];
  let stopped = 0;
  const fs = {
    collection: (_db: unknown, path: string) => { calls.push(['collection', path]); return { path }; },
    where: (field: string, op: string, value: unknown) => { calls.push(['where', field, op, value]); return { field, op, value }; },
    query: (ref: unknown, ...constraints: unknown[]) => { calls.push(['query', ref, ...constraints]); return { ref, constraints }; },
    onSnapshot: (target: unknown, ...rest: unknown[]) => {
      calls.push(['onSnapshot', target, ...rest]);
      const onNext = rest.find(arg => typeof arg === 'function') as (snap: unknown) => void;
      onNext({ docs: [{ id: '2026-10-01_mill', data: () => ({ date: '2026-10-01' }) }], metadata: { fromCache: false } });
      return () => { stopped += 1; };
    },
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return { kit, calls, stopped: () => stopped };
}

describe('ordersSource — the live window of orders-history', () => {
  it('asks only for the records dated on or after the window\'s start, under the open venue', async () => {
    const { kit, calls } = recordingKit();
    const source = createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery');
    const seen: unknown[] = [];
    const stop = source.watchRecentHistory('2026-08-27', list => { seen.push(list); }, () => {});
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.find(c => c[0] === 'collection')).toEqual(['collection', 'locations/bakery/orders-history']);
    expect(calls.filter(c => c[0] === 'where')).toEqual([['where', 'date', '>=', '2026-08-27']]);
    const query = calls.find(c => c[0] === 'query');
    expect(query?.slice(2)).toEqual([{ field: 'date', op: '>=', value: '2026-08-27' }]);
    // The listener is on the bounded QUERY, never on the bare collection.
    const listened = calls.find(c => c[0] === 'onSnapshot')?.[1] as { constraints?: unknown[] };
    expect(listened.constraints).toHaveLength(1);
    expect(seen).toEqual([[{ date: '2026-10-01', id: '2026-10-01_mill' }]]);
    stop();
  });

  it('stops the listener it opened', async () => {
    const { kit, stopped } = recordingKit();
    const source = createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery');
    const stop = source.watchRecentHistory('2026-08-27', () => {}, () => {});
    await Promise.resolve();
    await Promise.resolve();
    stop();
    expect(stopped()).toBe(1);
  });
});

// The orders OLDER than the window (step 3f-4, parity H8): read one page at a time, ordered by the `date` FIELD, and ALWAYS from
// the server — getDocs would answer offline from the browser's own database, and a short page there would read as «no more
// orders» for good (the current app pins it in tests/history-bounded-read.test.mjs).
function pagingKit(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  const calls: Array<[string, ...unknown[]]> = [];
  const fs = {
    collection: (_db: unknown, path: string) => ({ path }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    orderBy: (field: string, dir?: string) => ({ orderBy: [field, dir ?? 'asc'] }),
    startAfter: (cursor: unknown) => ({ startAfter: cursor }),
    limit: (n: number) => ({ limit: n }),
    query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
    getDocs: () => { calls.push(['getDocs']); return Promise.resolve({ docs }); },
    getDocsFromServer: (q: unknown) => { calls.push(['getDocsFromServer', q]); return Promise.resolve({ docs }); },
  };
  return { kit: { fs, db: {} } as unknown as FirestoreKit, calls };
}

describe('ordersSource — the older pages of orders-history', () => {
  it('asks the SERVER for `date < before`, newest first, 100 at a time, after the cursor', async () => {
    const docs = [{ id: '2026-08-20_mill', data: () => ({ date: '2026-08-20' }) }];
    const { kit, calls } = pagingKit(docs);
    const source = createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery');

    const first = await source.getOlderHistory({ before: '2026-08-27', cursor: null });
    expect(calls.map(c => c[0])).toStrictEqual(['getDocsFromServer']);
    expect(calls[0]![1]).toStrictEqual({
      ref: { path: 'locations/bakery/orders-history' },
      constraints: [{ where: ['date', '<', '2026-08-27'] }, { orderBy: ['date', 'desc'] }, { limit: 100 }],
    });
    expect(first.records).toStrictEqual([{ date: '2026-08-20', id: '2026-08-20_mill' }]);
    expect(first.done).toBe(true);
    expect(first.cursor).toBe(docs[0]);

    await source.getOlderHistory({ before: '2026-08-27', cursor: first.cursor });
    expect((calls[1]![1] as { constraints: unknown[] }).constraints).toContainEqual({ startAfter: docs[0] });
  });

  it('the legacy weekly records: by `weekStart`, from the server', async () => {
    const { kit, calls } = pagingKit([{ id: '2026-W28', data: () => ({ weekStart: '2026-07-06' }) }]);
    const source = createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery');
    expect(await source.getLegacyHistory()).toStrictEqual([{ weekStart: '2026-07-06', id: '2026-W28' }]);
    expect(calls.map(c => c[0])).toStrictEqual(['getDocsFromServer']);
    expect((calls[0]![1] as { constraints: unknown[] }).constraints).toStrictEqual([{ orderBy: ['weekStart', 'asc'] }]);
  });
});

describe('ordersSource — rewriting one record', () => {
  function txKit(stored: Record<string, unknown> | null) {
    const done: Array<[string, unknown?]> = [];
    const tx = {
      get: () => Promise.resolve({ exists: () => stored !== null, data: () => stored }),
      set: (_ref: unknown, data: unknown) => { done.push(['set', data]); },
      delete: () => { done.push(['delete']); },
    };
    const fs = {
      doc: (_db: unknown, path: string, id: string) => ({ path, id }),
      runTransaction: (_db: unknown, run: (t: typeof tx) => Promise<unknown>) => run(tx),
    };
    return { kit: { fs, db: {} } as unknown as FirestoreKit, done };
  }

  it('sets the whole record with the venue stamp, or deletes it when decide answers null', async () => {
    const a = txKit({ date: '2026-10-27' });
    const source = createFirestoreOrdersSource(() => Promise.resolve(a.kit), 'bakery');
    expect(await source.rewriteRecord('x', stored => ({ ...stored, quantities: { a: 1 } }))).toStrictEqual(
      { date: '2026-10-27', quantities: { a: 1 }, bakery: 'bakery' });
    expect(a.done).toStrictEqual([['set', { date: '2026-10-27', quantities: { a: 1 }, bakery: 'bakery' }]]);

    const b = txKit({ date: '2026-10-27' });
    expect(await createFirestoreOrdersSource(() => Promise.resolve(b.kit), 'bakery').rewriteRecord('x', () => null)).toBe(null);
    expect(b.done).toStrictEqual([['delete']]);
  });

  it('what decide throws aborts: nothing is written', async () => {
    const c = txKit(null);
    const source = createFirestoreOrdersSource(() => Promise.resolve(c.kit), 'bakery');
    await expect(source.rewriteRecord('x', () => { throw new Error('orders/record-gone'); })).rejects.toThrow('orders/record-gone');
    expect(c.done).toStrictEqual([]);
  });
});
