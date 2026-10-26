import type { DraftPayload } from '../orders/draftSync';
import type { OrdersMeta, OrdersSource, StoredDoc } from '../orders/ordersSource';

// An «Orders» source for the specs, in memory, that behaves like Firestore's own local view: a draft write is in the
// document and every watcher is told AT ONCE (Firestore shows its pending writes), and a refused write is taken back and
// the watchers are told again — then its promise rejects. `holdWrites` keeps the next writes «in the air» (offline) until
// the returned release is called.
type ListListener = { onChange: (list: StoredDoc[], meta: OrdersMeta) => void; onError: (err: unknown) => void };
type DocListener = { onChange: (data: Record<string, unknown> | null, meta: OrdersMeta) => void; onError: (err: unknown) => void };

export type FakeOrdersSource = OrdersSource & {
  suppliers: Map<string, StoredDoc>;
  ingredients: Map<string, StoredDoc>;
  ordersConfig: Record<string, unknown> | null;
  // drafts/current as stored (null = none).
  draft: Record<string, unknown> | null;
  // Every draft write the store sent, in order (refused ones included).
  writes: DraftPayload[];
  // The next draft writes are refused (the rules said no).
  refuseWrites: boolean;
  // The next watches fail (the rules refused them, or the stream died).
  refuse: { suppliers: boolean; ingredients: boolean; config: boolean; draft: boolean };
  // Another phone writes the draft: merged like a setDoc merge, then every watcher is told.
  remoteMerge(payload: Record<string, unknown>): void;
  // Every watcher is told again (e.g. after the maps were changed by hand).
  emit(): void;
  // How many listeners are open now.
  openListeners(): number;
  // Keeps every later write waiting until the returned function is called (then they settle, in order).
  holdWrites(): () => void;
};

// A merge like setDoc(…, { merge: true }): maps merged key by key at every depth, everything else replaced.
function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const before = out[key];
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      && before && typeof before === 'object' && !Array.isArray(before)
      ? deepMerge(before as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out;
}

export function fakeOrdersSource(init: {
  suppliers?: StoredDoc[]; ingredients?: StoredDoc[]; ordersConfig?: Record<string, unknown> | null;
  draft?: Record<string, unknown> | null;
} = {}): FakeOrdersSource {
  const supplierWatchers = new Set<ListListener>();
  const ingredientWatchers = new Set<ListListener>();
  const configWatchers = new Set<DocListener>();
  const draftWatchers = new Set<DocListener>();
  let held: Array<() => void> | null = null;
  const fromServer: OrdersMeta = { fromServer: true };

  const source: FakeOrdersSource = {
    suppliers: new Map((init.suppliers ?? []).map(s => [s.id, s])),
    ingredients: new Map((init.ingredients ?? []).map(i => [i.id, i])),
    ordersConfig: init.ordersConfig ?? null,
    draft: init.draft ?? null,
    writes: [],
    refuseWrites: false,
    refuse: { suppliers: false, ingredients: false, config: false, draft: false },

    watchSuppliers(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.suppliers) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      supplierWatchers.add(l);
      queueMicrotask(() => { if (supplierWatchers.has(l)) onChange([...source.suppliers.values()], fromServer); });
      return () => { supplierWatchers.delete(l); };
    },
    watchIngredients(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.ingredients) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      ingredientWatchers.add(l);
      queueMicrotask(() => { if (ingredientWatchers.has(l)) onChange([...source.ingredients.values()], fromServer); });
      return () => { ingredientWatchers.delete(l); };
    },
    watchOrdersConfig(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.config) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      configWatchers.add(l);
      queueMicrotask(() => { if (configWatchers.has(l)) onChange(source.ordersConfig, fromServer); });
      return () => { configWatchers.delete(l); };
    },
    watchDraft(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.draft) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      draftWatchers.add(l);
      queueMicrotask(() => { if (draftWatchers.has(l)) onChange(source.draft, fromServer); });
      return () => { draftWatchers.delete(l); };
    },

    mergeDraft(payload) {
      source.writes.push(payload);
      const before = source.draft;
      source.draft = deepMerge(before ?? {}, { ...payload, bakery: 'bakery' } as Record<string, unknown>);
      tellDraft();
      const refused = source.refuseWrites;
      const settle = (resolve: () => void, reject: (err: unknown) => void) => {
        if (refused) {
          source.draft = before;
          tellDraft();
          reject(new Error('permission-denied'));
        } else resolve();
      };
      return new Promise<void>((resolve, reject) => {
        if (held) held.push(() => settle(resolve, reject));
        else queueMicrotask(() => settle(resolve, reject));
      });
    },

    remoteMerge(payload) {
      source.draft = deepMerge(source.draft ?? {}, payload);
      tellDraft();
    },

    emit() {
      for (const l of supplierWatchers) l.onChange([...source.suppliers.values()], fromServer);
      for (const l of ingredientWatchers) l.onChange([...source.ingredients.values()], fromServer);
      for (const l of configWatchers) l.onChange(source.ordersConfig, fromServer);
      tellDraft();
    },

    openListeners: () => supplierWatchers.size + ingredientWatchers.size + configWatchers.size + draftWatchers.size,

    holdWrites() {
      held = [];
      return () => {
        const waiting = held ?? [];
        held = null;
        for (const run of waiting) run();
      };
    },
  };

  function tellDraft() {
    const doc = source.draft ? structuredClone(source.draft) : null;
    for (const l of draftWatchers) l.onChange(doc, fromServer);
  }

  return source;
}
