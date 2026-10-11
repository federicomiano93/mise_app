// stocktakeStore.ts — the month being counted, and the ingredients there are to count, for one venue.
//
// A port of js/inventory/inventory-store.js, decision for decision, as plain TypeScript with no
// React and no Firebase in it: the source (stocktakeSource.ts) and the browser (deps) are injected,
// so every trap below is a spec with fakes (stocktakeStore.spec.ts). Screens read it through
// StocktakeContext.tsx.
//
// It says nothing in words: a failure is a StocktakeMessage, and the screen puts it in the
// person's language.
//
// ⚠️ WRITES ARE LOCAL-FIRST AND DELIBERATELY NOT ROLLED BACK. Everywhere else a refused write is
// undone; here that would delete a number somebody has just walked across a storeroom to read,
// which is the one thing this screen must never do. The count stays on screen and in the local
// copy, the failure is said out loud, and the unsent change waits in the outbox
// (@mise/shared/inventory-outbox) to go with the next save.
//
// ⚠️ WHICH IS WHY NOTHING THE SCREEN DOES WAITS FOR A SERVER. A Firestore write does not settle
// until it reaches one, and with the offline cache that can be hours — see settled() below. The
// count is safe in the browser's own database long before it is confirmed.
//
// ⚠️ ONE DIFFERENCE FROM THE ORIGINAL, ON PURPOSE (docs/parity/stocktake.md): Mise 2 never reloads
// to change month, so the store watches one month at a time and openMonth() moves it; and a count
// is refused until the month has answered once (live, or from the device's own copy), so nothing
// can be typed into a month that turns out to be closed.

import {
  COUNT_MAPS, carryOver, isClosed, isMonthId, monthBounds, nextMonth, normalizeMonth, readCount, toDocument,
} from '@mise/shared/inventory-model';
import type { CountMap, InventoryMonth } from '@mise/shared/inventory-model';
import {
  EMPTY_OUTBOX, answered, applyOver, echoed, hasHeld, hasUnsaved, hasWork, isSending, release, revive,
  stage, stageMany, take, unsaved,
} from '@mise/shared/inventory-outbox';
import type { Outbox } from '@mise/shared/inventory-outbox';
import { purchasesInMonth } from '@mise/shared/inventory-purchases';
import type { KeyValueStorage } from '../session/backend';
import type { StocktakeSource, StoredDoc } from './stocktakeSource';

// How long after the last change a count is sent. Long enough that typing «12» is one write and
// not two, short enough that putting the phone down saves.
export const SAVE_DELAY_MS = 700;

// The longest the SCREEN may wait for a sequence of writes before carrying on regardless.
export const SETTLE_MS = 1200;

// ⚠️ THE CURRENT APP'S KEY, WITH ITS MEANING (both apps share one origin), and THE VENUE IS IN IT:
// one phone can hold two businesses. Not under KEEP_PREFIXES, so a venue switch wipes it.
export function monthCacheKey(locationId: string, monthId: string): string {
  return `inventory-${locationId || 'none'}-${monthId}`;
}

// ⚠️ THE CURRENT APP'S KEY TOO, FOR THE SAME REASON: what was typed here and is not yet in the
// browser's own database (keepUnsaved below). Either app may open the month next, and each must
// find the other's copy. The venue is in it; not under KEEP_PREFIXES either, so a venue switch
// wipes it.
export function unsavedCacheKey(locationId: string, monthId: string): string {
  return `inventory-unsaved-${locationId || 'none'}-${monthId}`;
}

export type StocktakeMessage =
  // A write was refused or failed: the count is still here and goes up with the next save.
  | { readonly kind: 'not-saved-yet' }
  // The month's live stream died. For whoever runs the place a notice; for an employee it is the
  // rules keeping a closed (or priced) month from them, and the screen says that instead.
  | { readonly kind: 'month-stream-broken' };

export interface StocktakeSnapshot {
  // The month the data below is about. A screen whose address names another month is still waiting.
  readonly monthId: string | null;
  // Always the full shape (every map present), never null once a month is open.
  readonly month: InventoryMonth | null;
  // Whether the month has answered once — live, from the device's own copy, or by failing. Until
  // then a count is refused (see the header).
  readonly monthLoaded: boolean;
  // The month's stream failed (for an employee: the rules refused it).
  readonly monthFailed: boolean;
  // The venue's ingredients with their prices laid on (empty prices for an employee).
  readonly ingredients: readonly StoredDoc[];
  // Whether the ingredients have answered once (or failed): until then the list says «Loading…».
  readonly ingredientsLoaded: boolean;
  // Counts typed here that Firestore has not confirmed yet (waiting, or in the air). While true the
  // section holds the session's busy marker, so a self-started reload never cuts a write short.
  readonly unsent: boolean;
}

export type ProposedPurchases = {
  readonly totals: Readonly<Record<string, number>>;
  readonly orders: number;
  readonly products: number;
  readonly unconverted: readonly string[];
  readonly failed: boolean;
};

// How closing a month ended. ⚠️ THE STORE SAYS WHETHER IT DID ANYTHING, because the screen must not
// announce — to the person or to the usage record — a close that never happened: another phone can
// close the month while this phone's question is still open, and a store that has refused wrote
// nothing.
export type CloseResult =
  // Nothing was written: the month is closed already, has not answered yet, or is no longer the one
  // being watched.
  | { readonly refused: true }
  // Closed. `opened` is the id of the month that was opened after it, or null when there was nothing
  // to carry into one.
  | { readonly refused: false; readonly opened: string | null };

// What closing a month freezes into it (stocktakeModel.ts frozenFor works it out from the screen's rows).
export type Frozen = {
  readonly names: Readonly<Record<string, string>>;
  readonly unitPrice: Readonly<Record<string, number>>;
  readonly packKg: Readonly<Record<string, number>>;
};

export interface StocktakeDeps {
  // localStorage, or null when the browser will not give it (then nothing is remembered).
  readonly storage: KeyValueStorage | null;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  // Calls back when the page is being hidden or left; returns the unsubscribe.
  onHide(callback: () => void): () => void;
  warn(message: string, detail?: unknown): void;
}

export interface StocktakeStore {
  getSnapshot(): StocktakeSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: StocktakeMessage) => void): () => void;
  // Starts the ingredients; stop() ends everything after handing what is unsent to Firestore.
  // Safe to call start → stop → start (React's development mode does exactly that).
  start(): void;
  stop(): void;
  // Watches this month (the one in the address). Leaving the previous one hands its unsent counts
  // to Firestore first, never waiting for the server.
  openMonth(monthId: string): void;
  // One box. `value` is what was typed; empty CLEARS the entry, never stores a zero. false when
  // refused (no month, not answered yet, closed, not a count map).
  setCount(map: CountMap, ingredientId: string, value: unknown): boolean;
  // Sends what is waiting. Resolves when the WRITE does — offline, never; see flushBeforeLeaving.
  flush(): Promise<void>;
  // Sends what is waiting and answers within SETTLE_MS whatever the network is doing.
  flushBeforeLeaving(): Promise<void>;
  // Closes the month; the answer tells a close that happened (and the new month's id, opened with
  // this one's closings, or null) from one that was refused and wrote nothing.
  closeMonth(frozen: Frozen): Promise<CloseResult>;
  reopenMonth(): Promise<void>;
  readProposedPurchases(): Promise<ProposedPurchases>;
  // How many products were filled in.
  applyPurchases(totals: Readonly<Record<string, unknown>>): number;
  // How many opening figures were carried; 0 for «that month has nothing»; null for «I could not
  // read it» — three answers, never two.
  pullOpeningFromPrevious(previousId: string): Promise<number | null>;
}

// One month's working state. The store holds one at a time; a month that is left keeps its own
// closure long enough for its last write to answer.
type MonthSession = {
  readonly id: string;
  month: InventoryMonth;
  outbox: Outbox;
  saveTimer: unknown;
  // The writes in the air, each one settling (never rejecting) once Firestore has answered it —
  // which with no signal is never.
  inAir: Set<Promise<void>>;
  // Whether Firestore has answered at all yet; until then the local copy is all there is.
  remoteArrived: boolean;
  // The month exactly as Firestore last sent it, before anything of this phone's was laid over it —
  // so the screen can be drawn again once the writes have answered. null until it has answered, and
  // while the document does not exist.
  lastRemote: StoredDoc | null;
  stopWatch: (() => void) | null;
  // Ends the listening of a month that was left, if the SDK has not shown its last write back by then.
  watchTimer: unknown;
  // The month's stream died (the rules refused it, or it could not start): nothing will be heard
  // again, so what was last heard is out of date for good.
  streamFailed: boolean;
  // Still the month on screen: a left month keeps writing, but never touches the snapshot.
  current: boolean;
};

// ⚠️ THE NEWEST SESSION OF A MONTH OWNS ITS UNSAVED COPY (keepUnsaved) — module-level, not per store:
// leaving the Stocktake and coming back builds a NEW store while the old one's sessions still have
// writes in the air, and an old session's late answer knows nothing of what the newer one holds (it
// would put a count the newer session has since corrected back in the copy, to be sent over the
// correction on the server's word). Keyed by the storage first: two storages never share an owner.
const unsavedOwner = new WeakMap<KeyValueStorage, Map<string, MonthSession>>();

function wait(deps: StocktakeDeps, ms: number): Promise<void> {
  return new Promise(resolve => { deps.setTimer(resolve, Math.max(0, ms)); });
}

export function createStocktakeStore(source: StocktakeSource, locationId: string, deps: StocktakeDeps): StocktakeStore {
  const { storage } = deps;

  let snapshot: StocktakeSnapshot = Object.freeze({
    monthId: null,
    month: null,
    monthLoaded: false,
    monthFailed: false,
    ingredients: [],
    ingredientsLoaded: false,
    unsent: false,
  });
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: StocktakeMessage) => void>();

  function update(partial: Partial<StocktakeSnapshot>): void {
    snapshot = Object.freeze({ ...snapshot, ...partial });
    for (const listener of [...listeners]) listener();
  }

  function say(message: StocktakeMessage): void {
    for (const listener of [...messageListeners]) listener(message);
  }

  // ── Waiting, without waiting for a server ─────────────────────────────────────────────────

  // ⚠️⚠️ A FIRESTORE WRITE DOES NOT SETTLE UNTIL IT REACHES THE SERVER. Under the offline cache a
  // write made with no signal is already durable (the SDK sends it when there is signal) but its
  // promise never settles, so anything the SCREEN waits on also waits against a clock. ONE
  // deadline for a whole sequence, not one per write: closing answers in a second and a bit.
  function settled(promise: Promise<unknown>, deadline: number): Promise<unknown> {
    return Promise.race([promise, wait(deps, deadline - deps.now())]);
  }

  function deadlineFromNow(): number {
    return deps.now() + SETTLE_MS;
  }

  // A write whose confirmation nobody waits for: it reports a failure and never rejects, so it
  // cannot become an unhandled rejection either.
  function queued(promise: Promise<void>): Promise<void> {
    return promise.catch(err => {
      deps.warn('The stocktake did not reach Firestore:', err);
      say({ kind: 'not-saved-yet' });
    });
  }

  // The month being watched. A month that was left keeps its own MonthSession until its last write
  // answers, so this is not always the one a function was handed.
  let session: MonthSession | null = null;

  // ── The local copy ─────────────────────────────────────────────────────────────────────────

  function readCache(monthId: string): InventoryMonth | null {
    try {
      const raw = storage?.getItem(monthCacheKey(locationId, monthId));
      if (raw) return normalizeMonth(JSON.parse(raw), monthId);
    } catch { /* corrupt or unavailable: the listener fills it in */ }
    return null;
  }

  function writeCache(session: MonthSession): void {
    try {
      storage?.setItem(monthCacheKey(locationId, session.id), JSON.stringify(toDocument(session.month)));
    } catch { /* storage full or unavailable: memory still works this session */ }
  }

  // What a page that was torn down left behind (keepUnsaved), or nothing.
  function readUnsaved(monthId: string): unknown {
    try {
      const raw = storage?.getItem(unsavedCacheKey(locationId, monthId));
      if (raw) return JSON.parse(raw);
    } catch { /* corrupt or unavailable: nothing was left */ }
    return null;
  }

  // ⚠️⚠️ WHAT EXISTS ONLY IN THIS PAGE'S MEMORY IS WRITTEN DOWN AT ONCE, on every change to the
  // outbox. A write handed to Firestore reaches the browser's own database a moment later, and a page
  // torn down inside that moment — the last number typed and the back gesture straight after — took
  // the number with it (emulator, 11 Oct 2026). localStorage is written before the call returns; the
  // copy is laid back in when the month is next opened (openSession), and removed once a snapshot has
  // shown every number back.
  // ⚠️ NOT the month copy above: the first snapshot rewrites that one, which is exactly how the
  // counts used to vanish.
  // ⚠️ A MONTH THAT WAS LEFT AND OPENED AGAIN LEAVES THE COPY TO THE NEWER SESSION (Mise 2 only: the
  // current app reloads to change month). The newer one took everything the older one had handed over
  // when it opened (openSession); the older one's late answers know nothing of what has been typed
  // since, and would erase it or put back what has been corrected. Only the owner writes.
  function keepUnsaved(s: MonthSession): void {
    if (!storage || unsavedOwner.get(storage)?.get(unsavedCacheKey(locationId, s.id)) !== s) return;
    try {
      const key = unsavedCacheKey(locationId, s.id);
      if (hasUnsaved(s.outbox)) storage.setItem(key, JSON.stringify(unsaved(s.outbox)));
      else storage.removeItem(key);
    } catch { /* storage full or unavailable: the SDK's own queue still has every write */ }
  }

  // This session is now the newest of its month: from here on it alone writes the unsaved copy.
  function claimUnsaved(s: MonthSession): void {
    if (!storage) return;
    let owners = unsavedOwner.get(storage);
    if (!owners) {
      owners = new Map();
      unsavedOwner.set(storage, owners);
    }
    owners.set(unsavedCacheKey(locationId, s.id), s);
  }

  // ── One month ──────────────────────────────────────────────────────────────────────────────

  // Held is NOT unsent: it is already in localStorage and goes only on the server's word.
  function publish(s: MonthSession, extra: Partial<StocktakeSnapshot> = {}): void {
    if (!s.current) return;
    update({ month: s.month, unsent: hasWork(s.outbox) || isSending(s.outbox), ...extra });
  }

  function emptyMonth(monthId: string): InventoryMonth {
    // A month id that passed isMonthId always normalises.
    return normalizeMonth({ month: monthId }) as InventoryMonth;
  }

  // The month with its count maps copied, to lay the outbox over: applyOver writes into the maps it
  // is given, and the ones on screen belong to a snapshot already published.
  function withCountsCopied(month: InventoryMonth): InventoryMonth {
    const copy = { ...month };
    for (const map of COUNT_MAPS) copy[map] = { ...month[map] };
    return copy;
  }

  // A fresh copy of the month as Firestore last sent it.
  function remoteMonth(s: MonthSession): InventoryMonth {
    return normalizeMonth(s.lastRemote, s.id) ?? emptyMonth(s.id);
  }

  // The month on screen = what Firestore last sent + what this phone has not had confirmed yet.
  //
  // ⚠️ A REMOTE CHANGE NEVER DISCARDS WHAT HAS NOT BEEN SENT: the local values of still-unsent
  // boxes (held, waiting AND in the air) are laid back over the incoming document.
  // ⚠️⚠️ EXCEPT OVER A CLOSED MONTH. It is shown as it was closed, and what this phone still holds
  // for it stays held — not drawn, not sent (flushSession) — until the month is reopened. Otherwise a
  // count left on one phone would change a closed month's figures weeks later, after the next month
  // had already copied them (code review, 11 Oct 2026). The SDK has already laid its own unanswered
  // writes into `remote`.
  // ⚠️ ONLY THE WATCH CALLBACK SAYS WHETHER THE MONTH HAS LOADED OR FAILED (`extra`): a redraw after
  // the last write has answered draws, and touches neither flag.
  function adopt(s: MonthSession, extra: Partial<StocktakeSnapshot> = {}): void {
    const merged = remoteMonth(s);
    if (!isClosed(merged)) applyOver(s.outbox, merged, COUNT_MAPS);
    s.month = merged;
    writeCache(s);
    publish(s, extra);
  }

  // A month that was left stops being listened to.
  function stopWatching(s: MonthSession): void {
    if (s.watchTimer !== null) deps.clearTimer(s.watchTimer);
    s.watchTimer = null;
    s.stopWatch?.();
    s.stopWatch = null;
  }

  // ⚠️⚠️ WHAT AN EARLIER VISIT LEFT GOES ONLY ONCE THE SERVER SAYS THE MONTH IS OPEN — never on the
  // strength of this phone's own copy, which can be days old. Driven on the emulator (11 Oct 2026): a
  // count left on the phone, the month closed from another device, the phone back online — sent at
  // once from its stale copy, the count landed in the closed month. Sending one that did reach
  // Firestore after all writes the same number twice and loses nothing.
  function releaseHeld(s: MonthSession): void {
    if (!hasHeld(s.outbox) || isClosed(s.month)) return;
    s.outbox = release(s.outbox);
    keepUnsaved(s);
    scheduleSave(s);
    publish(s);
  }

  function openSession(monthId: string): MonthSession {
    // ⚠️ THE LOCAL COPY IS PAINTED FIRST — the venue is known when this store is made, so the
    // original's «read it only once the venue is open» wait is built in. It is the only thing there
    // is until Firestore answers.
    const s: MonthSession = {
      id: monthId,
      month: readCache(monthId) ?? emptyMonth(monthId),
      outbox: EMPTY_OUTBOX,
      saveTimer: null,
      inAir: new Set(),
      remoteArrived: false,
      lastRemote: null,
      stopWatch: null,
      watchTimer: null,
      streamFailed: false,
      current: true,
    };
    // Then what the page last torn down left behind, laid back over it as HELD: on screen and kept,
    // NOT SENT from here (releaseHeld says why). Not over a month known to be closed (adopt says
    // why): kept for its reopening. From here on this session owns that copy (claimUnsaved).
    claimUnsaved(s);
    s.outbox = revive(s.outbox, readUnsaved(monthId), COUNT_MAPS);
    keepUnsaved(s);
    if (hasHeld(s.outbox) && !isClosed(s.month)) {
      const shown = withCountsCopied(s.month);
      applyOver(s.outbox, shown, COUNT_MAPS);
      s.month = shown;
      writeCache(s);
    }
    s.stopWatch = source.watchMonth(
      monthId,
      (remote, meta) => {
        s.remoteArrived = true;
        s.lastRemote = remote;
        // ⚠️ WHAT THE SNAPSHOT SHOWS BACK is in the browser's database: no longer only in this page's
        // memory. Judged on the document AS IT ARRIVED, before anything is laid over it.
        s.outbox = echoed(s.outbox, remoteMonth(s), COUNT_MAPS);
        keepUnsaved(s);
        // ⚠️ A MONTH THAT WAS LEFT IS LISTENED TO ONLY UNTIL THE SDK HAS SHOWN ITS LAST WRITE BACK
        // (leave): that settles the unsaved copy and nothing else. It draws nothing, and it never
        // sends what is held — the month on screen now is another one's to say.
        if (!s.current) {
          if (!hasUnsaved(s.outbox)) stopWatching(s);
          return;
        }
        s.streamFailed = false;
        adopt(s, { monthLoaded: true, monthFailed: false });
        // Released by a snapshot the server sent, never by the phone's own copy.
        if (meta?.fromServer) releaseHeld(s);
      },
      () => {
        s.streamFailed = true;
        // A stream that dies before it ever answered must not keep the boxes shut for ever: the
        // local copy is all there is, and the notice (or, for an employee, the sentence) says why.
        publish(s, { monthLoaded: true, monthFailed: true });
        if (s.current) say({ kind: 'month-stream-broken' });
      },
    );
    return s;
  }

  function scheduleSave(s: MonthSession): void {
    if (s.saveTimer !== null) deps.clearTimer(s.saveTimer);
    s.saveTimer = deps.setTimer(() => {
      s.saveTimer = null;
      void flushSession(s);
    }, SAVE_DELAY_MS);
  }

  // Send everything that has changed, as ONE write so a count and a cleared box beside it can
  // never half-land. Answers when every write sent so far has answered — which with no signal is
  // never, hence flushBeforeLeaving().
  //
  // ⚠️⚠️ IT NEVER WAITS FOR AN EARLIER WRITE. It used to keep one write in the air and hold every
  // later count in memory behind it; with no signal that write never answers, so only the FIRST count
  // of a storeroom reached the SDK's own queue — the one in the browser's database, which outlasts the
  // page. Closing the app, changing month or going Home before signal lost all the others (found 11
  // Oct 2026, reproduced on the emulator: three counts typed, one survived). Handed over at once,
  // every count is in that queue and goes up, in order, when there is signal. The outbox keeps the
  // books for several writes at once: nothing is settled until the LAST one has answered, or the
  // first answer would confirm values another write still carries (answered() in
  // @mise/shared/inventory-outbox).
  //
  // ⚠️⚠️ NOTHING IS SENT INTO A CLOSED MONTH, the same promise setCount() keeps: what is waiting stays
  // waiting until the month is reopened (adopt says why).
  function flushSession(s: MonthSession): Promise<void> {
    if (s.saveTimer !== null) deps.clearTimer(s.saveTimer);
    s.saveTimer = null;
    if (hasWork(s.outbox) && !isClosed(s.month)) send(s);
    return Promise.all([...s.inAir]).then(() => {});
  }

  function send(s: MonthSession): void {
    const taken = take(s.outbox);
    s.outbox = taken.outbox;
    keepUnsaved(s);

    const nowIso = new Date(deps.now()).toISOString();
    const patch: Record<string, unknown> = { month: s.id, updatedAt: nowIso };
    if (!s.month.createdAt) {
      s.month = { ...s.month, createdAt: nowIso };
      patch.createdAt = nowIso;
    }
    for (const [map, values] of Object.entries(taken.values)) patch[map] = { ...values };

    let sent: Promise<void>;
    try {
      sent = source.saveMonthFields(s.id, patch, taken.clear);
    } catch (err) {
      sent = Promise.reject(err);
    }
    const write: Promise<void> = sent.then(
      () => true,
      err => {
        deps.warn('The stocktake did not reach Firestore:', err);
        say({ kind: 'not-saved-yet' });
        return false;
      },
    ).then(ok => {
      // ⚠️ NOT A PUT-BACK, AND NOT SETTLED ON THIS ANSWER ALONE: a failed write goes back behind
      // anything typed since, and only when the last write in the air has answered
      // (@mise/shared/inventory-outbox answered()).
      s.outbox = answered(s.outbox, ok);
      keepUnsaved(s);
      s.inAir.delete(write);
      // Every write has answered: nothing of this phone's is in the air any more, so the screen is
      // drawn again from what Firestore last sent. Until now its own numbers were laid over that,
      // hiding a correction another phone made meanwhile (code review, 11 Oct 2026). ⚠️ NOT FOR A
      // MONTH THAT WAS LEFT: it is not on screen, and what it last heard may be older than its own
      // write, so drawing from that would put a stale month in its local copy. ⚠️ NOR AFTER THE STREAM
      // DIED: nothing will be heard again, so what was last heard is out of date for good (an employee's
      // month that a manager has just closed would come back open, and typable).
      if (s.current && !s.streamFailed && !isSending(s.outbox) && s.lastRemote !== null) adopt(s);
      publish(s);
    });
    s.inAir.add(write);
    publish(s);
  }

  function leave(s: MonthSession): void {
    s.current = false;
    // Handed to Firestore now; nobody waits for the answer (no signal in a storeroom).
    void flushSession(s);
    // ⚠️ BUT STILL LISTENED TO until the SDK has shown the batch just handed over back (its handler
    // settles the unsaved copy) or SETTLE_MS has passed, whichever is first — the SDK shows a write
    // only after its own database has it, a moment after this call. Stopped at once, the copy keeps
    // that batch as unseen, the month opened again lays it back as held, and it is sent a second time.
    if (s.stopWatch && hasUnsaved(s.outbox)) {
      s.watchTimer = deps.setTimer(() => {
        s.watchTimer = null;
        stopWatching(s);
      }, SETTLE_MS);
    } else {
      stopWatching(s);
    }
  }

  // ── The ingredients ────────────────────────────────────────────────────────────────────────

  let stopIngredients: (() => void) | null = null;
  let stopHide: (() => void) | null = null;
  let ingredientsSeq = 0;

  function openMonth(monthId: string): void {
    if (!isMonthId(monthId)) return;
    if (session?.id === monthId && session.current) return;
    if (session) leave(session);
    session = openSession(monthId);
    update({ monthId, month: session.month, monthLoaded: false, monthFailed: false, unsent: false });
  }

  // ⚠️⚠️ A CLOSED MONTH REFUSES EVERY CHANGE, AND THIS IS THE ONLY PLACE THAT CAN GUARANTEE IT. The
  // screen shuts the boxes too, but the rules cannot tell a count from the write that reopens a
  // month: «closed» is a promise the app makes about figures other people read, kept here.
  function writable(): MonthSession | null {
    const s = session;
    if (!s || !s.current || !snapshot.monthLoaded || isClosed(s.month)) return null;
    return s;
  }

  function setCount(map: CountMap, ingredientId: string, value: unknown): boolean {
    const s = writable();
    if (!s || !COUNT_MAPS.includes(map) || !ingredientId) return false;
    const n = readCount(value);
    const values = { ...s.month[map] };
    if (n === null) delete values[ingredientId];
    else values[ingredientId] = n;
    s.month = { ...s.month, [map]: values };
    s.outbox = stage(s.outbox, map, ingredientId, n);
    keepUnsaved(s);
    writeCache(s);
    scheduleSave(s);
    publish(s);
    return true;
  }

  function flush(): Promise<void> {
    return session ? flushSession(session) : Promise.resolve();
  }

  // ⚠️ FOR THE CALLER THAT IS ABOUT TO GO ELSEWHERE: flush() answers when the WRITE does, which
  // with no signal is never; this answers within the bound. The count is safe either way.
  async function flushBeforeLeaving(): Promise<void> {
    await settled(flush(), deadlineFromNow());
  }

  // Close the month: stamp it, freeze what it was worth, and open the next one with this one's
  // closing counts as its opening.
  //
  // ⚠️ THE NEXT MONTH IS WRITTEN FIRST. The other way round, a failure of the second write leaves
  // this month closed and the next one missing — and its openings only ever existed as this month's
  // closings. This order fails towards «closed nothing, lost nothing». It is the order of SENDING
  // that matters: offline neither write is confirmed, and the SDK sends them in the order made.
  async function closeMonth(frozen: Frozen): Promise<CloseResult> {
    // Only an open month that has answered: closing it twice would freeze today's prices over the
    // ones it was closed with (the original leaves this to the screen; here the store says no too).
    const s = writable();
    if (!s) return { refused: true };
    const deadline = deadlineFromNow();
    const nowIso = new Date(deps.now()).toISOString();
    // ⚠️ WHAT IS HELD GOES FIRST. It is on screen, so the next month's opening is copied from it
    // below; closing here is this phone's own word that the month was open — unsent, the closed month
    // and the next one's opening would disagree, and the closed month would show those products as
    // not counted (code review, 11 Oct 2026).
    s.outbox = release(s.outbox);
    keepUnsaved(s);
    await settled(flushSession(s), deadline);

    const next = carryOver(s.month, nextMonth(s.id), nowIso);
    if (next) {
      await settled(queued(source.saveMonthFields(next.month, {
        month: next.month,
        opening: next.opening,
        packKg: next.packKg,
        createdAt: nowIso,
        updatedAt: nowIso,
      })), deadline);
    }

    const patch = {
      month: s.id,
      closedAt: nowIso,
      updatedAt: nowIso,
      names: { ...frozen.names },
      unitPrice: { ...frozen.unitPrice },
      packKg: { ...frozen.packKg },
    };
    await settled(queued(source.saveMonthFields(s.id, patch)), deadline);
    s.month = { ...s.month, closedAt: nowIso, names: patch.names, unitPrice: patch.unitPrice, packKg: patch.packKg };
    writeCache(s);
    publish(s);
    return { refused: false, opened: next ? next.month : null };
  }

  // Unfreeze a month closed too early. ⚠️ IT DOES NOT UNDO THE NEXT MONTH: its openings were COPIED
  // out of this one, so correcting this one changes nothing there — the dialog says so.
  async function reopenMonth(): Promise<void> {
    const s = session;
    if (!s || !s.current) return;
    const nowIso = new Date(deps.now()).toISOString();
    await settled(
      queued(source.saveMonthFields(s.id, { month: s.id, closedAt: '', updatedAt: nowIso })),
      deadlineFromNow(),
    );
    s.month = { ...s.month, closedAt: '' };
    // What this phone was holding while the month was closed comes back, and goes: reopened here,
    // this phone has just told the server so.
    s.outbox = release(s.outbox);
    keepUnsaved(s);
    if (hasWork(s.outbox)) {
      const shown = withCountsCopied(s.month);
      applyOver(s.outbox, shown, COUNT_MAPS);
      s.month = shown;
      scheduleSave(s);
    }
    writeCache(s);
    publish(s);
  }

  // What the orders already recorded say was bought this month. ⚠️ IT READS, IT DOES NOT WRITE:
  // nothing moves until applyPurchases(), so the screen can ask first. ⚠️ A FAILURE IS «type it
  // yourself», not an error: the orders belong to another section a venue may not use at all.
  async function readProposedPurchases(): Promise<ProposedPurchases> {
    const none: ProposedPurchases = { totals: {}, orders: 0, products: 0, unconverted: [], failed: false };
    const s = session;
    if (!s) return none;
    const bounds = monthBounds(s.id);
    if (!bounds) return none;
    try {
      const records = await source.getOrdersInMonth(bounds.from, bounds.to);
      // The PRICED ingredients: a case of packages (what lets a «busta» line count in «cartone»)
      // is stored in the price document, which the ingredients already carry.
      const byId = Object.fromEntries(snapshot.ingredients.map(i => [i.id, i]));
      return { ...purchasesInMonth(records, s.id, byId), failed: false };
    } catch (err) {
      deps.warn('Could not read the orders of this month:', err);
      return { ...none, failed: true };
    }
  }

  // ⚠️ IT REPLACES THE WHOLE `purchased` MAP, clearing what the orders no longer account for — a
  // figure left from an earlier proposal would otherwise sit there with nothing to explain it. The
  // dialog says so before this runs.
  function applyPurchases(totals: Readonly<Record<string, unknown>>): number {
    const s = writable();
    if (!s || !totals) return 0;
    const wanted: Record<string, number> = {};
    for (const [id, value] of Object.entries(totals)) {
      const n = readCount(value);
      if (n !== null && n > 0) wanted[id] = n;
    }
    const gone = Object.keys(s.month.purchased).filter(id => !(id in wanted));
    s.month = { ...s.month, purchased: { ...wanted } };
    s.outbox = stageMany(s.outbox, 'purchased', wanted, gone);
    keepUnsaved(s);
    writeCache(s);
    scheduleSave(s);
    publish(s);
    return Object.keys(wanted).length;
  }

  // Copy the previous month's closing counts into this month's openings.
  async function pullOpeningFromPrevious(previousId: string): Promise<number | null> {
    if (!writable() || !isMonthId(previousId)) return 0;
    let previous: StoredDoc | null = null;
    try {
      previous = await source.getMonthOnce(previousId);
    } catch (err) {
      // ⚠️ A FAILED READ IS NOT AN EMPTY MONTH: on screen the two would look identical and mean
      // opposite things, on the one screen used where there is no signal.
      deps.warn('Could not read the previous month:', err);
      return null;
    }
    // The month may have been closed, or left, while the read was out.
    const s = writable();
    if (!s) return 0;
    const seed = carryOver(previous, s.id);
    const opening = seed ? seed.opening : {};
    const count = Object.keys(opening).length;
    if (!count) return 0;
    s.month = { ...s.month, opening: { ...s.month.opening, ...opening } };
    s.outbox = stageMany(s.outbox, 'opening', opening);
    keepUnsaved(s);
    writeCache(s);
    scheduleSave(s);
    publish(s);
    return count;
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
      stopIngredients?.();
      ingredientsSeq += 1;
      const mine = ingredientsSeq;
      stopIngredients = source.watchIngredients(
        list => { if (mine === ingredientsSeq) update({ ingredients: list, ingredientsLoaded: true }); },
        // The original ignores this failure; the list must not say «Loading…» for ever either.
        () => { if (mine === ingredientsSeq) update({ ingredientsLoaded: true }); },
      );
      // ⚠️ WHAT IS TYPED IS SENT BEFORE THE PAGE GOES AWAY: the save is debounced, so closing the
      // app a moment after the last number would otherwise lose it.
      stopHide?.();
      stopHide = deps.onHide(() => { void flush(); });
      // start → stop → start: the month watched before the stop is watched again.
      if (session && !session.current) {
        const id = session.id;
        session = null;
        openMonth(id);
      }
    },
    stop() {
      ingredientsSeq += 1;
      stopIngredients?.();
      stopIngredients = null;
      stopHide?.();
      stopHide = null;
      if (session?.current) leave(session);
    },
    openMonth,
    setCount,
    flush,
    flushBeforeLeaving,
    closeMonth,
    reopenMonth,
    readProposedPurchases,
    applyPurchases,
    pullOpeningFromPrevious,
  };
}

// The browser's own answers.
export function browserStocktakeDeps(): StocktakeDeps {
  let storage: KeyValueStorage | null = null;
  try { storage = window.localStorage; } catch { /* blocked site data */ }
  return {
    storage,
    now: () => Date.now(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: handle => window.clearTimeout(handle as number),
    onHide(callback) {
      const onVisibility = () => { if (document.visibilityState === 'hidden') callback(); };
      window.addEventListener('pagehide', callback);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        window.removeEventListener('pagehide', callback);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    },
    warn: (message, detail) => console.warn(message, detail),
  };
}
