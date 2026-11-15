import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { screen } from '@testing-library/react';
import { PartBoundary } from '../errors/PartBoundary';
import { fakeStore } from '../testing/fakeSession';
import { renderWithSession } from '../testing/renderWithSession';
import type { ConsoleLike, ListenerTarget } from './errorReport';
import type { TelemetrySinks } from './sinks';
import { startTelemetry } from './startTelemetry';
import { announceScreen, START_DELAY_MS } from './usage';
import { MISE2_VERSION } from './version';

// startTelemetry.ts — the wiring main.tsx calls, run against a fake session store and fake
// sinks. The three modules it starts carry their own specs (errorReport, devicePing, usage);
// what is pinned here is that they are STARTED, and started on the right things.

const READY = {
  status: 'ready' as const,
  user: { uid: 'u1', email: 'owner@club.test', isAnonymous: false },
  locationId: 'bakery',
};
const SIGNED_OUT = { status: 'signed-out' as const, user: null, locationId: null };

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

function fakeSinks() {
  return {
    reportError: vi.fn<TelemetrySinks['reportError']>(async () => undefined),
    pingDevice: vi.fn<TelemetrySinks['pingDevice']>(async () => undefined),
    saveUsage: vi.fn<TelemetrySinks['saveUsage']>(async () => undefined),
  };
}

// A store nobody is signed in to, sinks that remember, and a window and a console of our own, so
// the specs never wrap the real console or listen on the real window unless they say so.
function wiring() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const target: ListenerTarget = { addEventListener: (type, listener) => { handlers[type] = listener; } };
  const originalError = vi.fn();
  const consoleObj: ConsoleLike = { error: originalError };
  return { store: fakeStore(SIGNED_OUT), sinks: fakeSinks(), handlers, target, consoleObj, originalError };
}

let stop: (() => void) | null = null;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('screen', { width: 390, height: 844 });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

function Boom(): never {
  throw new Error('this part is broken');
}

describe('startTelemetry: errors', () => {
  test('an error before the session is ready is kept, then sent once a venue is open', async () => {
    const w = wiring();
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });

    w.handlers.error?.({ error: new Error('boot failure'), filename: '', message: 'boot failure' });
    await settle();
    expect(w.sinks.reportError).not.toHaveBeenCalled();

    w.store.set(READY);
    await settle();
    expect(w.sinks.reportError).toHaveBeenCalledTimes(1);
    expect(w.sinks.reportError.mock.calls[0]?.[0]).toMatchObject({
      source: 'error', message: 'boot failure', screen: 'm2', appVersion: MISE2_VERSION, deviceKind: 'phone',
    });
  });

  test('the error report is handed a plain record, whatever the sink does with it', async () => {
    const w = wiring();
    w.store.set(READY);
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });
    w.handlers.error?.({ error: new Error('plain'), filename: '', message: 'plain' });
    await settle();
    const record = w.sinks.reportError.mock.calls[0]?.[0];
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    // The write is the sink's job: uid, venue and time are added THERE, never here.
    expect(Object.keys(record ?? {})).not.toContain('uid');
    expect(Object.keys(record ?? {})).not.toContain('bakery');
  });

  test('a render error a boundary caught is reported once, as a console line', async () => {
    const w = wiring();
    w.store.set(READY);
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });
    // React logs what a boundary caught with console.error. The real console is left alone: its
    // calls are handed to the wrapped one of this spec, as the real one would be.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { w.consoleObj.error(...args); });

    renderWithSession(<PartBoundary><Boom /></PartBoundary>);
    expect(screen.getByRole('status')).toHaveTextContent('This part didn’t load.');
    await settle();

    expect(w.originalError).toHaveBeenCalled();
    expect(w.sinks.reportError).toHaveBeenCalledTimes(1);
    const record = w.sinks.reportError.mock.calls[0]?.[0];
    expect(record).toMatchObject({ source: 'console' });
    expect(String(record?.message)).toContain('this part is broken');
    expect(String(record?.stack)).toContain('Boom');
  });

  // ⚠️ React 19 puts an error nothing caught on the window's 'error' event, but inside act()
  // it hands the error to the test instead — so this one draws OUTSIDE act, as a browser does.
  test('an error thrown outside every boundary reaches the window and is reported', async () => {
    const w = wiring();
    w.store.set(READY);
    // The real window: that is where React sends it.
    stop = startTelemetry({ store: w.store, sinks: w.sinks, console: w.consoleObj });
    // jsdom prints an uncaught error to the console; this spec's console is not the real one.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const flag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = flag.IS_REACT_ACT_ENVIRONMENT;
    flag.IS_REACT_ACT_ENVIRONMENT = false;
    const root = createRoot(document.createElement('div'));
    try {
      root.render(<Boom />);
      await vi.waitFor(() => { expect(w.sinks.reportError).toHaveBeenCalledTimes(1); });
    } finally {
      root.unmount();
      flag.IS_REACT_ACT_ENVIRONMENT = before;
    }
    const record = w.sinks.reportError.mock.calls[0]?.[0];
    expect(record).toMatchObject({ source: 'error' });
    expect(String(record?.message)).toContain('this part is broken');
  });

  test('nothing is sent while nobody is signed in', async () => {
    vi.useFakeTimers();
    const w = wiring();
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });
    announceScreen('sign-in');

    w.handlers.error?.({ error: new Error('while signed out'), filename: '', message: 'while signed out' });
    w.consoleObj.error('also while signed out');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(w.sinks.reportError).not.toHaveBeenCalled();
    expect(w.sinks.pingDevice).not.toHaveBeenCalled();
    expect(w.sinks.saveUsage).not.toHaveBeenCalled();
  });

  test('the original console.error still prints, with the same arguments', () => {
    const w = wiring();
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });
    w.consoleObj.error('printed', 42);
    expect(w.originalError).toHaveBeenCalledWith('printed', 42);
  });
});

describe('startTelemetry: the device count and the usage record', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 10, 0, 0));
  });

  test('a ready session is counted once, after the page has settled', async () => {
    const w = wiring();
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });

    w.store.set(READY);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS - 1);
    expect(w.sinks.pingDevice).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(w.sinks.pingDevice).toHaveBeenCalledTimes(1);
    const [payload, id] = w.sinks.pingDevice.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ bakery: 'bakery', uid: 'u1', kind: 'phone', appVersion: MISE2_VERSION });
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);

    // The same session again, the same day: not counted twice.
    w.store.set(READY);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 1);
    expect(w.sinks.pingDevice).toHaveBeenCalledTimes(1);
  });

  test('a session that is already ready when the telemetry starts is counted too', async () => {
    const w = wiring();
    w.store.set(READY);
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 1);
    expect(w.sinks.pingDevice).toHaveBeenCalledTimes(1);
  });

  test('the screens announced are recorded under the signed-in account and sent after ten minutes', async () => {
    const w = wiring();
    stop = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });
    // Announced before a venue is open (the gate's screens): kept, filed once there is one.
    announceScreen('sign-in');
    w.store.set(READY);
    announceScreen('orders');

    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

    expect(w.sinks.saveUsage).toHaveBeenCalled();
    const [payload, id] = w.sinks.saveUsage.mock.calls[0] ?? [];
    expect(id).toMatch(/^[A-Za-z0-9]{20}_20261011_u1$/);
    expect(payload).toMatchObject({ dayKey: '20261011', kind: 'phone', appVersion: MISE2_VERSION });
    expect(Object.keys((payload as { screens: object }).screens)).toEqual(
      expect.arrayContaining(['m2', 'm2:sign-in', 'm2:orders']),
    );
  });

  test('stopping it stops the device count and the usage record', async () => {
    const w = wiring();
    const stopIt = startTelemetry({ store: w.store, sinks: w.sinks, target: w.target, console: w.consoleObj });
    stopIt();

    w.store.set(READY);
    announceScreen('orders');
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

    expect(w.sinks.pingDevice).not.toHaveBeenCalled();
    expect(w.sinks.saveUsage).not.toHaveBeenCalled();
  });
});

describe('startTelemetry: a part that cannot start', () => {
  test('one broken part does not stop the others, and nothing is thrown', async () => {
    vi.useFakeTimers();
    const w = wiring();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A target that refuses listeners breaks the error reports only.
    const refusing: ListenerTarget = { addEventListener: () => { throw Object.assign(new Error('x'), { code: 'blocked' }); } };

    expect(() => {
      stop = startTelemetry({ store: w.store, sinks: w.sinks, target: refusing, console: w.consoleObj });
    }).not.toThrow();

    expect(warn).toHaveBeenCalledWith('Telemetry (errors) not started:', 'blocked');
    // The device count still runs.
    w.store.set(READY);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 1);
    expect(w.sinks.pingDevice).toHaveBeenCalledTimes(1);
  });
});
