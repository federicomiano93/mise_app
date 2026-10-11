// stocktakeSource.ts — the Stocktake's data in Firestore, and nothing else.
//
// A port of js/inventory/firebase-inventory.js, write for write, because firestore.rules (the
// `inventory` block, stocktakeMayRead/Write) accept exactly these shapes and nothing else. Behind
// an interface, so the store (stocktakeStore.ts) is a spec with a fake source and never needs a
// database to be tested.
//
// Under the open venue:
//   • inventory/{YYYY-MM} — one document per month. Its own. Written by MERGE, never whole.
//   • ingredients — Orders' (Suppliers'), READ for the list of what there is to count.
//   • ingredient-prices — READ for what a month's consumption is worth. Refused to an employee:
//     that half fails quietly and the list simply has no money.
//   • orders-history — READ ONCE, to PROPOSE what was bought. Never written to.
//
// ⚠️ NO ROLE IS READ HERE, ON PURPOSE (the original's rule): the section gate and firestore.rules
// decide; a second, UX-only check inside the data layer would be a control dressed as one.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its
// settings are fixed by its first use (src/firestore-access.spec.ts).

import { buildPath } from '@mise/shared/location-id';
import { isMonthId } from '@mise/shared/inventory-model';
import { withPrices } from '@mise/shared/price-model';
import type { DocumentReference, Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as the store reads it: its id beside its fields.
export type StoredDoc = { readonly id: string } & Record<string, unknown>;

// The boxes emptied in one write, as `{ closing: { flour: true } }`.
//
// ⚠️ NESTED MAPS, NEVER A DOTTED 'closing.flour' STRING: an ingredient id is a Firestore document
// id and may legally contain a dot; splitting on it would delete the wrong key, or nothing.
export type Clearing = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface StocktakeSource {
  // One month, live. null while the document does not exist. Returns the unsubscribe at once.
  watchMonth(monthId: string, onChange: (doc: StoredDoc | null) => void, onError: (err: unknown) => void): () => void;
  // One month, read once (the month before, for «Carry forward»). Rejects when it cannot be read.
  getMonthOnce(monthId: string): Promise<StoredDoc | null>;
  // Part of a month, merged. Resolves when the server has it — which offline is NEVER (see the
  // store's settled()); rejects when it is refused.
  saveMonthFields(monthId: string, patch: Readonly<Record<string, unknown>>, clear?: Clearing): Promise<void>;
  // Every order record dated inside [from, to), read once.
  getOrdersInMonth(from: string, to: string): Promise<StoredDoc[]>;
  // The venue's ingredients with their prices laid on (withPrices), live. Nothing is emitted until
  // the ingredients themselves have arrived; a refused price read emits them unpriced.
  watchIngredients(onChange: (list: StoredDoc[]) => void, onError: (err: unknown) => void): () => void;
}

const MONTHS = 'inventory';
const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
// The orders already placed. Read to PROPOSE what was bought — never written to.
const HISTORY = 'orders-history';

export function createFirestoreStocktakeSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
): StocktakeSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const monthsPath = buildPath(locationId, MONTHS);
  const ingredientsPath = buildPath(locationId, INGREDIENTS);
  const pricesPath = buildPath(locationId, INGREDIENT_PRICES);
  const historyPath = buildPath(locationId, HISTORY);

  // The venue stamp is applied HERE, never by a caller: the rules require `bakery` to name the
  // folder written to (stampedFor).
  const withBakery = (data: Record<string, unknown>) => ({ ...data, bakery: locationId });

  // ⚠️ A month id that is not one never reaches Firestore: it would name a document the rules
  // refuse at best, and somewhere else at worst.
  function monthRef(kit: FirestoreKit, monthId: string): DocumentReference {
    if (!isMonthId(monthId)) throw new Error(`Not a month id: ${String(monthId)}`);
    return kit.fs.doc(kit.db, monthsPath, monthId);
  }

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment:
  // before the load (nothing is ever subscribed) or after it.
  //
  // ⚠️ onSnapshot does NOT resubscribe after an error, so a dropped stream would leave the screen
  // looking like a month nobody counted; onError lets the screen say so.
  function listen(
    subscribe: (kit: FirestoreKit) => () => void,
    onError: (err: unknown) => void,
  ): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    firestore().then(kit => {
      if (stopped) return;
      unsubscribe = subscribe(kit);
    }).catch(err => {
      if (!stopped) onError(err);
    });
    return () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
    };
  }

  return {
    // The month on screen, live — so a count typed on the phone in the storeroom appears on the
    // one in the office without either being reloaded.
    watchMonth: (monthId, onChange, onError) => listen(kit => kit.fs.onSnapshot(
      monthRef(kit, monthId),
      snap => onChange(snap.exists() ? { ...snap.data(), id: snap.id } : null),
      err => {
        console.error(`watchMonth(${monthId}) failed:`, err);
        onError(err);
      },
    ), onError),

    // ⚠️ A SINGLE READ, never a listener: the month before is closed by the time it is carried,
    // and a closed month cannot change while you look at it (P14).
    async getMonthOnce(monthId) {
      const kit = await firestore();
      const snap = await kit.fs.getDoc(monthRef(kit, monthId));
      return snap.exists() ? { ...snap.data(), id: snap.id } : null;
    },

    // ⚠️ A MERGE, NEVER A WHOLE DOCUMENT. Counting sixty products is one long evening of small
    // edits, often on two phones; a whole-document write from a phone holding a slightly stale
    // copy would silently undo what the other phone had just counted.
    //
    // ⚠️ WHICH IS EXACTLY WHY CLEARING A BOX NEEDS deleteField(): a merge never removes a key, so an
    // emptied box would come back counted on the next load. The removals travel IN THE SAME WRITE as
    // the rest, so a count and its neighbour's deletion can never half-land.
    async saveMonthFields(monthId, patch, clear = {}) {
      const kit = await firestore();
      const ref = monthRef(kit, monthId);
      const payload: Record<string, unknown> = withBakery({ ...patch });
      for (const [map, ids] of Object.entries(clear)) {
        if (!map || !ids || typeof ids !== 'object') continue;
        const removals: Record<string, unknown> = {};
        for (const id of Object.keys(ids)) removals[id] = kit.fs.deleteField();
        const existing = payload[map];
        payload[map] = { ...(existing && typeof existing === 'object' ? existing : {}), ...removals };
      }
      await kit.fs.setDoc(ref, payload, { merge: true });
    },

    // ⚠️ BOUNDED BY A RANGE ON `date`, NOT BY THE DOCUMENT ID: the ids look like `2026-09-04_alba`,
    // but Firestore refuses a descending scan by key, and an inequality on ONE field needs no
    // composite index. It therefore misses the retired weekly record (`weekStart`, no `date`), which
    // belongs to no month — the right answer, not a gap.
    // ⚠️ READING IT NEEDS THE ORDERS SECTION: a venue without it is refused here, which the store
    // turns into «write in what you bought by hand».
    async getOrdersInMonth(from, to) {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.query(
        fs.collection(db, historyPath),
        fs.where('date', '>=', from),
        fs.where('date', '<', to),
      ));
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    },

    // ⚠️ NOTHING IS EMITTED UNTIL THE INGREDIENTS HAVE ARRIVED: the prices can land first, and
    // emitting then would paint an empty list for a frame.
    // ⚠️ THE PRICE HALF FAILS QUIETLY: an employee may not read prices, and a venue with none still
    // counts perfectly well — it simply has no money column.
    watchIngredients(onChange, onError) {
      let ingredients: StoredDoc[] | null = null;
      let prices: Record<string, Record<string, unknown>> = {};
      const emit = () => {
        if (ingredients) onChange(withPrices(ingredients, prices) as StoredDoc[]);
      };
      return listen(kit => {
        const { fs, db } = kit;
        const stopIngredients = fs.onSnapshot(
          fs.collection(db, ingredientsPath) as Query,
          snap => {
            ingredients = snap.docs.map(d => ({ ...d.data(), id: d.id }));
            emit();
          },
          err => {
            console.warn('watchIngredients failed:', err);
            onError(err);
          },
        );
        const stopPrices = fs.onSnapshot(
          fs.collection(db, pricesPath) as Query,
          snap => {
            const next: Record<string, Record<string, unknown>> = {};
            snap.forEach(d => { next[d.id] = d.data(); });
            prices = next;
            emit();
          },
          () => {
            prices = {};
            emit();
          },
        );
        return () => { stopIngredients(); stopPrices(); };
      }, onError);
    },
  };
}
