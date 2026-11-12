import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { readsPurchasePrices } from '../session/visibility';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersSnapshot, OrdersStore } from './ordersStore';

// One Orders store for as long as the section is on screen: created from the open venue's source, started on mount and
// stopped on unmount — so the listeners (six, seven for a price reader) exist only while somebody is on the page (P14), and a change still waiting
// for the autosave is sent the moment the section closes.
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const OrdersContext = createContext<OrdersStore | null>(null);

export function OrdersProvider({ children, deps }: { children: ReactNode; deps?: OrdersDeps }) {
  const services = useDataServices();
  const { locationId, location, canManage, user } = useSession();
  // The section is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Orders needs an open venue.');
  // The venue goes in too: the note of typed quantities that outlives the page is one venue's (F-15). And the person: a quantity
  // the server refused after Orders closed is said at the next opening of THIS person in THIS venue only (refusedNote.ts).
  const [store] = useState(() => createOrdersStore(services.orders(locationId), deps, locationId, user?.uid ?? ''));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  // ⚠️ WHO MAY READ PRICES, asked as firestore.rules ask it (ingredient-prices: cardAccess(lid, 'foodcost', 'prices') != 'none'):
  // the venue has Food cost, and the person runs a side (an owner, a manager, the kitchen owner who orders the goods and has no
  // Food cost screen) or the venue showed their employees the card (session/visibility.ts readsPurchasePrices). UX only (P2): the
  // rules decide, and a refused read draws no money. Anybody else never opens the listener (step 3f-8c, parity L20). Declared
  // after the start, so React runs it after the start too.
  const readsPrices = readsPurchasePrices(location, canManage);
  useEffect(() => {
    store.setPriceReader(readsPrices);
  }, [store, readsPrices]);

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
