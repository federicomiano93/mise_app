// serviceWorker.ts — registers Mise 2's service worker and lets a new release in when nobody is editing.
//
// The worker (app/sw/worker.js, built into `sw.js` by app/sw-plugin.ts) installs a new release in the
// background and WAITS. This page lets it take over — and reloads once — as soon as isBusy() is false:
// every screen holding typed, unsaved work holds markBusy() (session/busy.ts lists them), so a release
// never lands under somebody's fingers. Nobody is asked: Mise 2 updates by itself, like its session reload.
//
// ⚠️ IT APPLIES ANY WAITING WORKER, NOT ONLY A MISE 2 ONE, AND THAT IS THE ROLLBACK. If the switch is
// reverted, the current app's sw.js comes back at the same address with a higher CACHE_NAME; this code is
// what lets it in on every phone running Mise 2 (app/sw/rollback.spec.ts runs both workers).
//
// ⚠️ A RELOAD ONLY AFTER THE NEW WORKER HAS TAKEN CONTROL, and only when this page asked for it: the very
// first install also changes the controller (clients.claim), and reloading then would yank the first
// screen away for nothing. At most one such reload a minute (sessionStorage): a worker that never manages
// to take over cannot reload the app in a loop.

import { isBusy } from '../session/busy';

export interface ServiceWorkerEnv {
  readonly container: ServiceWorkerContainer | undefined;
  readonly scriptUrl: string;
  readonly scope: string;
  isBusy(): boolean;
  reload(): void;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  setInterval(callback: () => void, ms: number): unknown;
  onVisible(callback: () => void): void;
  readStamp(): number | null;
  writeStamp(value: number): void;
}

export const CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const BUSY_RETRY_MS = 2000;
// Long enough for a write handed to Firestore as the page is left to be queued; the queue itself survives
// the reload (IndexedDB).
export const RELOAD_GRACE_MS = 300;
// The waiting worker was already gone (another tab let it in): reload anyway.
export const TAKEOVER_TIMEOUT_MS = 4000;
export const MIN_RELOAD_GAP_MS = 60 * 1000;
export const STAMP_KEY = 'mise2-sw-reload-at';

export function watchServiceWorker(env: ServiceWorkerEnv): Promise<void> {
  const container = env.container;
  if (!container) return Promise.resolve();
  let applying = false;

  const apply = (reg: ServiceWorkerRegistration) => {
    if (applying) return;
    if (env.isBusy()) { env.setTimeout(() => apply(reg), BUSY_RETRY_MS); return; }
    const waiting = reg.waiting;
    if (!waiting) return;
    const last = env.readStamp();
    // Reloaded for an update less than a minute ago and the worker is still waiting: it will take over
    // when every Mise tab is closed, as a browser does on its own. No loop.
    if (last !== null && env.now() - last >= 0 && env.now() - last < MIN_RELOAD_GAP_MS) return;
    applying = true;
    const reload = () => { env.writeStamp(env.now()); env.reload(); };
    container.addEventListener('controllerchange', () => { env.setTimeout(reload, RELOAD_GRACE_MS); }, { once: true });
    waiting.postMessage({ action: 'skipWaiting' });
    env.setTimeout(reload, TAKEOVER_TIMEOUT_MS);
  };

  const watch = (reg: ServiceWorkerRegistration) => {
    // An update only when this page is already served by an older worker; on a first visit the new worker
    // is the only one and takes over by itself.
    const isUpdate = () => !!container.controller;
    if (reg.waiting && isUpdate()) apply(reg);
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && isUpdate()) apply(reg);
      });
    });
    const check = () => { reg.update().catch(() => { /* offline: the next check */ }); };
    env.onVisible(check);
    env.setInterval(check, CHECK_INTERVAL_MS);
  };

  return container.register(env.scriptUrl, { scope: env.scope })
    .then(watch)
    .catch(err => { console.warn('Mise 2: the service worker could not be registered', err); });
}

export function browserServiceWorkerEnv(base: string): ServiceWorkerEnv {
  const session = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };
  return {
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    scriptUrl: `${base}sw.js`,
    scope: base,
    isBusy,
    reload: () => { window.location.reload(); },
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    onVisible: callback => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') callback(); });
    },
    readStamp: () => {
      const raw = session()?.getItem(STAMP_KEY);
      const n = raw === null || raw === undefined ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    },
    writeStamp: value => { try { session()?.setItem(STAMP_KEY, String(value)); } catch { /* storage refused */ } },
  };
}
