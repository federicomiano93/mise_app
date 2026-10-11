// pastriesStore.ts — the seven day lists, tonight's confirmations and the records, for one venue.
//
// A port of js/pastries/pastries-store.js, js/pastries/pastries-logs-store.js and the lock half
// of js/pastries/pastries-main.js, decision for decision, as plain TypeScript with no React and
// no Firebase in it: the source (pastriesSource.ts) and the browser (deps) are injected, so every
// trap below is a spec with fakes (pastriesStore.spec.ts). Screens read it through
// PastriesContext.tsx (usePastries, usePastriesStore).
//
// It says nothing in words: a failure is a PastriesMessage, and the screen puts it in the
// person's language.

import {
  WEEKDAYS, daysFromCache, normalizeDay, normalizeDays, setQuantityAt,
} from '@mise/shared/pastries-model';
import type { PastryDay, PastryDays, PastryItem, Weekday } from '@mise/shared/pastries-model';
import { buildLog, normalizeLogs, workDate } from '@mise/shared/pastries-log-model';
import type { BuiltLog, PastryLog } from '@mise/shared/pastries-log-model';
import { confirmedDaysFrom, grantAfter, grantKeyFor, isDayLocked, msUntilWorkDayEnd } from '@mise/shared/pastries-lock';
import type { KeyValueStorage } from '../session/backend';
import type { PastriesSource, StoredDoc } from './pastriesSource';

// The local copy of the seven days, for an instant first paint and for working offline.
// ⚠️ THE CURRENT APP'S KEY, WITH ITS MEANING: both apps live on one origin and read each other's
// copy. It is NOT under KEEP_PREFIXES, so a sign-out or a venue switch wipes it and one venue's
// lists never follow somebody into another.
export const DAYS_CACHE_KEY = 'pastries-days';

export type PastriesMessage =
  | { readonly kind: 'save-failed'; readonly day: Weekday }
  | { readonly kind: 'days-stream-broken' }
  | { readonly kind: 'logs-stream-broken' }
  | { readonly kind: 'record-failed'; readonly day: Weekday }
  | { readonly kind: 'remove-failed' };

export interface PastriesSnapshot {
  // Always all seven.
  readonly days: PastryDays;
  // Whether the seven days have been answered for, live or from the device's own cache (or the
  // stream failed): until then `days` is only the local copy, which may be empty or old. An EMPTY
  // answer from the device's cache does not count, unless the local copy agreed the venue never had
  // a pastry (see believable() in the store).
  //
  // ⚠️ THE EDITOR WAITS FOR IT. It copies the day once, when it opens, and never repaints; opened by
  // its address (a reload, a bookmark) on a phone with no local copy, it would copy an EMPTY day and
  // a Save would write that over the real one.
  readonly daysLoaded: boolean;
  // Whether tonight's confirmations have been answered for (or the question failed) since the
  // watch last STARTED — at start, and again at every refresh (4am, the app coming back after it).
  // Until then `confirmed` is empty only because nobody has said otherwise, so `isLocked` cannot be
  // trusted to say «no».
  //
  // ⚠️ THE EDITOR WAITS FOR IT TOO. Opened by its address it has not come through the day panel's
  // gate, so it must know whether the day is recorded before it lets anybody type
  // (docs/parity/pastries.md, 23).
  readonly confirmedLoaded: boolean;
  // The lists confirmed for the work date being watched.
  readonly confirmed: ReadonlySet<Weekday>;
  // This phone's permission to change a confirmed list: the work date it was given on, or null.
  readonly grants: Readonly<Record<Weekday, string | null>>;
  // Every record read so far (Records filters them to the last fifteen days).
  readonly logs: readonly PastryLog[];
}

export interface PastriesDeps {
  // localStorage, or null when the browser will not give it (then nothing is remembered).
  readonly storage: KeyValueStorage | null;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  // Calls back whenever the app comes back to the foreground; returns the unsubscribe.
  onForeground(callback: () => void): () => void;
  warn(message: string, detail?: unknown): void;
}

export interface PastriesStore {
  getSnapshot(): PastriesSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: PastriesMessage) => void): () => void;
  // Starts the live days and tonight's confirmations; stop() ends everything, Records included.
  // Safe to call start → stop → start (React's development mode does exactly that).
  start(): void;
  stop(): void;
  saveDay(day: Weekday, items: readonly PastryItem[], note?: string): void;
  setItemQuantity(day: Weekday, index: number, name: string, qty: unknown): boolean;
  isLocked(day: Weekday): boolean;
  grantEdit(day: Weekday): void;
  tonightsRecord(day: Weekday): Promise<StoredDoc | null>;
  confirmDay(day: Weekday, items: readonly PastryItem[], note: string): Promise<BuiltLog | null>;
  startLogs(): void;
  stopLogs(): void;
  removeLog(id: string): Promise<boolean>;
}

function readGrants(storage: KeyValueStorage | null): Record<Weekday, string | null> {
  const out = {} as Record<Weekday, string | null>;
  for (const day of WEEKDAYS) {
    const key = grantKeyFor(day);
    let value: string | null = null;
    try { value = key && storage ? storage.getItem(key) : null; } catch { /* nothing remembered */ }
    out[day] = value;
  }
  return out;
}

export function createPastriesStore(source: PastriesSource, deps: PastriesDeps): PastriesStore {
  const { storage } = deps;

  function readCache(): PastryDays {
    try {
      const raw = storage?.getItem(DAYS_CACHE_KEY);
      // The tolerant reader also understands the cache shape from before the standing note.
      if (raw) return daysFromCache(JSON.parse(raw));
    } catch { /* corrupt or unavailable: start empty, the listener fills it in */ }
    return normalizeDays([]);
  }

  function writeCache(days: PastryDays): void {
    try { storage?.setItem(DAYS_CACHE_KEY, JSON.stringify(days)); } catch { /* full: memory still works */ }
  }

  function hasLocalCopy(): boolean {
    try {
      return storage !== null && storage.getItem(DAYS_CACHE_KEY) !== null;
    } catch {
      return false;   // blocked site data: no copy this phone can show
    }
  }

  const bootDays = readCache();
  // What this phone's own copy said when the store was made: whether there was one at all, and if
  // so whether it held no pastry on any day.
  const bootCopyEmpty = hasLocalCopy() && !WEEKDAYS.some(day => bootDays[day].items.length > 0);

  // ⚠️ A FROM-CACHE ANSWER WITH NO DOCUMENTS AT ALL IS «NOTHING KNOWN», NOT «NOTHING HERE».
  // Firestore says it about a list it has never fetched on this phone, once it decides it is offline
  // (about ten seconds without a signal) — so a new phone on bad Wi-Fi would open an empty editor,
  // and the Save, queued, would replace the real list when the signal came back (found in the
  // current app, 11 Oct 2026, PR #341). The seven documents are never deleted, so once any day has
  // been saved a real answer always holds documents: an empty one from the cache is believed only
  // when this phone's own copy agreed that the venue has never had a pastry. Otherwise it is
  // ignored — not even drawn, so it cannot wipe the copy on screen either — and the server's answer
  // is awaited (the source asks for metadata changes, so that answer arrives even when it is the
  // same nothing).
  function believable(docs: readonly StoredDoc[], fromCache: boolean): boolean {
    if (!fromCache) return true;
    if (docs.length > 0) return true;
    return bootCopyEmpty;
  }

  let snapshot: PastriesSnapshot = Object.freeze({
    days: bootDays,
    daysLoaded: false,
    confirmedLoaded: false,
    confirmed: new Set<Weekday>(),
    grants: readGrants(storage),
    logs: [],
  });
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: PastriesMessage) => void>();

  function update(partial: Partial<PastriesSnapshot>): void {
    snapshot = Object.freeze({ ...snapshot, ...partial });
    for (const listener of [...listeners]) listener();
  }

  function say(message: PastriesMessage): void {
    for (const listener of [...messageListeners]) listener(message);
  }

  // ── The seven days ────────────────────────────────────────────────────────────────────────

  let stopDays: (() => void) | null = null;

  function applyDay(day: Weekday, value: PastryDay): void {
    const days = { ...snapshot.days, [day]: value };
    writeCache(days);
    update({ days });
  }

  // Local-first: the screen changes at once and the write goes in the background. A refused
  // write puts the day back and says so — a row left on screen after a failed save looks like
  // the work is recorded.
  //
  // ⚠️ AN OMITTED NOTE KEEPS THE NOTE THERE; '' clears it. The day is written whole, so a caller
  // that only cares about the list would otherwise destroy a note somebody wrote.
  function saveDay(day: Weekday, items: readonly PastryItem[], note?: string): void {
    const previous = snapshot.days[day];
    const clean = normalizeDay({ items, note: note === undefined ? previous.note : note }, day);
    applyDay(day, { items: clean.items, note: clean.note });
    source.saveDay(day, clean.items, clean.note).catch(err => {
      deps.warn('Pastry day did not sync to Firestore:', err);
      applyDay(day, previous);
      say({ kind: 'save-failed', day });
    });
  }

  // ⚠️ THE PAYLOAD IS BUILT FROM THE LIST AS IT IS NOW, not as the screen drew it: minutes can
  // pass between drawing a row and tapping its tick, and another phone may have reordered the
  // list. false when the row is no longer the one typed into (index AND name).
  function setItemQuantity(day: Weekday, index: number, name: string, qty: unknown): boolean {
    const current = snapshot.days[day];
    const next = setQuantityAt(current.items, index, qty, name);
    if (!next) return false;
    saveDay(day, next, current.note);
    return true;
  }

  // ── Tonight's confirmations and the lock ──────────────────────────────────────────────────

  let stopConfirmed: (() => void) | null = null;
  let confirmationsSeq = 0;
  let watchedDate: string | null = null;
  let rollTimer: unknown = null;
  let stopForeground: (() => void) | null = null;

  // ⚠️ A FAILURE LEAVES NOTHING CONFIRMED, so nothing is locked: the worst case is the app as it
  // was before the lock existed. Locking on data nobody could read would leave somebody unable
  // to correct a list at 4am with nothing on screen to explain why. A failure still counts as an
  // answer for `confirmedLoaded`: nothing may wait for ever on a question that cannot be answered.
  function refreshConfirmations(): void {
    confirmationsSeq += 1;
    const mine = confirmationsSeq;
    stopConfirmed?.();
    watchedDate = workDate(deps.now());
    update({ confirmed: new Set(), confirmedLoaded: false, grants: readGrants(storage) });
    stopConfirmed = source.watchLogsForDate(
      watchedDate,
      docs => { if (mine === confirmationsSeq) update({ confirmed: confirmedDaysFrom(docs), confirmedLoaded: true }); },
      () => { if (mine === confirmationsSeq) update({ confirmed: new Set(), confirmedLoaded: true }); },
    );
  }

  // A confirmed list unlocks when the work date moves on at 4am; nothing about that is stored, so
  // all it takes is asking about the NEW date. A second past the boundary, so the clock has
  // certainly crossed it.
  function scheduleRoll(): void {
    if (rollTimer !== null) deps.clearTimer(rollTimer);
    rollTimer = null;
    const wait = msUntilWorkDayEnd(deps.now());
    if (wait === null) return;
    rollTimer = deps.setTimer(() => {
      rollTimer = null;
      refreshConfirmations();
      scheduleRoll();
    }, wait + 1000);
  }

  // ⚠️ THE TIMER ALONE IS NOT ENOUGH ON A PHONE: a tab in the background has its timers
  // throttled or stopped, so a phone in a pocket across 4am would come back still showing last
  // night as done. Checking on the way back costs nothing when the date has not moved.
  function onForeground(): void {
    if (watchedDate === workDate(deps.now())) return;
    refreshConfirmations();
    scheduleRoll();
  }

  // ⚠️ THE WORK DATE IS READ FROM THE CLOCK EVERY TIME, unlike the day the screen opens on: the
  // lock must release itself at 4am, while the list under somebody's finger must not jump.
  function isLocked(day: Weekday): boolean {
    return isDayLocked({
      confirmed: snapshot.confirmed.has(day),
      grant: snapshot.grants[day],
      workDate: workDate(deps.now()),
    });
  }

  function setGrant(day: Weekday, value: string | null): void {
    const key = grantKeyFor(day);
    if (!key) return;
    // In private mode both throw, and the day then simply stays locked: annoying, never harmful.
    try {
      if (value === null) storage?.removeItem(key);
      else storage?.setItem(key, value);
    } catch { /* nothing stored */ }
    update({ grants: { ...snapshot.grants, [day]: value } });
  }

  // The permission carries the work date, so 4am spends it — and so does the next Confirm.
  function grantEdit(day: Weekday): void {
    setGrant(day, grantAfter('edit', workDate(deps.now())));
  }

  // ── Records ───────────────────────────────────────────────────────────────────────────────

  let stopLogsWatch: (() => void) | null = null;
  let logsSeq = 0;

  // Up to 120 documents live, so only while Records is on screen: the day screen stays at seven
  // reads per opening (P14). A second start replaces the first.
  function startLogs(): void {
    stopLogs();
    const mine = logsSeq;
    stopLogsWatch = source.watchLogs(
      docs => { if (mine === logsSeq) update({ logs: normalizeLogs(docs) }); },
      () => { if (mine === logsSeq) say({ kind: 'logs-stream-broken' }); },
    );
  }

  function stopLogs(): void {
    logsSeq += 1;
    stopLogsWatch?.();
    stopLogsWatch = null;
  }

  // One read, only when Confirm is tapped: it lets the question say «tonight's record will be
  // replaced» truthfully. null when it cannot be established — then nothing is promised.
  async function tonightsRecord(day: Weekday): Promise<StoredDoc | null> {
    try {
      return await source.getLog(buildLog({ day, items: [], note: '', nowMs: deps.now() }).id);
    } catch (err) {
      deps.warn('Could not check for an existing record:', err);
      return null;
    }
  }

  // NOT optimistic: nothing shows as recorded until the write has landed — a record on screen
  // that does not exist is worse than none. Once it has landed the day is ticked off at once
  // (the listener would say the same a moment later), and the permission to edit is spent.
  async function confirmDay(day: Weekday, items: readonly PastryItem[], note: string): Promise<BuiltLog | null> {
    const nowMs = deps.now();
    const id = buildLog({ day, items, note, nowMs }).id;
    // Not narrowed to null by the compiler: it is assigned inside the transaction's callback.
    let saved = null as BuiltLog | null;
    try {
      await source.confirmLog(id, existing => {
        saved = buildLog({ day, items, note, nowMs, existing });
        return saved;
      });
    } catch (err) {
      deps.warn('Pastry record did not save:', err);
      say({ kind: 'record-failed', day });
      return null;
    }
    update({ confirmed: new Set([...snapshot.confirmed, day]) });
    setGrant(day, grantAfter('confirm'));
    return saved;
  }

  async function removeLog(id: string): Promise<boolean> {
    try {
      await source.deleteLog(id);
      return true;
    } catch (err) {
      deps.warn('Pastry record did not delete:', err);
      say({ kind: 'remove-failed' });
      return false;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },
    start() {
      stopDays?.();
      stopDays = source.watchDays(
        (docs, fromCache) => {
          if (!believable(docs, fromCache)) return;
          const days = normalizeDays(docs);
          writeCache(days);
          update({ days, daysLoaded: true });
        },
        // A stream that dies before it ever answered must not keep the editor waiting for ever: the
        // local copy is all there is, and the notice says the list may be out of date.
        () => {
          update({ daysLoaded: true });
          say({ kind: 'days-stream-broken' });
        },
      );
      refreshConfirmations();
      scheduleRoll();
      stopForeground?.();
      stopForeground = deps.onForeground(onForeground);
    },
    stop() {
      stopDays?.();
      stopDays = null;
      confirmationsSeq += 1;
      stopConfirmed?.();
      stopConfirmed = null;
      if (rollTimer !== null) deps.clearTimer(rollTimer);
      rollTimer = null;
      stopForeground?.();
      stopForeground = null;
      stopLogs();
    },
    saveDay,
    setItemQuantity,
    isLocked,
    grantEdit,
    tonightsRecord,
    confirmDay,
    startLogs,
    stopLogs,
    removeLog,
  };
}

// The browser's own answers.
export function browserPastriesDeps(): PastriesDeps {
  let storage: KeyValueStorage | null = null;
  try { storage = window.localStorage; } catch { /* blocked site data */ }
  return {
    storage,
    now: () => Date.now(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: handle => window.clearTimeout(handle as number),
    onForeground(callback) {
      const listener = () => { if (document.visibilityState === 'visible') callback(); };
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    warn: (message, detail) => console.warn(message, detail),
  };
}
