import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { createSuppliersStore } from './suppliersStore';
import type { SuppliersDeps, SuppliersSnapshot, SuppliersStore } from './suppliersStore';

// One «Ingredients & suppliers» store for as long as the section is on screen: created from the open venue's source,
// started on mount and stopped on unmount — so the four listeners exist only while somebody is on the page (P14).
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const SuppliersContext = createContext<SuppliersStore | null>(null);

export function SuppliersProvider({ children, deps }: { children: ReactNode; deps?: SuppliersDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // The section is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Ingredients & suppliers needs an open venue.');
  const [store] = useState(() => createSuppliersStore(services.suppliers(locationId), deps));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <SuppliersContext.Provider value={store}>{children}</SuppliersContext.Provider>;
}

// The same store for ANOTHER section that only WRITES records (T15: the Recipe catalogue's «+ Add "…" as an ingredient»):
// created, NEVER STARTED. Its writes (saveIngredient, saveSupplier) only call the source, so it opens no listener and reads
// nothing — above all not ingredient-prices, the money the Recipe catalogue must never load (recipesSource.spec.ts). Its
// snapshot stays empty: whoever draws a card here hands it the suppliers and ingredients that section already watches.
export function SuppliersWritesProvider({ children, deps }: { children: ReactNode; deps?: SuppliersDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  if (!locationId) throw new Error('Writing records needs an open venue.');
  const [store] = useState(() => createSuppliersStore(services.suppliers(locationId), deps));
  return <SuppliersContext.Provider value={store}>{children}</SuppliersContext.Provider>;
}

export function useSuppliersStore(): SuppliersStore {
  const store = useContext(SuppliersContext);
  if (!store) throw new Error('useSuppliersStore must be used inside a <SuppliersProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useSuppliers(): SuppliersSnapshot {
  const store = useSuppliersStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
