// errorReport.ts — the flow, with every collaborator replaced. Ported from the current app's
// tests/error-report.test.mjs, test for test.
//
// NOT PORTED (they read source files as text, or belong to the current app's pages):
//   · «the file never calls console.error itself, and never builds a uid, name or email» (reads
//     js/error-report.js) — its behavioural half is «a failing send never throws…» below, which
//     proves nothing reaches console.error;
//   · «start/install runs at module level, listeners first, then the session» and «pins: the real
//     sender calls reportError, and start() wires the session into the reporter» (read the
//     source) — replaced by the startErrorReports specs at the end, which run the same wiring;
//   · «reportError writes through addDoc with the signed-in uid and the server clock» (reads
//     js/firebase.js and firebase.example.js) — the current app's file; Mise 2's writer is sinks.ts;
//   · «the staff door starts it; the client ordering page and the reset page do not» (reads
//     js/auth-gate.js and the HTML pages) — Mise 2 has one page and no client ordering page;
//   · the «files are precached» half of «the throttle key survives a sign-out» (the current app's
//     sw.js ASSETS list) — Mise 2's offline cache is a later step.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import { recordFromConsole, type ErrorPayload, type ErrorRecord } from '@mise/shared/error-model';
import {
  createReporter, install, startErrorReports, browserErrorDeps, THROTTLE_KEY, DEVICE_ID_KEY, BUFFER_MAX,
  NO_STORAGE_PAGE_CAP, type ConsoleLike, type ListenerTarget, type ReporterDeps,
} from './errorReport';
import type { SessionSource, TelemetrySession } from './common';
import { fakeSessionSource } from '../testing/fakeSessionSource';
import { MISE2_VERSION } from './version';

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  data: Record<string, string>;
}

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: k => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data,
  };
}

const READY: TelemetrySession = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };

type Deps = ReporterDeps & { sent: ErrorPayload[]; storage: MemoryStorage };

function deps(over: Partial<ReporterDeps> = {}): Deps {
  const sent: ErrorPayload[] = [];
  return {
    sent,
    storage: memoryStorage(),
    now: () => new Date(2026, 9, 9, 10, 0),
    origin: () => 'https://app.test',
    screen: () => 'orders',
    deviceId: () => 'Dev1ce2Id3Abc4Def5Gh',
    kind: () => 'phone',
    online: () => true,
    version: async () => '649',
    send: async payload => { sent.push(payload); },
    ...over,
  } as Deps;
}

const settle = () => new Promise(r => setTimeout(r, 10));
const err = (message: string, extra: Partial<ErrorRecord> = {}): ErrorRecord => ({
  source: 'error', message, code: null, stack: `Error: ${message}\n    at f (a.js:1:1)`, filename: null, ...extra,
});

describe('createReporter', () => {
  test('a ready session sends the line with screen, version, device facts and no uid of its own', async () => {
    const d = deps();
    const r = createReporter(d);
    r.setSession(READY);
    r.report(err('boom', { code: 'unavailable', filename: 'https://app.test/js/secret.js' }));
    await settle();
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toEqual({
      source: 'error', screen: 'orders', appVersion: '649', deviceId: 'Dev1ce2Id3Abc4Def5Gh',
      deviceKind: 'phone', online: true, code: 'unavailable', message: 'boom', stack: 'Error: boom\n    at f (a.js:1:1)',
    });
  });

  test('before a venue is open errors are buffered (at most 10) and sent once the session is ready', async () => {
    const d = deps();
    const r = createReporter(d);
    for (let i = 0; i < BUFFER_MAX + 5; i += 1) r.report(err(`early ${i}`));
    await settle();
    expect(d.sent).toHaveLength(0);
    expect(r.buffered()).toBe(BUFFER_MAX);
    r.setSession({ status: 'loading' });
    r.setSession({ status: 'ready', locationId: null, user: { uid: 'u1' } });
    r.setSession({ status: 'ready', locationId: 'bakery', user: {} });
    await settle();
    expect(d.sent).toHaveLength(0);
    r.setSession(READY);
    await settle();
    expect(d.sent).toHaveLength(BUFFER_MAX);
    expect(r.buffered()).toBe(0);
  });

  test('after a sign-out nothing is sent directly; it waits for the next ready session', async () => {
    const d = deps();
    const r = createReporter(d);
    r.setSession(READY);
    r.setSession({ status: 'signed-out' });
    r.report(err('while signed out'));
    await settle();
    expect(d.sent).toHaveLength(0);
    r.setSession(READY);
    await settle();
    expect(d.sent).toHaveLength(1);
  });

  test('the same error is sent once a day, and again tomorrow', async () => {
    let clock = new Date(2026, 9, 9, 10, 0);
    const d = deps({ now: () => clock });
    const r = createReporter(d);
    r.setSession(READY);
    r.report(err('same'));
    r.report(err('same'));
    r.report(err('other'));
    await settle();
    expect(d.sent).toHaveLength(2);
    expect(JSON.parse(d.storage.data[THROTTLE_KEY] as string).count).toBe(2);
    clock = new Date(2026, 9, 10, 8, 0);
    r.report(err('same'));
    await settle();
    expect(d.sent).toHaveLength(3);
  });

  test('at most 20 sends a device a day', async () => {
    const d = deps();
    const r = createReporter(d);
    r.setSession(READY);
    for (let i = 0; i < 40; i += 1) r.report(err(`distinct ${i}`));
    await settle();
    expect(d.sent).toHaveLength(20);
  });

  test('the throttle survives a new page (it lives in storage)', async () => {
    const storage = memoryStorage();
    const a = deps({ storage });
    const first = createReporter(a);
    first.setSession(READY);
    first.report(err('again'));
    await settle();
    const b = deps({ storage });
    const second = createReporter(b);
    second.setSession(READY);
    second.report(err('again'));
    await settle();
    expect(a.sent.length + b.sent.length).toBe(1);
  });

  test('no usable storage (missing, throwing, or dropping writes): still sends, but at most 5 a page', async () => {
    const blocked = () => { throw new Error('blocked'); };
    for (const storage of [null, { getItem: blocked, setItem: blocked }, { getItem: () => null, setItem: () => {} }]) {
      const d = deps({ storage });
      const r = createReporter(d);
      r.setSession(READY);
      for (let i = 0; i < 12; i += 1) r.report(err(`n${i}`));
      r.report(err('n0'));
      await settle();
      expect(d.sent, storage ? 'storage that cannot keep the count' : 'no storage').toHaveLength(NO_STORAGE_PAGE_CAP);
    }
  });

  test('noise is dropped', async () => {
    const d = deps();
    const r = createReporter(d);
    r.setSession(READY);
    r.report({ source: 'error', message: 'ResizeObserver loop limit exceeded', stack: null, code: null, filename: null });
    r.report({ source: 'error', message: 'Script error.', stack: null, code: null, filename: null });
    r.report(err('from an extension', { filename: 'chrome-extension://abc/x.js' }));
    await settle();
    expect(d.sent).toHaveLength(0);
  });

  test('a failing send never throws, never loops, and says only the code on console.warn', async () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
    try {
      const d = deps({ send: async () => { throw Object.assign(new Error('secret detail'), { code: 'permission-denied' }); } });
      const r = createReporter(d);
      r.setSession(READY);
      r.report(err('first'));
      await settle();
      expect(warnings).toEqual(['Error report not sent: permission-denied']);
      expect(errors).toEqual([]);
      // A synchronous throw from the data layer, and a send that throws before returning a promise.
      const d2 = deps({ send: () => { throw new Error('sync'); } });
      const r2 = createReporter(d2);
      r2.setSession(READY);
      r2.report(err('second'));
      await settle();
      expect(warnings).toHaveLength(2);
      expect(errors).toEqual([]);
    } finally { console.warn = origWarn; console.error = origError; }
  });

  test('a console.error raised while reporting is not reported again (re-entrancy)', async () => {
    const fake: ConsoleLike = { error: () => {} };
    const calls: ErrorPayload[] = [];
    const d = deps({
      // The collaborator logs through the wrapped console while the reporter is inside report().
      origin: () => { fake.error('inside the reporter'); return 'https://app.test'; },
      send: async payload => { calls.push(payload); },
    });
    const r = createReporter(d);
    install(r, { addEventListener() {} }, fake);
    r.setSession(READY);
    fake.error('outside');
    await settle();
    expect(calls.map(c => c.message)).toEqual(['outside']);
  });

  test('the version is asked once per page', async () => {
    let asked = 0;
    const d = deps({ version: async () => { asked += 1; return '649'; } });
    const r = createReporter(d);
    r.setSession(READY);
    r.report(err('a'));
    r.report(err('b'));
    await settle();
    expect(asked).toBe(1);
    expect(d.sent).toHaveLength(2);
  });

  test('a version that cannot be read still sends the line, with a null version', async () => {
    const d = deps({ version: async () => { throw new Error('no worker'); } });
    const r = createReporter(d);
    r.setSession(READY);
    r.report(err('a'));
    await settle();
    expect(d.sent[0]?.appVersion).toBeNull();
  });

  test('recordFromConsole feeds the reporter the way the wrapper does', async () => {
    const d = deps();
    const r = createReporter(d);
    r.setSession(READY);
    r.report(recordFromConsole(['Logs listener never started (no location open):', Object.assign(new Error('x'), { code: 'failed-precondition' })]));
    await settle();
    expect(d.sent[0]?.source).toBe('console');
    expect(d.sent[0]?.code).toBe('failed-precondition');
  });

  // With no signal the sink (sinks.ts) WAITS for it, so a send can stay pending for hours: the
  // line is then held by the promise, in memory, and goes when the signal is back.
  test('a send that stays pending (no signal) blocks nothing, is not sent twice, and goes once it settles', async () => {
    const releases: Array<() => void> = [];
    const calls: string[] = [];
    const d = deps({
      send: payload => new Promise<void>(resolve => { calls.push(payload.message); releases.push(resolve); }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = createReporter(d);
      r.setSession(READY);
      r.report(err('first'));
      r.report(err('second'));
      r.report(err('first'));
      await settle();

      // Both different errors were handed over; the repeat was throttled, not queued again.
      expect(calls).toEqual(['first', 'second']);
      expect(r.buffered()).toBe(0);

      releases.forEach(release => release());
      await settle();
      expect(calls).toEqual(['first', 'second']);
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  test('the session may change while the version is asked for: nothing is sent for a signed-out person', async () => {
    // The check after the await in dispatch(): the line belongs to who is signed in NOW.
    const d = deps({ version: () => new Promise<string>(resolve => setTimeout(() => resolve('649'), 5)) });
    const r = createReporter(d);
    r.setSession(READY);
    r.report(err('late'));
    r.setSession({ status: 'signed-out' });
    await settle();
    expect(d.sent).toHaveLength(0);
  });
});

describe('install', () => {
  test('the original console.error runs first with the same arguments and its result is kept', async () => {
    const order: unknown[][] = [];
    const fake: ConsoleLike = { error: function original(...args: unknown[]) { order.push(['original', args]); return 'printed'; } };
    const d = deps({ send: async () => { order.push(['send']); } });
    const r = createReporter(d);
    r.setSession(READY);
    expect(install(r, { addEventListener() {} }, fake)).toBe(true);
    const thing = { a: 1 };
    expect(fake.error('saveLogDoc failed:', thing)).toBe('printed');
    await settle();
    expect(order[0]).toEqual(['original', ['saveLogDoc failed:', thing]]);
    expect(order[1]).toEqual(['send']);
    expect(install(r, { addEventListener() {} }, fake), 'wrapped once only').toBe(false);
  });

  test('a reporter that throws cannot break console.error or the page', () => {
    const printed: unknown[][] = [];
    const fake: ConsoleLike = { error: (...a: unknown[]) => printed.push(a) };
    const broken = { report: () => { throw new Error('reporter bug'); } };
    install(broken, { addEventListener() {} }, fake);
    expect(() => fake.error('still prints')).not.toThrow();
    expect(printed).toEqual([['still prints']]);
  });

  test('window errors and unhandled rejections reach the reporter', () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const target: ListenerTarget = { addEventListener: (type, fn) => { handlers[type] = fn; } };
    const fire = (type: string, event: unknown): void => {
      const handler = handlers[type];
      if (!handler) throw new Error(`install never listened for «${type}»`);
      handler(event);
    };
    const got: ErrorRecord[] = [];
    install({ report: record => { if (record) got.push(record); } }, target, { error() {} });
    fire('error', { error: new Error('uncaught'), filename: 'https://app.test/js/a.js', message: 'Uncaught Error: uncaught' });
    fire('error', { error: null, filename: '', message: 'Script error.' });
    fire('unhandledrejection', { reason: 'plain reason' });
    fire('unhandledrejection', { reason: { a: 1 } });
    fire('unhandledrejection', {});
    expect(got.map(r => [r.source, r.message])).toEqual([
      ['error', 'uncaught'], ['error', 'Script error.'], ['rejection', 'plain reason'],
      ['rejection', '[object]'], ['rejection', 'undefined'],
    ]);
    expect(got[0]?.filename).toBe('https://app.test/js/a.js');
  });

  test('a listener handed nothing at all cannot break the page', () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const target: ListenerTarget = { addEventListener: (type, fn) => { handlers[type] = fn; } };
    const got: unknown[] = [];
    install({ report: record => { got.push(record); } }, target, { error() {} });
    expect(() => { handlers.error?.(undefined); handlers.unhandledrejection?.(null); }).not.toThrow();
    expect(got).toHaveLength(2);
  });
});

describe('the keys', () => {
  test('the throttle key survives a sign-out', () => {
    expect(keysToClear([THROTTLE_KEY, 'device-id', 'some-cache'])).toEqual(['some-cache']);
    expect(KEEP_PREFIXES).toContain('error-reports');
  });

  test('the device id is read under the key the device count writes', () => {
    expect(DEVICE_ID_KEY).toBe('device-id');
  });
});

// ── What Mise 2 adds: the real browser answers, and the start-up wiring ─────────────────────

describe('browserErrorDeps', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

  test('screen and send are the ones passed in; the release is Mise 2\'s own', async () => {
    const send = vi.fn(async () => {});
    const d = browserErrorDeps(send, () => 'm2:orders');
    expect(d.screen()).toBe('m2:orders');
    expect(d.send).toBe(send);
    expect(await d.version()).toBe(MISE2_VERSION);
  });

  test('it reads the browser: the origin, the clock, the storage and whether it is online', () => {
    const d = browserErrorDeps(async () => {}, () => null);
    expect(d.origin()).toBe(location.origin);
    expect(d.storage).toBe(window.localStorage);
    expect(Math.abs(d.now().getTime() - Date.now())).toBeLessThan(1000);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(d.online()).toBe(false);
  });

  test('the kind of device comes from the screen and the pointer', () => {
    vi.stubGlobal('screen', { width: 390, height: 844 });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const d = browserErrorDeps(async () => {}, () => null);
    expect(d.kind()).toBe('phone');
    vi.stubGlobal('screen', { width: 1024, height: 768 });
    expect(d.kind()).toBe('tablet');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(d.kind()).toBe('computer');
  });

  test('the device id is read, never made', () => {
    const d = browserErrorDeps(async () => {}, () => null);
    expect(d.deviceId()).toBeNull();
    expect(window.localStorage.getItem(DEVICE_ID_KEY), 'the device count owns the id').toBeNull();
    window.localStorage.setItem(DEVICE_ID_KEY, 'nonsense');
    expect(d.deviceId()).toBeNull();
    window.localStorage.setItem(DEVICE_ID_KEY, 'Ab3dEf6hIj9lMn2pQr5t');
    expect(d.deviceId()).toBe('Ab3dEf6hIj9lMn2pQr5t');
  });
});

describe('startErrorReports', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

  function wiring() {
    const handlers: Record<string, (event: unknown) => void> = {};
    const source = fakeSessionSource({ status: 'loading' });
    const target: ListenerTarget = {
      addEventListener: (type, fn) => { source.calls.push(`listen:${type}`); handlers[type] = fn; },
    };
    const originalError = vi.fn((..._args: unknown[]) => 'printed');
    const consoleObj: ConsoleLike = { error: originalError };
    const sent: ErrorPayload[] = [];
    const send = vi.fn(async (payload: ErrorPayload) => { sent.push(payload); });
    vi.stubGlobal('screen', { width: 390, height: 844 });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    return { handlers, source, target, consoleObj, originalError, sent, send };
  }

  test('the listeners go on before the session arrives, so an error during boot is caught', () => {
    const w = wiring();
    startErrorReports(w.source, w.send, () => 'm2:orders', w.target, w.consoleObj);
    expect(w.source.calls).toEqual(['listen:error', 'listen:unhandledrejection', 'subscribe']);
  });

  test('an error during boot is buffered, then sent once the venue opens, through the sender passed in', async () => {
    const w = wiring();
    const reporter = startErrorReports(w.source, w.send, () => 'm2:orders', w.target, w.consoleObj);
    w.consoleObj.error('Logs listener never started', Object.assign(new Error('x'), { code: 'failed-precondition' }));
    expect(w.originalError).toHaveBeenCalledOnce();
    expect(reporter.buffered()).toBe(1);
    expect(w.sent).toHaveLength(0);
    w.source.set(READY);
    await settle();
    expect(reporter.buffered()).toBe(0);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({
      source: 'console', screen: 'm2:orders', appVersion: MISE2_VERSION, deviceKind: 'phone', code: 'failed-precondition',
    });
  });

  test('a session that is already ready at start is used at once', async () => {
    const w = wiring();
    w.source.set(READY);
    startErrorReports(w.source, w.send, () => 'm2:orders', w.target, w.consoleObj);
    w.handlers.error?.({ error: new Error('uncaught'), filename: '', message: 'uncaught' });
    await settle();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]?.source).toBe('error');
  });

  test('signing out stops the reports; signing in again resumes them', async () => {
    const w = wiring();
    w.source.set(READY);
    startErrorReports(w.source, w.send, () => 'm2:orders', w.target, w.consoleObj);
    w.source.set({ status: 'signed-out' });
    w.consoleObj.error('while signed out');
    await settle();
    expect(w.sent).toHaveLength(0);
    w.source.set(READY);
    await settle();
    expect(w.sent).toHaveLength(1);
  });

  test('a session source that fails cannot break the start', () => {
    const w = wiring();
    const broken: SessionSource = {
      getSnapshot: () => { throw new Error('no snapshot'); },
      subscribe: () => { throw new Error('no subscribe'); },
    };
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };
    try {
      expect(() => startErrorReports(broken, w.send, () => null, w.target, w.consoleObj)).not.toThrow();
    } finally { console.warn = original; }
    expect(warnings).toEqual(['Error reports not started: unknown']);
  });
});
