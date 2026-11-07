import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { useTodayKey } from '../home/useTodayKey';
import { INERT_AWAY_STORE, createAwayStore } from './awayStore';
import type { AwaySnapshot, AwayStore } from './awayStore';

// One holiday store for as long as the venue is open: made from the open venue's source, started on mount (one read, no listener —
// P14) and held by the SHELL, so the Home's band, Settings' row and the reminder always agree after a write.
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const AwayContext = createContext<AwayStore | null>(null);

export function AwayProvider({ children }: { children: ReactNode }) {
  const services = useDataServices();
  const { locationId, user } = useSession();
  const uid = user?.uid ?? null;
  const [store] = useState<AwayStore>(() => (locationId && uid
    ? createAwayStore(services.settings(locationId), uid)
    : INERT_AWAY_STORE));
  const today = useTodayKey();

  useEffect(() => { store.start(); }, [store]);
  // A tablet left open past midnight: the holiday may have ended on its own.
  useEffect(() => { store.recheck(); }, [store, today]);

  return <AwayContext.Provider value={store}>{children}</AwayContext.Provider>;
}

export function useAwayStore(): AwayStore {
  const store = useContext(AwayContext);
  if (!store) throw new Error('useAwayStore must be used inside an <AwayProvider>.');
  return store;
}

// The current holiday. The store hands back the SAME object until something changes.
export function useAway(): AwaySnapshot {
  const store = useAwayStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
