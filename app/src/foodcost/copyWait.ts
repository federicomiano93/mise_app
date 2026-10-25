import { useEffect, useState } from 'react';

// How long a thing found only in this phone's local copy waits for the server before its screen opens
// anyway (the current app's RECIPE_LINK_WAIT_MS). Offline the server never answers, and the copy — by
// then usually replaced by the browser's own database — is all there will be.
export const COPY_WAIT_MS = 1200;

// True once the wait is over: the server has `answered`, or there is no signal, or COPY_WAIT_MS have
// passed since this component mounted. Once true it stays true.
export function useCopyWait(answered: boolean): boolean {
  const [patienceOver, setPatienceOver] = useState(false);
  useEffect(() => {
    if (answered || patienceOver) return undefined;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPatienceOver(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setPatienceOver(true), COPY_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [answered, patienceOver]);
  return answered || patienceOver;
}
