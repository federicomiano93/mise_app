import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreFoodcostSource } from '../foodcost/foodcostSource';
import type { FoodcostSource } from '../foodcost/foodcostSource';
import { createFirestorePastriesSource } from '../pastries/pastriesSource';
import type { PastriesSource } from '../pastries/pastriesSource';
import { createFirestoreStocktakeSource } from '../stocktake/stocktakeSource';
import type { StocktakeSource } from '../stocktake/stocktakeSource';

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
}

export function createDataServices(firestore: () => Promise<FirestoreKit>): DataServices {
  return {
    pastries: locationId => createFirestorePastriesSource(firestore, locationId),
    stocktake: locationId => createFirestoreStocktakeSource(firestore, locationId),
    foodcost: locationId => createFirestoreFoodcostSource(firestore, locationId),
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
