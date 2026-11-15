// serviceWorker.ts — registers Mise 2's service worker and lets a new release in when nobody is editing.
//
// The worker (app/sw/worker.js, built into `sw.js` by app/sw-plugin.ts) installs a new release in the
// background and WAITS. This page lets it take over — and reloads once — as soon as isBusy() is false:
// every screen holding typed, unsaved work holds markBusy() (session/busy.ts lists them), so a release
// never lands under somebody's fingers. Nobody is asked: Mise 2 updates by itself, like its session reload.
//
// ⚠️ IT APPLIES ANY WAITING WORKER, NOT ONLY A MISE 2 ONE, AND THAT IS THE ROLLBACK. If the switch is
// reverted, the current app's sw.js comes back at the same address with a higher CACHE_NAME; this code is
// what lets it in on every phone running Mise 2 (shell/rollback.spec.ts runs both workers).
//
// ⚠️ A RELOAD ONLY AFTER A NEW WORKER HAS TAKEN CONTROL, in every open Mise 2 window, and never for the very
// first install (it changes the controller too, through clients.claim, and reloading then would yank the
// first screen away for nothing). At most one update reload a minute, and after three in a row a ten-minute
// pause (sessionStorage): a worker that never manages to take over cannot reload the app in a tight loop.

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
  // The update reloads of this tab so far (sessionStorage): when the last one was, and how many in a row.
  readStamp(): ReloadStamp | null;
  writeStamp(value: ReloadStamp): void;
}
export interface ReloadStamp { at: number; count: number }

export const CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const BUSY_RETRY_MS = 2000;
// Long enough for a write handed to Firestore as the page is left to be queued; the queue itself survives
// the reload (IndexedDB).
export const RELOAD_GRACE_MS = 300;
// The waiting worker was already gone (another tab let it in): reload anyway.
export const TAKEOVER_TIMEOUT_MS = 4000;
// At most one update reload a minute, and at most MAX_RELOADS in a row (each within RELOADS_WINDOW_MS of the one
// before): a worker that never manages to take over must not reload the app over and over. After that it waits
// until RELOADS_WINDOW_MS has passed since the last one, then tries again.
export const MIN_RELOAD_GAP_MS = 60 * 1000;
export const MAX_RELOADS = 3;
export const RELOADS_WINDOW_MS = 10 * 60 * 1000;
export const STAMP_KEY = 'mise2-sw-reload-at';

export function watchServiceWorker(env: ServiceWorkerEnv): Promise<void> {
  const container = env.container;
  if (!container) return Promise.resolve();

  // ⚠️ EVERY MISE 2 WINDOW RELOADS WHEN A NEW WORKER TAKES CONTROL OF IT, not only the one that asked: its code
  // is the previous release's, and the sections it has not opened yet are chunks that are neither on the server
  // nor in the new cache any more. The very first install (no worker before) is not a new release: no reload.
  let controlled = !!container.controller;
  let reloading = false;
  const reloadWhenIdle = () => {
    if (reloading) return;
    // Asked again here, not only before the worker was let in: typing can start in the moment between.
    if (env.isBusy()) { env.setTimeout(reloadWhenIdle, BUSY_RETRY_MS); return; }
    reloading = true;
    const last = env.readStamp();
    const inARow = last && env.now() - last.at >= 0 && env.now() - last.at < RELOADS_WINDOW_MS ? last.count + 1 : 1;
    env.writeStamp({ at: env.now(), count: inARow });
    env.reload();
  };
  container.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    env.setTimeout(reloadWhenIdle, RELOAD_GRACE_MS);
  });

  let asked = false;
  const apply = (reg: ServiceWorkerRegistration) => {
    if (asked) return;
    if (env.isBusy()) { env.setTimeout(() => apply(reg), BUSY_RETRY_MS); return; }
    if (!reg.waiting) return;
    const last = env.readStamp();
    const since = last ? env.now() - last.at : Infinity;
    // Three in a row already: wait until the window has passed, then ask again — never give up for good inside a page
    // that stays open (the lab tablet can stay open for days, and a revert must still reach it).
    if (last && since >= 0 && since < RELOADS_WINDOW_MS && last.count >= MAX_RELOADS) {
      env.setTimeout(() => apply(reg), RELOADS_WINDOW_MS - since);
      return;
    }
    if (since >= 0 && since < MIN_RELOAD_GAP_MS) { env.setTimeout(() => apply(reg), MIN_RELOAD_GAP_MS - since); return; }
    asked = true;
    reg.waiting.postMessage({ action: 'skipWaiting' });
    env.setTimeout(reloadWhenIdle, TAKEOVER_TIMEOUT_MS);
  };

  const watch = (reg: ServiceWorkerRegistration) => {
    // An update only when this page is already served by an older worker; on a first visit the new worker
    // is the only one and takes over by itself.
    const isUpdate = () => !!container.controller;
    const follow = (incoming: ServiceWorker) => {
      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && isUpdate()) apply(reg);
      });
    };
    if (reg.waiting && isUpdate()) apply(reg);
    // ⚠️ ONE MAY ALREADY BE INSTALLING: the browser checks sw.js on every opening, and registration runs after the
    // page's load, when that check's `updatefound` has already fired.
    if (reg.installing) follow(reg.installing);
    reg.addEventListener('updatefound', () => { if (reg.installing) follow(reg.installing); });
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
      try {
        const raw = JSON.parse(session()?.getItem(STAMP_KEY) ?? 'null') as Partial<ReloadStamp> | null;
        return raw && Number.isFinite(raw.at) && Number.isFinite(raw.count) ? { at: raw.at!, count: raw.count! } : null;
      } catch { return null; }
    },
    writeStamp: value => { try { session()?.setItem(STAMP_KEY, JSON.stringify(value)); } catch { /* storage refused */ } },
  };
}
