// The three writes of Incoming (step 3f-5) drive the REAL Firestore half (ordersSource.ts) with a recording stand-in for the SDK:
// the rules accept exactly these shapes (firestore.rules, orders-history and config/{doc}), so the call, the path and the merge
// flag are pinned here.

import { describe, expect, it } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreOrdersSource } from './ordersSource';

function recordingKit() {
  const calls: unknown[][] = [];
  const fs = {
    doc: (_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` }),
    updateDoc: async (ref: unknown, data: unknown) => { calls.push(['updateDoc', ref, data]); },
    setDoc: async (ref: unknown, data: unknown, options: unknown) => { calls.push(['setDoc', ref, data, options]); },
  };
  return { kit: { fs, db: {} } as unknown as FirestoreKit, calls };
}

describe('ordersSource — Incoming', () => {
  it('«did it all arrive?» is an UPDATE of the record: `missing` replaced whole, the venue stamped', async () => {
    const { kit, calls } = recordingKit();
    await createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery')
      .confirmDelivery('2026-10-27_mill', { deliveredAt: 'T', missing: { flour: true }, updatedAt: 'T' });
    expect(calls).toStrictEqual([['updateDoc', { path: 'locations/bakery/orders-history/2026-10-27_mill' },
      { deliveredAt: 'T', missing: { flour: true }, updatedAt: 'T', bakery: 'bakery' }]]);
  });

  it('«Resolved» is a MERGE of one key of missingResolved', async () => {
    const { kit, calls } = recordingKit();
    await createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery').resolveMissing('2026-10-27_mill', 'flour', 'T');
    expect(calls).toStrictEqual([['setDoc', { path: 'locations/bakery/orders-history/2026-10-27_mill' },
      { missingResolved: { flour: 'T' }, updatedAt: 'T', bakery: 'bakery' }, { merge: true }]]);
  });

  it('the switch is a MERGE into config/orders', async () => {
    const { kit, calls } = recordingKit();
    await createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery').mergeOrdersConfig({ deliveryCheck: false });
    expect(calls).toStrictEqual([['setDoc', { path: 'locations/bakery/config/orders' },
      { deliveryCheck: false, bakery: 'bakery' }, { merge: true }]]);
  });
});
