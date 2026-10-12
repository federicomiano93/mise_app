import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { browserFoodcostDeps, createFoodcostStore } from './foodcostStore';
import type { FoodcostDeps, FoodcostSnapshot, FoodcostStore } from './foodcostStore';

// One Food cost store for as long as the section is on screen: created from the open venue's
// source, started on mount and stopped on unmount — so the listeners exist only while somebody is
// in Food cost (P14).
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts). Nor can the
// role: it is read once, here, and decides only whether the labour rate is asked for.
const FoodcostContext = createContext<FoodcostStore | null>(null);

export function FoodcostProvider({ children, deps }: { children: ReactNode; deps?: FoodcostDeps }) {
  const services = useDataServices();
  const { locationId, canManage } = useSession();
  // Food cost is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Food cost needs an open venue.');
  const [store] = useState(() => createFoodcostStore(
    services.foodcost(locationId), { canManage }, deps ?? browserFoodcostDeps(),
  ));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return (
    <FoodcostContext.Provider value={store}>
      <BusyWhileUnsent />
      {children}
    </FoodcostContext.Provider>
  );
}

// ⚠️ A SAVE NOT YET HANDED OVER IS AN UNSAVED EDIT (architecture rule 2): Firestore is loaded lazily,
// and a self-started reload in that moment would throw the product away before it reached the
// browser's own database.
function BusyWhileUnsent() {
  const { unsent } = useFoodcost();
  useEffect(() => (unsent ? markBusy() : undefined), [unsent]);
  return null;
}

export function useFoodcostStore(): FoodcostStore {
  const store = useContext(FoodcostContext);
  if (!store) throw new Error('useFoodcostStore must be used inside a <FoodcostProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useFoodcost(): FoodcostSnapshot {
  const store = useFoodcostStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
