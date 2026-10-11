// startTelemetry.ts — turns the three telemetry modules on, in one place main.tsx can call.
//
//   • errors   — errorReport.ts: an uncaught error, an unhandled promise and every console.error
//   • devices  — devicePing.ts: «this device used this venue today», once a day
//   • usage    — usage.ts: the screens people open, for how long, and the moves between them
//
// ⚠️ CALLED BEFORE THE SESSION STARTS (main.tsx). The error listeners must be on before anything
// else runs, or an error during boot would be lost; the reporter then keeps it in memory until
// a venue is open (the rules need a signed-in account and a venue).
//
// ⚠️ RENDER ERRORS NEED NOTHING EXTRA, and must not be given anything. React 19 logs an error
// that a boundary caught with console.error (which errorReport.ts wraps, so it arrives as source
// `console`), and an error nothing caught reaches the window's 'error' event (source `error`).
// Passing `onCaughtError` / `onUncaughtError` to createRoot would REPLACE that logging: the same
// error would then be reported twice (by our callback and by the wrapped console) or not at all
// (a callback that forgets to log). startTelemetry.spec.tsx pins both routes.
//
// ⚠️ NEVER VISIBLE, NEVER BLOCKING (P17). Each part is started on its own, so one that cannot
// start (a blocked storage, a broken source) does not stop the others, and none can stop the app
// from drawing its first screen.

import type { DevicePayload } from '@mise/shared/device-model';
import type { ErrorPayload } from '@mise/shared/error-model';
import type { UsagePayload } from '@mise/shared/usage-model';
import { errorCode, type SessionSource } from './common';
import { currentScreen, trackScreens } from './currentScreen';
import { browserPingDeps, startDevicePing } from './devicePing';
import { startErrorReports, type ConsoleLike, type ListenerTarget } from './errorReport';
import type { TelemetrySinks } from './sinks';
import { startUsage } from './usage';

export interface TelemetryStart {
  // The session store (it is a SessionSource as it is).
  store: SessionSource;
  // The three writes (createTelemetrySinks).
  sinks: TelemetrySinks;
  // Where the error listeners go, and the console whose errors are reported. For the specs; the
  // app passes neither.
  target?: ListenerTarget;
  console?: ConsoleLike;
}

// Returns a function that stops the device count, the usage counting and the screen tracking.
// The error listeners stay on for the life of the page: install() has no undo, on purpose — a
// page that stops hearing about its errors is the one that most needs to.
export function startTelemetry(
  { store, sinks, target = window, console: consoleObj = console }: TelemetryStart,
): () => void {
  const stops: Array<() => void> = [];
  const attempt = (name: string, start: () => (() => void) | void): void => {
    try {
      const stop = start();
      if (stop) stops.push(stop);
    } catch (err) {
      try { console.warn(`Telemetry (${name}) not started:`, errorCode(err)); } catch { /* nothing */ }
    }
  };

  // The sinks take any record (their payloads are checked by the shared models and by the
  // rules); the models hand over interfaces, which TypeScript will not treat as records. The
  // spread copies the payload into an object literal, which it will — nothing else changes.
  const sendError = (payload: ErrorPayload): Promise<unknown> => sinks.reportError({ ...payload });
  const sendDevice = (payload: DevicePayload, id: string): Promise<unknown> => sinks.pingDevice({ ...payload }, id);
  const sendUsage = (payload: UsagePayload, id: string): Promise<unknown> => sinks.saveUsage({ ...payload }, id);

  // First, so the screen is known from the first announcement on.
  attempt('screens', () => trackScreens());
  attempt('errors', () => {
    startErrorReports(store, sendError, currentScreen, target, consoleObj);
  });
  attempt('devices', () => startDevicePing(store, browserPingDeps(sendDevice)));
  attempt('usage', () => startUsage({ source: store, send: sendUsage }));

  return () => {
    for (const stop of stops.splice(0, stops.length)) {
      try { stop(); } catch { /* nothing */ }
    }
  };
}
