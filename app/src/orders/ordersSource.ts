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
// It writes the draft (a merge of the changed lines and days, draftSync.ts decides what changed; and, from step 3f-2, the
// clear of the lines an order took or a «Clear quantities» threw away) and ONE order record at a time
// (orders-history/<day>_<supplier>, in a transaction — parity H1, H2). It reads a record once: the confirm screen asks whether
// today's record exists before it opens. From step 3f-2b it also watches the LIVE WINDOW of orders-history — the last two
// calendar months (@mise/shared/history-window), exactly the query of the current app's watchRecentHistory — which the
// suggestions are worked out from (parity L27). From step 3f-4 (History) it fetches the orders OLDER than that window on
// demand, a page of 100 at a time and then the legacy weekly record, ALWAYS FROM THE SERVER (parity H8); and it rewrites or
// deletes ONE record from History's editor, in a transaction that refuses when the record changed since the editor opened it
// (parity H12, and the difference E1 of 3f-4). From step 3f-5 (Incoming) it answers «did it all arrive?» on one record
// (`confirmDelivery`, a patch that replaces `missing` whole), marks one missing line «Resolved» (`resolveMissing`, a merge that
// ADDS to `missingResolved`), and writes the venue's goods-arrived switch into config/orders (`mergeOrdersConfig`, decision F4;
// the rules let only an owner or a manager write that document).
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
  // orders-history from `fromDate` ('YYYY-MM-DD') onwards, live: `date >= fromDate`, one field, so no composite index. Same
  // contract. The legacy weekly record has no `date` and is never in it — as in the current app.
  watchRecentHistory(fromDate: string, onChange: (list: StoredDoc[], meta: OrdersMeta) => void, onError: (err: unknown) => void): () => void;
  // Merges the changed lines and days into drafts/current — and creates it on the very first order, which an update of
  // dotted paths could not. The venue stamp is applied here. Settles when the SERVER answers; REJECTS when refused
  // (offline, it simply waits, and Firestore shows the write at once in every answer meanwhile).
  mergeDraft(payload: DraftPayload): Promise<void>;
  // Deletes these fields of drafts/current (`entries.<id>`, `entries.<id>.qty`, `days.<supplierId>`…), stamping
  // `updatedAt` — an update, never a set: a merge cannot delete a nested key, and only the named paths go, so whatever
  // another phone is typing elsewhere in the document survives (js/orders/firebase-orders.js clearFields).
  clearDraft(paths: readonly string[], updatedAt: string): Promise<void>;
  // orders-history/<id> as stored, once (null when there is none). A failure rejects.
  readRecord(id: string): Promise<Record<string, unknown> | null>;
  // Writes orders-history/<id> in a TRANSACTION: `merge` gets the record as stored (null when there is none) and returns the
  // WHOLE new record, which replaces it (the venue stamp is applied here). What `merge` throws aborts the write and rejects
  // with it (orders/unit-conflict). Resolves with what was written.
  recordOrder(
    id: string,
    merge: (existing: Record<string, unknown> | null) => Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  // One page of orders-history OLDER than `before` ('YYYY-MM-DD'), newest first: `date < before`, ordered by `date`
  // descending, after `cursor` (the opaque value the previous page returned; null for the first). `done` when the page came
  // back short. ⚠️ FROM THE SERVER ONLY: rejects offline (see the implementation).
  getOlderHistory(args: { before: string; cursor: unknown }): Promise<{ records: StoredDoc[]; cursor: unknown; done: boolean }>;
  // The legacy weekly records — the only ones with a `weekStart` and no `date` (parity H5). From the server only, as above.
  getLegacyHistory(): Promise<StoredDoc[]>;
  // Rewrites orders-history/<id> in a TRANSACTION: `decide` gets the record as stored (null when there is none) and returns
  // the WHOLE new record (it replaces the stored one; the venue stamp is applied here) or null to DELETE it. What `decide`
  // throws aborts and rejects with it. Resolves with what was written (null after a delete). A transaction needs the
  // server, so offline it rejects.
  rewriteRecord(
    id: string,
    decide: (existing: Record<string, unknown> | null) => Record<string, unknown> | null,
  ): Promise<Record<string, unknown> | null>;
  // «Did it all arrive?» answered for orders-history/<id> (parity V4): an UPDATE of `deliveredAt`, `missing` (REPLACED whole)
  // and `updatedAt`, the current app's confirmDelivery. Settles when the server answers; offline it waits (Firestore shows the
  // answer at once meanwhile); rejects when refused or when the record is gone.
  confirmDelivery(id: string, patch: { deliveredAt: string; missing: Record<string, true>; updatedAt: string }): Promise<void>;
  // «Resolved» on one missing line of orders-history/<recordId> (parity V9, V11): a MERGE of `missingResolved.<ingredientId>` =
  // `at` and `updatedAt`; `missing` is never touched. Same contract.
  resolveMissing(recordId: string, ingredientId: string, at: string): Promise<void>;
  // Merges these keys into config/orders (decision F4: the goods-arrived switch). Same contract; a person who is not an owner or
  // a manager is refused by the rules (permission-denied).
  mergeOrdersConfig(patch: Record<string, unknown>): Promise<void>;
}

// Orders older than the live window are read 100 at a time (the current app's getOlderHistory).
export const OLDER_PAGE_SIZE = 100;

const SUPPLIERS = 'suppliers';
const INGREDIENTS = 'ingredients';
const CONFIG = 'config';
const ORDERS_DOC = 'orders';
const DRAFTS = 'drafts';
const DRAFT_ID = 'current';
const HISTORY = 'orders-history';

export function createFirestoreOrdersSource(firestore: () => Promise<FirestoreKit>, locationId: string): OrdersSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const suppliersPath = buildPath(locationId, SUPPLIERS);
  const ingredientsPath = buildPath(locationId, INGREDIENTS);
  const configPath = buildPath(locationId, CONFIG);
  const draftsPath = buildPath(locationId, DRAFTS);
  const historyPath = buildPath(locationId, HISTORY);

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

    // includeMetadataChanges for ONE answer: the server's first word, which may be identical to the browser's copy (History's
    // «Loading…» and an editor opened by its address wait for it, step 3f-4). Every other metadata-only answer is dropped, so the
    // window is not cut into lists again for nothing.
    watchRecentHistory(fromDate, onChange, onError) {
      let told = false;
      let toldServer = false;
      return listen(kit => kit.fs.onSnapshot(
        kit.fs.query(kit.fs.collection(kit.db, historyPath), kit.fs.where('date', '>=', fromDate)),
        { includeMetadataChanges: true },
        snap => {
          const fromServer = !snap.metadata.fromCache;
          if (told && snap.docChanges().length === 0 && (toldServer || !fromServer)) return;
          told = true;
          toldServer = toldServer || fromServer;
          onChange(docsOf(snap), { fromServer });
        },
        err => {
          console.error('watch(orders-history) failed:', err);
          onError(err);
        },
      ), onError);
    },

    // ⚠️ setDoc WITH merge AND A PARTIAL MAP: Firestore merges key by key, so the lines not mentioned keep whatever
    // anybody else has put there. The venue stamp goes on LAST: the rules require `bakery` to name the folder (stampedFor).
    async mergeDraft(payload) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, draftsPath, DRAFT_ID), { ...payload, bakery: locationId }, { merge: true });
    },

    // ⚠️ updateDoc, so the venue stamp rides along (the rules check it on every write) and a missing draft is refused
    // rather than created empty — there is nothing to clear in a draft that does not exist.
    async clearDraft(paths, updatedAt) {
      const { fs, db } = await firestore();
      const update: Record<string, unknown> = { updatedAt, bakery: locationId };
      for (const path of paths) update[path] = fs.deleteField();
      await fs.updateDoc(fs.doc(db, draftsPath, DRAFT_ID), update);
    },

    async readRecord(id) {
      const { fs, db } = await firestore();
      const snap = await fs.getDoc(fs.doc(db, historyPath, id));
      return snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null;
    },

    // ⚠️ ONE TRANSACTION FOR THE READ AND THE WRITE: two phones placing the same supplier's order in the same second must
    // both end up in the record (mergeArchives ADDS), never the second overwriting the first. tx.set replaces the record
    // WHOLE: mergeArchives carries over everything a record must keep (missing, missingResolved, names, sends).
    async recordOrder(id, merge) {
      const { fs, db } = await firestore();
      const ref = fs.doc(db, historyPath, id);
      return fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const next = { ...merge(snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null), bakery: locationId };
        tx.set(ref, next);
        return next;
      });
    },

    // ⚠️ getDocsFromServer, NEVER getDocs: offline, getDocs quietly answers from the browser's own database — often empty or
    // partial — and a short page would read as `done`, so «Load older orders» would vanish under a false «no more orders».
    // getDocsFromServer REJECTS when the server cannot be reached, which puts the error line and the retry on screen.
    // Ordered by the `date` FIELD, not the document id: Firestore refuses a descending scan by key, and one field needs no
    // composite index.
    async getOlderHistory({ before, cursor }) {
      const { fs, db } = await firestore();
      const snap = await fs.getDocsFromServer(fs.query(
        fs.collection(db, historyPath),
        fs.where('date', '<', before),
        fs.orderBy('date', 'desc'),
        ...(cursor ? [fs.startAfter(cursor)] : []),
        fs.limit(OLDER_PAGE_SIZE),
      ));
      const records = docsOf(snap);
      return {
        records,
        cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : cursor,
        done: records.length < OLDER_PAGE_SIZE,
      };
    },

    // Only legacy records carry `weekStart` (the rules keep it off modern ones), so ordering by it returns just them.
    async getLegacyHistory() {
      const { fs, db } = await firestore();
      const snap = await fs.getDocsFromServer(fs.query(fs.collection(db, historyPath), fs.orderBy('weekStart')));
      return docsOf(snap);
    },

    // ⚠️ ONE TRANSACTION FOR THE CHECK AND THE WRITE: a correction saved while a colleague added a second order to the same
    // record would otherwise overwrite their order (the current app's replaceDoc does). `decide` compares and throws.
    async rewriteRecord(id, decide) {
      const { fs, db } = await firestore();
      const ref = fs.doc(db, historyPath, id);
      return fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const next = decide(snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null);
        if (next === null) {
          tx.delete(ref);
          return null;
        }
        const stamped = { ...next, bakery: locationId };
        tx.set(ref, stamped);
        return stamped;
      });
    },

    // ⚠️ updateDoc, NOT A MERGE: `missing` is REPLACED WHOLE, so a second answer can say «the flour came after all» (a merge
    // would keep the old mark, and the flour would stay on «To re-order» and out of the stocktake for ever). An empty
    // `deliveredAt` is a real value («looked, not arrived») and is written, never omitted (js/orders/draft.js).
    async confirmDelivery(id, patch) {
      const { fs, db } = await firestore();
      await fs.updateDoc(fs.doc(db, historyPath, id), { ...patch, bakery: locationId });
    },

    // ⚠️ A MERGE, on purpose: the map is ADDED to, one line at a time, maybe from two phones (js/orders/draft.js resolveMissing).
    async resolveMissing(recordId, ingredientId, at) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, historyPath, recordId),
        { missingResolved: { [ingredientId]: at }, updatedAt: at, bakery: locationId }, { merge: true });
    },

    // A merge: only the keys named change, every other setting of the venue stays (js/orders/firebase-orders.js saveDoc).
    async mergeOrdersConfig(patch) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, configPath, ORDERS_DOC), { ...patch, bakery: locationId }, { merge: true });
    },
  };
}
