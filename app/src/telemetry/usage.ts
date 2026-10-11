// usage.ts — how the app is used: the screens people open, for how long, and the moves from
// one screen to the next (the routes that may deserve a shortcut).
//
// Port of js/usage.js (the current app) for Mise 2, flow for flow; usage.spec.ts carries every
// test of the original. The comments below are the ones it paid for in bugs.
//
// A device keeps ONE accumulator per person per venue per day in its own storage and sends the
// whole of it now and then: locations/{lid}/usage/<deviceId>_<YYYYMMDD>_<uid> (written by
// sinks.ts). The line carries the signed-in account's uid (the owner's choice, 9 Oct 2026,
// internal use — never a name or an email). The rules refuse every read; only the owner's script
// (scripts/read-usage.mjs) sees them.
//
// WHAT A «SCREEN» IS. The current app has many pages, each a «page» plus «views» inside it, shown
// as `page` or `page:view`. Mise 2 is ONE page: its page is always `m2`, and the view is the
// section the shell announces with a `mise:screen` event on window (detail = the section id:
// `orders`, `recipes`, `more`, `settings`, `not-found`…), so Mise 2's screens read `m2:orders`,
// `m2:recipes`… and never collide with the current app's `orders`, `catalogue`…. Key actions are
// announced by `mise:action` (detail = a short name). announceScreen() / announceAction() are the
// one-line announcers; the code that calls them imports nothing else from here.
//
// ⚠️ NEVER VISIBLE, NEVER BLOCKING (P17). Every failure is a console line with the error code and
// nothing else; every storage access is in a try/catch; nothing is thrown, drawn or awaited.
// ⚠️ NO STORAGE, NO LINE. The local accumulator IS the day's truth; with nowhere to keep it,
// nothing is sent (a smaller total would overwrite a bigger one on the server).
// ⚠️ THE KEYS START WITH "usage-": local-data keeps that prefix through a sign-out and a venue
// switch. Wiped, the next write of the day would carry smaller totals than the line already on
// the server and replace them. Mise 2 shares the current app's localStorage, so the SAME keys
// and the same device id are used: a person who opens either app adds to the same day record.
// ⚠️ FEW WRITES (P14). A line is sent only if something changed AND ten minutes passed since the
// last send (three when the page is being hidden), or the day is over. The throttle clock starts
// when the day's record is made, so a short visit does not write on its own.
// ⚠️ A RECORD IS CLEAN ONLY WHEN THE SERVER ANSWERED (and nothing was added meanwhile: `rev`).
// `lastSentAt` is the time of the last ATTEMPT, which bounds the retries to one per ten
// minutes; a write that never settles (offline, or a page that died) is sent again later,
// the same document id and the whole document, so repeating it is harmless.
// ⚠️ A RECORD THAT NEVER REACHED A SEND THRESHOLD is still sent: today's on the first check
// ten minutes after it was made, a past day's on the next page load. It is pruned only
// after seven days unsent.
// ⚠️ NOTHING TO RECORD, NOTHING WRITTEN: no target of a tap, no text, no value is ever read —
// only the name of the screen the tap happened on.

import { sameSession, type DeviceKind } from '@mise/shared/device-model';
import {
  newAcc, mergeAcc, cleanAcc, isEmptyAcc, addScreen, addRoute, addSeconds, addTap, addAction,
  addLoad, addOffline, touchMinute, dayKeyOf, docId, payloadOf, SCREEN_RE, ACTION_RE,
  type UsageAcc, type UsagePayload,
} from '@mise/shared/usage-model';
import type { KeyValueStorage } from '../session/backend';
import {
  browserDeviceKind, browserStorage, errorCode, isFinalRefusal, isReadySession, readJson,
  type SessionSource, type TelemetrySession,
} from './common';
import { deviceIdFrom } from './devicePing';
import { MISE2_VERSION } from './version';

export const STORE_PREFIX = 'usage-';
export const LAST_KEY = 'usage-last';
export const TICK_MS = 15000;
// How often the send check runs; the ten-minute throttle inside it decides.
export const FLUSH_CHECK_MS = 60000;
export const IDLE_MS = 120000;
export const ROUTE_WINDOW_MS = 30 * 60 * 1000;
export const SEND_EVERY_MS = 10 * 60 * 1000;
export const SEND_ON_HIDE_MS = 3 * 60 * 1000;
export const KEEP_DAYS = 7;
// Let the page paint and the first reads finish before any write.
export const START_DELAY_MS = 2500;

// Mise 2 is one page, and this is its name in every screen, route and load time.
export const MISE2_PAGE = 'm2';
export const SCREEN_EVENT = 'mise:screen';
export const ACTION_EVENT = 'mise:action';

function writeJson(storage: Pick<KeyValueStorage, 'setItem'>, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function warn(err: unknown): void {
  try { console.warn('Usage not sent:', errorCode(err)); } catch { /* nothing */ }
}

// A stored number, or `fallback` when it is anything else (a damaged record).
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// The page's name from its path: «/mise_app/orders.html» → «orders»; the root → «index». Kept for
// parity with the current app; Mise 2's own page is always MISE2_PAGE.
export function pageName(pathname: unknown): string {
  const file = String(pathname || '').split('/').pop() || '';
  const base = file.replace(/\.html?$/i, '').toLowerCase();
  const name = base || 'index';
  return SCREEN_RE.test(name) ? name : 'other';
}

export function storeKey(lid: string, uid: string, dayKey: string): string {
  return `${STORE_PREFIX}${lid}-${uid}-${dayKey}`;
}

export interface StoreKeyParts { lid: string; uid: string; dayKey: string }

// The inverse of storeKey. The uid has no hyphen and the day is eight digits, so the venue
// (which may have hyphens) is whatever is left in front.
export function parseStoreKey(key: unknown): StoreKeyParts | null {
  const match = /^usage-(.+)-([A-Za-z0-9]{1,128})-(20\d{6})$/.exec(String(key || ''));
  return match ? { lid: match[1] as string, uid: match[2] as string, dayKey: match[3] as string } : null;
}

// What a day's record looks like in storage. Read back from a place anything can write to, so
// every field is `unknown` until it has been looked at.
interface StoredRecord { acc?: unknown; dirty?: unknown; lastSentAt?: unknown; rev?: unknown }

// The browser's own answers, and the data layer, as the tracker asks for them. Replaced one by
// one in the specs; `browserUsageDeps` is the real set.
export interface UsageDeps {
  storage: KeyValueStorage | null;
  now(): Date;
  // Every storage key that starts with «usage-».
  keys(): string[];
  visible(): boolean;
  online(): boolean;
  // How long the page took to be ready, in ms since it opened; null = not known yet.
  navigationMs(): number | null;
  deviceId(): string | null;
  kind(): DeviceKind;
  version(): Promise<string | null> | string | null;
  // Who is signed in NOW.
  currentSession(): TelemetrySession | null | undefined;
  send(payload: UsagePayload, id: string): Promise<unknown>;
}

// 'timer' and 'load' may send past days too; 'hidden' hands over today's at once.
export type FlushReason = 'timer' | 'hidden' | 'load';
export type FlushResult = 'skipped' | 'nothing' | 'no-device' | 'sent' | 'failed';

export interface Tracker {
  // The page just opened.
  begin(page: string): void;
  // A view inside the page: '' = back to its main view.
  view(pageOf: string, detail: unknown): void;
  action(detail: unknown): void;
  tap(): void;
  input(): void;
  tick(): void;
  commit(): void;
  flush(reason: FlushReason): Promise<FlushResult>;
  prune(): void;
  setSession(next: TelemetrySession | null | undefined): void;
  goTo(name: unknown): void;
  recordLoad(): void;
  useCurrentSession(fn: () => TelemetrySession | null | undefined): void;
  // What is counted but not yet merged into the stored day.
  pending(): UsageAcc;
  current(): string | null;
}

export function createTracker(deps: UsageDeps): Tracker {
  // A copy: useCurrentSession() replaces one member and must not change the caller's object.
  const d: UsageDeps = { ...deps };
  // Counted but not yet merged into the stored day: everything before a venue is open, and the
  // last few seconds before each commit. `memDay` is the day those counts belong to, set when the
  // first one lands, so a tick that crosses midnight files them under the day they were made.
  let mem = newAcc();
  let memDay: string | null = null;
  let session: TelemetrySession | null | undefined = null;
  let current: string | null = null;
  let page: string | null = null;
  let loadRecorded = false;
  let lastInputAt = d.now().getTime();
  let lastTickAt = lastInputAt;
  let versionPromise: Promise<string | null> | null = null;
  // The release, once known: a flush on hide cannot wait for it.
  let cachedVersion: string | null = null;

  function version(): Promise<string | null> {
    if (!versionPromise) {
      versionPromise = Promise.resolve().then(() => d.version()).catch(() => null)
        .then(v => { cachedVersion = v; return v; });
    }
    return versionPromise;
  }

  function remember(screen: string): void {
    if (!d.storage) return;
    writeJson(d.storage, LAST_KEY, { screen, at: d.now().getTime() });
  }

  // Called before every count: counts made on an earlier day are filed first, then the new
  // count is marked as today's.
  function stamp(): void {
    const today = dayKeyOf(d.now());
    if (memDay !== null && memDay !== today) commit();
    if (memDay === null) memDay = today;
  }

  // The screen changed (or the page opened).
  function goTo(name: unknown): void {
    if (typeof name !== 'string' || !SCREEN_RE.test(name) || name === current) return;
    stamp();
    const previous = current;
    current = name;
    addScreen(mem, name);
    if (previous) addRoute(mem, previous, name);
    touchMinute(mem, d.now());
    remember(name);
  }

  // The page just opened: count it, and a move from the screen the last page ended on.
  function begin(pageOf: string): void {
    const now = d.now().getTime();
    const last = (d.storage ? readJson(d.storage, LAST_KEY) : null) as { screen?: unknown; at?: unknown } | null;
    page = pageOf;
    current = null;
    goTo(page);
    if (last && typeof last.screen === 'string' && typeof last.at === 'number' && Number.isFinite(last.at)
        && now - last.at >= 0 && now - last.at < ROUTE_WINDOW_MS) {
      addRoute(mem, last.screen, page);
    }
  }

  // The page finished loading: its load time, once. Not known at begin() — Mise 2 is ready only
  // when its first screen is up (markLoaded()), which is after the tracker starts.
  function recordLoad(): void {
    if (loadRecorded || !page) return;
    const ms = d.navigationMs();
    if (ms === null) return;
    loadRecorded = true;
    stamp();
    addLoad(mem, page, ms);
  }

  // A view inside the page: '' = back to its main view.
  function view(pageOf: string, detail: unknown): void {
    if (typeof detail !== 'string') return;
    goTo(detail === '' ? pageOf : `${pageOf}:${detail}`);
  }

  function action(detail: unknown): void {
    if (typeof detail === 'string' && ACTION_RE.test(detail)) {
      stamp();
      addAction(mem, detail);
    }
  }

  function tap(): void {
    lastInputAt = d.now().getTime();
    stamp();
    if (current) addTap(mem, current);
    touchMinute(mem, d.now());
  }

  function input(): void {
    lastInputAt = d.now().getTime();
  }

  // Every 15 seconds: the time between two ticks goes to the current screen only while the
  // page is on show AND somebody did something in the last two minutes.
  function tick(): void {
    const nowMs = d.now().getTime();
    const elapsed = Math.min(30, Math.max(0, Math.round((nowMs - lastTickAt) / 1000)));
    lastTickAt = nowMs;
    // A tick that crosses midnight files the old counts under the old day first.
    stamp();
    if (!d.visible()) { commit(); return; }
    if (!d.online()) addOffline(mem, elapsed);
    if (current && nowMs - lastInputAt <= IDLE_MS) {
      addSeconds(mem, current, elapsed);
      touchMinute(mem, d.now());
      remember(current);
    }
    commit();
  }

  // Memory → the day's stored record. Needs an open venue; nothing is lost while there is none.
  // Every commit raises `rev`: a write is only called delivered if nothing changed since.
  function commit(): void {
    try {
      const storage = d.storage;
      if (!isReadySession(session) || !storage || isEmptyAcc(mem)) return;
      const key = storeKey(session.locationId, session.user.uid, memDay || dayKeyOf(d.now()));
      const stored = readJson(storage, key) as StoredRecord | null;
      const rec = {
        acc: cleanAcc(stored && stored.acc),
        dirty: true,
        // The time of the last ATTEMPT to send; a new record starts its clock now, so a short
        // visit does not write on its own.
        lastSentAt: finiteOr(stored && stored.lastSentAt, d.now().getTime()),
        rev: finiteOr(stored && stored.rev, 0) + 1,
      };
      mergeAcc(rec.acc, mem);
      if (writeJson(storage, key, rec)) { mem = newAcc(); memDay = null; }
    } catch (err) {
      warn(err);
    }
  }

  // Delete what is older than a week, whoever it belongs to.
  function prune(): void {
    try {
      const storage = d.storage;
      if (!storage) return;
      const oldest = new Date(d.now().getTime() - KEEP_DAYS * 86400000);
      const limit = dayKeyOf(oldest);
      for (const key of d.keys()) {
        if (key === LAST_KEY) continue;
        const parsed = parseStoreKey(key);
        if (parsed && parsed.dayKey < limit) storage.removeItem(key);
      }
    } catch (err) {
      warn(err);
    }
  }

  // The write came back (or was refused for good): the record is clean ONLY if nothing was added
  // while it was in flight, and a past day's record is then deleted.
  function settle(storage: KeyValueStorage, key: string, sentRev: number, past: boolean): void {
    try {
      const again = readJson(storage, key) as StoredRecord | null;
      if (!again) return;
      if (finiteOr(again.rev, 0) !== sentRev) return;
      if (past) storage.removeItem(key);
      else writeJson(storage, key, { ...again, dirty: false });
    } catch { /* it stays dirty: one more send, same document id */ }
  }

  // Sends what is due for the open session.
  //
  // ⚠️ ON 'hidden' NOTHING IS AWAITED before the write is handed over (the page may be gone
  // within milliseconds) and only today's record is sent; past days go on 'load' and 'timer'.
  // ⚠️ A RECORD IS CLEAN ONLY WHEN THE SERVER ANSWERED. Handing the write to the SDK proves
  // nothing: a page that is leaving dies before it reaches even the offline cache. So the
  // record stays dirty, `lastSentAt` is the time of the ATTEMPT (it bounds the retries to one
  // per ten minutes), and an offline write that never settles is simply sent again later — the
  // same document id, the whole document, so repeating it is harmless.
  async function flush(reason: FlushReason): Promise<FlushResult> {
    try {
      const storage = d.storage;
      if (!isReadySession(session) || !storage) return 'skipped';
      const openSession = session;
      const lid = openSession.locationId;
      const uid = openSession.user.uid;
      commit();
      const hidden = reason === 'hidden';
      const today = dayKeyOf(d.now());
      const mine = d.keys().map(parseStoreKey)
        .filter((p): p is StoreKeyParts => p !== null && p.lid === lid && p.uid === uid && (!hidden || p.dayKey === today));
      if (mine.length === 0) return 'nothing';
      const deviceId = d.deviceId();
      if (!deviceId) return 'no-device';
      const appVersion = hidden ? cachedVersion : await version();
      // Who is signed in NOW: the person may have left during the wait for the version.
      if (!sameSession(openSession, d.currentSession())) return 'skipped';
      let sent = 0;
      for (const p of mine) {
        const key = storeKey(p.lid, p.uid, p.dayKey);
        const rec = readJson(storage, key) as StoredRecord | null;
        if (!rec) continue;
        const past = p.dayKey < today;
        if (!rec.dirty) {
          if (past) { try { storage.removeItem(key); } catch { /* next time */ } }
          continue;
        }
        const nowMs = d.now().getTime();
        const since = nowMs - finiteOr(rec.lastSentAt, 0);
        const due = past
          ? (reason === 'load' || since >= SEND_EVERY_MS)
          : (since >= SEND_EVERY_MS || (hidden && since >= SEND_ON_HIDE_MS));
        if (!due) continue;
        const id = docId(deviceId, p.dayKey, p.uid);
        const payload = payloadOf(rec.acc, { deviceId, dayKey: p.dayKey, kind: d.kind(), appVersion });
        if (!id || !payload) continue;
        const sentRev = finiteOr(rec.rev, 0);
        // The attempt is stamped BEFORE the write: a page that dies mid-write still bounds the retries.
        if (!writeJson(storage, key, { ...rec, lastSentAt: nowMs })) continue;
        let sending: Promise<unknown>;
        try { sending = Promise.resolve(d.send(payload, id)); } catch (err) { sending = Promise.reject(err); }
        sent += 1;
        sending.then(() => settle(storage, key, sentRev, past), (err: unknown) => {
          // A refusal by the rules would only repeat itself: leave it be. A passing failure
          // (offline, busy) keeps the record dirty for the next attempt.
          if (isFinalRefusal(err)) settle(storage, key, sentRev, past);
          warn(err);
        });
      }
      return sent > 0 ? 'sent' : 'nothing';
    } catch (err) {
      warn(err);
      return 'failed';
    }
  }

  // What was counted so far belongs to whoever was signed in until now, never to the next person.
  function setSession(next: TelemetrySession | null | undefined): void {
    if (isReadySession(session)) commit();
    session = next;
    if (isReadySession(session)) {
      commit();
      // Asked now so a flush on hide already has it.
      void version();
    }
  }

  return {
    begin, view, action, tap, input, tick, commit, flush, prune, setSession, goTo, recordLoad,
    useCurrentSession: fn => { d.currentSession = fn; },
    pending: () => mem,
    current: () => current,
  };
}

// ── What Mise 2 adds around the tracker ─────────────────────────────────────────────────────

// Mise 2's own first paint: milliseconds since the page opened (performance.now() counts from
// there), taken the first time markLoaded() is called. null until then.
let loadedAtMs: number | null = null;
const loadWaiters = new Set<() => void>();

// Called by the session gate when the FIRST screen is up (the sign-in form, the venue picker, an
// error screen or the shell, whichever comes first: a visit that starts signed out must not count
// the time it takes to type a password). It is the load time the usage record keeps for
// the page «m2»; later calls change nothing.
export function markLoaded(): void {
  if (loadedAtMs !== null) return;
  loadedAtMs = performance.now();
  for (const waiter of [...loadWaiters]) {
    try { waiter(); } catch { /* never visible */ }
  }
}

// The shell calls this on every route change, with the id of the section now shown (`orders`,
// `recipes`, `more`, `settings`, `not-found`…); '' means the app's own front. Nothing is thrown
// where there is no window.
//
// ⚠️ THE RECORD ACCEPTS ONLY lower-case letters, digits, «:» and «-», and at most 40 characters
// for the whole name, «m2:» included: a section id must be 37 characters or fewer. Anything else
// is silently not counted, so a new section's id is checked when the section is added.
export function announceScreen(view: string): void {
  globalThis.window?.dispatchEvent(new CustomEvent(SCREEN_EVENT, { detail: view }));
}

// A key action, by a short lower-case name (`order-sent`…). Same rules as announceScreen.
export function announceAction(name: string): void {
  globalThis.window?.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: name }));
}

// The browser's own answers. `send` is the data layer's saveUsage (sinks.ts).
//
// Read when called, not when this file is imported: the specs import it without a browser.
export function browserUsageDeps(send: UsageDeps['send']): UsageDeps {
  const storage = browserStorage();
  return {
    storage,
    now: () => new Date(),
    keys: () => {
      try { return Object.keys(window.localStorage).filter(k => k.startsWith(STORE_PREFIX)); } catch { return []; }
    },
    visible: () => document.visibilityState !== 'hidden',
    online: () => navigator.onLine !== false,
    navigationMs: () => loadedAtMs,
    // Read, or made if this is the first time any file asks (the device count owns the id).
    deviceId: () => deviceIdFrom(storage, () => crypto.getRandomValues(new Uint8Array(64))),
    kind: browserDeviceKind,
    version: () => MISE2_VERSION,
    currentSession: () => null,
    send,
  };
}

export interface UsageStart {
  source: SessionSource;
  send: UsageDeps['send'];
  // Replaces single browser answers. For the specs; the app passes nothing.
  deps?: Partial<UsageDeps>;
}

// Starts counting: the page opens, the listeners go on, the ticks begin, the session is followed.
// Returns a function that undoes all of it (the specs use it; the app never needs to).
//
// ⚠️ THE WHOLE BODY IS IN A try: it runs while the app starts, and a throw here would stop the
// app drawing its first screen.
export function startUsage({ source, send, deps }: UsageStart): () => void {
  const stops: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const stop = (): void => {
    for (const undo of stops.splice(0, stops.length)) {
      try { undo(); } catch { /* nothing */ }
    }
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
  };
  try {
    const tracker = createTracker({
      ...browserUsageDeps(send),
      currentSession: () => source.getSnapshot(),
      ...deps,
    });
    tracker.begin(MISE2_PAGE);

    const on = (target: EventTarget, type: string, listener: (event: Event) => void, capture = false): void => {
      target.addEventListener(type, listener, capture ? { capture: true, passive: true } : { passive: true });
      stops.push(() => target.removeEventListener(type, listener, capture));
    };
    // Only the fact that something happened is used; what was touched is never read.
    on(window, 'pointerdown', () => tracker.tap(), true);
    on(window, 'keydown', () => tracker.input());
    on(window, 'wheel', () => tracker.input());
    on(window, 'scroll', () => tracker.input(), true);
    on(window, SCREEN_EVENT, event => tracker.view(MISE2_PAGE, (event as CustomEvent).detail));
    on(window, ACTION_EVENT, event => tracker.action((event as CustomEvent).detail));

    // The load time is known when the first screen is up, which may be before or after this.
    const noteLoad = (): void => tracker.recordLoad();
    loadWaiters.add(noteLoad);
    stops.push(() => { loadWaiters.delete(noteLoad); });
    noteLoad();

    const leaving = (): void => {
      tracker.tick();
      void tracker.flush('hidden');
    };
    const onVisibility = (): void => { if (document.visibilityState === 'hidden') leaving(); };
    document.addEventListener('visibilitychange', onVisibility);
    stops.push(() => document.removeEventListener('visibilitychange', onVisibility));
    window.addEventListener('pagehide', leaving);
    stops.push(() => window.removeEventListener('pagehide', leaving));

    const ticking = setInterval(() => tracker.tick(), TICK_MS);
    stops.push(() => clearInterval(ticking));
    // The ten-minute throttle inside flush decides whether anything is actually sent.
    const checking = setInterval(() => { void tracker.flush('timer'); }, FLUSH_CHECK_MS);
    stops.push(() => clearInterval(checking));

    const handle = (opened: TelemetrySession): void => {
      tracker.setSession(opened);
      if (!isReadySession(opened)) return;
      tracker.prune();
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (sameSession(opened, source.getSnapshot())) void tracker.flush('load');
      }, START_DELAY_MS);
      timers.add(timer);
    };
    // A store does not call back at once the way the current app's onSession() did.
    stops.push(source.subscribe(() => handle(source.getSnapshot())));
    handle(source.getSnapshot());
  } catch (err) {
    // Half a wiring would count some things and not others: undo what was done.
    stop();
    try { console.warn('Usage not started:', errorCode(err)); } catch { /* nothing */ }
  }
  return stop;
}
