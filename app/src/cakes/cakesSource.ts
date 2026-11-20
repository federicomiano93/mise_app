// cakesSource.ts — the Cakes section's own data in Firestore: the cakes (READ) and the venue's reference grams (read and written).
//
// NEW IN MISE 2 (20 Nov 2026): there is no original to port. The shapes are exactly what firestore.rules accepts (`cakes/{id}`,
// `cake-settings/reference`), behind an interface so the store is a spec with a fake source.
//
// ⚠️ A CAKE IS NEVER WRITTEN FROM HERE. Its document travels in the SAME batch as its Food cost product (`cake-<id>`), so the two
// can never be saved or deleted apart: foodcost/foodcostSource.ts `saveProduct` / `removeProduct`, with a `companion`. This source
// only listens to them.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore() (src/firestore-access.spec.ts).

import { REFERENCE_KEYS } from '@mise/shared/cake-model';
import type { ReferenceGrams } from '@mise/shared/cake-model';
import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { StoredDoc } from '../foodcost/foodcostSource';
import type { FirestoreKit } from '../session/firebaseBackend';

// Where an answer came from: true when the SERVER sent it, false when it came from the browser's own database (possibly empty
// because this phone never synced it), so «there is no such cake» can wait for the server.
export interface CakesMeta {
  readonly fromServer: boolean;
}

export interface CakesSource {
  // The cakes, live, each with its id beside its fields. Returns the stop at once (Firestore may still be loading).
  watchCakes(onChange: (list: StoredDoc[], meta: CakesMeta) => void, onError: (err: unknown) => void): () => void;
  // `cake-settings/reference`, live: its fields, or null when it does not exist OR cannot be read. A refusal counts as the
  // server's word, as the labour rate's does.
  watchReference(onChange: (data: Record<string, unknown> | null, meta: CakesMeta) => void): () => void;
  // The reference grams, WHOLE, stamped for the venue. Resolves when the server has them (offline: later); rejects when refused.
  saveReference(grams: ReferenceGrams, updatedAt: string): Promise<void>;
}

const CAKES = 'cakes';
const SETTINGS = 'cake-settings';
const REFERENCE_DOC = 'reference';

export function createFirestoreCakesSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
): CakesSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const cakesPath = buildPath(locationId, CAKES);
  const settingsPath = buildPath(locationId, SETTINGS);

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment.
  // ⚠️ onSnapshot does NOT resubscribe after an error; onError lets the screen say so.
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

  return {
    // ⚠️ includeMetadataChanges: without it, the server's answer that is IDENTICAL to the browser's copy is never reported, and
    // the store would never learn that the list is the server's.
    watchCakes: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, cakesPath) as Query,
      { includeMetadataChanges: true },
      snap => onChange(
        snap.docs.map(d => ({ ...d.data(), id: d.id })),
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.error('watch(cakes) failed:', err);
        onError(err);
      },
    ), onError),

    // A refusal reads as «none»: the editor then simply has no reference grams to copy.
    watchReference: onChange => listen(kit => kit.fs.onSnapshot(
      kit.fs.doc(kit.db, settingsPath, REFERENCE_DOC),
      { includeMetadataChanges: true },
      snap => onChange(snap.exists() ? snap.data() : null, { fromServer: !snap.metadata.fromCache }),
      err => {
        console.warn('watch(cake reference) failed:', err);
        onChange(null, { fromServer: true });
      },
    ), () => onChange(null, { fromServer: true })),

    // ⚠️ WHOLE, NOT MERGED, AND ONLY THE EIGHT KEYS: the rules want exactly `bakery`, `grams`, `updatedAt` and exactly the eight
    // figures inside `grams`; a stray key from a caller would be a refused save, so it is built here from the list.
    async saveReference(grams, updatedAt) {
      const { fs, db } = await firestore();
      const whole: Record<string, number> = {};
      for (const key of REFERENCE_KEYS) whole[key] = grams[key];
      await fs.setDoc(fs.doc(db, settingsPath, REFERENCE_DOC), { bakery: locationId, grams: whole, updatedAt });
    },
  };
}
