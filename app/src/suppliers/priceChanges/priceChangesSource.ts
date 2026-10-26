// priceChangesSource.ts — the database half of «Price changes» (step 3e-7, parity I101–I116): the port of
// listPriceChanges / latestPriceChangeDate of js/orders/firebase-orders.js. READ-ONLY: the changes are written by the invoice
// import (importSource.ts) and deleted by a merge (mergeSource.ts), never here.
//
// ⚠️ NEVER A FALSE «NO CHANGES» (parity I103). getDocs would answer from the cache while the server is unreachable, and an empty
// or partial cache reads as «prices did not move». So the server is asked first (when the browser thinks it is online); only if
// that fails, or the browser is offline, the cache answers — and the answer says so (`fromCache: true`), so the screen can warn
// that changes may be missing. ⚠️ DIFFERENCE FROM THE CURRENT APP, ON PURPOSE: the server read is bounded
// (SERVER_READ_TIMEOUT_MS) — a connection that says it is up and carries nothing would otherwise leave the screen on «Loading…»
// for ever; past the bound the cache answers, flagged, exactly as after a refusal.
// ⚠️ A range and an orderBy on the SAME single field (`date`) need no composite index (parity I104).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore() (src/firestore-access.spec.ts).
// ⚠️ NO ROLE IS READ HERE: the rules read `price-changes` only for canManage(foodcost) (P2); the door is courtesy.

import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../../session/firebaseBackend';
import type { StoredDoc } from '../suppliersSource';

const PRICE_CHANGES = 'price-changes';

export const SERVER_READ_TIMEOUT_MS = 15_000;

export interface PriceChangesAnswer {
  // The stored changes, each with its document id.
  readonly docs: StoredDoc[];
  // The answer came from this phone's copy, not the server: some changes may be missing.
  readonly fromCache: boolean;
}

export interface LatestChangeAnswer {
  // The `date` of the newest stored change, '' when there is none.
  readonly date: string;
  readonly fromCache: boolean;
}

export interface PriceChangesSource {
  // The changes whose `date` falls in [from, to] (inclusive YYYY-MM-DD), oldest first. Rejects only when neither the server
  // nor the cache could answer.
  listPriceChanges(from: string, to: string): Promise<PriceChangesAnswer>;
  // The date of the newest change ('' when there is none yet).
  latestPriceChangeDate(): Promise<LatestChangeAnswer>;
}

export interface PriceChangesEnvironment {
  // Whether the browser says it is offline now (navigator.onLine === false). A spec passes its own.
  readonly isOffline: () => boolean;
}

const BROWSER: PriceChangesEnvironment = {
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
};

type Snapshot = { docs: Array<{ id: string; data: () => Record<string, unknown> }> };

export function createFirestorePriceChangesSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
  env: PriceChangesEnvironment = BROWSER,
): PriceChangesSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const path = buildPath(locationId, PRICE_CHANGES);

  function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('price-changes:server-timeout')), SERVER_READ_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function serverFirst(build: (kit: FirestoreKit) => Query): Promise<{ snap: Snapshot; fromCache: boolean }> {
    const kit = await firestore();
    const q = build(kit);
    if (!env.isOffline()) {
      try {
        return { snap: await bounded(kit.fs.getDocsFromServer(q)), fromCache: false };
      } catch (err) {
        console.warn('Price changes: the server could not be read, using the cache:', err);
      }
    }
    return { snap: await kit.fs.getDocsFromCache(q), fromCache: true };
  }

  return {
    async listPriceChanges(from, to) {
      const { snap, fromCache } = await serverFirst(({ fs, db }) => fs.query(
        fs.collection(db, path),
        fs.where('date', '>=', from),
        fs.where('date', '<=', to),
        fs.orderBy('date'),
      ));
      return { docs: snap.docs.map(d => ({ ...d.data(), id: d.id })), fromCache };
    },

    async latestPriceChangeDate() {
      const { snap, fromCache } = await serverFirst(({ fs, db }) => fs.query(
        fs.collection(db, path),
        fs.orderBy('date', 'desc'),
        fs.limit(1),
      ));
      const first = snap.docs[0];
      return { date: first ? String(first.data().date || '') : '', fromCache };
    },
  };
}
