import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { withPrices } from '@mise/shared/price-model';
import type { FoodcostSource, ProductsMeta, RecipeLossPatch, StoredDoc } from '../foodcost/foodcostSource';

// A Food cost source for the specs of screens, in memory: products, recipes, ingredients, their
// prices, the settings and the margin history are plain maps; a save lands at once (or is refused,
// with `refuse`), and every live watcher is told, like Firestore would. The store itself is covered
// against its own fake in foodcostStore.spec.ts; a screen's spec only needs a database that behaves.
type ProductsListener = { onChange: (list: StoredDoc[], meta: ProductsMeta) => void; onError: (err: unknown) => void };
type ListListener = { onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void };
type RecipesListener = { onChange: (list: StoredDoc[], meta?: ProductsMeta) => void; onError: (err: unknown) => void };
// This fake is a database that is online: every answer comes from the server — but for the recipes held back with a cached
// list (holdRecipes), which arrive first as the browser's own copy.
const FROM_SERVER: ProductsMeta = { fromServer: true };
const FROM_CACHE: ProductsMeta = { fromServer: false };

export type FakeFoodcostSource = FoodcostSource & {
  products: Map<string, StoredDoc>;
  recipes: Map<string, StoredDoc>;
  ingredients: Map<string, StoredDoc>;
  // Orders' suppliers, read for their names (step 4).
  suppliers: Map<string, StoredDoc>;
  // The categories the list groups cards by (model 4), `foodcost-categories`.
  categories: Map<string, StoredDoc>;
  prices: Map<string, Record<string, unknown>>;
  settings: Record<string, unknown> | null;
  history: Map<string, StoredDoc[]>;
  // The bookings price list as stored (null: never published). `publishedAt` is a fake timestamp.
  priceList: Record<string, unknown> | null;
  // The server's answer about the price list is held back until releasePriceList(): a phone offline that never read it.
  holdPriceList(): void;
  releasePriceList(): void;
  // The next calls of this kind fail.
  // `recipes`: the recipes' stream fails when it is opened.
  // `category`: a category's save or removal is refused.
  // `newRecipe`: Cakes' recipe-with-its-card batch is refused (both documents or neither).
  refuse: { save: boolean; create: boolean; loss: boolean; remove: boolean; rate: boolean; history: boolean; products: boolean; recipes: boolean; publish?: boolean; category?: boolean; newRecipe?: boolean };
  // Every write that reached the source, in order.
  // `companion` is the cake that travelled in the same batch (Cakes); the fake also keeps it in `cakes`.
  saved: { kind: 'product' | 'create' | 'new-recipe' | 'loss' | 'remove' | 'rate' | 'category' | 'category-remove'; id?: string; data?: unknown; snapshot?: unknown; companion?: unknown }[];
  cakes: Map<string, StoredDoc>;
  // The recipe-with-its-card batch, as a mock (what it was called with).
  createRecipeWithCard: Mock<FoodcostSource['createRecipeWithCard']>;
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Holds back the first answer of the products until release() (Firestore still loading).
  hold(): void;
  release(): void;
  // The same for the ingredients and their prices (the cost tables arrive after the products).
  holdIngredients(): void;
  releaseIngredients(): void;
  // The suppliers' first answer is held back until releaseSuppliers() (still loading, or offline with no copy).
  holdSuppliers(): void;
  releaseSuppliers(): void;
  // The suppliers' stream fails now: every live watcher gets the error (refused, a venue without Orders).
  failSuppliers(): void;
  // The server's answer about the recipes is held back until releaseRecipes(); meanwhile the watcher gets `cached` (when given),
  // marked as the browser's own copy — a phone whose copy predates a recipe, on slow Wi-Fi. Call it BEFORE the screen subscribes:
  // the copy is handed only to a watcher that subscribes while the hold is on.
  holdRecipes(cached?: StoredDoc[]): void;
  releaseRecipes(): void;
  // The recipes stream dies now (after the copy, say): every live watcher gets the error, as Firestore's listener would.
  failRecipes(): void;
};

export function fakeFoodcostSource(seed: {
  products?: StoredDoc[];
  recipes?: StoredDoc[];
  ingredients?: StoredDoc[];
  suppliers?: StoredDoc[];
  categories?: StoredDoc[];
  prices?: Record<string, Record<string, unknown>>;
  settings?: Record<string, unknown> | null;
  history?: Record<string, StoredDoc[]>;
  priceList?: Record<string, unknown> | null;
} = {}): FakeFoodcostSource {
  const products = new Map((seed.products ?? []).map(doc => [doc.id, doc] as const));
  const recipes = new Map((seed.recipes ?? []).map(doc => [doc.id, doc] as const));
  const ingredients = new Map((seed.ingredients ?? []).map(doc => [doc.id, doc] as const));
  const suppliers = new Map((seed.suppliers ?? []).map(doc => [doc.id, doc] as const));
  const categories = new Map((seed.categories ?? []).map(doc => [doc.id, doc] as const));
  const cakes = new Map<string, StoredDoc>();
  const prices = new Map(Object.entries(seed.prices ?? {}));
  const history = new Map(Object.entries(seed.history ?? {}));
  const productWatchers = new Set<ProductsListener>();
  const recipeWatchers = new Set<RecipesListener>();
  const ingredientWatchers = new Set<ListListener>();
  const supplierWatchers = new Set<ListListener>();
  const categoryWatchers = new Set<ProductsListener>();
  const settingsWatchers = new Set<(data: Record<string, unknown> | null, meta: { readonly fromServer: boolean }) => void>();
  const priceListWatchers = new Set<(data: Record<string, unknown> | null, meta: { readonly fromServer: boolean }) => void>();
  const refuse = { save: false, create: false, loss: false, remove: false, rate: false, history: false, products: false, recipes: false, publish: false, category: false, newRecipe: false };
  const saved: FakeFoodcostSource['saved'] = [];
  let held = false;
  let ingredientsHeld = false;
  let suppliersHeld = false;
  let recipesHeld = false;
  let priceListHeld = false;
  let recipesCached: StoredDoc[] | null = null;
  let ids = 0;

  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
  const priced = () => withPrices([...ingredients.values()], Object.fromEntries(prices)) as StoredDoc[];

  const fake: FakeFoodcostSource = {
    products, recipes, ingredients, suppliers, categories, cakes, prices, history, refuse, saved,
    settings: seed.settings === undefined ? null : seed.settings,
    priceList: seed.priceList ?? null,

    holdPriceList() { priceListHeld = true; },
    releasePriceList() {
      priceListHeld = false;
      for (const watcher of priceListWatchers) watcher(fake.priceList, { fromServer: true });
    },

    push() {
      if (!held) for (const w of productWatchers) w.onChange([...products.values()], FROM_SERVER);
      if (!recipesHeld) for (const w of recipeWatchers) w.onChange([...recipes.values()], FROM_SERVER);
      if (!ingredientsHeld) for (const w of ingredientWatchers) w.onChange(priced());
      if (!suppliersHeld) for (const w of supplierWatchers) w.onChange([...suppliers.values()]);
      for (const w of categoryWatchers) w.onChange([...categories.values()], FROM_SERVER);
      for (const w of settingsWatchers) w(fake.settings, { fromServer: true });
    },
    hold() { held = true; },
    release() { held = false; fake.push(); },
    holdIngredients() { ingredientsHeld = true; },
    releaseIngredients() { ingredientsHeld = false; fake.push(); },
    holdSuppliers() { suppliersHeld = true; },
    releaseSuppliers() { suppliersHeld = false; fake.push(); },
    failSuppliers() {
      for (const w of [...supplierWatchers]) { supplierWatchers.delete(w); w.onError(refused()); }
    },
    holdRecipes(cached) { recipesHeld = true; recipesCached = cached ?? null; },
    releaseRecipes() { recipesHeld = false; fake.push(); },
    failRecipes() {
      for (const w of [...recipeWatchers]) { recipeWatchers.delete(w); w.onError(refused()); }
    },

    newProductId: () => `fake-${++ids}`,

    watchProducts: vi.fn<FoodcostSource['watchProducts']>((onChange, onError) => {
      const listener: ProductsListener = { onChange, onError };
      productWatchers.add(listener);
      // Like onSnapshot: the first answer arrives after the call returns.
      queueMicrotask(() => {
        if (!productWatchers.has(listener)) return;
        if (refuse.products) {
          productWatchers.delete(listener);
          onError(refused());
        } else if (!held) {
          onChange([...products.values()], FROM_SERVER);
        }
      });
      return () => { productWatchers.delete(listener); };
    }),

    watchRecipes: vi.fn<FoodcostSource['watchRecipes']>((onChange, onError) => {
      const listener: RecipesListener = { onChange, onError };
      recipeWatchers.add(listener);
      queueMicrotask(() => {
        if (!recipeWatchers.has(listener)) return;
        if (refuse.recipes) {
          recipeWatchers.delete(listener);
          onError(refused());
        } else if (!recipesHeld) {
          onChange([...recipes.values()], FROM_SERVER);
        } else if (recipesCached !== null) {
          onChange(recipesCached, FROM_CACHE);
        }
      });
      return () => { recipeWatchers.delete(listener); };
    }),

    watchIngredients: vi.fn<FoodcostSource['watchIngredients']>((onChange, onError) => {
      const listener: ListListener = { onChange, onError };
      ingredientWatchers.add(listener);
      queueMicrotask(() => { if (ingredientWatchers.has(listener) && !ingredientsHeld) onChange(priced()); });
      return () => { ingredientWatchers.delete(listener); };
    }),

    watchSuppliers: vi.fn<FoodcostSource['watchSuppliers']>((onChange, onError) => {
      const listener: ListListener = { onChange, onError };
      supplierWatchers.add(listener);
      queueMicrotask(() => { if (supplierWatchers.has(listener) && !suppliersHeld) onChange([...suppliers.values()]); });
      return () => { supplierWatchers.delete(listener); };
    }),

    watchCategories: vi.fn<FoodcostSource['watchCategories']>((onChange, onError) => {
      const listener: ProductsListener = { onChange, onError };
      categoryWatchers.add(listener);
      queueMicrotask(() => { if (categoryWatchers.has(listener)) onChange([...categories.values()], FROM_SERVER); });
      return () => { categoryWatchers.delete(listener); };
    }),

    newCategoryId: () => `cat-${++ids}`,

    saveCategory: vi.fn<FoodcostSource['saveCategory']>(async (id, data) => {
      if (refuse.category) throw refused();
      saved.push({ kind: 'category', id, data });
      categories.set(id, { ...data, id, bakery: 'bakery' });
      fake.push();
    }),

    removeCategory: vi.fn<FoodcostSource['removeCategory']>(async id => {
      if (refuse.category) throw refused();
      saved.push({ kind: 'category-remove', id });
      categories.delete(id);
      fake.push();
    }),

    watchSettings: vi.fn<FoodcostSource['watchSettings']>(onChange => {
      settingsWatchers.add(onChange);
      queueMicrotask(() => { if (settingsWatchers.has(onChange)) onChange(fake.settings, { fromServer: true }); });
      return () => { settingsWatchers.delete(onChange); };
    }),

    saveProduct: vi.fn<FoodcostSource['saveProduct']>(async (id, data, snapshot, companion) => {
      if (refuse.save) throw refused();
      saved.push({ kind: 'product', id, data, snapshot, ...(companion ? { companion } : {}) });
      products.set(id, { ...data, id });
      if (companion) cakes.set(companion.id, { ...companion.data, id: companion.id });
      if (snapshot) history.set(id, [{ ...snapshot, id: `h${saved.length}` }, ...(history.get(id) ?? [])]);
      fake.push();
    }),

    // Asks the SERVER (the map) and writes only when nothing is there, like the transaction. `refuse.create` is the server being
    // unreachable or refusing (offline, permission-denied): it throws and nothing is written. A product put straight into `products`
    // without push() is one the store's list has not heard of yet, so a create over it must answer «already there».
    createProductIfAbsent: vi.fn<FoodcostSource['createProductIfAbsent']>(async (id, data) => {
      if (refuse.create) throw refused();
      if (products.has(id)) return false;
      saved.push({ kind: 'create', id, data });
      products.set(id, { ...data, id });
      fake.push();
      return true;
    }),

    // Both documents land together, or (refused) neither does; `saved` gets ONE entry holding both, as the batch is one write.
    createRecipeWithCard: vi.fn<FoodcostSource['createRecipeWithCard']>(async (recipeId, recipe, productId, product) => {
      if (refuse.newRecipe) throw refused();
      saved.push({ kind: 'new-recipe', id: productId, data: { recipeId, recipe, product } });
      recipes.set(recipeId, { ...recipe, id: recipeId });
      products.set(productId, { ...product, id: productId });
      fake.push();
    }),

    saveRecipeLoss: vi.fn<FoodcostSource['saveRecipeLoss']>(async (id: string, patch: RecipeLossPatch) => {
      if (refuse.loss) throw refused();
      saved.push({ kind: 'loss', id, data: patch });
      const recipe = recipes.get(id);
      if (recipe) recipes.set(id, { ...recipe, ...patch });
      fake.push();
    }),

    removeProduct: vi.fn<FoodcostSource['removeProduct']>(async (id, companion) => {
      if (refuse.remove) throw refused();
      saved.push({ kind: 'remove', id, ...(companion ? { companion } : {}) });
      products.delete(id);
      if (companion) cakes.delete(companion.id);
      fake.push();
    }),

    getProductHistory: vi.fn<FoodcostSource['getProductHistory']>(async productId => {
      if (refuse.history) throw refused();
      return history.get(productId) ?? [];
    }),

    watchPriceList: vi.fn<FoodcostSource['watchPriceList']>(onChange => {
      priceListWatchers.add(onChange);
      queueMicrotask(() => {
        if (!priceListWatchers.has(onChange)) return;
        // Held (holdPriceList): this device's own copy answers first — empty, as a phone that never read the list.
        if (priceListHeld) onChange(null, { fromServer: false });
        else onChange(fake.priceList, { fromServer: true });
      });
      return () => { priceListWatchers.delete(onChange); };
    }),

    publishPriceList: vi.fn<FoodcostSource['publishPriceList']>(async items => {
      if (refuse.publish) throw refused();
      const at = Date.now();
      fake.priceList = { bakery: 'bakery', items: items.map(item => ({ ...item })), publishedAt: { toMillis: () => at } };
      for (const watcher of priceListWatchers) watcher(fake.priceList, { fromServer: true });
    }),

    saveLabourCostPerHour: vi.fn<FoodcostSource['saveLabourCostPerHour']>(async (rate, updatedAt) => {
      if (refuse.rate) throw refused();
      saved.push({ kind: 'rate', data: { labourCostPerHour: rate, updatedAt } });
      fake.settings = { ...(fake.settings ?? {}), labourCostPerHour: rate, updatedAt };
      fake.push();
    }),
  };
  return fake;
}
