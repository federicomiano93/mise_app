// ordersSource.ts — the data of «Orders» in Firestore, and nothing else (step 3f-1).
//
// A port of the parts of js/orders/firebase-orders.js and js/orders/draft.js that the order list calls, write for write,
// because firestore.rules (the `suppliers`, `ingredients`, `config/{doc}` and `drafts/{id}` blocks) accepts exactly these
// shapes. Behind an interface, so the store (ordersStore.ts) is a spec with a fake source and never needs a database.
//
// Under the open venue, watched only while the section is on screen (P14):
//   • suppliers — every supplier (the list shows the active ones; a switched-off one still names an override).
//   • ingredients — every ingredient, as stored. ⚠️ NO PRICES in this slice: the order's money is a tablet-only line for
//     whoever may read prices (parity L20, slice 3f-8), and an employee must not even load them.
//   • config/orders — the venue's supplier order, favourites, Stock box switch (parity M10).
//   • drafts/current — the order in progress, shared live by every phone of the venue (parity L31).
// It writes ONE thing: a merge of the changed lines and days of drafts/current (draftSync.ts decides what changed).
//
// ⚠️ NO ROLE IS READ HERE, ON PURPOSE: the section gate and firestore.rules decide (P2).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are fixed by its
// first use (src/firestore-access.spec.ts).
//
// The Suppliers section watches three of the same collections with its own source: a feature never imports from another
// feature's folder, and the two sections are never on screen together, so no document is listened to twice (T4).

import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';
import type { DraftPayload } from './draftSync';

// A document as the store reads it: its id beside its fields.
export type StoredDoc = { readonly id: string } & Record<string, unknown>;

// Where a snapshot came from: true when the SERVER sent it, false when it came from the browser's own database — which can
// be empty, or old, because this phone never synced the collection.
export interface OrdersMeta {
  readonly fromServer: boolean;
}

export interface OrdersSource {
  // Every supplier, live. Returns the unsubscribe at once (Firestore may still be loading).
  // ⚠️ onSnapshot does NOT resubscribe after an error; onError lets the screen say so (parity L5).
  watchSuppliers(onChange: (list: StoredDoc[], meta: OrdersMeta) => void, onError: (err: unknown) => void): () => void;
  // Every ingredient (and packaging item), live, as stored. Same contract.
  watchIngredients(onChange: (list: StoredDoc[], meta: OrdersMeta) => void, onError: (err: unknown) => void): () => void;
  // config/orders as stored (null when there is none), live. Same contract.
  watchOrdersConfig(
    onChange: (data: Record<string, unknown> | null, meta: OrdersMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // drafts/current as stored (null when there is none), live. Same contract.
  watchDraft(
    onChange: (data: Record<string, unknown> | null, meta: OrdersMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // Merges the changed lines and days into drafts/current — and creates it on the very first order, which an update of
  // dotted paths could not. The venue stamp is applied here. Settles when the SERVER answers; REJECTS when refused
  // (offline, it simply waits, and Firestore shows the write at once in every answer meanwhile).
  mergeDraft(payload: DraftPayload): Promise<void>;
}

const SUPPLIERS = 'suppliers';
const INGREDIENTS = 'ingredients';
const CONFIG = 'config';
const ORDERS_DOC = 'orders';
const DRAFTS = 'drafts';
const DRAFT_ID = 'current';

export function createFirestoreOrdersSource(firestore: () => Promise<FirestoreKit>, locationId: string): OrdersSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const suppliersPath = buildPath(locationId, SUPPLIERS);
  const ingredientsPath = buildPath(locationId, INGREDIENTS);
  const configPath = buildPath(locationId, CONFIG);
  const draftsPath = buildPath(locationId, DRAFTS);

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment.
  function listen(subscribe: (kit: FirestoreKit) => () => void, onError: (err: unknown) => void): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    firestore().then(kit => {
      if (stopped) return;
      unsubscribe = subscribe(kit);
    }).catch((err: unknown) => {
      if (!stopped) onError(err);
    });
    return () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
    };
  }

  const docsOf = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): StoredDoc[] =>
    snap.docs.map(d => ({ ...d.data(), id: d.id }));

  // ⚠️ includeMetadataChanges EVERYWHERE: without it the server's answer that is IDENTICAL to the browser's copy is never
  // reported, and the store would never learn that what it shows is the server's (an empty list would say «Loading…» for
  // ever, a missing draft would never be known to be really missing).
  function watchCollection(path: string, label: string) {
    return (onChange: (list: StoredDoc[], meta: OrdersMeta) => void, onError: (err: unknown) => void) =>
      listen(kit => kit.fs.onSnapshot(
        kit.fs.collection(kit.db, path) as Query,
        { includeMetadataChanges: true },
        snap => onChange(docsOf(snap), { fromServer: !snap.metadata.fromCache }),
        err => {
          console.error(`watch(${label}) failed:`, err);
          onError(err);
        },
      ), onError);
  }

  function watchDocument(path: string, id: string, label: string) {
    return (onChange: (data: Record<string, unknown> | null, meta: OrdersMeta) => void, onError: (err: unknown) => void) =>
      listen(kit => kit.fs.onSnapshot(
        kit.fs.doc(kit.db, path, id),
        { includeMetadataChanges: true },
        snap => onChange(
          snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null,
          { fromServer: !snap.metadata.fromCache },
        ),
        err => {
          console.error(`watch(${label}) failed:`, err);
          onError(err);
        },
      ), onError);
  }

  return {
    watchSuppliers: watchCollection(suppliersPath, SUPPLIERS),
    watchIngredients: watchCollection(ingredientsPath, INGREDIENTS),
    watchOrdersConfig: watchDocument(configPath, ORDERS_DOC, 'config/orders'),
    watchDraft: watchDocument(draftsPath, DRAFT_ID, 'drafts/current'),

    // ⚠️ setDoc WITH merge AND A PARTIAL MAP: Firestore merges key by key, so the lines not mentioned keep whatever
    // anybody else has put there. The venue stamp goes on LAST: the rules require `bakery` to name the folder (stampedFor).
    async mergeDraft(payload) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, draftsPath, DRAFT_ID), { ...payload, bakery: locationId }, { merge: true });
    },
  };
}
