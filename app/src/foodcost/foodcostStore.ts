// foodcostStore.ts — the products, and the two borrowed lookups the costing needs (recipes and
// ingredient prices), plus the hourly labour cost for whoever runs the place. One venue.
//
// A port of js/foodcost/foodcost-store.js, decision for decision, as plain TypeScript with no React
// and no Firebase in it: the source (foodcostSource.ts) and the browser (deps) are injected, so
// every trap below is a spec with fakes (foodcostStore.spec.ts). Screens read it through
// FoodcostContext.tsx.
//
// It says nothing in words: a failure is a FoodcostMessage, and the screen puts it in the person's
// language (foodcostMessages.ts).
//
// ⚠️ WRITES ARE LOCAL-FIRST (P20): memory, the local copy and the screen move at once — offline too,
// where a write waits rather than fails — and a write the database REFUSES is rolled back and said
// out loud, so the screen never shows a save that did not happen.
//
// ⚠️ TWO DIFFERENCES FROM THE ORIGINAL, ON PURPOSE (docs/parity/foodcost.md):
//   • an EMPTY answer from the browser's own database is not believed over a local copy that had
//     products (the Pastries' trap: that database can be empty because this phone never synced it);
//   • a refused save rolls back only if no later save of the same product has been made since —
//     otherwise the rollback would put back a version older than what is now on screen.

import { PRODUCT_MODEL, normalizeProduct, normalizeProducts } from '@mise/shared/foodcost-model';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { restoreAfterRefusal } from '@mise/shared/foodcost-weighing';
import { positiveNumber } from '@mise/shared/price-model';
import type { KeyValueStorage } from '../session/backend';
import type { FoodcostSource, RecipeLossPatch, StoredDoc } from './foodcostSource';

// ⚠️ THE CURRENT APP'S KEYS, WITH THEIR MEANING (both apps share one origin): either app may paint
// from the other's copy. Not under KEEP_PREFIXES, so a venue switch wipes them. The venue is NOT in
// the key (it never was): the wipe is what keeps two venues apart.
export const PRODUCTS_KEY = 'foodcost-products';
export const RECIPES_KEY = 'foodcost-recipes';
export const INGREDIENTS_KEY = 'foodcost-ingredients';

export type FoodcostMessage =
  // A product's save was refused: it is back as it was (or gone, if it was new).
  | { readonly kind: 'product-not-saved'; readonly name: string }
  // A weighing typed on a recipe line was refused: the recipe is back as it was.
  | { readonly kind: 'loss-not-saved'; readonly name: string }
  // A delete was refused: the product is back.
  | { readonly kind: 'product-not-deleted' }
  // The hourly labour cost was refused: the old one is back.
  | { readonly kind: 'rate-not-saved' }
  // The products' live stream died.
  | { readonly kind: 'products-stream-broken' };

export interface FoodcostSnapshot {
  readonly products: readonly Product[];
  // Whether the product list can be shown: the local copy existed, or a believable answer came (or
  // the stream failed). Until then the list says «Loading…» and an address cannot open its product.
  readonly productsLoaded: boolean;
  // Whether the SERVER has answered once: only then is «this product no longer exists» the truth.
  readonly productsFromServer: boolean;
  readonly recipes: Readonly<Record<string, StoredDoc>>;
  // The recipes have answered once (or failed, or a local copy was there).
  readonly recipesLoaded: boolean;
  // The SERVER has answered about the recipes once: only then is «no such recipe» the truth.
  readonly recipesFromServer: boolean;
  readonly ingredients: Readonly<Record<string, StoredDoc>>;
  readonly ingredientsLoaded: boolean;
  // What an hour of work costs — null until it arrives, and null for ever for anybody who does not
  // run the place (nothing is ever asked for them).
  readonly labourCostPerHour: number | null;
  // The rate has answered once (always true for somebody who does not run the place: there is
  // nothing to wait for). The Settings screen copies the rate only after this.
  readonly settingsLoaded: boolean;
  // The lookup tables, in the shape the cost models expect: the SAME object until one of its three
  // parts changes, so a screen can memoise on it.
  readonly tables: CostTables;
  // Writes handed over and not yet answered. While true the section holds the session's busy marker.
  readonly unsent: boolean;
}

// What saving a product needs from the editor: the product as typed (normalised fields), its margin
// point or null, and the weighings to write onto recipes.
export interface ProductSave {
  readonly product: Product;
  readonly snapshot: Readonly<Record<string, unknown>> | null;
  readonly lossPatches: Readonly<Record<string, RecipeLossPatch>>;
}

export interface FoodcostDeps {
  // localStorage, or null when the browser will not give it (then nothing is remembered).
  readonly storage: KeyValueStorage | null;
  now(): number;
  warn(message: string, detail?: unknown): void;
}

export interface FoodcostOptions {
  // Whether this person runs the place (session.canManage). Decides ONLY whether the labour rate is
  // asked for; the rules decide everything else.
  readonly canManage: boolean;
}

export interface FoodcostStore {
  getSnapshot(): FoodcostSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: FoodcostMessage) => void): () => void;
  // Starts the listeners; stop() ends them. Safe to call start → stop → start (React's development
  // mode does exactly that). Writes in the air are not cut short by stop().
  start(): void;
  stop(): void;
  // A new product id, made on the phone (no write).
  newProductId(): string;
  // Saves a product LOCAL-FIRST and returns its id at once.
  saveProduct(save: ProductSave): string;
  deleteProduct(id: string): void;
  // The hourly labour cost (null clears it), local-first.
  saveLabourRate(rate: number | null): void;
  // A product's margin history, read once.
  getProductHistory(productId: string): Promise<StoredDoc[]>;
}

// The fields of a product document, listed BY HAND: this object becomes the Firestore document and
// the rules whitelist exactly these — spreading the product would send `id` and every save would be
// refused. `model` is always the app's: the rules refuse a save without it over a product that has
// it, so an older phone cannot delete ingredient lines and packs in silence.
export function toProductDocument(product: Product): Record<string, unknown> {
  return {
    name: product.name,
    components: product.components ?? [],
    packaging: product.packaging ?? [],
    sellingMode: product.sellingMode ?? null,
    piecesPerBatch: product.piecesPerBatch ?? null,
    packSize: product.packSize ?? null,
    packUnit: product.packUnit ?? null,
    sellingPrice: product.sellingPrice ?? null,
    vatRate: product.vatRate ?? null,
    foodCostTarget: product.foodCostTarget ?? null,
    labourMinutes: product.labourMinutes ?? null,
    labourPeople: product.labourPeople ?? null,
    model: PRODUCT_MODEL,
  };
}

function indexById(list: unknown): Record<string, StoredDoc> {
  const out: Record<string, StoredDoc> = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (item && typeof item === 'object' && typeof (item as StoredDoc).id === 'string' && (item as StoredDoc).id) {
      out[(item as StoredDoc).id] = item as StoredDoc;
    }
  }
  return out;
}

export function createFoodcostStore(
  source: FoodcostSource,
  options: FoodcostOptions,
  deps: FoodcostDeps,
): FoodcostStore {
  // A corrupt or unavailable copy reads as «none»; the listener fills it in.
  function readJson(key: string): unknown {
    try {
      const raw = deps.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function writeJson(key: string, value: unknown): void {
    try {
      deps.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the copy in memory still works this session.
    }
  }

  const bootProducts = readJson(PRODUCTS_KEY);
  const bootRecipes = readJson(RECIPES_KEY);
  const bootIngredients = readJson(INGREDIENTS_KEY);
  // ⚠️ ONLY A COPY THAT SAYS «NO PRODUCTS» MAY LET AN EMPTY CACHED ANSWER STAND (see believable()).
  const bootSaidNone = Array.isArray(bootProducts) && bootProducts.length === 0;

  let products: readonly Product[] = normalizeProducts(bootProducts) as Product[];
  let productsLoaded = Array.isArray(bootProducts);
  let productsFromServer = false;
  let productsStreamFailed = false;
  let recipes: Readonly<Record<string, StoredDoc>> = indexById(bootRecipes);
  let recipesLoaded = Array.isArray(bootRecipes);
  let recipesFromServer = false;
  let ingredients: Readonly<Record<string, StoredDoc>> = indexById(bootIngredients);
  let ingredientsLoaded = Array.isArray(bootIngredients);
  let labourCostPerHour: number | null = null;
  let settingsLoaded = !options.canManage;
  let inFlight = 0;

  // Which save of each product is the latest: a refusal rolls back only its own save.
  const saveSeq = new Map<string, number>();
  let seq = 0;

  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: FoodcostMessage) => void>();
  let stops: Array<() => void> = [];
  let started = false;

  let tables: CostTables = { recipes, ingredients, labourCostPerHour };
  let snapshot: FoodcostSnapshot = build();

  function build(): FoodcostSnapshot {
    if (tables.recipes !== recipes || tables.ingredients !== ingredients || tables.labourCostPerHour !== labourCostPerHour) {
      tables = { recipes, ingredients, labourCostPerHour };
    }
    return {
      products, productsLoaded, productsFromServer, recipes, recipesLoaded, recipesFromServer, ingredients, ingredientsLoaded,
      labourCostPerHour, settingsLoaded, tables, unsent: inFlight > 0,
    };
  }

  function changed(): void {
    snapshot = build();
    for (const listener of [...listeners]) listener();
  }

  function say(message: FoodcostMessage): void {
    for (const listener of [...messageListeners]) listener(message);
  }

  // A write handed to Firestore. Counted while in the air; `onRefused` runs when it is refused.
  function track(write: Promise<void>, onRefused: (err: unknown) => void): void {
    inFlight += 1;
    changed();
    write.then(() => undefined, err => onRefused(err)).finally(() => {
      inFlight -= 1;
      changed();
    });
  }

  // ⚠️ AN EMPTY ANSWER FROM THE BROWSER'S OWN DATABASE IS NOT THE TRUTH unless the local copy agreed
  // there were none: that database can be empty because this phone never synced the products, and
  // believing it would show «No products yet» over a venue that has twenty.
  function believable(list: readonly StoredDoc[], fromServer: boolean): boolean {
    return fromServer || list.length > 0 || bootSaidNone;
  }

  // ⚠️ WHEN THE PRODUCTS' STREAM IS ALIVE, A REFUSAL IS UNDONE BY IT: the SDK shows the database
  // without the refused write (in a snapshot it sends before it rejects the promise). Putting back
  // `prev` on top would replace that with the version this phone held before saving, which can be
  // OLDER than what the server now has (another phone's save), or a new product's first, never-saved
  // version after a second refusal. Only with no live stream is the rollback the store's to do.
  function listenerWillRevert(): boolean {
    return productsFromServer && !productsStreamFailed;
  }

  function upsertLocal(product: Product): void {
    const index = products.findIndex(p => p.id === product.id);
    const next = products.slice();
    if (index >= 0) next[index] = product; else next.push(product);
    products = next;
    writeJson(PRODUCTS_KEY, products);
    changed();
  }

  function removeLocal(id: string): void {
    products = products.filter(p => p.id !== id);
    writeJson(PRODUCTS_KEY, products);
    changed();
  }

  // The weighings typed on a product's recipe lines, LOCAL-FIRST like the product.
  // ⚠️ ONE WRITE PER RECIPE, AND NOT INSIDE THE PRODUCT'S BATCH: the recipe rule and the product
  // rule each spend reads, and a batch shares ONE read budget; a product with several recipes would
  // reach the ceiling and refuse the whole save. Kept apart, a refused weighing costs only itself.
  function saveRecipeLosses(patches: Readonly<Record<string, RecipeLossPatch>>): void {
    for (const [id, patch] of Object.entries(patches)) {
      const prev = recipes[id];
      if (!prev) continue;
      recipes = { ...recipes, [id]: { ...prev, ...patch } };
      writeJson(RECIPES_KEY, Object.values(recipes));
      changed();
      track(source.saveRecipeLoss(id, patch), err => {
        deps.warn('Recipe loss did not sync to Firestore:', err);
        // Put back only what this write changed, and only if nothing newer has landed on top.
        const restored = restoreAfterRefusal(recipes[id], prev, patch) as StoredDoc | null;
        if (restored) {
          recipes = { ...recipes, [id]: restored };
          writeJson(RECIPES_KEY, Object.values(recipes));
          changed();
        }
        say({ kind: 'loss-not-saved', name: String(prev.name ?? '') });
      });
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
      if (started) return;
      started = true;

      stops.push(source.watchProducts(
        (remote, meta) => {
          if (meta.fromServer) productsFromServer = true;
          if (!believable(remote, meta.fromServer)) return;
          products = normalizeProducts(remote) as Product[];
          productsLoaded = true;
          writeJson(PRODUCTS_KEY, remote);
          changed();
        },
        err => {
          deps.warn('Food cost live sync failed:', err);
          productsStreamFailed = true;
          // A dead stream still ends the wait: the list shows what it has, and says why it may be old.
          productsLoaded = true;
          changed();
          say({ kind: 'products-stream-broken' });
        },
      ));

      // Borrowed from the catalogue and from Orders. Quiet on failure: they belong to other
      // sections, and a venue may legitimately not use them — a failure only ends the wait.
      stops.push(source.watchRecipes(
        (remote, meta) => {
          if (meta?.fromServer) recipesFromServer = true;
          recipes = indexById(remote);
          recipesLoaded = true;
          writeJson(RECIPES_KEY, remote);
          changed();
        },
        () => {
          recipesLoaded = true;
          changed();
        },
      ));

      stops.push(source.watchIngredients(
        remote => {
          ingredients = indexById(remote);
          ingredientsLoaded = true;
          writeJson(INGREDIENTS_KEY, remote);
          changed();
        },
        () => {
          ingredientsLoaded = true;
          changed();
        },
      ));

      // ⚠️ THE HOURLY LABOUR COST IS WATCHED ONLY FOR WHOEVER RUNS THE PLACE: an employee's listener
      // would be refused (noise and a wasted read), and the rate is a wage figure they are not meant
      // to see. Never written to the phone's storage either, so it never lingers on a shared phone.
      if (options.canManage) {
        stops.push(source.watchSettings((settings, meta) => {
          // ⚠️ A «MISSING» FROM THIS PHONE'S OWN DATABASE IS NOT AN ANSWER: offline, a device that never
          // read the document has no copy of it, and Settings opened on that would show an empty box
          // whose Save clears the real rate. It waits for the server (or a copy that exists).
          if (!settings && !meta.fromServer) return;
          labourCostPerHour = positiveNumber(settings ? settings.labourCostPerHour : null);
          settingsLoaded = true;
          changed();
        }));
      }
    },

    stop() {
      started = false;
      for (const stop of stops) stop();
      stops = [];
    },

    newProductId: () => source.newProductId(),

    // ⚠️ THE ID IS MADE HERE (or kept), NEVER BY THE DATA LAYER: the product is on screen under it
    // at once, and a second id minted later would write a different document — two products, one of
    // them invisible, and the rollback would remove the wrong one.
    saveProduct({ product, snapshot: point, lossPatches }) {
      const id = product.id || source.newProductId();
      saveRecipeLosses(lossPatches);
      const data = toProductDocument(product);
      const prev = products.find(p => p.id === id) ?? null;
      const mine = ++seq;
      saveSeq.set(id, mine);
      upsertLocal(normalizeProduct({ id, ...data }) as Product);
      track(source.saveProduct(id, data, point), err => {
        deps.warn('Product did not sync to Firestore:', err);
        if (saveSeq.get(id) === mine && !listenerWillRevert()) {
          if (prev) upsertLocal(prev); else removeLocal(id);
        }
        say({ kind: 'product-not-saved', name: product.name });
      });
      return id;
    },

    deleteProduct(id) {
      const prev = products.find(p => p.id === id) ?? null;
      const mine = ++seq;
      saveSeq.set(id, mine);
      removeLocal(id);
      track(source.removeProduct(id), err => {
        deps.warn('Product delete did not sync to Firestore:', err);
        if (prev && saveSeq.get(id) === mine && !listenerWillRevert()) upsertLocal(prev);
        say({ kind: 'product-not-deleted' });
      });
    },

    saveLabourRate(rate) {
      const prev = labourCostPerHour;
      const next = positiveNumber(rate);
      labourCostPerHour = next;
      changed();
      track(source.saveLabourCostPerHour(next, new Date(deps.now()).toISOString()), err => {
        deps.warn('The hourly labour cost did not sync to Firestore:', err);
        // Only if nothing newer has arrived meanwhile (another save, or the listener).
        if (labourCostPerHour === next) {
          labourCostPerHour = prev;
          changed();
        }
        say({ kind: 'rate-not-saved' });
      });
    },

    getProductHistory: productId => source.getProductHistory(productId),
  };
}

export function browserFoodcostDeps(): FoodcostDeps {
  let storage: KeyValueStorage | null = null;
  try { storage = window.localStorage; } catch { /* blocked site data */ }
  return {
    storage,
    now: () => Date.now(),
    warn: (message, detail) => console.warn(message, detail),
  };
}
