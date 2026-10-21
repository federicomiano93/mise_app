// suppliersSource.ts — the data of «Ingredients & suppliers» in Firestore, and nothing else (step 3e-1).
//
// A port of the parts of js/orders/firebase-orders.js, js/record-data.js and js/orders/firebase-features.js that
// suppliers.html calls, write for write, because firestore.rules (the `suppliers`, `ingredients`, `ingredient-prices`
// and `config/{doc}` blocks) accept exactly these shapes. Behind an interface, so the store (suppliersStore.ts) is a
// spec with a fake source and never needs a database to be tested (docs/parity/suppliers.md, decision T2).
//
// Under the open venue, watched only while the section is on screen (P14):
//   • suppliers — every supplier (a handful of documents, every one needed to draw the screen).
//   • ingredients — every ingredient and packaging item, AS STORED (the store lays the prices on).
//   • ingredient-prices — what each costs, a separate collection that an employee is usually refused (parity S14):
//     a refusal is «no prices», never an error (S24).
//   • config/orders — the venue's category list and its favourite suppliers.
// The ingredient card (step 3e-2) writes `ingredients/{id}` and, for a delete, `ingredient-prices/{id}` (only for a person who
// may write prices — js/ingredient-edit-model.js deletePlan); it keeps the order draft (`drafts/current`, the Orders
// section's) honest about an ingredient whose order unit it changed or that it deleted (js/orders/draft.js), and counts the
// recipes and Food cost products that use an ingredient before a delete (his decision F5).
// And one Cloud Function, setIngredientPanels: the allergen and nutrition switches live on locations/{lid}, which no
// client may write (functions/onboarding.js).
//
// ⚠️ NO ROLE IS READ HERE, ON PURPOSE: the section gate and firestore.rules decide (P2).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are fixed by its
// first use (src/firestore-access.spec.ts).

import { categoryPatch, planBatches } from '@mise/shared/category-batches';
import { deletePlan } from '@mise/shared/ingredient-edit-model';
import { findUsage } from '@mise/shared/ingredient-merge';
import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as the store reads it: its id beside its fields.
export type StoredDoc = { readonly id: string } & Record<string, unknown>;

// Where a snapshot came from: true when the SERVER sent it, false when it came from the browser's own database —
// which can be empty, or old, because this phone never synced the collection. The store must be able to tell.
export interface SuppliersMeta {
  readonly fromServer: boolean;
}

// The two switches setIngredientPanels writes (the venue's allergen and nutrition panels).
export type PanelKey = 'showAllergens' | 'showNutrition';

// How many recipes and Food cost products name an ingredient (his decision F5). null = could not be counted: the section
// is off (the rules refuse the read), or the server did not answer. ⚠️ NEVER A 0 FOR «COULD NOT COUNT».
export interface IngredientUsage {
  readonly recipes: number | null;
  readonly products: number | null;
}

export type CallFunction = (name: string, data: unknown, timeoutMs: number) => Promise<unknown>;

export interface SuppliersSource {
  // A new supplier id, made on the phone with no write, so a new supplier can be on screen before the network has
  // heard of it (parity S31: the id is minted BEFORE the write).
  newSupplierId(): string;
  // Every supplier, live. Returns the unsubscribe at once (Firestore may still be loading).
  // ⚠️ onSnapshot does NOT resubscribe after an error; onError lets the screen say so (parity S71).
  watchSuppliers(onChange: (list: StoredDoc[], meta: SuppliersMeta) => void, onError: (err: unknown) => void): () => void;
  // Every ingredient (and packaging item), live, as stored. Same contract.
  watchIngredients(onChange: (list: StoredDoc[], meta: SuppliersMeta) => void, onError: (err: unknown) => void): () => void;
  // The prices by ingredient id, live, and whether they REALLY answered (parity S24): a server answer, or a cached one
  // that holds prices. A refusal or a failure answers ({}, false) — never an error: a person the rules refuse sees no
  // price, the same as for an ingredient nobody has priced.
  watchPrices(onChange: (map: Record<string, Record<string, unknown>>, readable: boolean) => void): () => void;
  // config/orders as stored (null when there is none), live. Same contract as watchSuppliers.
  watchOrdersConfig(
    onChange: (data: Record<string, unknown> | null, meta: SuppliersMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // Creates or merges a supplier at a known id. ⚠️ A MERGE, never a whole write: a field a newer screen wrote that this
  // card does not know about stays (parity S31). The venue stamp is applied here. Settles when the SERVER answers;
  // REJECTS when refused (offline, it simply waits).
  saveSupplier(id: string, data: Readonly<Record<string, unknown>>): Promise<void>;
  // Switches a supplier off or back on (`active`). Same promise contract.
  setSupplierActive(id: string, active: boolean): Promise<void>;
  // Deletes a supplier document — nothing else (parity S36: its ingredients keep their supplierId). Same contract.
  deleteSupplier(id: string): Promise<void>;
  // Stars or unstars a supplier for the whole venue (config/orders.favouriteSuppliers). Same contract.
  setFavourite(id: string, on: boolean): Promise<void>;
  // «Delete a category»: the venue's shortened category list, and «no category» on every ingredient in `ids`. Settles
  // when every batch has; REJECTS when one is refused.
  deleteCategory(shortenedList: readonly string[], ids: readonly string[]): Promise<void>;
  // A new ingredient id, made on the phone with no write (the same reason as newSupplierId).
  newIngredientId(): string;
  // Creates or merges an ingredient at a known id. ⚠️ A MERGE, never a whole write: invoiceName, supplierCode(s), the
  // allergen and nutrition fields and every key this card does not draw stay as they are (parity C15). `data` is the
  // ingredient document ALREADY CUT from its price keys (the store does it). The venue stamp is applied here. Same
  // promise contract as saveSupplier.
  saveIngredient(id: string, data: Readonly<Record<string, unknown>>): Promise<void>;
  // Deletes an ingredient — and its price document too when `withPrice` (deletePlan) — in ONE batch. The price history
  // stays (the rules forbid deleting it). Same promise contract.
  deleteIngredient(id: string, withPrice: boolean): Promise<void>;
  // Removes an ingredient's line from the order in progress (drafts/current entries.<id>). Rejects when there is no draft
  // or the write is refused: the caller only logs it (parity C33).
  clearDraftEntry(id: string): Promise<void>;
  // An ingredient's line in the order in progress, as stored (null when there is none, or no draft). Rejects on a failed
  // read.
  readDraftEntry(id: string): Promise<Record<string, unknown> | null>;
  // Writes the unit of an ingredient's line in the order in progress (merge: the quantity stays). Same contract.
  setDraftEntryUnit(id: string, unit: string): Promise<void>;
  // Reads the recipes and the Food cost products ONCE, from the server, and counts those that name the ingredient (F5).
  // Never rejects: what could not be read is null.
  readUsage(id: string): Promise<IngredientUsage>;
  // Throws ONE of the venue's two panel switches (owner and manager; the server checks). Resolves when the server has
  // written it; REJECTS when refused or unreachable. The caller then reads the venue again (session.refreshLocation()).
  setIngredientPanel(key: PanelKey, on: boolean): Promise<void>;
}

const SUPPLIERS = 'suppliers';
const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const CONFIG = 'config';
const DRAFTS = 'drafts';
const DRAFT_ID = 'current';
const RECIPES = 'recipes';
const PRODUCTS = 'products';
const ORDERS_DOC = 'orders';
// The stored «no category» word (js/record-choices.js NO_CATEGORY_WORD): a category deleted leaves its ingredients on it.
const NO_CATEGORY = 'Other';

// ⚠️ AT MOST FIVE DOCUMENTS IN ONE BATCH (decision T8). Firestore's production limit is 20 document-access calls per
// batched write and the rules make about two get() calls per ingredient write and three for config/orders; the current
// app puts six in one (js/orders/category-batches.js), which nobody has measured in production. The emulator does not
// enforce the limit, so only this number keeps a venue with many ingredients in one category working.
export const WRITES_PER_BATCH = 5;

// setIngredientPanels has no timeoutSeconds of its own (functions/onboarding.js), so the platform's 60 s applies: the
// phone waits 70 s (the SDK's default, as the current app) — never less than the server, or a switch would be changed
// by a call the phone has already called failed.
export const PANEL_TIMEOUT_MS = 70_000;

// Firestore's own document id alphabet and length (its autoId): 20 characters of 62 → about 119 bits, so two phones
// never mint the same one. Made here rather than with doc(collection()).id because Firestore may not be loaded yet when
// somebody taps «+» on a cold start, and the id is needed at once.
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function makeSupplierId(fill: (bytes: Uint8Array<ArrayBuffer>) => void = b => { crypto.getRandomValues(b); }): string {
  let id = '';
  // 248 is the largest multiple of 62 under 256: rejecting the bytes above it keeps every character equally likely.
  while (id.length < 20) {
    const bytes = new Uint8Array(40);
    fill(bytes);
    for (const byte of bytes) {
      if (byte < 248 && id.length < 20) id += ID_ALPHABET[byte % 62];
    }
  }
  return id;
}

// ⚠️ An id that could name a different path never reaches Firestore.
function checkId(id: unknown): string {
  if (typeof id !== 'string' || !id || id.includes('/') || id === '.' || id === '..') {
    throw new Error(`Not a document id: ${JSON.stringify(id)}`);
  }
  return id;
}

export function createFirestoreSuppliersSource(
  firestore: () => Promise<FirestoreKit>,
  call: CallFunction,
  locationId: string,
): SuppliersSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const suppliersPath = buildPath(locationId, SUPPLIERS);
  const ingredientsPath = buildPath(locationId, INGREDIENTS);
  const pricesPath = buildPath(locationId, INGREDIENT_PRICES);
  const configPath = buildPath(locationId, CONFIG);
  const draftsPath = buildPath(locationId, DRAFTS);
  const recipesPath = buildPath(locationId, RECIPES);
  const productsPath = buildPath(locationId, PRODUCTS);
  const collectionPaths: Record<string, string> = { ingredients: ingredientsPath, 'ingredient-prices': pricesPath };

  // The venue stamp is applied HERE, LAST, never by a caller: the rules require `bakery` to name the folder written to
  // (stampedFor). `id` is never a field (the rules' closed key lists would refuse the whole write).
  const withBakery = (data: Readonly<Record<string, unknown>>) => {
    const out: Record<string, unknown> = { ...data };
    delete out.id;
    return { ...out, bakery: locationId };
  };

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment.
  function listen(subscribe: (kit: FirestoreKit) => () => void, onError: (err: unknown) => void): () => void {
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

  const docsOf = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): StoredDoc[] =>
    snap.docs.map(d => ({ ...d.data(), id: d.id }));

  return {
    newSupplierId: () => makeSupplierId(),

    // ⚠️ includeMetadataChanges: without it, the server's answer that is IDENTICAL to the browser's copy is never
    // reported, and the store would never learn that the list is the server's (an empty one would say «Loading…» for
    // ever).
    watchSuppliers: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, suppliersPath) as Query,
      { includeMetadataChanges: true },
      snap => onChange(docsOf(snap), { fromServer: !snap.metadata.fromCache }),
      err => {
        console.error('watch(suppliers) failed:', err);
        onError(err);
      },
    ), onError),

    watchIngredients: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, ingredientsPath) as Query,
      { includeMetadataChanges: true },
      snap => onChange(docsOf(snap), { fromServer: !snap.metadata.fromCache }),
      err => {
        console.error('watch(ingredients) failed:', err);
        onError(err);
      },
    ), onError),

    // ⚠️ includeMetadataChanges IS WHAT LETS AN EMPTY COLLECTION BECOME «READABLE» (the current app's bug of 6 Oct 2026):
    // without it the server's confirmation of an empty cached answer changes no document and is never reported.
    // ⚠️ AN EMPTY ANSWER FROM THE BROWSER'S OWN DATABASE PROVES NOTHING: the server's refusal may not have arrived yet.
    // ⚠️ QUIET (warn): an employee is refused this collection in most venues, and that is the rules working.
    watchPrices: onChange => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, pricesPath) as Query,
      { includeMetadataChanges: true },
      snap => {
        const map: Record<string, Record<string, unknown>> = {};
        snap.forEach(d => { map[d.id] = d.data(); });
        onChange(map, !snap.metadata.fromCache || !snap.empty);
      },
      err => {
        console.warn('watch(ingredient-prices) failed:', err);
        onChange({}, false);
      },
    ), () => onChange({}, false)),

    // ⚠️ includeMetadataChanges, for the same reason as the suppliers: a «missing» from the browser's own database is
    // confirmed only by a later report that the server said so (parity S28), and that report changes no document.
    watchOrdersConfig: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.doc(kit.db, configPath, ORDERS_DOC),
      { includeMetadataChanges: true },
      snap => onChange(
        snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null,
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.warn('watch(config/orders) failed:', err);
        onError(err);
      },
    ), onError),

    async saveSupplier(id, data) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, suppliersPath, checkId(id)), withBakery(data), { merge: true });
    },

    // ⚠️ updateDoc, NOT A MERGE (the current app merges): a supplier deleted on another phone meanwhile must not come
    // back as a document holding only `active` and the stamp — the write fails instead, and the screen says so.
    async setSupplierActive(id, active) {
      const { fs, db } = await firestore();
      await fs.updateDoc(fs.doc(db, suppliersPath, checkId(id)), withBakery({ active }));
    },

    async deleteSupplier(id) {
      const { fs, db } = await firestore();
      await fs.deleteDoc(fs.doc(db, suppliersPath, checkId(id)));
    },

    // ⚠️ arrayUnion / arrayRemove, NEVER a read-modify-write of the whole list: two managers starring at the same moment
    // must not overwrite each other (parity S29). The rules let only an owner or a manager write config/orders.
    async setFavourite(id, on) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, configPath, ORDERS_DOC), withBakery({
        favouriteSuppliers: on ? fs.arrayUnion(checkId(id)) : fs.arrayRemove(checkId(id)),
      }), { merge: true });
    },

    // ⚠️ THE LIST RIDES IN THE FIRST BATCH, so the list and the first ingredients change together or not at all; batches
    // of at most WRITES_PER_BATCH documents (header). ⚠️ batch.update(), NOT A MERGE: an ingredient deleted meanwhile on
    // another phone must not come back as a nameless document — that batch fails instead and the screen says so.
    // ⚠️ EVERY BATCH IS COMMITTED AT ONCE, NOT ONE AFTER THE OTHER (the current app awaits each): Firestore keeps one
    // client's writes in order and holds the unsent ones in its own queue, so offline the change is on screen at once and
    // reaches the server later, instead of the second batch waiting in memory for the first one's answer.
    // ⚠️ ACCEPTED: if the first batch is refused the later ones may still land; the partial state is accepted, and a second
    // delete of the same category finishes the job.
    async deleteCategory(shortenedList, ids) {
      const { fs, db } = await firestore();
      const commits: Promise<void>[] = [];
      for (const step of planBatches([...ids], WRITES_PER_BATCH, true)) {
        const batch = fs.writeBatch(db);
        if (step.config) {
          batch.set(fs.doc(db, configPath, ORDERS_DOC), withBakery({ ingredientCategories: [...shortenedList] }), { merge: true });
        }
        for (const id of step.ids) {
          batch.update(fs.doc(db, ingredientsPath, checkId(id)), withBakery(categoryPatch(NO_CATEGORY)));
        }
        commits.push(batch.commit());
      }
      await Promise.all(commits);
    },

    newIngredientId: () => makeSupplierId(),

    async saveIngredient(id, data) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, ingredientsPath, checkId(id)), withBakery(data), { merge: true });
    },

    // ⚠️ ONE BATCH, AND THE PRICE DOCUMENT ONLY WHEN `withPrice` (deletePlan's header): a price delete the rules refuse
    // would fail the whole batch, and the ingredient with it.
    async deleteIngredient(id, withPrice) {
      const { fs, db } = await firestore();
      const batch = fs.writeBatch(db);
      for (const step of deletePlan({ id: checkId(id), mayPrice: withPrice })) {
        const path = collectionPaths[step.collection];
        if (!path) throw new Error(`Not a collection this card deletes from: ${step.collection}`);
        batch.delete(fs.doc(db, path, step.id));
      }
      await batch.commit();
    },

    // ⚠️ updateDoc, as the current app's clearFields: no draft means nothing to clear, and the write fails rather than
    // creating a draft that holds nothing. ⚠️ A FieldPath, never the dotted string: an id is data, not a path.
    async clearDraftEntry(id) {
      const { fs, db } = await firestore();
      await fs.updateDoc(
        fs.doc(db, draftsPath, DRAFT_ID),
        new fs.FieldPath('entries', checkId(id)), fs.deleteField(),
        'updatedAt', new Date().toISOString(),
        'bakery', locationId,
      );
    },

    async readDraftEntry(id) {
      const { fs, db } = await firestore();
      const snap = await fs.getDoc(fs.doc(db, draftsPath, DRAFT_ID));
      const entries = snap.exists() ? (snap.data() as Record<string, unknown>).entries : null;
      const entry = entries && typeof entries === 'object' ? (entries as Record<string, unknown>)[checkId(id)] : null;
      return entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...(entry as Record<string, unknown>) } : null;
    },

    // A MERGE of the one line's unit (js/orders/draft.js freezeUnitInDraft): the quantity and every other line stay.
    async setDraftEntryUnit(id, unit) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, draftsPath, DRAFT_ID), withBakery({
        updatedAt: new Date().toISOString(),
        entries: { [checkId(id)]: { unit } },
      }), { merge: true });
    },

    // ⚠️ FROM THE SERVER, NOT THE BROWSER'S OWN DATABASE: a copy can miss a recipe somebody wrote on another phone, and a
    // count that is too low is the false comfort F5 exists to remove. Each collection on its own: Food cost off refuses
    // the products and leaves the recipes countable (firestore.rules: recipes read with the Catalogue OR Food cost on).
    async readUsage(id) {
      const { fs, db } = await firestore();
      const count = async (path: string, key: 'recipes' | 'products'): Promise<number | null> => {
        try {
          const snap = await fs.getDocsFromServer(fs.collection(db, path) as Query);
          return findUsage(checkId(id), { [key]: docsOf(snap) }).length;
        } catch (err) {
          console.warn(`count(${key}) failed:`, err);
          return null;
        }
      };
      const [recipes, products] = await Promise.all([count(recipesPath, 'recipes'), count(productsPath, 'products')]);
      return { recipes, products };
    },

    // ⚠️ ONE SWITCH AT A TIME, DELIBERATELY (js/orders/firebase-features.js): sending both would let a screen drawn before
    // somebody else's change put the other switch back to what it was showing.
    async setIngredientPanel(key, on) {
      await call('setIngredientPanels', { locationId, [key]: on }, PANEL_TIMEOUT_MS);
    },
  };
}
