// «Close as not ordered» as written to Firestore (the current app's setSupplierSkipped / clearSupplierSkipped, PR #470), against
// a recording stand-in for the SDK: every screen spec runs on the in-memory source, so a slip here would first show as a close
// the rules refuse, or one that moves the draft's `updatedAt` (the day that stands in for rows saved before day stamps existed).

import { describe, expect, it } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreOrdersSource } from './ordersSource';

class FieldPath {
  readonly segments: string[];
  constructor(...segments: string[]) { this.segments = segments; }
}
const DELETE = { deleteField: true };

function recordingKit() {
  const calls: Array<[string, ...unknown[]]> = [];
  const fs = {
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    setDoc: (...args: unknown[]) => { calls.push(['setDoc', ...args]); return Promise.resolve(); },
    updateDoc: (...args: unknown[]) => { calls.push(['updateDoc', ...args]); return Promise.resolve(); },
    deleteField: () => DELETE,
    FieldPath,
  };
  return { kit: { fs, db: {} } as unknown as FirestoreKit, calls };
}

describe('ordersSource — a supplier closed as not ordered', () => {
  it('the close merges ONLY skipped.<id> with the venue stamp: no updatedAt, no entries, no days', async () => {
    const { kit, calls } = recordingKit();
    const source = createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery');
    await source.setSupplierSkipped('s-alp', '2026-11-06');
    expect(calls).toEqual([[
      'setDoc', { path: 'locations/bakery/drafts/current' }, { skipped: { 's-alp': '2026-11-06' }, bakery: 'bakery' }, { merge: true },
    ]]);
  });

  it('the reopen deletes that one key by a FieldPath (an id is data, not a path), stamped, with no updatedAt', async () => {
    const { kit, calls } = recordingKit();
    const source = createFirestoreOrdersSource(() => Promise.resolve(kit), 'bakery');
    await source.clearSupplierSkipped('a.b');
    const [op, ref, field, value, k, v, ...rest] = calls[0] ?? [];
    expect(op).toBe('updateDoc');
    expect(ref).toEqual({ path: 'locations/bakery/drafts/current' });
    expect(field).toBeInstanceOf(FieldPath);
    expect((field as FieldPath).segments).toEqual(['skipped', 'a.b']);
    expect(value).toBe(DELETE);
    expect([k, v]).toEqual(['bakery', 'bakery']);
    expect(rest).toEqual([]);
  });
});
