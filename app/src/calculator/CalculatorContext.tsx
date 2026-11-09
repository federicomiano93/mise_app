import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { getClients } from '@mise/shared/calculator-config';
import { countryOf } from '@mise/shared/market';
import { browserCalculatorDeps, createCalculatorStore } from './calculatorStore';
import type { CalculatorDeps, CalculatorSnapshot, CalculatorStore } from './calculatorStore';
import { menusWouldChange } from './clientOrdersModel';
import { createClientOrdersStore } from './clientOrdersStore';
import type { ClientOrdersDepsLite, ClientOrdersSnapshot, ClientOrdersStore } from './clientOrdersStore';
import type { MenuVenue } from './clientOrdersSource';

// One Calculator store for as long as the section is on screen: created from the open venue's source, started
// on mount and stopped on unmount — so the listeners exist only while somebody is in the Calculator (P14).
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const CalculatorContext = createContext<CalculatorStore | null>(null);
// The clients' own orders (banner, Orders received, the deadline, the ordering links), with the same lifetime.
const ClientOrdersContext = createContext<ClientOrdersStore | null>(null);

const browserClientOrdersDeps = (): ClientOrdersDepsLite => ({
  now: () => Date.now(),
  warn: (message, detail) => console.warn(message, detail),
});

export function CalculatorProvider({ children, deps, clientOrdersDeps }: {
  children: ReactNode;
  deps?: CalculatorDeps;
  clientOrdersDeps?: ClientOrdersDepsLite;
}) {
  const services = useDataServices();
  const session = useSession();
  const { locationId } = session;
  const { t } = useT();
  // The Calculator is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('The Calculator needs an open venue.');
  // Who the clients' menus say they come from: the venue's name and country are read at the save. A rename alone
  // republishes nothing (as the current app: menusWouldChange ignores the venue) and reaches the clients with the next
  // save that changes some menu.
  const venueRef = useRef<MenuVenue>({ name: '', country: null });
  venueRef.current = { name: session.name, country: countryOf(session.location) };
  const [clientOrders] = useState(() => createClientOrdersStore(
    services.clientOrders(locationId),
    clientOrdersDeps ?? browserClientOrdersDeps(),
  ));
  const [store] = useState(() => createCalculatorStore(
    services.calculator(locationId),
    {
      marketOrderTitle: t('calc.marketOrderTitle'),
      // ⚠️ THE CLIENTS' MENUS FOLLOW THE ADDRESS BOOK (item 69): a client cannot order a product whose menu was
      // never published, and nothing on the bakery's side would show it. Only when some client's published list
      // would read differently: a save of recipes, WhatsApp lists or log settings costs no menu read.
      onConfigSaved: (previous, saved) => {
        if (!menusWouldChange(previous, saved)) return;
        void clientOrders.publishMenus(getClients(saved), venueRef.current);
      },
    },
    deps ?? browserCalculatorDeps(),
  ));

  useEffect(() => {
    store.start();
    clientOrders.start();
    return () => {
      store.stop();
      clientOrders.stop();
    };
  }, [store, clientOrders]);

  return (
    <CalculatorContext.Provider value={store}>
      <ClientOrdersContext.Provider value={clientOrders}>
        <BusyWhileUnsent />
        {children}
      </ClientOrdersContext.Provider>
    </CalculatorContext.Provider>
  );
}

// ⚠️ A CONFIRMED DOUGH NOT YET ANSWERED IS AN UNSAVED EDIT (architecture rule 2): Firestore is loaded lazily,
// and a self-started reload in that moment would lose the log before it reached the browser's own database.
function BusyWhileUnsent() {
  const { unsent } = useCalculator();
  const { unsent: ordersUnsent } = useClientOrders();
  const busy = unsent || ordersUnsent;
  useEffect(() => (busy ? markBusy() : undefined), [busy]);
  return null;
}

export function useCalculatorStore(): CalculatorStore {
  const store = useContext(CalculatorContext);
  if (!store) throw new Error('useCalculatorStore must be used inside a <CalculatorProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useCalculator(): CalculatorSnapshot {
  const store = useCalculatorStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useClientOrdersStore(): ClientOrdersStore {
  const store = useContext(ClientOrdersContext);
  if (!store) throw new Error('useClientOrdersStore must be used inside a <CalculatorProvider>.');
  return store;
}

// The clients' orders, the deadline and the links as last known. The SAME object until something changes.
export function useClientOrders(): ClientOrdersSnapshot {
  const store = useClientOrdersStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
