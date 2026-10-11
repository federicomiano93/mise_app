import { vi } from 'vitest';
import { withPrices } from '@mise/shared/price-model';
import type { SnapshotMeta, StocktakeSource, StoredDoc } from '../stocktake/stocktakeSource';

// A Stocktake source for the specs of screens, in memory: the months, the ingredients, their prices
// and the orders are plain maps; a save MERGES into the month at once (or is refused, with
// `refuse`), a `true` in `clear` removes the key like deleteField(), and every live watcher is told,
// like Firestore would. The store itself is covered against its own fake in stocktakeStore.spec.ts;
// a screen's spec only needs a database that behaves.
type MonthListener = { monthId: string; onChange: (doc: StoredDoc | null, meta: SnapshotMeta) => void; onError: (err: unknown) => void };
// This fake is a database that is online: every answer comes from the server.
const FROM_SERVER: SnapshotMeta = { fromServer: true };
type IngredientListener = { onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void };

export type FakeStocktakeSource = StocktakeSource & {
  months: Map<string, StoredDoc>;
  ingredients: Map<string, StoredDoc>;
  prices: Map<string, Record<string, unknown>>;
  orders: StoredDoc[];
  // The next calls of this kind fail.
  refuse: { save: boolean; watchMonth: boolean; getMonthOnce: boolean; orders: boolean };
  // Every save that reached the source, in order.
  saved: { monthId: string; patch: Record<string, unknown>; clear: Record<string, Record<string, unknown>> }[];
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Holds back the first answer of the month watchers until release() (Firestore still loading).
  hold(): void;
  release(): void;
};

export function fakeStocktakeSource(seed: {
  months?: StoredDoc[];
  ingredients?: StoredDoc[];
  prices?: Record<string, Record<string, unknown>>;
  orders?: StoredDoc[];
} = {}): FakeStocktakeSource {
  const months = new Map((seed.months ?? []).map(doc => [doc.id, doc] as const));
  const ingredients = new Map((seed.ingredients ?? []).map(doc => [doc.id, doc] as const));
  const prices = new Map(Object.entries(seed.prices ?? {}));
  const orders = [...(seed.orders ?? [])];
  const monthWatchers = new Set<MonthListener>();
  const ingredientWatchers = new Set<IngredientListener>();
  const refuse = { save: false, watchMonth: false, getMonthOnce: false, orders: false };
  const saved: FakeStocktakeSource['saved'] = [];
  let held = false;

  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
  const priced = () => withPrices([...ingredients.values()], Object.fromEntries(prices)) as StoredDoc[];

  function push(): void {
    if (!held) {
      for (const w of monthWatchers) w.onChange(months.get(w.monthId) ?? null, FROM_SERVER);
    }
    for (const w of ingredientWatchers) w.onChange(priced());
  }

  return {
    months,
    ingredients,
    prices,
    orders,
    refuse,
    saved,
    push,
    hold() { held = true; },
    release() { held = false; push(); },

    watchMonth: vi.fn<StocktakeSource['watchMonth']>((monthId, onChange, onError) => {
      const listener: MonthListener = { monthId, onChange, onError };
      monthWatchers.add(listener);
      // Like onSnapshot: the first answer arrives after the call returns.
      queueMicrotask(() => {
        if (!monthWatchers.has(listener)) return;
        if (refuse.watchMonth) {
          monthWatchers.delete(listener);
          onError(refused());
        } else if (!held) {
          onChange(months.get(monthId) ?? null, FROM_SERVER);
        }
      });
      return () => { monthWatchers.delete(listener); };
    }),

    getMonthOnce: vi.fn<StocktakeSource['getMonthOnce']>(async monthId => {
      if (refuse.getMonthOnce) throw refused();
      return months.get(monthId) ?? null;
    }),

    saveMonthFields: vi.fn<StocktakeSource['saveMonthFields']>(async (monthId, patch, clear = {}) => {
      saved.push({ monthId, patch: { ...patch }, clear: { ...clear } as Record<string, Record<string, unknown>> });
      if (refuse.save) throw refused();
      const doc: Record<string, unknown> = { ...(months.get(monthId) ?? {}), bakery: 'bakery' };
      for (const [key, value] of Object.entries(patch)) {
        // A merge: maps are merged key by key, everything else replaced.
        doc[key] = value && typeof value === 'object' && !Array.isArray(value)
          ? { ...((doc[key] as Record<string, unknown>) ?? {}), ...(value as Record<string, unknown>) }
          : value;
      }
      for (const [map, ids] of Object.entries(clear)) {
        const next = { ...((doc[map] as Record<string, unknown>) ?? {}) };
        for (const id of Object.keys(ids)) delete next[id];
        doc[map] = next;
      }
      months.set(monthId, { ...doc, id: monthId });
      push();
    }),

    getOrdersInMonth: vi.fn<StocktakeSource['getOrdersInMonth']>(async (from, to) => {
      if (refuse.orders) throw refused();
      return orders.filter(record => typeof record.date === 'string' && record.date >= from && record.date < to);
    }),

    watchIngredients: vi.fn<StocktakeSource['watchIngredients']>((onChange, onError) => {
      const listener: IngredientListener = { onChange, onError };
      ingredientWatchers.add(listener);
      queueMicrotask(() => { if (ingredientWatchers.has(listener)) onChange(priced()); });
      return () => { ingredientWatchers.delete(listener); };
    }),
  };
}
