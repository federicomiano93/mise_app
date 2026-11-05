import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { browserCalculatorDeps, createCalculatorStore } from './calculatorStore';
import type { CalculatorDeps, CalculatorSnapshot, CalculatorStore } from './calculatorStore';

// One Calculator store for as long as the section is on screen: created from the open venue's source, started
// on mount and stopped on unmount — so the listeners exist only while somebody is in the Calculator (P14).
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const CalculatorContext = createContext<CalculatorStore | null>(null);

export function CalculatorProvider({ children, deps }: { children: ReactNode; deps?: CalculatorDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  const { t } = useT();
  // The Calculator is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('The Calculator needs an open venue.');
  const [store] = useState(() => createCalculatorStore(
    services.calculator(locationId),
    { marketOrderTitle: t('calc.marketOrderTitle') },
    deps ?? browserCalculatorDeps(),
  ));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return (
    <CalculatorContext.Provider value={store}>
      <BusyWhileUnsent />
      {children}
    </CalculatorContext.Provider>
  );
}

// ⚠️ A CONFIRMED DOUGH NOT YET ANSWERED IS AN UNSAVED EDIT (architecture rule 2): Firestore is loaded lazily,
// and a self-started reload in that moment would lose the log before it reached the browser's own database.
function BusyWhileUnsent() {
  const { unsent } = useCalculator();
  useEffect(() => (unsent ? markBusy() : undefined), [unsent]);
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
