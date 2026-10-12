import { describe, expect, test, vi } from 'vitest';
import { normalizeProduct } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import type { KeyValueStorage } from '../session/backend';
import type { FoodcostSource, ProductsMeta, RecipeLossPatch, StoredDoc } from './foodcostSource';
import { INGREDIENTS_KEY, PRODUCTS_KEY, RECIPES_KEY, createFoodcostStore, toProductDocument } from './foodcostStore';
import type { FoodcostDeps, FoodcostMessage } from './foodcostStore';

// The store against a fake source and a fake browser: every decision of the current app's
// js/foodcost/foodcost-store.js, one test each, plus the two Mise 2 differences (an empty cached
// answer is not believed over a local copy that had products; a refusal rolls back only its own save).

type Pending = { resolve: () => void; reject: (err: unknown) => void };

function fakeSource() {
  let products: { onChange: (list: StoredDoc[], meta: ProductsMeta) => void; onError: (err: unknown) => void } | null = null;
  let recipes: { onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void } | null = null;
  let ingredients: { onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void } | null = null;
  let settings: ((data: Record<string, unknown> | null) => void) | null = null;
  const stopped: string[] = [];
  const writes: { kind: string; args: unknown[]; pending: Pending }[] = [];
  let ids = 0;

  function write(kind: string, ...args: unknown[]): Promise<void> {
    return new Promise<void>((resolve, reject) => { writes.push({ kind, args, pending: { resolve, reject } }); });
  }

  const source: FoodcostSource = {
    newProductId: () => `new-${++ids}`,
    watchProducts: vi.fn((onChange, onError) => { products = { onChange, onError }; return () => stopped.push('products'); }),
    watchRecipes: vi.fn((onChange, onError) => { recipes = { onChange, onError }; return () => stopped.push('recipes'); }),
    watchIngredients: vi.fn((onChange, onError) => { ingredients = { onChange, onError }; return () => stopped.push('ingredients'); }),
    watchSettings: vi.fn(onChange => { settings = onChange; return () => stopped.push('settings'); }),
    saveProduct: (id, data, snapshot) => write('product', id, data, snapshot),
    saveRecipeLoss: (id: string, patch: RecipeLossPatch) => write('loss', id, patch),
    removeProduct: id => write('remove', id),
    getProductHistory: vi.fn(async () => [{ id: 'h1', foodCostPct: 30 }]),
    saveLabourCostPerHour: (rate, updatedAt) => write('rate', rate, updatedAt),
  };
  return {
    source, writes, stopped,
    products: (list: StoredDoc[], fromServer = true) => products!.onChange(list, { fromServer }),
    productsFail: () => products!.onError(new Error('permission-denied')),
    recipes: (list: StoredDoc[]) => recipes!.onChange(list),
    recipesFail: () => recipes!.onError(new Error('refused')),
    ingredients: (list: StoredDoc[]) => ingredients!.onChange(list),
    settings: (data: Record<string, unknown> | null) => settings!(data),
  };
}

function fakeStorage(seed: Record<string, unknown> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)] as const));
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

function setup({ canManage = true, storage = fakeStorage() }: { canManage?: boolean; storage?: KeyValueStorage | null } = {}) {
  const fake = fakeSource();
  const deps: FoodcostDeps = { storage, now: () => Date.UTC(2026, 9, 12, 9, 0), warn: vi.fn() };
  const store = createFoodcostStore(fake.source, { canManage }, deps);
  const messages: FoodcostMessage[] = [];
  store.onMessage(m => messages.push(m));
  return { fake, store, messages, storage };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function product(fields: Partial<Product> & { name: string }): Product {
  return normalizeProduct({ id: '', components: [], packaging: [], ...fields }) as Product;
}

describe('the Food cost store', () => {
  test('nothing is listened to until start(), and stop() ends every listener', () => {
    const { fake, store } = setup();
    expect(fake.source.watchProducts).not.toHaveBeenCalled();
    store.start();
    expect(fake.source.watchProducts).toHaveBeenCalledTimes(1);
    store.stop();
    expect(fake.stopped.sort()).toEqual(['ingredients', 'products', 'recipes', 'settings']);
  });

  test('start → stop → start listens again, once (React development mode)', () => {
    const { fake, store } = setup();
    store.start();
    store.start();
    store.stop();
    store.start();
    expect(fake.source.watchProducts).toHaveBeenCalledTimes(2);
  });

  test('⚠️ the labour rate is asked for ONLY for whoever runs the place', () => {
    const employee = setup({ canManage: false });
    employee.store.start();
    expect(employee.fake.source.watchSettings).not.toHaveBeenCalled();
    expect(employee.store.getSnapshot().labourCostPerHour).toBeNull();
    // Nothing to wait for: Settings is not theirs.
    expect(employee.store.getSnapshot().settingsLoaded).toBe(true);

    const manager = setup({ canManage: true });
    manager.store.start();
    expect(manager.store.getSnapshot().settingsLoaded).toBe(false);
    manager.fake.settings({ labourCostPerHour: 14.5 });
    expect(manager.store.getSnapshot().labourCostPerHour).toBe(14.5);
    expect(manager.store.getSnapshot().settingsLoaded).toBe(true);
    expect(manager.store.getSnapshot().tables.labourCostPerHour).toBe(14.5);
  });

  test('⚠️ the labour rate is never written to the phone’s storage', () => {
    const { fake, store, storage } = setup();
    store.start();
    fake.settings({ labourCostPerHour: 14.5 });
    store.saveLabourRate(16);
    const everything = [...(storage as ReturnType<typeof fakeStorage>).data.values()].join(' ');
    expect(everything).not.toContain('14.5');
    expect(everything).not.toContain('16');
  });

  test('a rate that is not a positive number reads as none', () => {
    const { fake, store } = setup();
    store.start();
    fake.settings({ labourCostPerHour: 0 });
    expect(store.getSnapshot().labourCostPerHour).toBeNull();
    fake.settings(null);
    expect(store.getSnapshot().labourCostPerHour).toBeNull();
  });

  test('the products arrive normalised, and the raw list is the local copy (the current app’s key)', () => {
    const { fake, store, storage } = setup();
    store.start();
    expect(store.getSnapshot().productsLoaded).toBe(false);
    fake.products([{ id: 'p1', name: ' Loaf ', vatRate: 0 }]);
    const snap = store.getSnapshot();
    expect(snap.productsLoaded).toBe(true);
    expect(snap.productsFromServer).toBe(true);
    expect(snap.products[0]!.name).toBe('Loaf');
    // A stored zero VAT rate survives: zero-rated is a real answer.
    expect(snap.products[0]!.vatRate).toBe(0);
    expect(JSON.parse(storage!.getItem(PRODUCTS_KEY)!)).toEqual([{ id: 'p1', name: ' Loaf ', vatRate: 0 }]);
  });

  test('the local copy is painted before the network answers', () => {
    const storage = fakeStorage({
      [PRODUCTS_KEY]: [{ id: 'p1', name: 'Loaf' }],
      [RECIPES_KEY]: [{ id: 'r1', name: 'Dough' }],
      [INGREDIENTS_KEY]: [{ id: 'i1', name: 'Flour' }],
    });
    const { store } = setup({ storage });
    const snap = store.getSnapshot();
    expect(snap.productsLoaded).toBe(true);
    expect(snap.productsFromServer).toBe(false);
    expect(snap.products.map(p => p.id)).toEqual(['p1']);
    expect(Object.keys(snap.recipes)).toEqual(['r1']);
    expect(Object.keys(snap.ingredients)).toEqual(['i1']);
    expect(snap.recipesLoaded && snap.ingredientsLoaded).toBe(true);
  });

  test('a corrupt local copy, or no storage at all, reads as none and throws nothing', () => {
    const storage = fakeStorage();
    storage.data.set(PRODUCTS_KEY, '{not json');
    expect(setup({ storage }).store.getSnapshot().productsLoaded).toBe(false);
    const none = setup({ storage: null });
    none.store.start();
    none.fake.products([{ id: 'p1', name: 'Loaf' }]);
    expect(none.store.getSnapshot().products).toHaveLength(1);
  });

  test('⚠️ an EMPTY answer from the browser’s own database is not believed over a copy that had products', () => {
    const storage = fakeStorage({ [PRODUCTS_KEY]: [{ id: 'p1', name: 'Loaf' }] });
    const { fake, store } = setup({ storage });
    store.start();
    fake.products([], false);
    expect(store.getSnapshot().products.map(p => p.id)).toEqual(['p1']);
    // The server's word is the truth, empty or not.
    fake.products([], true);
    expect(store.getSnapshot().products).toEqual([]);
  });

  test('⚠️ …nor on a phone with no copy at all: the list keeps waiting', () => {
    const { fake, store } = setup();
    store.start();
    fake.products([], false);
    expect(store.getSnapshot().productsLoaded).toBe(false);
    fake.products([{ id: 'p1', name: 'Loaf' }], false);
    expect(store.getSnapshot().productsLoaded).toBe(true);
  });

  test('an empty cached answer stands when the copy itself said there were none', () => {
    const { fake, store } = setup({ storage: fakeStorage({ [PRODUCTS_KEY]: [] }) });
    store.start();
    expect(store.getSnapshot().productsLoaded).toBe(true);
    fake.products([], false);
    expect(store.getSnapshot().products).toEqual([]);
  });

  test('a dead products stream ends the wait and says so', () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.productsFail();
    expect(store.getSnapshot().productsLoaded).toBe(true);
    expect(messages).toEqual([{ kind: 'products-stream-broken' }]);
  });

  test('the borrowed collections fail quietly: only the wait ends', () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.recipesFail();
    expect(store.getSnapshot().recipesLoaded).toBe(true);
    expect(messages).toEqual([]);
  });

  test('the tables are the SAME object until one of their parts changes', () => {
    const { fake, store } = setup();
    store.start();
    const before = store.getSnapshot().tables;
    fake.products([{ id: 'p1', name: 'Loaf' }]);
    expect(store.getSnapshot().tables).toBe(before);
    fake.recipes([{ id: 'r1', name: 'Dough' }]);
    expect(store.getSnapshot().tables).not.toBe(before);
    expect(store.getSnapshot().tables.recipes).toBe(store.getSnapshot().recipes);
    expect(store.getSnapshot().recipes.r1!.name).toBe('Dough');
  });

  test('⚠️ a save is local-first: on screen at once under the id made on the phone, the SAME id written', () => {
    const { fake, store } = setup();
    store.start();
    fake.products([]);
    const id = store.saveProduct({ product: product({ name: 'Focaccia' }), snapshot: null, lossPatches: {} });
    expect(id).toBe('new-1');
    expect(store.getSnapshot().products.map(p => p.id)).toEqual(['new-1']);
    expect(store.getSnapshot().unsent).toBe(true);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]!.args[0]).toBe('new-1');
  });

  test('⚠️ the document carries exactly the whitelisted fields and the product model, never the id', () => {
    const doc = toProductDocument(product({ id: 'p1', name: 'Loaf', sellingPrice: 2.5, vatRate: 0 } as Product & { name: string }));
    expect(Object.keys(doc).sort()).toEqual([
      'components', 'foodCostTarget', 'labourMinutes', 'labourPeople', 'model', 'name', 'packSize', 'packUnit',
      'packaging', 'piecesPerBatch', 'sellingMode', 'sellingPrice', 'vatRate',
    ]);
    expect(doc.model).toBe(2);
    expect(doc.vatRate).toBe(0);
    expect(doc).not.toHaveProperty('id');
  });

  test('the margin point travels with the product', () => {
    const { fake, store } = setup();
    store.start();
    store.saveProduct({ product: product({ id: 'p1', name: 'Loaf' } as Product & { name: string }), snapshot: { recordedAt: 'x' }, lossPatches: {} });
    expect(fake.writes[0]!.args[2]).toEqual({ recordedAt: 'x' });
  });

  test('⚠️ a refused save of a NEW product removes it, and names it', async () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.products([]);
    store.saveProduct({ product: product({ name: 'Focaccia' }), snapshot: null, lossPatches: {} });
    fake.writes[0]!.pending.reject(new Error('permission-denied'));
    await settle();
    expect(store.getSnapshot().products).toEqual([]);
    expect(store.getSnapshot().unsent).toBe(false);
    expect(messages).toEqual([{ kind: 'product-not-saved', name: 'Focaccia' }]);
  });

  test('a refused save of an existing product puts the old one back', async () => {
    const { fake, store } = setup();
    store.start();
    fake.products([{ id: 'p1', name: 'Loaf', sellingPrice: 2 }]);
    store.saveProduct({ product: product({ id: 'p1', name: 'Loaf', sellingPrice: 3 } as Product & { name: string }), snapshot: null, lossPatches: {} });
    expect(store.getSnapshot().products[0]!.sellingPrice).toBe(3);
    fake.writes[0]!.pending.reject(new Error('refused'));
    await settle();
    expect(store.getSnapshot().products[0]!.sellingPrice).toBe(2);
  });

  test('⚠️ a refusal never rolls back over a LATER save of the same product', async () => {
    const { fake, store } = setup();
    store.start();
    fake.products([{ id: 'p1', name: 'Loaf', sellingPrice: 2 }]);
    store.saveProduct({ product: product({ id: 'p1', name: 'Loaf', sellingPrice: 3 } as Product & { name: string }), snapshot: null, lossPatches: {} });
    store.saveProduct({ product: product({ id: 'p1', name: 'Loaf', sellingPrice: 4 } as Product & { name: string }), snapshot: null, lossPatches: {} });
    fake.writes[0]!.pending.reject(new Error('refused'));
    await settle();
    expect(store.getSnapshot().products[0]!.sellingPrice).toBe(4);
  });

  test('a landed save leaves the product and clears the unsent mark', async () => {
    const { fake, store } = setup();
    store.start();
    store.saveProduct({ product: product({ name: 'Focaccia' }), snapshot: null, lossPatches: {} });
    fake.writes[0]!.pending.resolve();
    await settle();
    expect(store.getSnapshot().unsent).toBe(false);
    expect(store.getSnapshot().products).toHaveLength(1);
  });

  test('a weighing is written onto its recipe, apart from the product, and shows at once', () => {
    const { fake, store } = setup();
    store.start();
    fake.recipes([{ id: 'r1', name: 'Dough', lossPct: 0 }]);
    store.saveProduct({
      product: product({ id: 'p1', name: 'Loaf' } as Product & { name: string }), snapshot: null,
      lossPatches: { r1: { lossPct: 12, rawGrams: 1000, cookedGrams: 880 } },
    });
    expect(fake.writes.map(w => w.kind)).toEqual(['loss', 'product']);
    expect(fake.writes[0]!.args).toEqual(['r1', { lossPct: 12, rawGrams: 1000, cookedGrams: 880 }]);
    expect(store.getSnapshot().recipes.r1!.lossPct).toBe(12);
  });

  test('a weighing for a recipe that is not here is not written', () => {
    const { fake, store } = setup();
    store.start();
    store.saveProduct({
      product: product({ name: 'Loaf' }), snapshot: null,
      lossPatches: { gone: { lossPct: 12, rawGrams: 1000, cookedGrams: 880 } },
    });
    expect(fake.writes.map(w => w.kind)).toEqual(['product']);
  });

  test('⚠️ a refused weighing puts back only its own fields — and removes one the recipe never had', async () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.recipes([{ id: 'r1', name: 'Dough', lossPct: 5 }]);
    store.saveProduct({
      product: product({ name: 'Loaf' }), snapshot: null,
      lossPatches: { r1: { lossPct: 12, rawGrams: 1000, cookedGrams: 880 } },
    });
    fake.writes[0]!.pending.reject(new Error('refused'));
    await settle();
    expect(store.getSnapshot().recipes.r1).toEqual({ id: 'r1', name: 'Dough', lossPct: 5 });
    expect(messages).toContainEqual({ kind: 'loss-not-saved', name: 'Dough' });
  });

  test('a refused weighing is NOT put back over somebody else’s newer weighing', async () => {
    const { fake, store } = setup();
    store.start();
    fake.recipes([{ id: 'r1', name: 'Dough', lossPct: 5 }]);
    store.saveProduct({
      product: product({ name: 'Loaf' }), snapshot: null,
      lossPatches: { r1: { lossPct: 12, rawGrams: 1000, cookedGrams: 880 } },
    });
    fake.recipes([{ id: 'r1', name: 'Dough', lossPct: 9, rawGrams: 500, cookedGrams: 455 }]);
    fake.writes[0]!.pending.reject(new Error('refused'));
    await settle();
    expect(store.getSnapshot().recipes.r1!.lossPct).toBe(9);
  });

  test('a delete is local-first; a refused one puts the product back and says so', async () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.products([{ id: 'p1', name: 'Loaf' }]);
    store.deleteProduct('p1');
    expect(store.getSnapshot().products).toEqual([]);
    fake.writes[0]!.pending.reject(new Error('refused'));
    await settle();
    expect(store.getSnapshot().products.map(p => p.id)).toEqual(['p1']);
    expect(messages).toEqual([{ kind: 'product-not-deleted' }]);
  });

  test('the labour rate is local-first; null clears it; a refusal puts the old one back', async () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.settings({ labourCostPerHour: 14 });
    store.saveLabourRate(16);
    expect(store.getSnapshot().labourCostPerHour).toBe(16);
    expect(fake.writes[0]!.args).toEqual([16, '2026-10-12T09:00:00.000Z']);
    fake.writes[0]!.pending.reject(new Error('refused'));
    await settle();
    expect(store.getSnapshot().labourCostPerHour).toBe(14);
    expect(messages).toEqual([{ kind: 'rate-not-saved' }]);

    store.saveLabourRate(null);
    expect(fake.writes[1]!.args[0]).toBeNull();
    expect(store.getSnapshot().labourCostPerHour).toBeNull();
  });

  test('the margin history is read through the source, on demand', async () => {
    const { fake, store } = setup();
    expect(await store.getProductHistory('p1')).toEqual([{ id: 'h1', foodCostPct: 30 }]);
    expect(fake.source.getProductHistory).toHaveBeenCalledWith('p1');
  });

  test('a subscriber is told of every change, and the snapshot is the same object in between', () => {
    const { fake, store } = setup();
    store.start();
    const seen = vi.fn();
    const unsubscribe = store.subscribe(seen);
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    fake.ingredients([{ id: 'i1', name: 'Flour' }]);
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
    fake.ingredients([]);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
