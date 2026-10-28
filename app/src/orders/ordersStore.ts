// ordersStore.ts — what the order list shows for one venue, and what it writes: the shared order in progress (step 3f-1)
// and, from step 3f-2, the order records.
//
// The page half of js/orders/orders-main.js that the order list needs, decision for decision, as plain TypeScript with no
// React and no Firebase in it: the source (ordersSource.ts) is injected, so every trap below is a spec with a fake
// (ordersStore.spec.ts). Screens read it through OrdersContext.tsx. It says nothing in words: a failure is an
// OrdersMessage or an outcome, and the screen puts it in the person's language.
//
// LOCAL-FIRST (P20, decision T3): a typed quantity is on screen at once and saved through Firestore's own offline database
// a moment later (draftSync.ts, 800 ms); a refused save is said and the typing stays on screen, sent again with the next
// change (parity L37).
//
// PLACING AN ORDER (step 3f-2, decision T5): `place` is the whole sequence of the current app's placeOrder, in the data layer
// and not in a screen — flush the typing → write the record in a transaction → forget the lines here → clear them in the
// draft — with ONE point of no return (placeOne). The screens only confirm and ask; they never write.
//
// ⚠️ NO COPY OF ITS OWN IN localStorage (decision T14): the current app cached config/orders in `orders-config` so the
// Stock column did not flash before the snapshot (parity M11); Firestore's offline database already answers from this
// phone at once, and a key outside KEEP_PREFIXES would be one more thing a venue switch must wipe.

import { stampFor } from '@mise/shared/order-day';
import { todayISO } from '@mise/shared/day';
import { normalizeOrdersConfig } from '@mise/shared/orders-config';
import { storedUnitFor } from '@mise/shared/order-unit';
import {
  buildSupplierArchive, historyDocId, isUnitConflict, mergeArchives, quantityPathsFor, unitConflicts, wholeNumber,
} from '@mise/shared/archive';
import type { SupplierRecord } from '@mise/shared/archive';
import { confirmedEntries } from '@mise/shared/untold-changes';
import { markBusy as markBusyOfSession } from '../session/busy';
import { createDraftSync, EMPTY_DRAFT } from './draftSync';
import type { DraftDays, DraftEntries, DraftEntry, DraftSync, DraftSyncDeps, DraftView } from './draftSync';
import { buildOrdersLens } from './ordersLens';
import type { LensIngredient, OrdersLens } from './ordersLens';
import type { OrdersMeta, OrdersSource, StoredDoc } from './ordersSource';

export type OrdersConfig = ReturnType<typeof normalizeOrdersConfig>;

export type OrdersMessage =
  // An autosave of the order was refused (or failed): what was typed is still on screen and goes out with the next change.
  | { readonly kind: 'draft-not-saved' }
  // A later autosave landed: a «not saved» message still on screen can go.
  | { readonly kind: 'draft-saved' }
  // The day chosen on a supplier's day line was refused: the line is back on the day that is stored (parity D7).
  | { readonly kind: 'day-not-saved' };

export interface OrdersSnapshot {
  // Every supplier, as stored (the lens keeps the active ones and sorts them).
  readonly suppliers: readonly StoredDoc[];
  // Whether the suppliers can be shown: the server answered, the copy held some, or the stream failed.
  readonly suppliersLoaded: boolean;
  // The live stream died (no resubscribe): the page says the order no longer updates (parity L5).
  readonly suppliersBroken: boolean;
  readonly ingredients: readonly StoredDoc[];
  readonly ingredientsLoaded: boolean;
  readonly ingredientsBroken: boolean;
  // config/orders through normalizeOrdersConfig (defaults while it has not arrived: the Stock box shown, parity M10).
  readonly config: OrdersConfig;
  readonly configLoaded: boolean;
  // The order in progress: the server's document with this phone's unsent typing on top (draftSync.ts).
  readonly draft: DraftView;
  readonly draftLoaded: boolean;
  readonly draftBroken: boolean;
  // The last autosave was refused and no later one has landed (parity L37).
  readonly draftSaveFailed: boolean;
  // The suppliers whose order is being recorded right now: their «Order placed…» is off (parity X1).
  readonly placing: readonly string[];
}

// One change to one line, as a row makes it.
export type LineEdit =
  // The Order box, the − / + steppers: a whole number, never below 0 (parity L26).
  | { readonly qty: number }
  // The Stock box: a reading of the shelf. ⚠️ It never moves the supplier's day (parity L28).
  | { readonly stock: number }
  // The unit menu, only for a card that offers a choice (parity L25): stored as `storedUnitFor` says ('' = the card's).
  | { readonly unit: string }
  // The ×: back to the card's unit and no quantity, in ONE autosave (parity L25).
  | { readonly clear: true };

// One supplier's order as the confirm screen confirmed it (parity X2): the quantities above zero, by ingredient id, and the
// unit each line SHOWED, frozen when the screen opened.
export interface PlaceItem {
  readonly supplierId: string;
  // The day it is recorded under: recordDay(stamp, today), never later than today (decision F3).
  readonly date: string;
  readonly quantities: Readonly<Record<string, number>>;
  readonly units: Readonly<Record<string, string>>;
}

// How one supplier's order ended.
export type PlaceOutcome =
  // Recorded and cleared from the order.
  | { readonly supplierId: string; readonly kind: 'saved' }
  // Recorded, but the clear was refused: the lines are back on screen, and must NOT be placed again (they would add up).
  | { readonly supplierId: string; readonly kind: 'not-cleared' }
  // Nothing was written: the order is as it was.
  | { readonly supplierId: string; readonly kind: 'failed' }
  // Nothing was written: today's record holds these lines in a unit the new ones cannot be added to (parity H2).
  | { readonly supplierId: string; readonly kind: 'unit-conflict'; readonly ids: readonly string[] }
  // Every line was set to 0 on the confirm screen, or the supplier is gone: not an order, nothing written.
  | { readonly supplierId: string; readonly kind: 'nothing' }
  // This supplier's order is already being recorded (a second tap).
  | { readonly supplierId: string; readonly kind: 'busy' };

export type PlaceReport =
  | { readonly offline: true }
  | { readonly offline: false; readonly outcomes: readonly PlaceOutcome[] };

export type ClearOutcome = 'cleared' | 'failed' | 'offline';

// What the confirm screen needs to know about today's record of one supplier.
export interface RecordCheck {
  readonly supplierId: string;
  readonly date: string;
  // Whether the record already exists: the screen then says the order ADDS to it (parity X2).
  readonly exists: boolean;
  // The lines it holds in a unit the new order cannot be added to (archive.ts unitConflicts, parity X7).
  readonly conflicts: ReturnType<typeof unitConflicts>;
}

export interface OrdersDeps {
  // The busy marker of the session (session/busy.ts); a spec passes its own to count.
  markBusy(): () => void;
  // Today, 'YYYY-MM-DD' in the phone's own time zone (day.js todayISO).
  today(): string;
  // The draft's write clock and debounce; a spec passes its own.
  draft: Pick<DraftSyncDeps, 'nowIso' | 'setTimer' | 'clearTimer'>;
  // Whether the phone believes it is connected. ⚠️ Placing and clearing are refused offline (parity X3): Firestore would
  // keep the record and the clear waiting, to land in two different moments of connectivity — how an order gets lost.
  online(): boolean;
}

export interface OrdersStore {
  getSnapshot(): OrdersSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: OrdersMessage) => void): () => void;
  // Starts the four listeners; stop() ends them and sends a change still waiting for the autosave at once, so leaving the
  // section within 800 ms of a keystroke loses nothing. Safe to call start → stop → start (React's development mode does).
  start(): void;
  stop(): void;
  // Changes one line of the order, LOCAL-FIRST. `supplier` is the supplier whose screen the row is on (the pseudo
  // «No supplier» included); `ingredient` is the row's line as the lens filed it.
  editLine(supplier: StoredDoc, ingredient: LensIngredient, edit: LineEdit): void;
  // The day line (parity D7): the supplier's lines are for `day` ('YYYY-MM-DD'). Written at once, LOCAL-FIRST; a refusal
  // puts the stored day back and says 'day-not-saved'.
  setDay(supplier: StoredDoc, day: string): void;
  // What the confirm screen needs before it opens, read once from the server (parity X2, X7). A record that cannot be read
  // counts as none: the transaction inside `place` still refuses a real clash.
  checkRecords(items: ReadonlyArray<{ readonly supplierId: string; readonly date: string }>, noSupplierName: string): Promise<RecordCheck[]>;
  // Records these orders, one supplier after the other (parity X5, X8). `noSupplierName` names the pseudo-supplier.
  place(items: readonly PlaceItem[], noSupplierName: string): Promise<PlaceReport>;
  // «Clear quantities» (parity X11): these suppliers' quantities, units and overrides go, in ONE write; the stock readings
  // stay; nothing recorded is touched.
  clearQuantities(supplierIds: readonly string[], noSupplierName: string): Promise<ClearOutcome>;
}

export function browserOrdersDeps(): OrdersDeps {
  return {
    markBusy: markBusyOfSession,
    today: () => todayISO(),
    draft: {
      nowIso: () => new Date().toISOString(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    online: () => navigator.onLine,
  };
}

// A switched-off line with a quantity is ordered, recorded and cleared like any other (decision T10): the record's own lens
// (ingredientsOf, active only — kept as the current app has it) must see every line of the order as in use.
function orderable(lines: readonly LensIngredient[]): LensIngredient[] {
  return lines.map(line => ((line as { active?: unknown }).active === false ? { ...line, active: true } : line));
}

export function createOrdersStore(source: OrdersSource, deps: OrdersDeps = browserOrdersDeps()): OrdersStore {
  let snapshot: OrdersSnapshot = {
    suppliers: [], suppliersLoaded: false, suppliersBroken: false,
    ingredients: [], ingredientsLoaded: false, ingredientsBroken: false,
    config: normalizeOrdersConfig(null), configLoaded: false,
    draft: EMPTY_DRAFT, draftLoaded: false, draftBroken: false, draftSaveFailed: false,
    placing: [],
  };
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: OrdersMessage) => void>();
  let stops: Array<() => void> = [];
  let releaseBusy: (() => void) | null = null;
  // The section was left: nothing can be typed any more, so the marker waits only for the writes still in the air.
  let stopped = false;

  function set(patch: Partial<OrdersSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  function say(message: OrdersMessage) {
    for (const listener of messageListeners) listener(message);
  }

  // ⚠️ RULE 2 OF EVERY SCREEN: while typing has not reached Firestore, a self-started reload must not throw it away. Held
  // from the keystroke until the save has settled (offline, until the connection comes back).
  function holdBusy() {
    if (!releaseBusy) releaseBusy = deps.markBusy();
  }
  function dropBusyWhenSaved() {
    // ⚠️ After stop() a refused change can never be sent again from here (it was said, and the section is gone): holding
    // the marker for it blocked every self-started reload of the phone for good (found in the third review of 3f-1).
    if (releaseBusy && (stopped ? !sync.saving() : !sync.hasUnsaved())) {
      releaseBusy();
      releaseBusy = null;
    }
  }

  const sync: DraftSync = createDraftSync({
    save: payload => source.mergeDraft(payload),
    nowIso: deps.draft.nowIso,
    setTimer: deps.draft.setTimer,
    clearTimer: deps.draft.clearTimer,
    onResult: ok => {
      if (ok && snapshot.draftSaveFailed) {
        set({ draftSaveFailed: false });
        say({ kind: 'draft-saved' });
      } else if (!ok) {
        // The refusal handed the typing back to the sync: drawn again now, in case Firestore took its copy back first.
        set({ draftSaveFailed: true, draft: sync.view() });
        say({ kind: 'draft-not-saved' });
      }
      dropBusyWhenSaved();
    },
  });

  // The lens as it is NOW, from the latest data: what an order records and clears is decided by the one lens the screens
  // draw (ordersLens.ts), never by a list taken before the confirm screen opened — a line another phone moved meanwhile
  // belongs to the other order.
  function lensNow(noSupplierName: string): OrdersLens {
    return buildOrdersLens({
      suppliers: snapshot.suppliers,
      suppliersLoaded: snapshot.suppliersLoaded,
      ingredients: snapshot.ingredients,
      entries: snapshot.draft.entries,
      supplierOrder: snapshot.config.supplierOrder,
      noSupplierName,
    });
  }

  // Each card by id, for the merge of two orders the same day (its unit, its package, how many a case holds).
  const cardOf = (id: string): unknown => snapshot.ingredients.find(i => i.id === id);

  function setPlacing(id: string, on: boolean) {
    const others = snapshot.placing.filter(p => p !== id);
    set({ placing: on ? [...others, id] : others });
  }

  // One supplier's order: the current app's placeOrder from the confirm screen on.
  async function placeOne(item: PlaceItem, noSupplierName: string): Promise<PlaceOutcome> {
    const { supplierId, date, quantities, units } = item;
    // ⚠️ A SECOND TAP IN THE SECOND THE WRITE TAKES would pass every check and record the same lines again — and the merge
    // ADDS by design, doubling them.
    if (snapshot.placing.includes(supplierId)) return { supplierId, kind: 'busy' };
    const supplier = lensNow(noSupplierName).supplierById(supplierId);
    if (!supplier || Object.keys(quantities).length === 0) return { supplierId, kind: 'nothing' };
    setPlacing(supplierId, true);
    try {
      // A keystroke from the last 800 ms may still wait for the autosave — possibly for ANOTHER supplier. It goes now, or
      // the clear's snapshot would arrive before it and it would be lost.
      await sync.flush();
      // ⚠️⚠️ WHAT IS RECORDED IS WHAT WAS CONFIRMED, NEVER THE SHARED ORDER AS IT IS NOW (Federico's rule, 24 Aug 2026):
      // the order is live on every phone, and a colleague may have typed since the screen opened. confirmedEntries rewrites
      // EVERY line of this supplier from the confirmed numbers (a line left out was set to 0 and is not ordered) with the
      // units the screen showed; the stock readings ride along untouched. A copy: the draft itself is never changed by it.
      const lines = orderable(lensNow(noSupplierName).linesOf(supplierId));
      const entries = confirmedEntries(snapshot.draft.entries as Record<string, Record<string, unknown> | undefined>, lines, quantities, units);
      const incoming = buildSupplierArchive({ supplier, ingredients: lines, entries, date, now: new Date(deps.draft.nowIso()) });
      if (!incoming) {
        setPlacing(supplierId, false);
        return { supplierId, kind: 'nothing' };
      }
      await source.recordOrder(historyDocId(date, supplierId), existing =>
        mergeArchives(existing as SupplierRecord | null, incoming, { cardOf }) as unknown as Record<string, unknown>);
    } catch (err) {
      // Before the point of no return: nothing was recorded and the order is as it was.
      console.error('Recording the order failed:', err);
      setPlacing(supplierId, false);
      if (isUnitConflict(err)) {
        return { supplierId, kind: 'unit-conflict', ids: [...err.ids] };
      }
      return { supplierId, kind: 'failed' };
    }

    // ⚠️⚠️ PAST THE POINT OF NO RETURN: the order IS in the record. Nothing below may ever say «could not save» — whoever
    // placed it would place it again, and the merge would ADD the same lines to the record a second time.
    //
    // The lines leave this phone first (the screen clears at once, and nothing waiting to be sent can write them back), by
    // the lens AS IT IS NOW: a line another phone moved to another supplier while the record was written is that
    // supplier's, and clearing by the old list would wipe it. The whole line goes, overrides included (parity X6).
    const cleared = lensNow(noSupplierName).linesOf(supplierId).map(line => line.id);
    set({ draft: sync.forget(cleared, [supplierId]) });
    try {
      await source.clearDraft([...cleared.map(id => `entries.${id}`), `days.${supplierId}`], deps.draft.nowIso());
      return { supplierId, kind: 'saved' };
    } catch (err) {
      console.error('Clearing the draft after recording the order failed:', err);
      return { supplierId, kind: 'not-cleared' };
    } finally {
      setPlacing(supplierId, false);
    }
  }

  // A snapshot that came from the browser's own database and holds nothing proves nothing (that database can be empty
  // because this phone never synced the collection): until the server speaks, or the copy holds something, «Loading…».
  const loadedBy = (list: readonly unknown[], meta: OrdersMeta) => meta.fromServer || list.length > 0;

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
      if (stops.length) return;
      stopped = false;
      stops = [
        source.watchSuppliers(
          (list, meta) => set({
            suppliers: list,
            suppliersLoaded: snapshot.suppliersLoaded || loadedBy(list, meta),
            suppliersBroken: false,
          }),
          () => set({ suppliersBroken: true, suppliersLoaded: true }),
        ),
        source.watchIngredients(
          (list, meta) => set({
            ingredients: list,
            ingredientsLoaded: snapshot.ingredientsLoaded || loadedBy(list, meta),
            ingredientsBroken: false,
          }),
          () => set({ ingredientsBroken: true, ingredientsLoaded: true }),
        ),
        // ⚠️ A config missing from the browser's own database is only «none» once the server says so: until then the
        // defaults stand (the Stock box shown — only an explicit false hides it, parity M3).
        source.watchOrdersConfig(
          (data, meta) => set({
            config: normalizeOrdersConfig(data),
            configLoaded: snapshot.configLoaded || data !== null || meta.fromServer,
          }),
          () => set({ configLoaded: true }),
        ),
        // ⚠️ A DRAFT MISSING FROM THE BROWSER'S OWN DATABASE IS NOT AN EMPTY ORDER: a phone that never opened Orders has
        // no copy of it. The lines are drawn only once the server has answered or the copy holds the document.
        source.watchDraft(
          (data, meta) => set({
            draft: sync.receive(data),
            draftLoaded: snapshot.draftLoaded || data !== null || meta.fromServer,
            draftBroken: false,
          }),
          () => set({ draftBroken: true, draftLoaded: true }),
        ),
      ];
    },

    stop() {
      for (const stop of stops) stop();
      stops = [];
      // The write is handed to Firestore now; it carries on without the listeners and lands when it can.
      stopped = true;
      sync.flush().then(dropBusyWhenSaved, () => { /* said through onResult, which also releases the busy marker */ });
    },

    editLine(supplier, ingredient, edit) {
      const id = ingredient.id;
      const current: DraftEntry = snapshot.draft.entries[id] ?? {};
      const next: { qty?: number; stock?: number; unit?: string; supplierId?: string } = { ...current };
      let stockOnly = false;

      const setQty = (value: number) => {
        const qty = wholeNumber(value);
        next.qty = qty;
        // ⚠️ WHOSE ORDER THIS LINE IS IN (js/orders/ingredients.js claimLine). One ingredient is in ONE order at a time,
        // so a quantity typed on a row settles it:
        //   • a line SENT HERE from its usual supplier stays here while it has a quantity, and goes back at zero;
        //   • a line of this supplier's ordered elsewhere this time is taken back (override cleared, same write);
        //   • any other line never carries an override — a stale one is cleared on the way.
        // The key is sent as '' (never left behind) by changedEntries when it goes.
        if (ingredient.usualSupplierId) next.supplierId = qty > 0 ? supplier.id : '';
        else if (next.supplierId) next.supplierId = '';
      };

      if ('qty' in edit) setQty(edit.qty);
      else if ('stock' in edit) {
        next.stock = wholeNumber(edit.stock);
        stockOnly = true;
      } else if ('unit' in edit) {
        next.unit = storedUnitFor(edit.unit, ingredient);
      } else {
        // The unit goes first so the one autosave carries both (js/orders/ingredients.js, the ×).
        next.unit = '';
        setQty(0);
      }

      const entries: DraftEntries = { ...snapshot.draft.entries, [id]: next };
      let days: DraftDays = snapshot.draft.days;
      // Stamp the day these lines are FOR (order-day.js stampFor): next week's quantities typed early are for the
      // supplier's next order day. ⚠️ A stock-only edit never moves the day: counting the shelves is not ordering
      // (parity L28, D2).
      if (!stockOnly) {
        const stamp = stampFor({ current: days[supplier.id], supplier, today: deps.today() });
        if (stamp && stamp !== days[supplier.id]) days = { ...days, [supplier.id]: stamp };
      }

      set({ draft: { ...snapshot.draft, entries, days } });
      holdBusy();
      sync.change(entries, days);
    },

    // The current app's setSupplierDay + restamp: written at once rather than after the pause, rolled back when refused.
    // Offline the write simply waits, and the line shows the chosen day meanwhile (local-first).
    setDay(supplier, day) {
      const id = supplier.id;
      const previous = snapshot.draft.days[id];
      if (previous === day) return;
      const days: DraftDays = { ...snapshot.draft.days, [id]: day };
      set({ draft: { ...snapshot.draft, days } });
      holdBusy();
      sync.change(snapshot.draft.entries, days);
      sync.flush().then(dropBusyWhenSaved, () => {
        // ⚠️ THE LINE NEVER SHOWS A DAY THAT WAS NOT SAVED: back to the one stored — unless another day was chosen since,
        // which is newer than this refusal.
        if (snapshot.draft.days[id] === day) {
          const back: Record<string, string> = { ...snapshot.draft.days };
          if (previous === undefined) delete back[id];
          else back[id] = previous;
          set({ draft: { ...snapshot.draft, days: back } });
          sync.change(snapshot.draft.entries, back);
        }
        say({ kind: 'day-not-saved' });
        dropBusyWhenSaved();
      });
    },

    async checkRecords(items, noSupplierName) {
      const lens = lensNow(noSupplierName);
      return Promise.all(items.map(async ({ supplierId, date }) => {
        // ⚠️ A CHECK THAT FAILS MUST NEVER STOP THE ORDER: logged, and the merge inside the write still refuses a real
        // clash (js/orders/orders-main.js refuseOnUnitConflict).
        let record: Record<string, unknown> | null = null;
        try {
          record = await source.readRecord(historyDocId(date, supplierId));
        } catch (err) {
          console.error('Reading the day\'s record failed, carrying on:', err);
        }
        let conflicts: ReturnType<typeof unitConflicts> = [];
        try {
          conflicts = unitConflicts(record, snapshot.draft.entries, orderable(lens.linesOf(supplierId)), supplierId);
        } catch (err) {
          console.error('Unit check failed, carrying on:', err);
        }
        return { supplierId, date, exists: record !== null, conflicts };
      }));
    },

    async place(items, noSupplierName) {
      if (!deps.online()) return { offline: true };
      // A self-started reload in the middle would cut the sequence between the record and the clear.
      const release = deps.markBusy();
      try {
        // ONE AFTER THE OTHER: each writes its record and then clears its own lines of the ONE shared draft, and
        // overlapping writes would race on it.
        const outcomes: PlaceOutcome[] = [];
        for (const item of items) outcomes.push(await placeOne(item, noSupplierName));
        return { offline: false, outcomes };
      } finally {
        release();
      }
    },

    async clearQuantities(supplierIds, noSupplierName) {
      const ids = supplierIds.filter(Boolean);
      if (ids.length === 0) return 'cleared';
      if (!deps.online()) return 'offline';
      const release = deps.markBusy();
      try {
        // A keystroke from the last 800 ms goes first, or it comes back with the next snapshot. A refusal is said by the
        // status line and does not stop the clear.
        try {
          await sync.flush();
        } catch (err) {
          console.error('Flushing the draft before clearing failed:', err);
        }
        const lens = lensNow(noSupplierName);
        // The lines as the lens files them, switched-off ones included (quantityPathsFor reads them unfiltered).
        const lines = ids.flatMap(id => lens.linesOf(id));
        set({ draft: sync.forget(lines.map(line => line.id), ids, { quantitiesOnly: true }) });
        try {
          await source.clearDraft(quantityPathsFor(ids, lines), deps.draft.nowIso());
          return 'cleared';
        } catch (err) {
          // The screen is clear and the database is not: Firestore's take-back puts the lines back, and the caller says so.
          console.error('Clearing quantities failed:', err);
          return 'failed';
        }
      } finally {
        release();
      }
    },
  };
}
