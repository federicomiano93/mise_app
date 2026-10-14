import { useEffect, useState } from 'react';

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
export function usePresenceClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    // The clock may be old by the time the printer turns out to be a Zebra (the paper arrives late).
    setNow(Date.now());
    const timer = setInterval(() => { setNow(Date.now()); }, PRESENCE_RECHECK_MS);
    return () => { clearInterval(timer); };
  }, [active]);
  return now;
}
