import { useCallback, useEffect, useState } from 'react';

// ⚠️ HOW OFTEN THE LABEL SCREEN ASKS AGAIN WHETHER THE SHOP COMPUTER IS STILL ANSWERING. A heartbeat is only ever
// «fresh» against a clock, and the answer changes when the clock moves, not when a document does: a shop computer
// that goes silent writes nothing, so no watch would ever fire. Without this tick a screen left open since a fresh
// beat would keep offering «Print» to a computer that was switched off ten minutes ago — a tap that looks like it
// worked and prints nothing, which is exactly what the heartbeat exists to prevent. 30 s is a fraction of the
// 12 minutes a beat stays fresh (STALE_AFTER_MS), so the screen is never more than half a minute behind the
// truth, and it costs one re-render of one screen twice a minute (no read, no write). DELIBERATELY NOT in the
// current app, which asks only when it is redrawn (docs/parity/catalogue.md, 3d-4).
export const PRESENCE_RECHECK_MS = 30_000;

// The time to judge a heartbeat against: now, and again every PRESENCE_RECHECK_MS while `active`. Only a Zebra
// venue needs it (any other printer has no shop computer to judge), so an os venue sets no timer at all. The timer
// is cleared when the screen is left or the printer stops being a Zebra.
//
// It also returns `refresh`, which reads the clock at once. Two things need it: a phone woken from sleep has an
// interval that has not fired yet (so the screen is also refreshed when the page becomes visible again), and a tap
// that finds the beat gone stale must make the screen show the truth now, not at the next tick.
export function usePresenceClock(active: boolean): { now: number; refresh: () => void } {
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(() => { setNow(Date.now()); }, []);
  useEffect(() => {
    if (!active) return undefined;
    // The clock may be old by the time the printer turns out to be a Zebra (the paper arrives late).
    setNow(Date.now());
    const timer = setInterval(() => { setNow(Date.now()); }, PRESENCE_RECHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
  return { now, refresh };
}
