import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

// ⚠️ `navigator.onLine` can say «online» on a Wi-Fi with no internet, but it never says
// «offline» while the network works — so «No connection» is always true, and «Online» only
// means «the device thinks it has a network». So it never blocks a save: saves are local-first
// (P20). What «No connection» does open: Food cost's editor lets a product saved before the
// switch be edited on this phone's copy of the recipes, only when it holds every recipe on the
// product's lines (ProductEditor); a false «Online» only keeps that pencil held until the
// server answers.
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
