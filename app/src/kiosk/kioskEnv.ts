// The kiosk's environment in a browser: the page's clock, timers, storage, wake lock and busy marker (kioskController.ts).
import { isBusyApartFrom, markBusy } from '../session/busy';
import { acquireWakeLock, refreshWakeLock, releaseWakeLock } from '../ui/wakeLock';
import type { KioskEnv } from './kioskController';

export function browserKioskEnv(): KioskEnv {
  return {
    now: () => Date.now(),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: id => { window.clearInterval(id as number); },
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: id => { window.clearTimeout(id as number); },
    local: () => { try { return window.localStorage; } catch { return null; } },
    session: () => { try { return window.sessionStorage; } catch { return null; } },
    document,
    reload: () => { window.location.reload(); },
    // The same question the current app's kiosk asked: a worker waiting, and this page already served by one (on a first visit
    // the new worker is the only one and nothing waits). In `npm run dev` and the specs no worker is registered: never.
    updateWaiting: async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration();
      return !!(registration?.waiting && navigator.serviceWorker.controller);
    },
    acquireWakeLock,
    releaseWakeLock,
    refreshWakeLock,
    // The rest screen's hold means «nobody is looking»: the browser's «leave this page?» question ignores it (session/busy.ts).
    markBusy: () => markBusy({ rest: true }),
    isBusyApartFrom,
  };
}
