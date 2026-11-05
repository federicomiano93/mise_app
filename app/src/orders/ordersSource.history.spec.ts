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
