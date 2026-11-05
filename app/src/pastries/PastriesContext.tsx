import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { browserPastriesDeps, createPastriesStore } from './pastriesStore';
import type { PastriesDeps, PastriesSnapshot, PastriesStore } from './pastriesStore';

// One Pastries store for as long as the section is on screen: created from the open venue's
// source, started on mount and stopped on unmount — so the seven-day listener, tonight's
// confirmations and the 4am timer exist only while somebody is in Pastries (P14).
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const PastriesContext = createContext<PastriesStore | null>(null);

export function PastriesProvider({ children, deps }: { children: ReactNode; deps?: PastriesDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // Pastries is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Pastries needs an open venue.');
  const [store] = useState(() => createPastriesStore(services.pastries(locationId), deps ?? browserPastriesDeps()));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <PastriesContext.Provider value={store}>{children}</PastriesContext.Provider>;
}

export function usePastriesStore(): PastriesStore {
  const store = useContext(PastriesContext);
  if (!store) throw new Error('usePastriesStore must be used inside a <PastriesProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function usePastries(): PastriesSnapshot {
  const store = usePastriesStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
