import { vi } from 'vitest';
import { withPrices } from '@mise/shared/price-model';
import type { FoodcostSource, ProductsMeta, RecipeLossPatch, StoredDoc } from '../foodcost/foodcostSource';

// A Food cost source for the specs of screens, in memory: products, recipes, ingredients, their
// prices, the settings and the margin history are plain maps; a save lands at once (or is refused,
// with `refuse`), and every live watcher is told, like Firestore would. The store itself is covered
// against its own fake in foodcostStore.spec.ts; a screen's spec only needs a database that behaves.
type ProductsListener = { onChange: (list: StoredDoc[], meta: ProductsMeta) => void; onError: (err: unknown) => void };
type ListListener = { onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void };
// This fake is a database that is online: every answer comes from the server.
const FROM_SERVER: ProductsMeta = { fromServer: true };

export type FakeFoodcostSource = FoodcostSource & {
  products: Map<string, StoredDoc>;
  recipes: Map<string, StoredDoc>;
  ingredients: Map<string, StoredDoc>;
  prices: Map<string, Record<string, unknown>>;
  settings: Record<string, unknown> | null;
  history: Map<string, StoredDoc[]>;
  // The next calls of this kind fail.
  refuse: { save: boolean; loss: boolean; remove: boolean; rate: boolean; history: boolean; products: boolean };
  // Every write that reached the source, in order.
  saved: { kind: 'product' | 'loss' | 'remove' | 'rate'; id?: string; data?: unknown; snapshot?: unknown }[];
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Holds back the first answer of the products until release() (Firestore still loading).
  hold(): void;
  release(): void;
};

export function fakeFoodcostSource(seed: {
  products?: StoredDoc[];
  recipes?: StoredDoc[];
  ingredients?: StoredDoc[];
  prices?: Record<string, Record<string, unknown>>;
  settings?: Record<string, unknown> | null;
  history?: Record<string, StoredDoc[]>;
} = {}): FakeFoodcostSource {
  const products = new Map((seed.products ?? []).map(doc => [doc.id, doc] as const));
  const recipes = new Map((seed.recipes ?? []).map(doc => [doc.id, doc] as const));
  const ingredients = new Map((seed.ingredients ?? []).map(doc => [doc.id, doc] as const));
  const prices = new Map(Object.entries(seed.prices ?? {}));
  const history = new Map(Object.entries(seed.history ?? {}));
  const productWatchers = new Set<ProductsListener>();
  const recipeWatchers = new Set<ListListener>();
  const ingredientWatchers = new Set<ListListener>();
  const settingsWatchers = new Set<(data: Record<string, unknown> | null, meta: { readonly fromServer: boolean }) => void>();
  const refuse = { save: false, loss: false, remove: false, rate: false, history: false, products: false };
  const saved: FakeFoodcostSource['saved'] = [];
  let held = false;
  let ids = 0;

  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
  const priced = () => withPrices([...ingredients.values()], Object.fromEntries(prices)) as StoredDoc[];

  const fake: FakeFoodcostSource = {
    products, recipes, ingredients, prices, history, refuse, saved,
    settings: seed.settings === undefined ? null : seed.settings,

    push() {
      if (!held) for (const w of productWatchers) w.onChange([...products.values()], FROM_SERVER);
      for (const w of recipeWatchers) w.onChange([...recipes.values()]);
      for (const w of ingredientWatchers) w.onChange(priced());
      for (const w of settingsWatchers) w(fake.settings, { fromServer: true });
    },
    hold() { held = true; },
    release() { held = false; fake.push(); },

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
      const listener: ListListener = { onChange, onError };
      recipeWatchers.add(listener);
      queueMicrotask(() => { if (recipeWatchers.has(listener)) onChange([...recipes.values()]); });
      return () => { recipeWatchers.delete(listener); };
    }),

    watchIngredients: vi.fn<FoodcostSource['watchIngredients']>((onChange, onError) => {
      const listener: ListListener = { onChange, onError };
      ingredientWatchers.add(listener);
      queueMicrotask(() => { if (ingredientWatchers.has(listener)) onChange(priced()); });
      return () => { ingredientWatchers.delete(listener); };
    }),

    watchSettings: vi.fn<FoodcostSource['watchSettings']>(onChange => {
      settingsWatchers.add(onChange);
      queueMicrotask(() => { if (settingsWatchers.has(onChange)) onChange(fake.settings, { fromServer: true }); });
      return () => { settingsWatchers.delete(onChange); };
    }),

    saveProduct: vi.fn<FoodcostSource['saveProduct']>(async (id, data, snapshot) => {
      if (refuse.save) throw refused();
      saved.push({ kind: 'product', id, data, snapshot });
      products.set(id, { ...data, id });
      if (snapshot) history.set(id, [{ ...snapshot, id: `h${saved.length}` }, ...(history.get(id) ?? [])]);
      fake.push();
    }),

    saveRecipeLoss: vi.fn<FoodcostSource['saveRecipeLoss']>(async (id: string, patch: RecipeLossPatch) => {
      if (refuse.loss) throw refused();
      saved.push({ kind: 'loss', id, data: patch });
      const recipe = recipes.get(id);
      if (recipe) recipes.set(id, { ...recipe, ...patch });
      fake.push();
    }),

    removeProduct: vi.fn<FoodcostSource['removeProduct']>(async id => {
      if (refuse.remove) throw refused();
      saved.push({ kind: 'remove', id });
      products.delete(id);
      fake.push();
    }),

    getProductHistory: vi.fn<FoodcostSource['getProductHistory']>(async productId => {
      if (refuse.history) throw refused();
      return history.get(productId) ?? [];
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
