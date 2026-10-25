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
// means «the device thinks it has a network». That is why this is a hint in the top bar and
// nothing is ever blocked by it: saves are local-first (P20).
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
