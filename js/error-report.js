// error-report.js — the app tells the owner about its own errors, so they can be fixed before
// anybody notices.
//
// Three things are caught: an uncaught exception (window 'error'), a promise nobody handled
// ('unhandledrejection') and a console.error the app itself logged (a failed save, a listener
// cut off). Each becomes ONE line, locations/{lid}/errors/{autoId}, with the release, the
// screen, the kind of device and the signed-in account's uid (the owner's choice, 9 Oct 2026,
// internal use — never a name or an email). The rules refuse every read; only the owner's
// script (scripts/read-errors.mjs) can see them.
//
// Imported by js/auth-gate.js, which every member page loads and the client ordering page
// (order.html) and the password-reset page do not: a client account is not a member and its
// writes would be refused.
//
// ⚠️ NEVER VISIBLE, NEVER BLOCKING (P17). Nothing is thrown, drawn or awaited by the caller.
// ⚠️ NO LOOPS. console.error is wrapped, so this file may NEVER call console.error itself:
// its own failures are a console.warn with the error code and nothing else. A re-entrancy
// guard covers the synchronous case; the throttle (same error once a day, a daily cap) bounds
// the rest — e.g. the Firestore SDK logging a failed write of ours.
// ⚠️ THE ORIGINAL console.error RUNS FIRST, with the same arguments: what is printed never
// changes.
// ⚠️ ERRORS BEFORE A VENUE IS OPEN are kept in memory (at most BUFFER_MAX) and sent once the
// session is ready; the rules need a venue and a signed-in account.
// ⚠️ THE THROTTLE KEY IS "error-reports": js/local-data.js keeps it through a sign-out, or
// signing out and in again would be a way round the daily cap.

import { askVersionOf, versionNumber } from './app-version.js';
import { deviceKind, isValidDeviceId, localDayKey } from './device-model.js';
import {
  recordFromError, recordFromRejection, recordFromConsole, isNoise, signature, shouldSend,
  screenName, errorPayload,
} from './error-model.js';

export const THROTTLE_KEY = 'error-reports';
export const DEVICE_ID_KEY = 'device-id';
export const BUFFER_MAX = 10;
// With no storage to remember the day, a page may still say this much.
export const NO_STORAGE_PAGE_CAP = 5;

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isReady(session) {
  return !!session && session.status === 'ready' && !!session.locationId && !!(session.user && session.user.uid);
}

// `deps` exists so the flow can be tested without a browser; production passes REAL().
export function createReporter(deps = {}) {
  const d = { ...REAL(), ...deps };
  const buffer = [];
  let session = null;
  let busy = false;
  let versionPromise = null;
  // Used only when storage is unavailable.
  const pageSigs = new Set();

  function warn(err) {
    // Never console.error from here: that is the function being wrapped.
    try { console.warn('Error report not sent:', err && err.code ? err.code : 'unknown'); } catch { /* nothing */ }
  }

  function version() {
    if (!versionPromise) versionPromise = Promise.resolve().then(() => d.version()).catch(() => null);
    return versionPromise;
  }

  // Throttle, then hand the line to the data layer. Never throws.
  function dispatch(record) {
    try {
      const sig = signature(record);
      const today = localDayKey(d.now());
      const storage = d.storage;
      let remembered = false;
      if (storage) {
        const verdict = shouldSend(readJson(storage, THROTTLE_KEY), sig, today);
        if (!verdict.send) return;
        // Written, and did it stick? A storage that throws or silently drops writes cannot
        // keep the daily count, so it gets the per-page cap below instead.
        try {
          const json = JSON.stringify(verdict.state);
          storage.setItem(THROTTLE_KEY, json);
          remembered = storage.getItem(THROTTLE_KEY) === json;
        } catch { /* falls to the per-page cap */ }
      }
      if (!remembered) {
        if (pageSigs.has(sig) || pageSigs.size >= NO_STORAGE_PAGE_CAP) return;
        pageSigs.add(sig);
      }
      const context = {
        screen: d.screen(), deviceId: d.deviceId(), kind: d.kind(), online: d.online(),
      };
      version().then(appVersion => {
        // The session may have changed while the version was asked for.
        if (!isReady(session)) return;
        const payload = errorPayload(record, { ...context, appVersion });
        if (!payload) return;
        return Promise.resolve().then(() => d.send(payload)).catch(warn);
      }).catch(warn);
    } catch (err) {
      warn(err);
    }
  }

  function flush() {
    const waiting = buffer.splice(0, buffer.length);
    for (const record of waiting) dispatch(record);
  }

  // One caught thing → sent, buffered or dropped. Never throws.
  function report(record) {
    if (busy) return;
    busy = true;
    try {
      if (!record || isNoise(record, { origin: d.origin() })) return;
      if (isReady(session)) dispatch(record);
      else if (buffer.length < BUFFER_MAX) buffer.push(record);
    } catch (err) {
      warn(err);
    } finally {
      busy = false;
    }
  }

  function setSession(next) {
    session = next;
    if (isReady(session) && buffer.length > 0) flush();
  }

  return { report, setSession, buffered: () => buffer.length };
}

// Wraps console.error and listens on the window, once. Returns the reporter's `report`.
const wrapped = new WeakSet();
export function install(reporter, target, consoleObj) {
  // Once per console: wrapping twice would report every line twice.
  if (wrapped.has(consoleObj)) return false;
  wrapped.add(consoleObj);

  target.addEventListener('error', event => {
    try {
      reporter.report(recordFromError(event && event.error, {
        filename: event && event.filename, message: event && event.message,
      }));
    } catch { /* never visible */ }
  });
  target.addEventListener('unhandledrejection', event => {
    try { reporter.report(recordFromRejection(event && event.reason)); } catch { /* never visible */ }
  });

  const original = consoleObj.error;
  consoleObj.error = function wrappedConsoleError(...args) {
    // The original first, so what is printed never depends on this file.
    const result = original.apply(this, args);
    try { reporter.report(recordFromConsole(args)); } catch { /* never visible */ }
    return result;
  };
  return true;
}

// The browser's own answers, read when needed (not at import: this file is also loaded by tests).
function REAL() {
  return {
    storage: (() => { try { return window.localStorage; } catch { return null; } })(),
    now: () => new Date(),
    origin: () => (typeof location !== 'undefined' ? location.origin : null),
    screen: () => screenName(location.pathname, location.hash),
    // Read, never made: the device count (js/device-ping.js) owns the id.
    deviceId: () => {
      try {
        const id = window.localStorage.getItem(DEVICE_ID_KEY);
        return isValidDeviceId(id) ? id : null;
      } catch { return null; }
    },
    kind: () => deviceKind({
      width: screen.width,
      height: screen.height,
      coarse: window.matchMedia('(pointer: coarse)').matches,
    }),
    online: () => navigator.onLine === true,
    version: async () => {
      const controller = navigator.serviceWorker ? navigator.serviceWorker.controller : null;
      return versionNumber(await askVersionOf(controller, { timeoutMs: 800, attempts: 1 }));
    },
    send: payload => import('./firebase.js').then(m => m.reportError(payload)),
  };
}

// The listeners go on at once, so an error during boot is caught and buffered; the session
// arrives later. firebase.js is loaded here, not imported at the top, so tests can read this
// file without the Firebase SDK from its CDN. Every page that loads the gate has already
// loaded it.
function start() {
  const reporter = createReporter();
  install(reporter, window, console);
  import('./firebase.js').then(({ onSession }) => {
    onSession(session => reporter.setSession(session));
  }).catch(err => {
    console.warn('Error reports not started:', err && err.code ? err.code : 'unknown');
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') start();
