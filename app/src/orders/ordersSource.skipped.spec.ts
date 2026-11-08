// The two writes of «Close as not ordered» / «Reopen» (checklist item 3, 8 Nov 2026) drive the REAL Firestore half (ordersSource.ts)
// with a recording stand-in for the SDK: firestore.rules (drafts/{id}: `skipped` an optional map of at most 200 keys) accept exactly these
// shapes, and the current app writes the same (js/orders/draft.js setSupplierSkipped / clearSupplierSkipped).

import { describe, expect, it } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreOrdersSource } from './ordersSource';

class FieldPath {
  readonly parts: string[];
  constructor(...parts: string[]) { this.parts = parts; }
}
const DELETE = { deleted: true };

function recordingKit() {
  const calls: unknown[][] = [];
  const fs = {
    doc: (_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` }),
    FieldPath,
    deleteField: () => DELETE,
    updateDoc: async (...args: unknown[]) => { calls.push(['updateDoc', ...args]); },
    setDoc: async (ref: unknown, data: unknown, options: unknown) => { calls.push(['setDoc', ref, data, options]); },
  };
  return { kit: { fs, db: {} } as unknown as FirestoreKit, calls };
}

describe('ordersSource — closing today\'s order', () => {
  it('a close is a MERGE of ONE key of `skipped`, the venue stamped, and NO updatedAt', async () => {
    const { kit, calls } = recordingKit();
    await createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery').setSkipped('mill', '2026-11-06');
    expect(calls).toStrictEqual([['setDoc', { path: 'locations/bakery/drafts/current' },
      { skipped: { mill: '2026-11-06' }, bakery: 'bakery' }, { merge: true }]]);
  });

  it('a reopen is an UPDATE deleting only that key through a FieldPath (an id is data, never a dotted path), NO updatedAt', async () => {
    const { kit, calls } = recordingKit();
    await createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery').clearSkipped('a.b');
    expect(calls).toStrictEqual([['updateDoc', { path: 'locations/bakery/drafts/current' },
      new FieldPath('skipped', 'a.b'), DELETE, 'bakery', 'bakery']]);
  });
});
