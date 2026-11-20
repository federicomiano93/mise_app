// kioskOrdersSource.ts — what the kiosk's rest screen reads for its Orders lines (staff slice 6), and nothing else: the reads of the
// current app's js/kiosk-orders.js (`fetchRestSections`), ONE-TIME and READ-ONLY, on paths the app already reads (no new collection,
// field, rule or index):
//   - config/orders (1 document): which day the week starts on, and the goods-arrived switch (decision F4);
//   - the venue's suppliers (all of them);
//   - orders-history from the start of the current work week (`date >=`, one field, no composite index: a handful of documents);
//   - drafts/current (1 document), of which only `skipped` is used (a supplier closed today as not ordered).
// No listener: the rest screen reads when it goes to rest and every 15 minutes while it stays there (restOrders.ts), and only for
// somebody the venue shows Orders to (the rules ask the same of the last two: `canUse(lid, 'orders')`).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore() (src/firestore-access.spec.ts). A feature
// never imports another's source, so these few lines repeat the Orders section's paths.

import { buildPath } from '@mise/shared/location-id';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as stored, with its id.
export type StoredDoc = Readonly<Record<string, unknown>> & { readonly id: string };

export interface KioskOrdersSource {
  // config/orders as stored (null when there is none).
  readConfig(): Promise<Readonly<Record<string, unknown>> | null>;
  readSuppliers(): Promise<StoredDoc[]>;
  // orders-history from `fromDate` ('YYYY-MM-DD') onwards.
  readHistoryFrom(fromDate: string): Promise<StoredDoc[]>;
  // drafts/current as stored (null when there is none).
  readDraft(): Promise<Readonly<Record<string, unknown>> | null>;
}

export function createFirestoreKioskOrdersSource(firestore: () => Promise<FirestoreKit>, locationId: string): KioskOrdersSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const configPath = buildPath(locationId, 'config');
  const suppliersPath = buildPath(locationId, 'suppliers');
  const historyPath = buildPath(locationId, 'orders-history');
  const draftsPath = buildPath(locationId, 'drafts');

  const docsOf = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): StoredDoc[] =>
    snap.docs.map(d => ({ ...d.data(), id: d.id }));

  async function readDoc(path: string, id: string): Promise<Readonly<Record<string, unknown>> | null> {
    const { fs, db } = await firestore();
    const snap = await fs.getDoc(fs.doc(db, path, id));
    return snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null;
  }

  return {
    readConfig: () => readDoc(configPath, 'orders'),
    readDraft: () => readDoc(draftsPath, 'current'),
    async readSuppliers() {
      const { fs, db } = await firestore();
      return docsOf(await fs.getDocs(fs.collection(db, suppliersPath)));
    },
    async readHistoryFrom(fromDate) {
      const { fs, db } = await firestore();
      return docsOf(await fs.getDocs(fs.query(fs.collection(db, historyPath), fs.where('date', '>=', fromDate))));
    },
  };
}
