import { useEffect, useState } from 'react';

// How long the ingredients may take before the screen says what it is still waiting for.
export const STILL_WAITING_MS = 10_000;

// True once `waiting` has been true for STILL_WAITING_MS without a break. On a phone that is offline with
// nothing stored the ingredients never arrive and the «checking» text would stay for ever; this lets the
// screen add a line saying so. It changes NO verdict: while it is true there is still no answer and no button.
// The timer starts when the screen mounts (or when waiting begins) and is cleared on unmount.
export function useStillWaiting(waiting: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setLate(false);
      return undefined;
    }
    const timer = setTimeout(() => { setLate(true); }, STILL_WAITING_MS);
    return () => { clearTimeout(timer); };
  }, [waiting]);
  return waiting && late;
}
