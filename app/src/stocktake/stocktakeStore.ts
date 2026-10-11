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
  EMPTY_OUTBOX, applyOver, confirm, hasWork, restore, stage, stageMany, take,
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
  // The write currently in the air, if any. Exactly one at a time.
  sending: Promise<void> | null;
  // Whether Firestore has answered at all yet; until then the local copy is all there is.
  remoteArrived: boolean;
  stopWatch: (() => void) | null;
  // Still the month on screen: a left month keeps writing, but never touches the snapshot.
  current: boolean;
};

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

  // ── One month ──────────────────────────────────────────────────────────────────────────────

  let session: MonthSession | null = null;

  function publish(s: MonthSession, extra: Partial<StocktakeSnapshot> = {}): void {
    if (!s.current) return;
    update({ month: s.month, unsent: hasWork(s.outbox) || s.sending !== null, ...extra });
  }

  function emptyMonth(monthId: string): InventoryMonth {
    // A month id that passed isMonthId always normalises.
    return normalizeMonth({ month: monthId }) as InventoryMonth;
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
      sending: null,
      remoteArrived: false,
      stopWatch: null,
      current: true,
    };
    s.stopWatch = source.watchMonth(
      monthId,
      remote => {
        s.remoteArrived = true;
        // ⚠️ A REMOTE CHANGE NEVER DISCARDS WHAT HAS NOT BEEN SENT: the local values of still-unsent
        // boxes (waiting AND in the air) are laid back over the incoming document.
        const merged = normalizeMonth(remote, monthId) ?? emptyMonth(monthId);
        applyOver(s.outbox, merged, COUNT_MAPS);
        s.month = merged;
        writeCache(s);
        publish(s, { monthLoaded: true, monthFailed: false });
      },
      () => {
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
  // never half-land.
  //
  // ⚠️ EXACTLY ONE WRITE IN THE AIR AT A TIME. With two, the second's success would confirm the
  // first's values as landed too — and a failed first write would then never be sent again.
  function flushSession(s: MonthSession): Promise<void> {
    if (s.saveTimer !== null) deps.clearTimer(s.saveTimer);
    s.saveTimer = null;
    if (s.sending) return s.sending.then(() => flushSession(s));
    if (!hasWork(s.outbox)) return Promise.resolve();

    const taken = take(s.outbox);
    s.outbox = taken.outbox;

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
    s.sending = sent.then(
      () => { s.outbox = confirm(s.outbox); },
      err => {
        deps.warn('The stocktake did not reach Firestore:', err);
        // ⚠️ NOT A PUT-BACK: what went out is older than anything typed since, and per box the
        // newer answer wins (@mise/shared/inventory-outbox restore()).
        s.outbox = restore(s.outbox);
        say({ kind: 'not-saved-yet' });
      },
    ).finally(() => {
      s.sending = null;
      publish(s);
    });
    return s.sending;
  }

  function leave(s: MonthSession): void {
    s.current = false;
    s.stopWatch?.();
    s.stopWatch = null;
    // Handed to Firestore now; nobody waits for the answer (no signal in a storeroom).
    void flushSession(s);
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
