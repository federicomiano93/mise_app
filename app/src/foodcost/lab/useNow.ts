import { useEffect, useState } from 'react';

// The current time, repainted every second while `active` — and the moment the page wakes up. ⚠️ ONLY A REPAINT TRIGGER: the clock's
// figures are always `now - startedAt` (labClock), never a count of ticks, so a screen that slept for an hour is right on waking.
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => { setNow(Date.now()); };
    tick();
    const id = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [active]);
  return now;
}
