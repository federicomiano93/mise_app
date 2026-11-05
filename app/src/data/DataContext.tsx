import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreCalculatorSource } from '../calculator/calculatorSource';
import type { CalculatorSource } from '../calculator/calculatorSource';
import { browserRandomBytes, createFirestoreClientOrdersSource } from '../calculator/clientOrdersSource';
import type { ClientOrdersSource } from '../calculator/clientOrdersSource';
import { createFirestoreFoodcostSource } from '../foodcost/foodcostSource';
import type { FoodcostSource } from '../foodcost/foodcostSource';
import { createFirestorePastriesSource } from '../pastries/pastriesSource';
import type { PastriesSource } from '../pastries/pastriesSource';
import { createPhotoSource } from '../recipes/photoSource';
import type { PhotoSource } from '../recipes/photoSource';
import { createFirestoreRecipesSource } from '../recipes/recipesSource';
import type { RecipesSource } from '../recipes/recipesSource';
import { createFirestoreStocktakeSource } from '../stocktake/stocktakeSource';
import type { StocktakeSource } from '../stocktake/stocktakeSource';
import { createFirestoreSuppliersSource } from '../suppliers/suppliersSource';
import type { SuppliersSource } from '../suppliers/suppliersSource';
import type { InvoiceImportSource } from '../suppliers/invoiceImport/importSource';
import { createLazyImportSource } from '../suppliers/invoiceImport/lazyImportSource';

// Where every section gets its data from: one factory per section, built once in main.tsx on the
// session's backend. A screen's spec passes fakes instead (testing/renderApp.tsx), so no screen
// ever needs a database to be tested — the same idea as the session's injected backend.
//
// ⚠️ EVERY FACTORY TAKES FIRESTORE FROM THE BACKEND (`firestore()`), never from getFirestore():
// its settings are fixed by its first use (src/firestore-access.spec.ts).
export interface DataServices {
  pastries(locationId: string): PastriesSource;
  stocktake(locationId: string): StocktakeSource;
  foodcost(locationId: string): FoodcostSource;
  calculator(locationId: string): CalculatorSource;
  // The clients' own orders, the deadline, the menus and the ordering links (hosted by the Calculator).
  clientOrders(locationId: string): ClientOrdersSource;
  // The Recipe catalogue («Ricettario»).
  recipes(locationId: string): RecipesSource;
  // Reading a recipe from photographs and the venue's switch for it (step 3d-9): Cloud Functions, no Firestore.
  photo(locationId: string): PhotoSource;
  // «Ingredients & suppliers» (step 3e): the suppliers, the ingredients with their prices, config/orders, and the venue's
  // allergen and nutrition switches (a Cloud Function).
  suppliers(locationId: string): SuppliersSource;
  // «Import from invoices» (step 3e-6): network-only reads and writes (parity I8), made when the import screen opens.
  invoiceImport(locationId: string): InvoiceImportSource;
}

// What the data layers need from the backend besides Firestore: the account behind a client's ordering link is
// created on a second Firebase app (session/firebaseBackend.ts `createLinkAccount`), and the Cloud Functions are called
// through `callFunction` (the emulator's on a local address, never the real, paid ones).
export interface AuthServices {
  createLinkAccount(email: string, password: string): Promise<string>;
  callFunction(name: string, data: unknown, timeoutMs: number): Promise<unknown>;
}

export function createDataServices(firestore: () => Promise<FirestoreKit>, auth: AuthServices): DataServices {
  return {
    pastries: locationId => createFirestorePastriesSource(firestore, locationId),
    stocktake: locationId => createFirestoreStocktakeSource(firestore, locationId),
    foodcost: locationId => createFirestoreFoodcostSource(firestore, locationId),
    calculator: locationId => createFirestoreCalculatorSource(firestore, locationId),
    clientOrders: locationId => createFirestoreClientOrdersSource(firestore, locationId, {
      createLinkAccount: (email, password) => auth.createLinkAccount(email, password),
      nowIso: () => new Date().toISOString(),
      randomBytes: browserRandomBytes,
    }),
    recipes: locationId => createFirestoreRecipesSource(firestore, locationId),
    photo: locationId => createPhotoSource((name, data, timeoutMs) => auth.callFunction(name, data, timeoutMs), locationId),
    suppliers: locationId => createFirestoreSuppliersSource(firestore,
      (name, data, timeoutMs) => auth.callFunction(name, data, timeoutMs), locationId),
    invoiceImport: locationId => createLazyImportSource(firestore, locationId),
  };
}

// ⚠️ THE DEFAULT IS null, NOT AN EMPTY SOURCE: a screen drawn outside the provider would
// otherwise show an empty venue and look fine; the error names the missing provider instead.
const DataContext = createContext<DataServices | null>(null);

export function DataProvider({ services, children }: { services: DataServices; children: ReactNode }) {
  return <DataContext.Provider value={services}>{children}</DataContext.Provider>;
}

export function useDataServices(): DataServices {
  const services = useContext(DataContext);
  if (!services) throw new Error('useDataServices must be used inside a <DataProvider>.');
  return services;
}
