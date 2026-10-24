// lazyImportSource.ts — the invoice import's database half (importSource.ts), loaded only when somebody opens the import.
//
// WHY A WRAPPER: DataContext is in the first screen's code, and importSource.ts pulls in the plan, the selection and the hash
// of the remembered decisions — code nobody needs until «Import from invoices» is opened (P16). So the data services hand out
// this thin object, and the real source is fetched the first time it is used. It is also fetched when the object is made (the
// screen makes it as it opens), so that by the time a file is read the code is already there: with the connection gone
// mid-way a first fetch would fail with an error the screen cannot tell from any other.
//
// A load that failed is forgotten, so the next call tries again.

import type { FirestoreKit } from '../../session/firebaseBackend';
import type { InvoiceImportSource } from './importSource';

export function createLazyImportSource(firestore: () => Promise<FirestoreKit>, locationId: string): InvoiceImportSource {
  let real: Promise<InvoiceImportSource> | null = null;

  function load(): Promise<InvoiceImportSource> {
    real ??= import('./importSource')
      .then(module => module.createFirestoreImportSource(firestore, locationId))
      .catch((error: unknown) => {
        real = null;
        throw error;
      });
    return real;
  }
  // Fetch it now; a failure here is reported by the first call that needs it.
  load().catch(() => undefined);

  return {
    createSupplier: async data => (await load()).createSupplier(data),
    linkSupplierVat: async (supplierId, vatNumber) => (await load()).linkSupplierVat(supplierId, vatNumber),
    freshSuppliers: async () => (await load()).freshSuppliers(),
    freshIngredientsForSupplier: async supplierId => (await load()).freshIngredientsForSupplier(supplierId),
    invoicePoints: async ingredientId => (await load()).invoicePoints(ingredientId),
    storedPriceChanges: async ingredientId => (await load()).storedPriceChanges(ingredientId),
    freshPrice: async ingredientId => (await load()).freshPrice(ingredientId),
    runImportBatches: async batches => (await load()).runImportBatches(batches),
    loadDecisions: async () => (await load()).loadDecisions(),
    writeDecisions: async changes => (await load()).writeDecisions(changes),
  };
}
