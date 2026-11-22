import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { browserCakesDeps, createCakesStore } from './cakesStore';
import type { CakesDeps, CakesSnapshot, CakesStore } from './cakesStore';

// One Cakes store for as long as the section is on screen: created from the open venue's source, started on mount and stopped on
// unmount — so the listeners exist only while somebody is in Cakes (P14). The venue cannot change under it: a venue switch reloads
// the whole app (session.ts).
//
// It sits INSIDE Food cost's provider (cakes/ imports foodcost/, never the other way round): the cakes are read here, and saved
// through Food cost's store.
const CakesContext = createContext<CakesStore | null>(null);

export function CakesProvider({ children, deps }: { children: ReactNode; deps?: CakesDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // Cakes are drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Cakes need an open venue.');
  const [store] = useState(() => createCakesStore(services.cakes(locationId), deps ?? browserCakesDeps(), locationId));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return (
    <CakesContext.Provider value={store}>
      <BusyWhileUnsent />
      {children}
    </CakesContext.Provider>
  );
}

// ⚠️ A SAVE NOT YET ANSWERED IS AN UNSAVED EDIT (architecture rule 2), as in Food cost: no self-started reload while the reference
// grams are still on their way to the server.
function BusyWhileUnsent() {
  const { unsent } = useCakes();
  useEffect(() => (unsent ? markBusy() : undefined), [unsent]);
  return null;
}

export function useCakesStore(): CakesStore {
  const store = useContext(CakesContext);
  if (!store) throw new Error('useCakesStore must be used inside a <CakesProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useCakes(): CakesSnapshot {
  const store = useCakesStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
