// lazyMergeSource.ts — the merge's database half (mergeSource.ts), loaded only when somebody opens «Merge another pack…».
//
// WHY A WRAPPER (the shape of invoiceImport/lazyImportSource.ts): DataContext is in the first screen's code, and mergeSource.ts
// pulls in the merge plan and the invoice-import model behind it — code nobody needs until the chooser is opened (P16). The
// real source is fetched when this object is made (the chooser makes it as it opens), so that by the time a row is tapped the
// code is already there, and a load that failed is forgotten so the next call tries again.

import type { FirestoreKit } from '../../session/firebaseBackend';
import type { MergeSource } from './mergeSource';

export function createLazyMergeSource(firestore: () => Promise<FirestoreKit>, locationId: string): MergeSource {
  let real: Promise<MergeSource> | null = null;

  function load(): Promise<MergeSource> {
    real ??= import('./mergeSource')
      .then(module => module.createFirestoreMergeSource(firestore, locationId))
      .catch((error: unknown) => {
        real = null;
        throw error;
      });
    return real;
  }
  // Fetch it now; a failure here is reported by the first call that needs it.
  load().catch(() => undefined);

  return {
    checkUsage: async bId => (await load()).checkUsage(bId),
    previewMerge: async (aId, bId) => (await load()).previewMerge(aId, bId),
    mergeIngredients: async (aId, bId) => (await load()).mergeIngredients(aId, bId),
  };
}
