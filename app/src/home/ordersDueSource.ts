// ordersDueSource.ts — what the Home's «Ordini da fare» card reads, and nothing else (the Orders redesign of 16 Nov 2026, item 7;
// docs/mockups/orders-tablet-2026-11.md). NEW in Mise 2: the current app's Home has no such card.
//
// THREE live reads, all of them READ-ONLY, all on paths and queries the app already makes (no new collection, field, rule or index):
//   - the venue's suppliers (their order days), as the Suppliers section watches them;
//   - orders-history from TODAY onwards (`date >= today`, one field, no composite index): exactly the Suppliers section's
//     `watchPlaced`, to know which suppliers were already ordered today;
//   - drafts/current, of which only `skipped` is read (a supplier closed today as «not needed»).
// The rules let a person read the last two only with Orders (`canUse(lid, 'orders')`), so the card asks for them only for somebody
// the venue shows Orders to (useOrdersDue). Each listener lives exactly as long as the card is on screen (P14): the Home mounts it, a
// move to any other section stops it.
//
// ⚠️ includeMetadataChanges on every listener, and `fromServer` reported: a supplier placed this morning on another phone must not
// flash as «to order» from this phone's saved copy, so the card waits for the SERVER's word on the records and the draft (the rule
// of the Orders list's «To order» group).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are fixed by its first use
// (src/firestore-access.spec.ts). A feature never imports another's source, so these few lines repeat the Suppliers section's.

import type { Query } from 'firebase/firestore';
import { buildPath } from '@mise/shared/location-id';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as stored, with its id.
export type StoredDoc = Readonly<Record<string, unknown>> & { readonly id: string };
// Whether this answer is the SERVER's (not this phone's offline copy).
export type DueMeta = { readonly fromServer: boolean };

export interface OrdersDueSource {
  // Every supplier, live. Each watch returns its stop at once (Firestore may still be loading).
  // ⚠️ onSnapshot does NOT resubscribe after an error; onError lets the card give up quietly.
  watchSuppliers(onChange: (list: StoredDoc[], meta: DueMeta) => void, onError: (err: unknown) => void): () => void;
  // orders-history from `fromDate` ('YYYY-MM-DD') onwards, live.
  watchPlaced(fromDate: string, onChange: (list: StoredDoc[], meta: DueMeta) => void, onError: (err: unknown) => void): () => void;
  // drafts/current as stored (null when there is none), live.
  watchDraft(onChange: (data: Readonly<Record<string, unknown>> | null, meta: DueMeta) => void, onError: (err: unknown) => void): () => void;
}

const SUPPLIERS = 'suppliers';
const HISTORY = 'orders-history';
const DRAFTS = 'drafts';
const DRAFT_ID = 'current';

export function createFirestoreOrdersDueSource(firestore: () => Promise<FirestoreKit>, locationId: string): OrdersDueSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const suppliersPath = buildPath(locationId, SUPPLIERS);
  const historyPath = buildPath(locationId, HISTORY);
  const draftsPath = buildPath(locationId, DRAFTS);

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment.
  function listen(subscribe: (kit: FirestoreKit) => () => void, onError: (err: unknown) => void): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    firestore().then(kit => {
      if (stopped) return;
      unsubscribe = subscribe(kit);
    }).catch(err => {
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

  return {
    watchSuppliers: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, suppliersPath) as Query,
      { includeMetadataChanges: true },
      snap => { onChange(docsOf(snap), { fromServer: !snap.metadata.fromCache }); },
      err => {
        console.error('watch(suppliers) for the Home failed:', err);
        onError(err);
      },
    ), onError),

    watchPlaced: (fromDate, onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.query(kit.fs.collection(kit.db, historyPath), kit.fs.where('date', '>=', fromDate)),
      { includeMetadataChanges: true },
      snap => { onChange(docsOf(snap), { fromServer: !snap.metadata.fromCache }); },
      err => {
        console.error('watch(orders-history) for the Home failed:', err);
        onError(err);
      },
    ), onError),

    watchDraft: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.doc(kit.db, draftsPath, DRAFT_ID),
      { includeMetadataChanges: true },
      snap => { onChange(snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null, { fromServer: !snap.metadata.fromCache }); },
      err => {
        console.error('watch(drafts/current) for the Home failed:', err);
        onError(err);
      },
    ), onError),
  };
}
