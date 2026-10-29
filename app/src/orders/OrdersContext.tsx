import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersSnapshot, OrdersStore } from './ordersStore';

// One Orders store for as long as the section is on screen: created from the open venue's source, started on mount and
// stopped on unmount — so the five listeners exist only while somebody is on the page (P14), and a change still waiting
// for the autosave is sent the moment the section closes.
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const OrdersContext = createContext<OrdersStore | null>(null);

export function OrdersProvider({ children, deps }: { children: ReactNode; deps?: OrdersDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // The section is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Orders needs an open venue.');
  const [store] = useState(() => createOrdersStore(services.orders(locationId), deps));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <OrdersContext.Provider value={store}>{children}</OrdersContext.Provider>;
}

export function useOrdersStore(): OrdersStore {
  const store = useContext(OrdersContext);
  if (!store) throw new Error('useOrdersStore must be used inside an <OrdersProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useOrders(): OrdersSnapshot {
  const store = useOrdersStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
