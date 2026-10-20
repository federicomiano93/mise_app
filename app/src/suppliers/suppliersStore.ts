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
import { normalizeFavourites } from '@mise/shared/favourite-suppliers';
import { withPrices } from '@mise/shared/price-model';
import { markBusy as markBusyOfSession } from '../session/busy';
import type { PanelKey, StoredDoc, SuppliersMeta, SuppliersSource } from './suppliersSource';

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
  | { readonly kind: 'category-not-deleted'; readonly name: string };

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
  readonly ingredientsBroken: boolean;
  // Whether the prices REALLY answered (parity S24). False for a person the rules refuse.
  readonly pricesReadable: boolean;
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
  // Throws one of the venue's panel switches through the server. NOT local-first (a Cloud Function): resolves when the
  // server has written it, REJECTS when refused or unreachable. The busy marker is held meanwhile.
  setIngredientPanel(key: PanelKey, on: boolean): Promise<void>;
}

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
  let ingredientsBroken = false;
  let prices: Record<string, Record<string, unknown>> = {};
  let pricesReadable = false;
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
      suppliers, suppliersLoaded, suppliersFromServer, suppliersBroken, ingredients, ingredientsLoaded, ingredientsBroken, pricesReadable,
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
  function attempt(run: () => Promise<void>): Promise<void> {
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

  function nameOf(id: string): string {
    const found = suppliers.find(s => s.id === id);
    return typeof found?.name === 'string' ? found.name : '';
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
          ingredientsBroken = false;
          changed();
        }, () => {
          ingredientsBroken = true;
          ingredientsLoaded = true;
          changed();
        }),
        source.watchPrices((map, readable) => {
          prices = map;
          pricesReadable = readable;
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
      track(attempt(() => source.saveSupplier(supplierId, payload)), { kind: 'supplier-not-saved', name: payload.name });
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
