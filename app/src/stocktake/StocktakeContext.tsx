import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { browserStocktakeDeps, createStocktakeStore } from './stocktakeStore';
import type { StocktakeDeps, StocktakeSnapshot, StocktakeStore } from './stocktakeStore';

// One Stocktake store for as long as the section is on screen: created from the open venue's
// source, started on mount and stopped on unmount — so the month and ingredient listeners exist
// only while somebody is in the Stocktake (P14), and what is unsent is handed to Firestore on the
// way out.
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const StocktakeContext = createContext<StocktakeStore | null>(null);

export function StocktakeProvider({ children, deps }: { children: ReactNode; deps?: StocktakeDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // The Stocktake is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('The Stocktake needs an open venue.');
  const [store] = useState(() => createStocktakeStore(
    services.stocktake(locationId), locationId, deps ?? browserStocktakeDeps(),
  ));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return (
    <StocktakeContext.Provider value={store}>
      <BusyWhileUnsent />
      {children}
    </StocktakeContext.Provider>
  );
}

// ⚠️ A COUNT NOT YET CONFIRMED IS AN UNSAVED EDIT (architecture rule 2): the session's self-started
// reload waits while one is waiting or in the air, so it never cuts a write short. Offline that can
// be a long while — and offline there is no server copy to reload for either.
function BusyWhileUnsent() {
  const { unsent } = useStocktake();
  useEffect(() => (unsent ? markBusy() : undefined), [unsent]);
  return null;
}

export function useStocktakeStore(): StocktakeStore {
  const store = useContext(StocktakeContext);
  if (!store) throw new Error('useStocktakeStore must be used inside a <StocktakeProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useStocktake(): StocktakeSnapshot {
  const store = useStocktakeStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
