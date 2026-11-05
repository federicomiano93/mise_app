// foodcostSource.ts — Food cost's data in Firestore, and nothing else.
//
// A port of js/foodcost/firebase-foodcost.js, write for write, because firestore.rules (the
// `products`, `products/{id}/snapshots`, `foodcost-settings` and `recipes` blocks) accept exactly
// these shapes and nothing else. Behind an interface, so the store (foodcostStore.ts) is a spec with
// a fake source and never needs a database to be tested.
//
// Under the open venue:
//   • products/{id} — a finished product. Its own. Written WHOLE.
//   • products/{id}/snapshots/{auto} — its margin history, append-only, written in the SAME batch.
//   • foodcost-settings/main — what an hour of work costs. Read and written only by whoever runs the
//     place (the rules say so; the store never even listens for anybody else).
//   • recipes — the catalogue's, READ to cost a product; and THREE fields of one written: the oven
//     loss weighed on a product's recipe line. Nothing else of a recipe is ever written from here.
//   • ingredients + ingredient-prices — Orders' (Suppliers'), READ for ingredient lines and packaging.
//
// ⚠️ NO ROLE IS READ HERE, ON PURPOSE (the Stocktake's rule): the section gate and firestore.rules
// decide; who may see the labour rate is decided by the store from the session, and enforced by
// the rules whatever any screen does (P2).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its
// settings are fixed by its first use (src/firestore-access.spec.ts).

import { buildPath } from '@mise/shared/location-id';
import { withPrices } from '@mise/shared/price-model';
import type { DocumentReference, Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as the store reads it: its id beside its fields.
export type StoredDoc = { readonly id: string } & Record<string, unknown>;

// What a snapshot of the products says about where it came from: true when the SERVER sent it,
// false when it came from the browser's own database (possibly empty because this phone never
// synced it — the Pastries' trap, so the store must be able to tell).
export interface ProductsMeta {
  readonly fromServer: boolean;
}

// The three fields a weighing writes onto a recipe.
export interface RecipeLossPatch {
  readonly lossPct: number;
  readonly rawGrams: number;
  readonly cookedGrams: number;
}

export interface FoodcostSource {
  // A new product id, made on the phone with no write, so a new product can be on screen (and in
  // the local copy) before the network has heard of it — instantly, and offline.
  newProductId(): string;
  // The products, live. Returns the unsubscribe at once (Firestore may still be loading).
  watchProducts(
    onChange: (list: StoredDoc[], meta: ProductsMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // The catalogue's recipes, live. Fails quietly in the store (a venue may not use the catalogue).
  // `meta.fromServer` is the products' word: only the server can say a recipe does not exist (a recipe
  // address from Food cost's entry waits for it). Absent counts as «not from the server».
  watchRecipes(onChange: (list: StoredDoc[], meta?: ProductsMeta) => void, onError: (err: unknown) => void): () => void;
  // The ingredients with their prices laid on (withPrices), live. Nothing is emitted until the
  // ingredients themselves have arrived; a refused price read emits them unpriced.
  watchIngredients(onChange: (list: StoredDoc[]) => void, onError: (err: unknown) => void): () => void;
  // foodcost-settings/main, live: its fields, or null when it does not exist OR cannot be read.
  // `meta.fromServer` tells «the server says there is none» from «this phone's own database has no
  // copy» (offline, a device that never read it): only the first is an answer. A refusal counts as
  // the server's word. ⚠️ Call it only for whoever runs the place.
  watchSettings(onChange: (data: Record<string, unknown> | null, meta: { readonly fromServer: boolean }) => void): () => void;
  // A product, WHOLE, and when given its margin point, in ONE batch. Resolves when the server has
  // both (offline: never); rejects when either is refused.
  saveProduct(id: string, data: Readonly<Record<string, unknown>>, snapshot: Readonly<Record<string, unknown>> | null): Promise<void>;
  // The oven loss onto a recipe: three fields, never the whole recipe.
  saveRecipeLoss(id: string, patch: RecipeLossPatch): Promise<void>;
  removeProduct(id: string): Promise<void>;
  // A product's margin history, newest first, at most `max`. Read once, never watched.
  getProductHistory(productId: string, max?: number): Promise<StoredDoc[]>;
  // The hourly labour cost (null clears it), merged with its stamp.
  saveLabourCostPerHour(rate: number | null, updatedAt: string): Promise<void>;
}

const PRODUCTS = 'products';
const SNAPSHOTS = 'snapshots';
const RECIPES = 'recipes';
const INGREDIENTS = 'ingredients';
// What each ingredient COSTS. A separate collection, because Orders must read every ingredient to
// work at all (js/price-model.js says why).
const INGREDIENT_PRICES = 'ingredient-prices';
const SETTINGS = 'foodcost-settings';
const SETTINGS_DOC = 'main';
// How many margin points the history reads: the current app's `max = 30`.
export const HISTORY_LIMIT = 30;

// Firestore's own document id alphabet and length (its autoId): 20 characters of 62 → about 119
// bits, so two phones never mint the same one. Made here rather than with doc(collection()).id
// because Firestore may not be loaded yet when somebody taps «+» on a cold start, and the id is
// needed at once.
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function makeDocumentId(fill: (bytes: Uint8Array<ArrayBuffer>) => void = b => { crypto.getRandomValues(b); }): string {
  let id = '';
  // 248 is the largest multiple of 62 under 256: rejecting the bytes above it keeps every
  // character equally likely.
  while (id.length < 20) {
    const bytes = new Uint8Array(40);
    fill(bytes);
    for (const byte of bytes) {
      if (byte < 248 && id.length < 20) id += ID_ALPHABET[byte % 62];
    }
  }
  return id;
}

// ⚠️ A product id or a recipe id that could name a different path never reaches Firestore.
function checkId(id: unknown): string {
  if (typeof id !== 'string' || !id || id.includes('/') || id === '.' || id === '..') {
    throw new Error(`Not a document id: ${JSON.stringify(id)}`);
  }
  return id;
}

export function createFirestoreFoodcostSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
): FoodcostSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const productsPath = buildPath(locationId, PRODUCTS);
  const recipesPath = buildPath(locationId, RECIPES);
  const ingredientsPath = buildPath(locationId, INGREDIENTS);
  const pricesPath = buildPath(locationId, INGREDIENT_PRICES);
  const settingsPath = buildPath(locationId, SETTINGS);

  // The venue stamp is applied HERE, never by a caller: the rules require `bakery` to name the
  // folder written to (stampedFor).
  const withBakery = (data: Readonly<Record<string, unknown>>) => ({ ...data, bakery: locationId });

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment.
  // ⚠️ onSnapshot does NOT resubscribe after an error; onError lets the screen say so.
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
    newProductId: () => makeDocumentId(),

    // ⚠️ includeMetadataChanges: without it, the server's answer that is IDENTICAL to the browser's
    // copy is never reported, and the store would never learn that the list is the server's.
    watchProducts: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, productsPath) as Query,
      { includeMetadataChanges: true },
      snap => onChange(docsOf(snap), { fromServer: !snap.metadata.fromCache }),
      err => {
        console.error('watch(products) failed:', err);
        onError(err);
      },
    ), onError),

    // QUIET: the catalogue's collection; a venue may not use it.
    watchRecipes: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, recipesPath) as Query,
      // Same reason as the products: without it the server's answer that equals the browser's copy
      // is never reported.
      { includeMetadataChanges: true },
      snap => onChange(docsOf(snap), { fromServer: !snap.metadata.fromCache }),
      err => {
        console.warn('watch(recipes) failed:', err);
        onError(err);
      },
    ), onError),

    // ⚠️ NOTHING IS EMITTED UNTIL THE INGREDIENTS HAVE ARRIVED: the prices can land first, and
    // emitting then would paint every line «no longer exists» for a frame.
    // ⚠️ THE PRICE HALF FAILS QUIETLY: a venue may have no prices; an unpriced line says so already.
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
            ingredients = docsOf(snap);
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

    // A refusal reads as «no rate»: the screen then simply shows no labour money.
    // ⚠️ includeMetadataChanges, for the same reason as the products: the server's answer identical
    // to the cached one is otherwise never reported, and a cached «missing» would never be confirmed.
    watchSettings: onChange => listen(kit => kit.fs.onSnapshot(
      kit.fs.doc(kit.db, settingsPath, SETTINGS_DOC),
      { includeMetadataChanges: true },
      snap => onChange(snap.exists() ? snap.data() : null, { fromServer: !snap.metadata.fromCache }),
      err => {
        console.warn('watchFoodcostSettings failed:', err);
        onChange(null, { fromServer: true });
      },
    ), () => onChange(null, { fromServer: true })),

    // ⚠️ THE BATCH IS THE POINT: done as two writes the margin point could fail alone, leaving a
    // product whose history has no record of the change just made. Either both land or neither.
    // ⚠️ WHOLE, NOT MERGED: the store has computed the exact document, and a merge would keep a line
    // removed from the list alive in Firestore.
    async saveProduct(id, data, snapshot) {
      const { fs, db } = await firestore();
      const ref: DocumentReference = fs.doc(db, productsPath, checkId(id));
      const batch = fs.writeBatch(db);
      batch.set(ref, withBakery(data));
      if (snapshot) batch.set(fs.doc(fs.collection(db, productsPath, id, SNAPSHOTS)), withBakery(snapshot));
      await batch.commit();
    },

    // ⚠️ THREE FIELDS, NEVER THE WHOLE RECIPE: the catalogue owns its name, rows and steps, and a
    // whole write from a copy read minutes ago would put back whatever it changed since.
    // ⚠️ updateDoc, NOT setDoc: a recipe deleted meanwhile must fail, not come back nameless.
    // ⚠️ `bakery` TRAVELS WITH IT: the rules judge the merged document and want it to name the venue.
    async saveRecipeLoss(id, patch) {
      const { fs, db } = await firestore();
      await fs.updateDoc(fs.doc(db, recipesPath, checkId(id)), withBakery({
        lossPct: patch.lossPct,
        rawGrams: patch.rawGrams,
        cookedGrams: patch.cookedGrams,
      }));
    },

    async removeProduct(id) {
      const { fs, db } = await firestore();
      await fs.deleteDoc(fs.doc(db, productsPath, checkId(id)));
    },

    // ⚠️ ORDERED BY THE recordedAt FIELD, never by document id: Firestore refuses a descending scan
    // by key (a trap this project has lost a release to twice). Read on demand, never watched, so a
    // series that grows for years costs nothing on the screens that do not ask for it (P14).
    async getProductHistory(productId, max = HISTORY_LIMIT) {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.query(
        fs.collection(db, productsPath, checkId(productId), SNAPSHOTS),
        fs.orderBy('recordedAt', 'desc'),
        fs.limit(max),
      ));
      return docsOf(snap);
    },

    // A MERGE with the stamp, so a field added to this document later is never wiped by a screen
    // that only knows the rate. Never deleted: clearing is a write of null.
    async saveLabourCostPerHour(rate, updatedAt) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, settingsPath, SETTINGS_DOC), withBakery({
        labourCostPerHour: rate,
        updatedAt,
      }), { merge: true });
    },
  };
}
