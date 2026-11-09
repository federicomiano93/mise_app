// errorReport.ts — the app tells the owner about its own errors, so they can be fixed before
// anybody notices.
//
// Port of js/error-report.js (the current app) for Mise 2, flow for flow; errorReport.spec.ts
// carries every test of the original. The comments below are the ones it paid for in bugs.
//
// Three things are caught: an uncaught exception (window 'error'), a promise nobody handled
// ('unhandledrejection') and a console.error the app itself logged (a failed save, a listener
// cut off). Each becomes ONE line, locations/{lid}/errors/{autoId} (written by sinks.ts), with
// the release, the screen, the kind of device and the signed-in account's uid (the owner's
// choice, 9 Oct 2026, internal use — never a name or an email). The rules refuse every read;
// only the owner's script (scripts/read-errors.mjs) can see them.
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
// ⚠️ THE THROTTLE KEY IS "error-reports": the current app's local-data keeps it through a
// sign-out (and so does @mise/shared/local-data), or signing out and in again would be a way
// round the daily cap. Mise 2 shares that storage with the current app.
// ⚠️ NO UID, NAME OR EMAIL IS BUILT HERE: the uid is added by the data layer (sinks.ts), from the
// signed-in account, so a record can never claim to be somebody else's.

import { isValidDeviceId, localDayKey, type DeviceKind } from '@mise/shared/device-model';
import {
  recordFromError, recordFromRejection, recordFromConsole, isNoise, signature, shouldSend,
  errorPayload, type ErrorPayload, type ErrorRecord,
} from '@mise/shared/error-model';
import type { KeyValueStorage } from '../session/backend';
import {
  browserDeviceKind, browserStorage, errorCode, isReadySession, readJson,
  type SessionSource, type TelemetrySession,
} from './common';
import { MISE2_VERSION } from './version';

export const THROTTLE_KEY = 'error-reports';
export const DEVICE_ID_KEY = 'device-id';
export const BUFFER_MAX = 10;
// With no storage to remember the day, a page may still say this much.
export const NO_STORAGE_PAGE_CAP = 5;

// The browser's own answers, and the data layer, as the reporter asks for them. Replaced one by
// one in the specs; `browserErrorDeps` is the real set.
export interface ReporterDeps {
  // Only these two are used: the throttle is read and written, never deleted.
  storage: Pick<KeyValueStorage, 'getItem' | 'setItem'> | null;
  now(): Date;
  origin(): string | null;
  // The name of the screen the person is on, as the line should say it.
  screen(): string | null;
  deviceId(): string | null;
  kind(): DeviceKind;
  online(): boolean;
  version(): Promise<string | null> | string | null;
  send(payload: ErrorPayload): Promise<unknown>;
}

export interface Reporter {
  // One caught thing → sent, buffered or dropped. Never throws.
  report(record: ErrorRecord | null | undefined): void;
  setSession(session: TelemetrySession | null | undefined): void;
  // How many are waiting for a venue to open.
  buffered(): number;
}

export function createReporter(d: ReporterDeps): Reporter {
  const buffer: ErrorRecord[] = [];
  let session: TelemetrySession | null | undefined = null;
  let busy = false;
  let versionPromise: Promise<string | null> | null = null;
  // Used only when storage is unavailable.
  const pageSigs = new Set<string>();

  function warn(err: unknown): void {
    // Never console.error from here: that is the function being wrapped.
    try { console.warn('Error report not sent:', errorCode(err)); } catch { /* nothing */ }
  }

  function version(): Promise<string | null> {
    if (!versionPromise) versionPromise = Promise.resolve().then(() => d.version()).catch(() => null);
    return versionPromise;
  }

  // Throttle, then hand the line to the data layer. Never throws.
  function dispatch(record: ErrorRecord): void {
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
        if (!isReadySession(session)) return;
        const payload = errorPayload(record, { ...context, appVersion });
        if (!payload) return;
        return Promise.resolve().then(() => d.send(payload)).catch(warn);
      }).catch(warn);
    } catch (err) {
      warn(err);
    }
  }

  function flush(): void {
    const waiting = buffer.splice(0, buffer.length);
    for (const record of waiting) dispatch(record);
  }

  function report(record: ErrorRecord | null | undefined): void {
    if (busy) return;
    busy = true;
    try {
      if (!record || isNoise(record, { origin: d.origin() })) return;
      if (isReadySession(session)) dispatch(record);
      else if (buffer.length < BUFFER_MAX) buffer.push(record);
    } catch (err) {
      warn(err);
    } finally {
      busy = false;
    }
  }

  function setSession(next: TelemetrySession | null | undefined): void {
    session = next;
    if (isReadySession(session) && buffer.length > 0) flush();
  }

  return { report, setSession, buffered: () => buffer.length };
}

// What `install` needs of a window, and of a console.
export interface ListenerTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}
export interface ConsoleLike {
  error: (...args: unknown[]) => unknown;
}

// The fields `install` reads from the events; anything else on them is ignored.
interface ErrorEventLike { error?: unknown; filename?: unknown; message?: unknown }
interface RejectionEventLike { reason?: unknown }

// Wraps console.error and listens on the window, once per console.
const wrapped = new WeakSet<object>();
export function install(reporter: Pick<Reporter, 'report'>, target: ListenerTarget, consoleObj: ConsoleLike): boolean {
  // Once per console: wrapping twice would report every line twice.
  if (wrapped.has(consoleObj)) return false;
  wrapped.add(consoleObj);

  target.addEventListener('error', rawEvent => {
    try {
      const event = rawEvent as ErrorEventLike | null | undefined;
      reporter.report(recordFromError(event && event.error, {
        filename: event && event.filename, message: event && event.message,
      }));
    } catch { /* never visible */ }
  });
  target.addEventListener('unhandledrejection', rawEvent => {
    try {
      const event = rawEvent as RejectionEventLike | null | undefined;
      reporter.report(recordFromRejection(event && event.reason));
    } catch { /* never visible */ }
  });

  const original = consoleObj.error;
  consoleObj.error = function wrappedConsoleError(this: unknown, ...args: unknown[]): unknown {
    // The original first, so what is printed never depends on this file.
    const result = original.apply(this, args);
    try { reporter.report(recordFromConsole(args)); } catch { /* never visible */ }
    return result;
  };
  return true;
}

// The browser's own answers. `send` is the data layer's reportError (sinks.ts); `screen` names the
// screen Mise 2 is showing (the router's section id, however the shell tracks it).
//
// Read when called, not when this file is imported: the specs import it without a browser.
export function browserErrorDeps(send: ReporterDeps['send'], screen: () => string | null): ReporterDeps {
  return {
    storage: browserStorage(),
    now: () => new Date(),
    origin: () => (typeof location !== 'undefined' ? location.origin : null),
    screen,
    // Read, never made: the device count (devicePing.ts) owns the id.
    deviceId: () => {
      try {
        const id = window.localStorage.getItem(DEVICE_ID_KEY);
        return isValidDeviceId(id) ? id : null;
      } catch { return null; }
    },
    kind: browserDeviceKind,
    online: () => navigator.onLine === true,
    version: () => MISE2_VERSION,
    send,
  };
}

// The listeners go on at once, so an error during boot is caught and buffered; the session
// arrives later (and is handed over now too, if it is already there).
export function startErrorReports(
  source: SessionSource,
  send: ReporterDeps['send'],
  screen: () => string | null,
  target: ListenerTarget = window,
  consoleObj: ConsoleLike = console,
): Reporter {
  const reporter = createReporter(browserErrorDeps(send, screen));
  install(reporter, target, consoleObj);
  try {
    source.subscribe(() => reporter.setSession(source.getSnapshot()));
    reporter.setSession(source.getSnapshot());
  } catch (err) {
    console.warn('Error reports not started:', errorCode(err));
  }
  return reporter;
}
