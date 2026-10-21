// suppliersStore.ts — what «Ingredients & suppliers» shows for one venue, and its writes (step 3e-1).
//
// The page half of js/orders/registry-main.js, decision for decision, as plain TypeScript with no React and no Firebase
// in it: the source (suppliersSource.ts) is injected, so every trap below is a spec with a fake (suppliersStore.spec.ts).
// Screens read it through SuppliersContext.tsx.
//
// It says nothing in words: a failure is a SuppliersMessage, and the screen puts it in the person's language.
//
// ⚠️ NO COPY OF ITS OWN IN localStorage (parity S39, as the current app): Firestore's own offline database is the only
// local copy, so a write is on screen at once — Firestore shows its own pending writes in every answer — and a REFUSED
// write is taken back by Firestore itself, in the very next answer. What the store adds to that: it holds the busy
// marker while a write is in the air (rule 2: a self-started reload must not drop it), and it says a refusal.
//
// ⚠️ AN EMPTY ANSWER FROM THE BROWSER'S OWN DATABASE IS NOT AN ANSWER (decision T9, Finding S-A): that database can be
// empty because this phone never read the collection, and believing it would say «No suppliers yet — add one» to a
// venue that has twenty. Until the server has spoken, or the copy holds something, the list says «Loading…».

import { categoryChoices, countInCategory } from '@mise/shared/record-choices';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { cleanUnit, storedUnitFor } from '@mise/shared/order-unit';
import { normalizeFavourites } from '@mise/shared/favourite-suppliers';
import { INGREDIENT_DRAINED_FIELDS, PRICE_FIELDS, withPrices } from '@mise/shared/price-model';
import { supplierLabel } from '@mise/shared/supplier-label';
import { markBusy as markBusyOfSession } from '../session/busy';
import { priceWriteOf } from './priceSave';
import type { PricePatch } from '@mise/shared/price-model';
import type { IngredientUsage, PanelKey, StoredDoc, SuppliersMeta, SuppliersSource } from './suppliersSource';

export type SuppliersMessage =
  // A supplier save the database refused: Firestore has taken it back. `name` is what was typed.
  | { readonly kind: 'supplier-not-saved'; readonly name: string }
  // Switching a supplier off or on was refused (or the supplier was deleted meanwhile).
  | { readonly kind: 'supplier-active-not-saved'; readonly name: string }
  // A supplier delete the database refused: it is back.
  | { readonly kind: 'supplier-not-deleted'; readonly name: string }
  // A star the database refused: it is back as it was.
  | { readonly kind: 'favourite-not-saved' }
  // A category delete the database refused (or an ingredient was deleted meanwhile): `name` is the category.
  | { readonly kind: 'category-not-deleted'; readonly name: string }
  // An ingredient save the database refused: Firestore has taken it back. `name` is the name to show, as typed.
  | { readonly kind: 'ingredient-not-saved'; readonly name: string }
  // An ingredient delete the database refused: it is back.
  | { readonly kind: 'ingredient-not-deleted'; readonly name: string };

export interface SuppliersSnapshot {
  // Every supplier, as stored, in the order the database gave them (the list sorts them itself).
  readonly suppliers: readonly StoredDoc[];
  // Whether the suppliers can be shown (header): the server answered, the copy held some, or the stream failed.
  readonly suppliersLoaded: boolean;
  // Whether the SERVER has answered once: only then is «this supplier no longer exists» the truth (a copy in the
  // browser's own database can be older than a supplier somebody added on another phone).
  readonly suppliersFromServer: boolean;
  // The live stream died (no resubscribe): the page says it could not load them (parity S71).
  readonly suppliersBroken: boolean;
  // Every ingredient and packaging item with its price laid on (withPrices) for whoever may read prices; unpriced for
  // everybody else (the same as an ingredient nobody has priced — parity S60).
  readonly ingredients: readonly StoredDoc[];
  readonly ingredientsLoaded: boolean;
  // Whether the SERVER has answered the ingredients once: only then is the list of what a category holds (and so what a
  // category delete rewrites) the whole truth; a copy in the browser's own database can miss ingredients.
  readonly ingredientsFromServer: boolean;
  readonly ingredientsBroken: boolean;
  // Whether the prices REALLY answered (parity S24). False for a person the rules refuse.
  readonly pricesReadable: boolean;
  // Whether the SERVER has answered the prices once (parity C28): only then is a price missing from the list really «no
  // price». Until then a price writer's card reads its own price document before it opens (readPrice).
  readonly pricesFromServer: boolean;
  // The venue's saved category list (config/orders.ingredientCategories), or null when it never saved one — or it has
  // not arrived. ⚠️ AN EMPTY LIST IS AN ANSWER: the venue deleted every category (parity S27).
  readonly storedCategories: readonly string[] | null;
  // The starred suppliers' ids, normalised (parity S29).
  readonly favourites: readonly string[];
  // Whether config/orders has REALLY arrived (parity S28): a document, or the server's word that there is none. Until
  // then the category list is only the defaults, and a category delete would write them over the venue's real list.
  readonly configLoaded: boolean;
}

export interface SuppliersDeps {
  // The busy marker of the session (session/busy.ts); a spec passes its own to count.
  markBusy(): () => void;
}

// What the supplier card saves (parity S82), as the card builds it.
export type SupplierPayload = Readonly<Record<string, unknown>> & { readonly name: string };

// What the ingredient card saves (parity C87), as the card builds it: product data. The money travels apart, in
// IngredientSaveOptions.price, and only for a person who may write prices.
export type IngredientPayload = Readonly<Record<string, unknown>> & { readonly name: string };

export interface IngredientSaveOptions {
  // The order unit the card has just replaced (Cartone / Singola rewrote `unit`): the open line of the order in progress
  // is frozen in it, so a quantity keeps its meaning (parity C35). '' or absent = nothing to freeze.
  readonly unitChangedFrom?: string;
  // The money (step 3e-3), ONLY for a person who may write prices (canManage AND the venue's Food cost section — parity
  // C4, C5, C22: a price write the rules refuse fails the whole batch, and an ordinary rename with it). `before` is the
  // ingredient as the card OPENED it, its price laid on (null for a new one); `patch` is the card's pricePatch.
  // priceSave.ts decides what is written: the price's date kept when the money did not move (F4), a history entry only
  // when it did, and no price write at all when nothing in it would change.
  readonly price?: { readonly before: Readonly<Record<string, unknown>> | null; readonly patch: PricePatch };
}

// What a save started: the ingredient's id (a new one is made on the phone), and whether a price-history entry went with
// it (the screen then reports the `price-saved` action, parity C31).
export interface IngredientSaved {
  readonly id: string;
  readonly priceRecorded: boolean;
}

// The ingredient DOCUMENT of a card's payload (js/price-model.js splitPriceFields, its ingredient half): every price key
// cut off — they live in ingredient-prices — and the six old price keys sent as null, for every role (parity C16): that is
// what drains a stale rate written by a phone of before off the ingredient, which everybody may read. ⚠️ vatRate, the case
// keys and priceBasis are never on the ingredient: its key list is closed, and ONE refused key fails every save.
export function ingredientDocOf(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!(PRICE_FIELDS as readonly string[]).includes(key)) doc[key] = value;
  }
  for (const key of INGREDIENT_DRAINED_FIELDS) doc[key] = null;
  return doc;
}

export interface SuppliersStore {
  getSnapshot(): SuppliersSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: SuppliersMessage) => void): () => void;
  // Starts the four listeners; stop() ends them. Safe to call start → stop → start (React's development mode does).
  start(): void;
  stop(): void;
  // Saves a supplier, LOCAL-FIRST: returns its id at once (a new one is made on the phone) and never waits for the
  // network. A refusal says `supplier-not-saved`. `id` null = a new supplier.
  saveSupplier(id: string | null, payload: SupplierPayload): string;
  // Switches a supplier off (`active` false) or back on. Local-first; a refusal says `supplier-active-not-saved`.
  setSupplierActive(id: string, active: boolean): void;
  // Deletes a supplier, local-first. Its ingredients keep their supplierId (parity S36). A refusal says so.
  deleteSupplier(id: string): void;
  // How many ingredients and packaging items are filed under a supplier: the number his decision F2 puts in the
  // delete question.
  itemsOfSupplier(id: string): number;
  // Stars or unstars a supplier, local-first: the star moves at once and a refusal puts it back and says so.
  setFavourite(id: string, on: boolean): void;
  // The categories the Settings card lists (parity S106): the venue's saved list or the defaults in the venue's
  // OUTPUT language, plus every category an ingredient uses. `language` is the venue's (market.ts outputLanguage).
  categories(language: string): readonly string[];
  // How many ingredients a category holds (case-insensitive after trim): the number in the delete question.
  countInCategory(category: string): number;
  // Deletes a category: the shortened list, and «no category» on every ingredient that used it. Local-first; returns
  // false and writes nothing when config/orders has not really arrived (parity S107). A refusal says so.
  deleteCategory(category: string, language: string): boolean;
  // Saves an ingredient, LOCAL-FIRST (decision T3): returns at once and never waits for the network. With
  // `options.price`, the price document and its history entry go in the same batch (parity C21) — or nothing of the money
  // at all when the save would change none of it. A refusal says `ingredient-not-saved`: Firestore takes back the WHOLE
  // batch. `id` null = a new ingredient.
  saveIngredient(id: string | null, payload: IngredientPayload, options?: IngredientSaveOptions): IngredientSaved;
  // One ingredient's price document, for a price writer's card that opens before the prices came from the server
  // (parity C28). REJECTS when it cannot be read: the card then does not open.
  readPrice(id: string): Promise<Record<string, unknown> | null>;
  // The last 20 price-history entries of an ingredient, newest first, from the server (parity C25). REJECTS on failure.
  readPriceHistory(id: string): Promise<readonly StoredDoc[]>;
  // Deletes an ingredient, local-first — with its price document when `withPrice` (a person who may write prices) — and
  // takes its line out of the order in progress (parity C32, C33). A refusal says `ingredient-not-deleted`.
  deleteIngredient(id: string, withPrice: boolean): void;
  // How many recipes and Food cost products use an ingredient, read from the server once (his decision F5). Never rejects.
  ingredientUsage(id: string): Promise<IngredientUsage>;
  // Throws one of the venue's panel switches through the server. NOT local-first (a Cloud Function): resolves when the
  // server has written it, REJECTS when refused or unreachable. The busy marker is held meanwhile.
  setIngredientPanel(key: PanelKey, on: boolean): Promise<void>;
}

// How many price-history entries the card shows (js/orders/firebase-orders.js getPriceHistory, parity C25).
export const PRICE_HISTORY_MAX = 20;

export function browserSuppliersDeps(): SuppliersDeps {
  return { markBusy: markBusyOfSession };
}

export function createSuppliersStore(source: SuppliersSource, deps: SuppliersDeps = browserSuppliersDeps()): SuppliersStore {
  let suppliers: readonly StoredDoc[] = [];
  let suppliersLoaded = false;
  let suppliersFromServer = false;
  let suppliersBroken = false;
  let rawIngredients: readonly StoredDoc[] = [];
  let ingredients: readonly StoredDoc[] = [];
  let ingredientsLoaded = false;
  let ingredientsFromServer = false;
  let ingredientsBroken = false;
  let prices: Record<string, Record<string, unknown>> = {};
  let pricesReadable = false;
  let pricesFromServer = false;
  let storedCategories: readonly string[] | null = null;
  let favourites: readonly string[] = [];
  let configLoaded = false;

  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: SuppliersMessage) => void>();
  let stops: Array<() => void> = [];
  let started = false;

  let snapshot: SuppliersSnapshot = build();

  function build(): SuppliersSnapshot {
    return {
      suppliers, suppliersLoaded, suppliersFromServer, suppliersBroken, ingredients, ingredientsLoaded, ingredientsFromServer, ingredientsBroken, pricesReadable, pricesFromServer,
      storedCategories, favourites, configLoaded,
    };
  }

  function changed(): void {
    snapshot = build();
    for (const listener of [...listeners]) listener();
  }

  function say(message: SuppliersMessage): void {
    for (const listener of [...messageListeners]) listener(message);
  }

  // A write in the air: the busy marker is held until the database answers, and a refusal is said. Offline the promise
  // waits, and so does the marker — the change is in Firestore's own queue and a self-started reload must not drop it.
  function track(write: Promise<void>, refused: SuppliersMessage): void {
    const release = deps.markBusy();
    write.then(release, (err: unknown) => {
      release();
      console.error(`Suppliers write refused (${refused.kind}):`, err);
      say(refused);
    });
  }

  // Starts a write that may throw before it even returns a promise (an id that is not one): the throw is a refusal too.
  function attempt<T>(run: () => Promise<T>): Promise<T> {
    try {
      return run();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // ⚠️ THE SERVER'S WORD, OR A COPY THAT HOLDS SOMETHING (header). A cached copy that holds documents is the venue's
  // own, maybe a little old; the server's answer follows it in a moment.
  const believable = (list: readonly StoredDoc[], meta: SuppliersMeta) => meta.fromServer || list.length > 0;

  function relayIngredients(): void {
    ingredients = withPrices(rawIngredients, prices) as StoredDoc[];
  }

  function ingredientNameOf(id: string): string {
    const found = rawIngredients.find(item => item.id === id);
    return found ? ingredientDisplayName(found) : '';
  }

  // ⚠️ THE FREEZE IS NOT PART OF THE SAVE (js/orders/registry-main.js): the ingredient is already saved, and a failure is
  // only logged. Rules of js/orders/draft.js freezeUnitInDraft: only a line with a quantity and NO unit of its own (it
  // meant «the card's unit, whatever it is now»), frozen in the replaced unit unless that is the new unit anyway.
  // Firestore keeps one client's writes in order, so the freeze lands after the save it follows.
  function freezeDraftLine(id: string, from: string, saved: Readonly<Record<string, unknown>>): void {
    const frozen = storedUnitFor(from, saved);
    if (!frozen) return;
    attempt(() => source.readDraftEntry(id).then(entry => {
      if (!(Number(entry?.qty) > 0) || cleanUnit(entry?.unit)) return;
      return source.setDraftEntryUnit(id, frozen);
    })).catch((err: unknown) => console.error('The draft line kept an old unit:', err));
  }

  function nameOf(id: string): string {
    const found = suppliers.find(s => s.id === id);
    return found ? supplierLabel(found) : '';
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
      if (started) return;
      started = true;
      stops = [
        source.watchSuppliers((list, meta) => {
          suppliers = list;
          if (believable(list, meta)) suppliersLoaded = true;
          if (meta.fromServer) suppliersFromServer = true;
          suppliersBroken = false;
          changed();
        }, () => {
          // ⚠️ THE WAIT ENDS: a stream that died must not leave «Loading…» for ever; the page says it failed instead.
          suppliersBroken = true;
          suppliersLoaded = true;
          changed();
        }),
        source.watchIngredients((list, meta) => {
          rawIngredients = list;
          relayIngredients();
          if (believable(list, meta)) ingredientsLoaded = true;
          if (meta.fromServer) ingredientsFromServer = true;
          ingredientsBroken = false;
          changed();
        }, () => {
          ingredientsBroken = true;
          ingredientsLoaded = true;
          changed();
        }),
        source.watchPrices((map, readable, meta) => {
          prices = map;
          pricesReadable = readable;
          if (readable && meta?.fromServer) pricesFromServer = true;
          relayIngredients();
          changed();
        }),
        // ⚠️ A FAILURE HERE IS NOT SHOWN ON THE PAGE (parity S71): the categories fall back to the defaults plus those in
        // use, a usable screen; configLoaded stays false, so no category can be deleted over a list nobody has seen.
        source.watchOrdersConfig((data, meta) => {
          storedCategories = Array.isArray(data?.ingredientCategories)
            ? (data.ingredientCategories as unknown[]).filter((c): c is string => typeof c === 'string')
            : null;
          favourites = normalizeFavourites(data?.favouriteSuppliers);
          // ⚠️ «MISSING» COUNTS ONLY WHEN THE SERVER SAID IT (parity S28).
          if (data !== null || meta.fromServer) configLoaded = true;
          changed();
        }, () => undefined),
      ];
    },

    stop() {
      for (const stopOne of stops) stopOne();
      stops = [];
      started = false;
    },

    saveSupplier(id, payload) {
      const supplierId = id ?? source.newSupplierId();
      track(attempt(() => source.saveSupplier(supplierId, payload)), { kind: 'supplier-not-saved', name: supplierLabel(payload) });
      return supplierId;
    },

    // ⚠️ THE NAME IS READ BEFORE THE WRITE: Firestore reports its own pending write at once, and after a delete the supplier
    // is already gone from the list when the sentence is built.
    setSupplierActive(id, active) {
      const refused: SuppliersMessage = { kind: 'supplier-active-not-saved', name: nameOf(id) };
      track(attempt(() => source.setSupplierActive(id, active)), refused);
    },

    deleteSupplier(id) {
      const refused: SuppliersMessage = { kind: 'supplier-not-deleted', name: nameOf(id) };
      track(attempt(() => source.deleteSupplier(id)), refused);
    },

    // The same count as the Suppliers tab's row (parity S55): every ingredient AND packaging item whose supplierId is it.
    itemsOfSupplier: id => rawIngredients.filter(item => item.supplierId === id).length,

    // ⚠️ NOT AWAITED BY ANY SCREEN (parity S89): the star moves at once in Firestore's own answer, and a refusal puts it
    // back in the next one.
    setFavourite(id, on) {
      track(attempt(() => source.setFavourite(id, on)), { kind: 'favourite-not-saved' });
    },

    categories: language => categoryChoices({ stored: storedCategories, ingredients: rawIngredients, language }),

    countInCategory: category => countInCategory(rawIngredients, category),

    // ⚠️ THE SHORTENED LIST IS THE LIST THE CARD SHOWS without the one deleted (parity S107, Finding S-J), and the
    // ingredients are the ones that hold it, compared as countInCategory compares (case-insensitive after trim).
    deleteCategory(category, language) {
      if (!configLoaded) return false;
      const key = category.trim().toLowerCase();
      const shown = categoryChoices({ stored: storedCategories, ingredients: rawIngredients, language });
      const shortened = shown.filter(c => c.trim().toLowerCase() !== key);
      const ids = rawIngredients
        .filter(item => countInCategory([item], category) === 1)
        .map(item => item.id);
      track(attempt(() => source.deleteCategory(shortened, ids)), { kind: 'category-not-deleted', name: category });
      return true;
    },

    saveIngredient(id, payload, options = {}) {
      const ingredientId = id ?? source.newIngredientId();
      const doc = ingredientDocOf(payload);
      const supplierId = typeof payload.supplierId === 'string' ? payload.supplierId : '';
      const money = options.price
        ? priceWriteOf(options.price.before, options.price.patch, supplierId, new Date().toISOString())
        : null;
      track(attempt(() => source.saveIngredient(ingredientId, doc, money)), {
        kind: 'ingredient-not-saved', name: ingredientDisplayName(payload),
      });
      if (options.unitChangedFrom) freezeDraftLine(ingredientId, options.unitChangedFrom, payload);
      return { id: ingredientId, priceRecorded: Boolean(money?.history) };
    },

    readPrice: id => attempt(() => source.readPrice(id)),

    readPriceHistory: id => attempt(() => source.readPriceHistory(id, PRICE_HISTORY_MAX)),

    // ⚠️ THE NAME IS READ BEFORE THE WRITE (as for a supplier). ⚠️ The draft line goes too, only logged on failure (parity
    // C33): a quantity left for a product that no longer exists would sit in the draft, never ordered. ⚠️ BUT ONLY ONCE THE
    // DELETE HAS LANDED (js/orders/registry-main.js awaits it first): a refused delete puts the ingredient back, and its
    // quantity in the order being prepared must still be there.
    deleteIngredient(id, withPrice) {
      const refused: SuppliersMessage = { kind: 'ingredient-not-deleted', name: ingredientNameOf(id) };
      const removed = attempt(() => source.deleteIngredient(id, withPrice));
      track(removed, refused);
      removed.then(
        () => attempt(() => source.clearDraftEntry(id))
          .catch((err: unknown) => console.error('The draft still holds a deleted ingredient:', err)),
        () => undefined,
      );
    },

    ingredientUsage: id => attempt(() => source.readUsage(id)).catch((err: unknown) => {
      console.warn('Counting what uses an ingredient failed:', err);
      return { recipes: null, products: null };
    }),

    async setIngredientPanel(key, on) {
      const release = deps.markBusy();
      try {
        await source.setIngredientPanel(key, on);
      } finally {
        release();
      }
    },
  };
}
