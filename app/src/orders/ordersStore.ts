// ordersStore.ts — what the order list shows for one venue, and the one thing it writes: the shared order in progress
// (step 3f-1).
//
// The page half of js/orders/orders-main.js that the order list needs, decision for decision, as plain TypeScript with no
// React and no Firebase in it: the source (ordersSource.ts) is injected, so every trap below is a spec with a fake
// (ordersStore.spec.ts). Screens read it through OrdersContext.tsx. It says nothing in words: a failure is an
// OrdersMessage, and the screen puts it in the person's language.
//
// LOCAL-FIRST (P20, decision T3): a typed quantity is on screen at once and saved through Firestore's own offline database
// a moment later (draftSync.ts, 800 ms); a refused save is said and the typing stays on screen, sent again with the next
// change (parity L37).
//
// ⚠️ NO COPY OF ITS OWN IN localStorage (decision T14): the current app cached config/orders in `orders-config` so the
// Stock column did not flash before the snapshot (parity M11); Firestore's offline database already answers from this
// phone at once, and a key outside KEEP_PREFIXES would be one more thing a venue switch must wipe.

import { stampFor } from '@mise/shared/order-day';
import { todayISO } from '@mise/shared/day';
import { normalizeOrdersConfig } from '@mise/shared/orders-config';
import { storedUnitFor } from '@mise/shared/order-unit';
import { wholeNumber } from '@mise/shared/archive';
import { markBusy as markBusyOfSession } from '../session/busy';
import { createDraftSync, EMPTY_DRAFT } from './draftSync';
import type { DraftDays, DraftEntries, DraftEntry, DraftSync, DraftSyncDeps, DraftView } from './draftSync';
import type { LensIngredient } from './ordersLens';
import type { OrdersMeta, OrdersSource, StoredDoc } from './ordersSource';

export type OrdersConfig = ReturnType<typeof normalizeOrdersConfig>;

export type OrdersMessage =
  // An autosave of the order was refused (or failed): what was typed is still on screen and goes out with the next change.
  | { readonly kind: 'draft-not-saved' }
  // A later autosave landed: a «not saved» message still on screen can go.
  | { readonly kind: 'draft-saved' };

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

export interface OrdersDeps {
  // The busy marker of the session (session/busy.ts); a spec passes its own to count.
  markBusy(): () => void;
  // Today, 'YYYY-MM-DD' in the phone's own time zone (day.js todayISO).
  today(): string;
  // The draft's write clock and debounce; a spec passes its own.
  draft: Pick<DraftSyncDeps, 'nowIso' | 'setTimer' | 'clearTimer'>;
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
  };
}

export function createOrdersStore(source: OrdersSource, deps: OrdersDeps = browserOrdersDeps()): OrdersStore {
  let snapshot: OrdersSnapshot = {
    suppliers: [], suppliersLoaded: false, suppliersBroken: false,
    ingredients: [], ingredientsLoaded: false, ingredientsBroken: false,
    config: normalizeOrdersConfig(null), configLoaded: false,
    draft: EMPTY_DRAFT, draftLoaded: false, draftBroken: false, draftSaveFailed: false,
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
  };
}
