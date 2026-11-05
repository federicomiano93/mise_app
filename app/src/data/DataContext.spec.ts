import { describe, expect, it, vi } from 'vitest';
import { createDataServices } from './DataContext';

// The data services of the app (built once in main.tsx on the session's backend). Each section has its own factory; the one for the
// invoice import is made when its screen opens and must not read or write anything by being made.

describe('createDataServices', () => {
  const auth = { createLinkAccount: vi.fn(), callFunction: vi.fn() };

  it('hands out an invoice import source for the venue that does not touch Firestore until it is used', () => {
    const firestore = vi.fn(() => Promise.reject(new Error('Firestore must not be asked for yet')));
    const services = createDataServices(firestore, auth);
    const source = services.invoiceImport('bakery');
    expect(Object.keys(source).sort()).toEqual([
      'createSupplier', 'freshIngredientsForSupplier', 'freshPrice', 'freshSuppliers', 'invoicePoints', 'linkSupplierVat',
      'loadDecisions', 'loadImportLog', 'runImportBatches', 'saveImportLog', 'storedPriceChanges', 'writeDecisions',
    ]);
    expect(firestore).not.toHaveBeenCalled();
  });

  it('asks the SESSION\'S backend for Firestore when the import reads, never getFirestore() (the venue id is in the path)', async () => {
    const firestore = vi.fn(() => Promise.reject(new Error('offline in this spec')));
    const source = createDataServices(firestore, auth).invoiceImport('bakery');
    await expect(source.loadDecisions()).rejects.toThrow('offline in this spec');
    expect(firestore).toHaveBeenCalledTimes(1);
  });
});
