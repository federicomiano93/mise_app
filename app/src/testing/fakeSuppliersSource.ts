import type {
  IngredientPriceWrite, IngredientUsage, PanelKey, StoredDoc, SuppliersMeta, SuppliersSource,
} from '../suppliers/suppliersSource';

// An «Ingredients & suppliers» source for the specs of screens, in memory, that behaves like Firestore's own local
// view: a write is in the maps and every watcher is told AT ONCE (Firestore shows its pending writes), and a refused
// write is taken back and the watchers are told again — then its promise rejects. The store itself is covered against
// this fake in suppliersStore.spec.ts too.
type Listener = { onChange: (list: StoredDoc[], meta: SuppliersMeta) => void; onError: (err: unknown) => void };
type PriceListener = (map: Record<string, Record<string, unknown>>, readable: boolean, meta: SuppliersMeta) => void;
type ConfigListener = { onChange: (data: Record<string, unknown> | null, meta: SuppliersMeta) => void; onError: (err: unknown) => void };

export type SupplierWrite =
  | { readonly op: 'save'; readonly id: string; readonly data: Record<string, unknown> }
  | { readonly op: 'active'; readonly id: string; readonly active: boolean }
  | { readonly op: 'delete'; readonly id: string }
  | { readonly op: 'favourite'; readonly id: string; readonly on: boolean }
  | { readonly op: 'category'; readonly list: readonly string[]; readonly ids: readonly string[] }
  | {
    readonly op: 'ingredient-save'; readonly id: string; readonly data: Record<string, unknown>;
    // The money of the same batch (step 3e-3), as the store sent it; null when the save carried none.
    readonly price: IngredientPriceWrite | null;
  }
  | { readonly op: 'ingredient-delete'; readonly id: string; readonly withPrice: boolean }
  | { readonly op: 'draft-clear'; readonly id: string }
  | { readonly op: 'draft-unit'; readonly id: string; readonly unit: string };

export type FakeSuppliersSource = SuppliersSource & {
  suppliers: Map<string, StoredDoc>;
  ingredients: Map<string, StoredDoc>;
  // The price documents by ingredient id. `refusePrices` makes the price watch answer ({}, false), as the rules do for
  // most employees.
  prices: Map<string, Record<string, unknown>>;
  refusePrices: boolean;
  // The append-only price history by ingredient id, oldest first as written (readPriceHistory answers newest first).
  history: Map<string, StoredDoc[]>;
  // The next readPrice / readPriceHistory calls reject (offline, or the server did not answer); every id they were asked.
  refusePriceRead: boolean;
  refuseHistory: boolean;
  priceReads: string[];
  historyReads: string[];
  // The next price answers say they came from the browser's own database (the store then reads the card's price first).
  pricesFromCache: boolean;
  // config/orders as stored (null = none).
  ordersConfig: Record<string, unknown> | null;
  // The next watches fail (the rules refused them, or the stream died).
  refuse: { suppliers: boolean; ingredients: boolean; config: boolean };
  // Every write the store sent, in order (refused ones included: they are taken back afterwards).
  writes: SupplierWrite[];
  // The next writes of these kinds are refused (the rules said no).
  refuseWrites: {
    save: boolean; active: boolean; delete: boolean; favourite: boolean; category: boolean;
    ingredientSave: boolean; ingredientDelete: boolean;
  };
  // The order in progress (drafts/current): its lines by ingredient id, or null when there is no draft (a clear then
  // rejects, as updateDoc does on a missing document).
  draft: Record<string, Record<string, unknown>> | null;
  // What readUsage answers, and every id it was asked about. `holdUsage` makes the next answers wait until the returned
  // function is called.
  usage: IngredientUsage;
  usageCalls: string[];
  holdUsage(): () => void;
  // The next writes are answered only when the returned function is called (offline, or a slow network); until then
  // they are on screen, as Firestore's pending writes are.
  holdWrites(): () => void;
  // Every panel switch the screen asked the server for, in order; `refusePanel` makes the next ones reject, and
  // `holdPanel` makes them wait until the returned function is called.
  panelCalls: Array<{ key: PanelKey; on: boolean }>;
  refusePanel: unknown;
  holdPanel(): () => void;
  // With this on, a delete drops the supplier from the maps only when settleDeletes() is called — as with real Firestore, where
  // the row can still be in the list while the screen is already navigating away. Off by default.
  deferDeletes: boolean;
  settleDeletes(): void;
  // Holds back the first answers until release() (Firestore still loading).
  hold(): void;
  release(): void;
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Kills the live suppliers / ingredients streams, as a lost permission would.
  breakStreams(): void;
  // The next answers come from the browser's own database (not the server).
  fromCache: boolean;
};

let idCounter = 0;

export function fakeSuppliersSource(
  seed: {
    suppliers?: StoredDoc[]; ingredients?: StoredDoc[]; prices?: Record<string, Record<string, unknown>>;
    ordersConfig?: Record<string, unknown> | null; refusePrices?: boolean;
    history?: Record<string, StoredDoc[]>;
  } = {},
): FakeSuppliersSource {
  const suppliers = new Map((seed.suppliers ?? []).map(doc => [doc.id, doc] as const));
  const ingredients = new Map((seed.ingredients ?? []).map(doc => [doc.id, doc] as const));
  const prices = new Map(Object.entries(seed.prices ?? {}));
  const history = new Map<string, StoredDoc[]>(Object.entries(seed.history ?? {}).map(([id, list]) => [id, [...list]] as const));
  const supplierWatchers = new Set<Listener>();
  const ingredientWatchers = new Set<Listener>();
  const priceWatchers = new Set<PriceListener>();
  const configWatchers = new Set<ConfigListener>();
  let held = false;
  let writeHold: Promise<void> | null = null;
  let panelHold: Promise<void> | null = null;
  let usageHold: Promise<void> | null = null;
  const deferred: string[] = [];
  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

  const meta = (): SuppliersMeta => ({ fromServer: !fake.fromCache });
  const priceMap = () => Object.fromEntries(prices);

  function tellSuppliers() { for (const w of [...supplierWatchers]) w.onChange([...suppliers.values()], meta()); }
  function tellIngredients() { for (const w of [...ingredientWatchers]) w.onChange([...ingredients.values()], meta()); }
  const priceMeta = (): SuppliersMeta => ({ fromServer: !fake.pricesFromCache && !fake.fromCache });
  function tellPrices() { for (const w of [...priceWatchers]) w(fake.refusePrices ? {} : priceMap(), !fake.refusePrices, priceMeta()); }
  function tellConfig() { for (const w of [...configWatchers]) w.onChange(fake.ordersConfig ? { ...fake.ordersConfig } : null, meta()); }
  function tellAll() { tellSuppliers(); tellIngredients(); tellPrices(); tellConfig(); }

  // Like onSnapshot: the first answer arrives after the call returns.
  function watch(set: Set<Listener>, refusedNow: () => boolean) {
    return (onChange: Listener['onChange'], onError: Listener['onError']) => {
      const listener: Listener = { onChange, onError };
      set.add(listener);
      queueMicrotask(() => {
        if (!set.has(listener)) return;
        if (refusedNow()) {
          set.delete(listener);
          onError(refused());
        } else if (!held) {
          onChange(set === supplierWatchers ? [...suppliers.values()] : [...ingredients.values()], meta());
        }
      });
      return () => { set.delete(listener); };
    };
  }

  // A write: applied at once and told (Firestore's pending write), then answered — after the hold, if any. A refusal
  // puts back what `undo` restores, tells again, and rejects.
  async function write(entry: SupplierWrite, refuseNow: boolean, apply: () => () => void): Promise<void> {
    fake.writes.push(entry);
    const undo = apply();
    tellAll();
    const hold = writeHold;
    if (hold) await hold;
    else await Promise.resolve();
    if (refuseNow) {
      undo();
      tellAll();
      throw refused();
    }
  }

  function snapshotOf<K, V>(map: Map<K, V>): () => void {
    const before = new Map(map);
    return () => {
      map.clear();
      for (const [k, v] of before) map.set(k, v);
    };
  }

  const fake: FakeSuppliersSource = {
    suppliers, ingredients, prices, history,
    refusePrices: seed.refusePrices ?? false,
    refusePriceRead: false,
    refuseHistory: false,
    priceReads: [],
    historyReads: [],
    pricesFromCache: false,
    ordersConfig: seed.ordersConfig ?? null,
    refuse: { suppliers: false, ingredients: false, config: false },
    writes: [],
    refuseWrites: {
      save: false, active: false, delete: false, favourite: false, category: false, ingredientSave: false, ingredientDelete: false,
    },
    draft: null,
    usage: { recipes: 0, products: 0 },
    usageCalls: [],
    panelCalls: [],
    refusePanel: null,
    fromCache: false,
    deferDeletes: false,
    settleDeletes() {
      for (const id of deferred.splice(0)) suppliers.delete(id);
      tellAll();
    },

    newSupplierId: () => `new-supplier-${++idCounter}`,

    watchSuppliers: watch(supplierWatchers, () => fake.refuse.suppliers),
    watchIngredients: watch(ingredientWatchers, () => fake.refuse.ingredients),

    watchPrices(onChange) {
      priceWatchers.add(onChange);
      queueMicrotask(() => {
        if (!priceWatchers.has(onChange) || held) return;
        onChange(fake.refusePrices ? {} : priceMap(), !fake.refusePrices, priceMeta());
      });
      return () => { priceWatchers.delete(onChange); };
    },

    watchOrdersConfig(onChange, onError) {
      const listener: ConfigListener = { onChange, onError };
      configWatchers.add(listener);
      queueMicrotask(() => {
        if (!configWatchers.has(listener)) return;
        if (fake.refuse.config) {
          configWatchers.delete(listener);
          onError(refused());
        } else if (!held) {
          onChange(fake.ordersConfig ? { ...fake.ordersConfig } : null, meta());
        }
      });
      return () => { configWatchers.delete(listener); };
    },

    saveSupplier(id, data) {
      return write({ op: 'save', id, data: { ...data } }, fake.refuseWrites.save, () => {
        const undo = snapshotOf(suppliers);
        suppliers.set(id, { ...(suppliers.get(id) ?? {}), ...data, id });
        return undo;
      });
    },

    setSupplierActive(id, active) {
      return write({ op: 'active', id, active }, fake.refuseWrites.active || !suppliers.has(id), () => {
        const undo = snapshotOf(suppliers);
        const found = suppliers.get(id);
        if (found) suppliers.set(id, { ...found, active });
        return undo;
      });
    },

    deleteSupplier(id) {
      return write({ op: 'delete', id }, fake.refuseWrites.delete, () => {
        const undo = snapshotOf(suppliers);
        if (fake.deferDeletes) deferred.push(id);
        else suppliers.delete(id);
        return undo;
      });
    },

    setFavourite(id, on) {
      return write({ op: 'favourite', id, on }, fake.refuseWrites.favourite, () => {
        const before = fake.ordersConfig;
        const list = Array.isArray(before?.favouriteSuppliers) ? (before.favouriteSuppliers as string[]) : [];
        const next = on ? (list.includes(id) ? list : [...list, id]) : list.filter(x => x !== id);
        fake.ordersConfig = { ...(before ?? {}), favouriteSuppliers: next };
        return () => { fake.ordersConfig = before; };
      });
    },

    deleteCategory(list, ids) {
      return write({ op: 'category', list: [...list], ids: [...ids] }, fake.refuseWrites.category, () => {
        const before = fake.ordersConfig;
        const undo = snapshotOf(ingredients);
        fake.ordersConfig = { ...(before ?? {}), ingredientCategories: [...list] };
        for (const id of ids) {
          const found = ingredients.get(id);
          if (found) ingredients.set(id, { ...found, category: 'Other' });
        }
        return () => { fake.ordersConfig = before; undo(); };
      });
    },

    newIngredientId: () => `new-ingredient-${++idCounter}`,

    // One batch: the item, its price (merged) and the history entry land together, and a refusal takes all three back.
    saveIngredient(id, data, price = null) {
      return write({ op: 'ingredient-save', id, data: { ...data }, price }, fake.refuseWrites.ingredientSave, () => {
        const undoItems = snapshotOf(ingredients);
        const undoPrices = snapshotOf(prices);
        const undoHistory = snapshotOf(history);
        ingredients.set(id, { ...(ingredients.get(id) ?? {}), ...data, id });
        if (price) {
          prices.set(id, { ...(prices.get(id) ?? {}), ...price.doc });
          if (price.history) history.set(id, [...(history.get(id) ?? []), { ...price.history, id: `h-${++idCounter}` }]);
        }
        return () => { undoItems(); undoPrices(); undoHistory(); };
      });
    },

    async readPrice(id) {
      fake.priceReads.push(id);
      await Promise.resolve();
      if (fake.refusePriceRead) throw refused();
      const found = prices.get(id);
      return found ? { ...found } : null;
    },

    async readPriceHistory(id, max) {
      fake.historyReads.push(id);
      await Promise.resolve();
      if (fake.refuseHistory) throw refused();
      return [...(history.get(id) ?? [])]
        .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
        .slice(0, max)
        .map(entry => ({ ...entry }));
    },

    deleteIngredient(id, withPrice) {
      return write({ op: 'ingredient-delete', id, withPrice }, fake.refuseWrites.ingredientDelete, () => {
        const undoItems = snapshotOf(ingredients);
        const undoPrices = snapshotOf(prices);
        ingredients.delete(id);
        if (withPrice) prices.delete(id);
        return () => { undoItems(); undoPrices(); };
      });
    },

    clearDraftEntry(id) {
      return write({ op: 'draft-clear', id }, fake.draft === null, () => {
        const before = fake.draft;
        if (before) {
          const next = { ...before };
          delete next[id];
          fake.draft = next;
        }
        return () => { fake.draft = before; };
      });
    },

    async readDraftEntry(id) {
      await Promise.resolve();
      const entry = fake.draft?.[id];
      return entry ? { ...entry } : null;
    },

    setDraftEntryUnit(id, unit) {
      return write({ op: 'draft-unit', id, unit }, false, () => {
        const before = fake.draft;
        fake.draft = { ...(before ?? {}), [id]: { ...(before?.[id] ?? {}), unit } };
        return () => { fake.draft = before; };
      });
    },

    async readUsage(id) {
      fake.usageCalls.push(id);
      const hold = usageHold;
      if (hold) await hold;
      else await Promise.resolve();
      return { ...fake.usage };
    },

    holdUsage() {
      let release = () => undefined as void;
      usageHold = new Promise<void>(resolve => { release = resolve; });
      return () => { usageHold = null; release(); };
    },

    async setIngredientPanel(key, on) {
      fake.panelCalls.push({ key, on });
      const hold = panelHold;
      if (hold) await hold;
      if (fake.refusePanel) throw fake.refusePanel;
    },

    holdWrites() {
      let release = () => undefined as void;
      writeHold = new Promise<void>(resolve => { release = resolve; });
      return () => { writeHold = null; release(); };
    },
    holdPanel() {
      let release = () => undefined as void;
      panelHold = new Promise<void>(resolve => { release = resolve; });
      return () => { panelHold = null; release(); };
    },
    hold() { held = true; },
    release() {
      held = false;
      tellAll();
    },
    push: tellAll,
    breakStreams() {
      const err = refused();
      for (const w of [...supplierWatchers]) w.onError(err);
      for (const w of [...ingredientWatchers]) w.onError(err);
      supplierWatchers.clear();
      ingredientWatchers.clear();
    },
  };
  return fake;
}
