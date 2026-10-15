import { describe, expect, test, vi } from 'vitest';
import { SCALED_TTL_MS } from '@mise/shared/catalogue-model';
import { PRICE_FIELDS } from '@mise/shared/price-model';
import type { KeyValueStorage } from '../session/backend';
import type { RecipesMeta, RecipesSource, StoredDoc } from './recipesSource';
import { INGREDIENTS_KEY, LABEL_CONFIG_KEY, RECIPES_KEY, SCALED_KEY, USAGE_KEY, createRecipesStore } from './recipesStore';

// The Recipe catalogue's store against a hand-driven source and an in-memory localStorage. The keys
// are the CURRENT app's (one origin): what this store writes, js/catalogue/catalogue-store.js reads.

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  return { data, storage: storage as unknown as KeyValueStorage };
}

function handSource() {
  let onChange: ((list: StoredDoc[], meta: RecipesMeta) => void) | null = null;
  let onError: ((err: unknown) => void) | null = null;
  const stop = vi.fn();
  const watchRecipes = vi.fn<RecipesSource['watchRecipes']>((change, error) => {
    onChange = change;
    onError = error;
    return stop;
  });
  let onIngredients: ((list: StoredDoc[], meta: RecipesMeta) => void) | null = null;
  let onIngredientsError: ((err: unknown) => void) | null = null;
  const stopIngredients = vi.fn();
  const watchIngredients = vi.fn<RecipesSource['watchIngredients']>((change, error) => {
    onIngredients = change;
    onIngredientsError = error;
    return stopIngredients;
  });
  let onLabel: ((data: Record<string, unknown> | null, meta: RecipesMeta) => void) | null = null;
  let onLabelError: ((err: unknown) => void) | null = null;
  const stopLabel = vi.fn();
  const watchLabelConfig = vi.fn<RecipesSource['watchLabelConfig']>((change, error) => {
    onLabel = change;
    onLabelError = error;
    return stopLabel;
  });
  let onAgents: ((list: StoredDoc[]) => void) | null = null;
  let onAgentsError: ((err: unknown) => void) | null = null;
  const stopAgents = vi.fn();
  const watchPrintAgents = vi.fn<RecipesSource['watchPrintAgents']>((change, error) => {
    onAgents = change;
    onAgentsError = error;
    return stopAgents;
  });
  const queuePrintJob = vi.fn<RecipesSource['queuePrintJob']>(() => Promise.resolve());
  const saveLabelConfig = vi.fn<RecipesSource['saveLabelConfig']>(() => Promise.resolve());
  const source: RecipesSource = { watchRecipes, watchIngredients, watchLabelConfig, watchPrintAgents, queuePrintJob, saveLabelConfig };
  return {
    source,
    watchPrintAgents,
    queuePrintJob,
    saveLabelConfig,
    stopAgents,
    agents: (list: StoredDoc[]) => onAgents!(list),
    agentsFail: () => onAgentsError!(new Error('permission-denied')),
    watchRecipes,
    watchIngredients,
    watchLabelConfig,
    stop,
    stopIngredients,
    stopLabel,
    labelServer: (data: Record<string, unknown> | null) => onLabel!(data, { fromServer: true }),
    labelCache: (data: Record<string, unknown> | null) => onLabel!(data, { fromServer: false }),
    labelFail: () => onLabelError!(new Error('permission-denied')),
    ingServer: (list: StoredDoc[]) => onIngredients!(list, { fromServer: true }),
    ingCache: (list: StoredDoc[]) => onIngredients!(list, { fromServer: false }),
    ingFail: () => onIngredientsError!(new Error('permission-denied')),
    server: (list: StoredDoc[]) => onChange!(list, { fromServer: true }),
    cache: (list: StoredDoc[]) => onChange!(list, { fromServer: false }),
    fail: () => onError!(new Error('permission-denied')),
  };
}

const NOW = Date.UTC(2026, 9, 13, 9, 0);

function makeStore(seed: Record<string, string> = {}, now = () => NOW) {
  const { data, storage } = memoryStorage(seed);
  const hand = handSource();
  const warn = vi.fn();
  const store = createRecipesStore(hand.source, { storage, now, warn });
  return { store, data, warn, ...hand };
}

const FOCACCIA: StoredDoc = { id: 'r1', name: ' Focaccia ', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'i1', rid: 'a1' }] };
const BREAD: StoredDoc = { id: 'r2', name: 'Bread', ingredients: [] };
const FLOUR: StoredDoc = { id: 'i1', name: 'Flour 00', allergens: ['gluten-wheat'], allergensCheckedAt: '2026-09-01' };
const BUTTER: StoredDoc = { id: 'i2', name: 'Butter', allergens: ['milk'], allergensCheckedAt: '2026-09-01' };

describe('the Recipe catalogue store', () => {
  test('paints the local copy at once, and waits («not loaded») when there is none', () => {
    const cold = makeStore();
    expect(cold.store.getSnapshot().recipesLoaded).toBe(false);
    expect(cold.store.getSnapshot().recipes).toEqual([]);
    const warm = makeStore({ [RECIPES_KEY]: JSON.stringify([BREAD]) });
    expect(warm.store.getSnapshot().recipesLoaded).toBe(true);
    expect(warm.store.getSnapshot().recipes.map(r => r.name)).toEqual(['Bread']);
  });

  test('⚠️ the copy is stored NORMALISED, links and row ids kept — the current app reads it', () => {
    const { store, data, server } = makeStore();
    store.start();
    server([FOCACCIA]);
    const stored = JSON.parse(data.get(RECIPES_KEY)!);
    expect(stored[0].name).toBe('Focaccia');
    expect(stored[0].lossPct).toBe(0);
    expect(stored[0].ingredients[0]).toEqual({ label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'i1', rid: 'a1' });
    expect(store.getSnapshot().recipesFromServer).toBe(true);
  });

  test('⚠️ an EMPTY answer from the browser’s own database does not wipe a copy that had recipes', () => {
    const { store, cache, server } = makeStore({ [RECIPES_KEY]: JSON.stringify([BREAD]) });
    store.start();
    cache([]);
    expect(store.getSnapshot().recipes).toHaveLength(1);
    expect(store.getSnapshot().recipesFromServer).toBe(false);
    server([]);
    expect(store.getSnapshot().recipes).toHaveLength(0);
  });

  test('⚠️ before the server speaks, a cached answer that LACKS a held recipe is not believed (nor saved)', () => {
    const { store, data, cache, server } = makeStore({ [RECIPES_KEY]: JSON.stringify([FOCACCIA, BREAD]) });
    store.start();
    cache([BREAD]);
    expect(store.getSnapshot().recipes.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(JSON.parse(data.get(RECIPES_KEY)!)).toHaveLength(2);
    // A cached answer that holds every recipe (and more) is believed.
    cache([FOCACCIA, BREAD, { id: 'r3', name: 'Pizza' }]);
    expect(store.getSnapshot().recipes).toHaveLength(3);
    // The server's word is believed whatever it lacks; after it, the browser's own copy follows it.
    server([BREAD]);
    expect(store.getSnapshot().recipes.map(r => r.id)).toEqual(['r2']);
    cache([BREAD]);
    expect(store.getSnapshot().recipes.map(r => r.id)).toEqual(['r2']);
  });

  test('an empty cached answer stands when the copy itself said «no recipes»; a cold one keeps waiting', () => {
    const none = makeStore({ [RECIPES_KEY]: '[]' });
    none.store.start();
    none.cache([]);
    expect(none.store.getSnapshot().recipesLoaded).toBe(true);
    const cold = makeStore();
    cold.store.start();
    cold.cache([]);
    expect(cold.store.getSnapshot().recipesLoaded).toBe(false);
    cold.cache([BREAD]);
    expect(cold.store.getSnapshot().recipesLoaded).toBe(true);
  });

  test('a corrupt copy reads as none, and blocked storage never throws', () => {
    const corrupt = makeStore({ [RECIPES_KEY]: '{not json', [USAGE_KEY]: '[1,2]', [SCALED_KEY]: 'nope' });
    expect(corrupt.store.getSnapshot().recipesLoaded).toBe(false);
    expect(corrupt.store.getSnapshot().usage).toEqual({});
    expect(corrupt.store.getSnapshot().scaled).toEqual({});
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => undefined,
    } as unknown as KeyValueStorage;
    const hand = handSource();
    const store = createRecipesStore(hand.source, { storage: throwing, now: () => NOW, warn: vi.fn() });
    store.start();
    expect(() => hand.server([BREAD])).not.toThrow();
    expect(() => store.bumpUsage('r2')).not.toThrow();
    expect(store.getSnapshot().usage).toEqual({ r2: 1 });
  });

  test('a dead stream ends the wait and is said once; the copy stays on screen', () => {
    const { store, fail, warn } = makeStore({ [RECIPES_KEY]: JSON.stringify([BREAD]) });
    const said = vi.fn();
    store.onMessage(said);
    store.start();
    fail();
    expect(store.getSnapshot()).toMatchObject({ recipesLoaded: true, streamBroken: true });
    expect(store.getSnapshot().recipes).toHaveLength(1);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith({ kind: 'recipes-stream-broken' });
    expect(warn).toHaveBeenCalled();
  });

  test('the shop computers are watched while the store runs and let go of when it stops', () => {
    const { store, watchPrintAgents, stopAgents, agents } = makeStore();
    expect(store.getSnapshot().printAgents).toEqual([]);
    store.start();
    expect(watchPrintAgents).toHaveBeenCalledTimes(1);
    agents([{ id: 'pc', lastSeenAt: '2026-10-13T09:00:00.000Z' }]);
    expect(store.getSnapshot().printAgents).toEqual([{ id: 'pc', lastSeenAt: '2026-10-13T09:00:00.000Z' }]);
    store.stop();
    expect(stopAgents).toHaveBeenCalledTimes(1);
  });

  test('⚠️ the heartbeats are NEVER written to storage, and a stored one is never read back', () => {
    const { store, data, agents } = makeStore({ 'catalogue-print-agents': JSON.stringify([{ id: 'old', lastSeenAt: '2026-10-13T09:00:00.000Z' }]) });
    expect(store.getSnapshot().printAgents).toEqual([]);
    const before = new Map(data);
    store.start();
    agents([{ id: 'pc', lastSeenAt: '2026-10-13T09:00:00.000Z' }]);
    expect(new Map(data)).toEqual(before);
    expect([...data.values()].filter(value => value.includes('"pc"'))).toEqual([]);
  });

  test('a failed agents watch leaves «nobody is listening» and says so only in a warning', () => {
    const { store, agents, agentsFail, warn } = makeStore();
    store.start();
    agents([{ id: 'pc', lastSeenAt: '2026-10-13T09:00:00.000Z' }]);
    agentsFail();
    expect(store.getSnapshot().printAgents).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  test('a job goes to the source as it is, and a refusal reaches the caller (it is not local-first)', async () => {
    const { store, queuePrintJob } = makeStore();
    await store.queuePrintJob({ payload: '^XA^XZ' });
    expect(queuePrintJob).toHaveBeenCalledWith({ payload: '^XA^XZ' });
    queuePrintJob.mockRejectedValueOnce(new Error('offline'));
    await expect(store.queuePrintJob({ payload: '^XA^XZ' })).rejects.toThrow('offline');
  });

  test('opening counts one more, written to the shared key', () => {
    const { store, data } = makeStore({ [USAGE_KEY]: JSON.stringify({ r1: 2 }) });
    store.bumpUsage('r1');
    store.bumpUsage('r2');
    store.bumpUsage('');
    expect(store.getSnapshot().usage).toEqual({ r1: 3, r2: 1 });
    expect(JSON.parse(data.get(USAGE_KEY)!)).toEqual({ r1: 3, r2: 1 });
  });

  test('a batch is remembered for 12 hours, then reads as none; Clear forgets it', () => {
    let now = NOW;
    const { store, data } = makeStore({}, () => now);
    store.setScaledTarget('r1', 2500);
    expect(store.scaledTarget('r1')).toBe(2500);
    expect(JSON.parse(data.get(SCALED_KEY)!)).toEqual({ r1: { target: 2500, ts: NOW } });
    now = NOW + SCALED_TTL_MS + 1;
    expect(store.scaledTarget('r1')).toBeNull();
    now = NOW;
    store.clearScaledTarget('r1');
    expect(store.scaledTarget('r1')).toBeNull();
    expect(JSON.parse(data.get(SCALED_KEY)!)).toEqual({});
  });

  test('a batch of nothing, of a negative or of junk is not remembered', () => {
    const { store } = makeStore();
    store.setScaledTarget('r1', 0);
    store.setScaledTarget('r1', -5);
    store.setScaledTarget('r1', Number.NaN);
    store.setScaledTarget('r1', Number.POSITIVE_INFINITY);
    store.setScaledTarget('', 100);
    expect(store.getSnapshot().scaled).toEqual({});
  });

  test('⚠️ counts and batches of deleted recipes are pruned on the SERVER’s word only', () => {
    const { store, data, cache, server } = makeStore({
      [RECIPES_KEY]: JSON.stringify([FOCACCIA, BREAD]),
      [USAGE_KEY]: JSON.stringify({ r1: 4, r2: 1, gone: 9 }),
      [SCALED_KEY]: JSON.stringify({
        r1: { target: 900, ts: NOW },
        r2: { target: 50, ts: NOW - SCALED_TTL_MS - 1 },
        gone: { target: 1, ts: NOW },
      }),
    });
    store.start();
    // The browser's own database holds only the recipe the Calculator once read.
    cache([BREAD]);
    expect(store.getSnapshot().usage).toEqual({ r1: 4, r2: 1, gone: 9 });
    expect(store.getSnapshot().recipes).toHaveLength(2);
    server([FOCACCIA, BREAD]);
    expect(store.getSnapshot().usage).toEqual({ r1: 4, r2: 1 });
    expect(store.getSnapshot().scaled).toEqual({ r1: { target: 900, ts: NOW } });
    expect(JSON.parse(data.get(USAGE_KEY)!)).toEqual({ r1: 4, r2: 1 });
  });

  test('start → stop → start listens once at a time; stop ends the listener', () => {
    const { store, watchRecipes, stop } = makeStore();
    store.start();
    store.start();
    expect(watchRecipes).toHaveBeenCalledTimes(1);
    store.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    store.start();
    expect(watchRecipes).toHaveBeenCalledTimes(2);
  });

  test('the ingredients are watched with the recipes, and both listeners end on stop', () => {
    const { store, watchIngredients, stopIngredients } = makeStore();
    store.start();
    store.start();
    expect(watchIngredients).toHaveBeenCalledTimes(1);
    store.stop();
    expect(stopIngredients).toHaveBeenCalledTimes(1);
  });

  test('the ingredients paint from the shared copy at once (by id), and wait when there is none', () => {
    const cold = makeStore();
    expect(cold.store.getSnapshot().ingredientsLoaded).toBe(false);
    expect(cold.store.getSnapshot().ingredients).toEqual({});
    const warm = makeStore({ [INGREDIENTS_KEY]: JSON.stringify([FLOUR, { name: 'no id' }, null]) });
    expect(warm.store.getSnapshot().ingredientsLoaded).toBe(true);
    expect(warm.store.getSnapshot().ingredients).toEqual({ i1: FLOUR });
  });

  test('a server answer replaces the ingredients and is stored as the current app’s ARRAY', () => {
    const { store, data, ingServer } = makeStore();
    store.start();
    ingServer([FLOUR, BUTTER]);
    expect(store.getSnapshot().ingredientsLoaded).toBe(true);
    expect(Object.keys(store.getSnapshot().ingredients)).toEqual(['i1', 'i2']);
    expect(JSON.parse(data.get(INGREDIENTS_KEY)!)).toEqual([FLOUR, BUTTER]);
  });

  test('⚠️ NO PRICE is kept or stored, from the server or from an older copy', () => {
    const priced: Record<string, unknown> = { ...BUTTER };
    for (const key of PRICE_FIELDS) priced[key] = 3;
    const { store, data, ingServer } = makeStore({ [INGREDIENTS_KEY]: JSON.stringify([priced]) });
    for (const key of PRICE_FIELDS) expect(Object.keys(store.getSnapshot().ingredients.i2!), key).not.toContain(key);
    store.start();
    ingServer([priced as StoredDoc]);
    const stored = data.get(INGREDIENTS_KEY)!;
    for (const key of PRICE_FIELDS) {
      expect(stored, key).not.toContain(`"${key}"`);
      expect(Object.keys(store.getSnapshot().ingredients.i2!), key).not.toContain(key);
    }
  });

  test('⚠️ an EMPTY or SHRUNKEN cached ingredient answer is not believed before the server speaks', () => {
    const { store, data, ingCache, ingServer } = makeStore({ [INGREDIENTS_KEY]: JSON.stringify([FLOUR, BUTTER]) });
    store.start();
    ingCache([]);
    ingCache([FLOUR]);
    expect(Object.keys(store.getSnapshot().ingredients)).toEqual(['i1', 'i2']);
    expect(JSON.parse(data.get(INGREDIENTS_KEY)!)).toHaveLength(2);
    ingServer([FLOUR]);
    expect(Object.keys(store.getSnapshot().ingredients)).toEqual(['i1']);
    // After the server's word a cached answer may shrink the list (a deletion seen offline) — not empty it.
    ingCache([]);
    expect(Object.keys(store.getSnapshot().ingredients)).toEqual(['i1']);
  });

  test('a cold phone believes a cached answer that holds ingredients; a copy that said «none» lets an empty one stand', () => {
    const cold = makeStore();
    cold.store.start();
    cold.ingCache([]);
    expect(cold.store.getSnapshot().ingredientsLoaded).toBe(false);
    cold.ingCache([FLOUR]);
    expect(cold.store.getSnapshot().ingredientsLoaded).toBe(true);
    const none = makeStore({ [INGREDIENTS_KEY]: '[]' });
    none.store.start();
    none.ingCache([]);
    expect(none.store.getSnapshot().ingredientsLoaded).toBe(true);
  });

  test('⚠️ a refused ingredients stream is QUIET: a warning, no message, and the wait ends', () => {
    const { store, warn, ingFail } = makeStore();
    const said = vi.fn();
    store.onMessage(said);
    store.start();
    ingFail();
    expect(store.getSnapshot().ingredientsLoaded).toBe(true);
    expect(store.getSnapshot().ingredients).toEqual({});
    expect(store.getSnapshot().ingredientsUnreadable).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(said).not.toHaveBeenCalled();
  });

  test('a refused stream over a held copy (or after an answer) is NOT «unreadable»: the copy is the data', () => {
    const warm = makeStore({ [INGREDIENTS_KEY]: JSON.stringify([FLOUR]) });
    warm.store.start();
    warm.ingFail();
    expect(warm.store.getSnapshot().ingredientsUnreadable).toBe(false);
    expect(Object.keys(warm.store.getSnapshot().ingredients)).toEqual(['i1']);
    const answered = makeStore();
    answered.store.start();
    answered.ingServer([FLOUR]);
    answered.ingFail();
    expect(answered.store.getSnapshot().ingredientsUnreadable).toBe(false);
  });

  test('a corrupt ingredient copy reads as none and waits for the answer', () => {
    const { store } = makeStore({ [INGREDIENTS_KEY]: '{not json' });
    expect(store.getSnapshot().ingredientsLoaded).toBe(false);
    expect(store.getSnapshot().ingredients).toEqual({});
  });

  describe('the label profile (config/labels)', () => {
    const SMALL = { labelSize: '57x32', fontMm: 2.5 };

    test('is watched with the recipes, and the listener ends on stop', () => {
      const { store, watchLabelConfig, stopLabel } = makeStore();
      store.start();
      store.start();
      expect(watchLabelConfig).toHaveBeenCalledTimes(1);
      store.stop();
      expect(stopLabel).toHaveBeenCalledTimes(1);
    });

    test('a cold phone does not know the paper; a server answer (a document or none) is stored RAW', () => {
      const { store, data, labelServer } = makeStore();
      expect(store.getSnapshot().labelConfigKnown).toBe(false);
      expect(store.getSnapshot().labelConfig).toBeNull();
      store.start();
      labelServer({ ...SMALL, junk: 'kept as stored' });
      expect(store.getSnapshot().labelConfigKnown).toBe(true);
      expect(store.getSnapshot().labelConfig).toEqual({ ...SMALL, junk: 'kept as stored' });
      expect(JSON.parse(data.get(LABEL_CONFIG_KEY)!)).toEqual({ ...SMALL, junk: 'kept as stored' });
      labelServer(null);
      expect(store.getSnapshot().labelConfig).toBeNull();
      expect(data.get(LABEL_CONFIG_KEY)).toBe('null');
    });

    test('⚠️ the copy is two answers: «null» = the venue has none (known), no key = never told', () => {
      expect(makeStore({ [LABEL_CONFIG_KEY]: 'null' }).store.getSnapshot().labelConfigKnown).toBe(true);
      const held = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(SMALL) }).store.getSnapshot();
      expect(held.labelConfigKnown).toBe(true);
      expect(held.labelConfig).toEqual(SMALL);
      for (const junk of ['{not json', '[1,2]', '"text"', '7']) {
        expect(makeStore({ [LABEL_CONFIG_KEY]: junk }).store.getSnapshot().labelConfigKnown, junk).toBe(false);
      }
    });

    test('⚠️ «no document» from the browser’s own database is not believed unless the copy said so too', () => {
      const cold = makeStore();
      cold.store.start();
      cold.labelCache(null);
      expect(cold.store.getSnapshot().labelConfigKnown).toBe(false);
      expect(cold.data.has(LABEL_CONFIG_KEY)).toBe(false);
      // A held profile is not wiped by it either.
      const held = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(SMALL) });
      held.store.start();
      held.labelCache(null);
      expect(held.store.getSnapshot().labelConfig).toEqual(SMALL);
      // The copy that said «none» lets it stand.
      const none = makeStore({ [LABEL_CONFIG_KEY]: 'null' });
      none.store.start();
      none.labelCache(null);
      expect(none.store.getSnapshot().labelConfigKnown).toBe(true);
    });

    test('a cached document that exists is believed (the venue’s own); after the server, cache answers count', () => {
      const cold = makeStore();
      cold.store.start();
      cold.labelCache(SMALL);
      expect(cold.store.getSnapshot().labelConfigKnown).toBe(true);
      expect(cold.store.getSnapshot().labelConfig).toEqual(SMALL);
      const later = makeStore();
      later.store.start();
      later.labelServer(SMALL);
      later.labelCache(null);
      expect(later.store.getSnapshot().labelConfig).toBeNull();
    });

    test('⚠️ a refused read is quiet and ends the wait (defaults), keeping a held profile', () => {
      const cold = makeStore();
      const said = vi.fn();
      cold.store.onMessage(said);
      cold.store.start();
      cold.labelFail();
      expect(cold.store.getSnapshot().labelConfigKnown).toBe(true);
      expect(cold.store.getSnapshot().labelConfig).toBeNull();
      expect(cold.warn).toHaveBeenCalledTimes(1);
      expect(said).not.toHaveBeenCalled();
      const held = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(SMALL) });
      held.store.start();
      held.labelFail();
      expect(held.store.getSnapshot().labelConfig).toEqual(SMALL);
    });

    test('blocked storage never throws', () => {
      const throwing = {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
        removeItem: () => { throw new Error('blocked'); },
      } as unknown as KeyValueStorage;
      const hand = handSource();
      const store = createRecipesStore(hand.source, { storage: throwing, now: () => NOW, warn: vi.fn() });
      expect(store.getSnapshot().labelConfigKnown).toBe(false);
      store.start();
      expect(() => hand.labelServer(SMALL)).not.toThrow();
      expect(store.getSnapshot().labelConfig).toEqual(SMALL);
    });
  });

  describe('saving the label profile (step 3d-5)', () => {
    const HELD = { widthMm: 76, heightMm: 51, dpi: 203 };
    const deferred = () => {
      let resolve: () => void = () => undefined;
      let reject: (err: unknown) => void = () => undefined;
      const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };

    test('⚠️ is LOCAL-FIRST: the store and the phone’s copy change at once, before the source answers', async () => {
      const { store, data, saveLabelConfig, labelServer } = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(HELD) });
      store.start();
      labelServer(HELD);
      const gate = deferred();
      saveLabelConfig.mockReturnValueOnce(gate.promise);
      const heard = vi.fn();
      store.subscribe(heard);
      const saving = store.saveLabelProfile({ dpi: 300 });
      expect(store.getSnapshot().labelConfig).toEqual({ ...HELD, dpi: 300 });
      expect(JSON.parse(data.get(LABEL_CONFIG_KEY)!)).toEqual({ ...HELD, dpi: 300 });
      expect(heard).toHaveBeenCalledTimes(1);
      expect(saveLabelConfig).toHaveBeenCalledWith({ dpi: 300 });
      gate.resolve();
      await saving;
      expect(store.getSnapshot().labelConfig).toEqual({ ...HELD, dpi: 300 });
    });

    test('a venue with no document gets one made of the patch', async () => {
      const { store, labelServer } = makeStore();
      store.start();
      labelServer(null);
      await store.saveLabelProfile({ showDate: true });
      expect(store.getSnapshot().labelConfig).toEqual({ showDate: true });
    });

    test('⚠️ two quick saves reach the source in the order they were made, NOT chained behind each other', async () => {
      const { store, saveLabelConfig, labelServer } = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(HELD) });
      store.start();
      labelServer(HELD);
      const first = deferred();
      saveLabelConfig.mockReturnValueOnce(first.promise);
      const a = store.saveLabelProfile({ widthMm: 25 });
      const b = store.saveLabelProfile({ heightMm: 40 });
      // The second was handed over while the first was still in the air.
      expect(saveLabelConfig.mock.calls.map(call => call[0])).toEqual([{ widthMm: 25 }, { heightMm: 40 }]);
      first.resolve();
      await Promise.all([a, b]);
      expect(store.getSnapshot().labelConfig).toEqual({ ...HELD, widthMm: 25, heightMm: 40 });
    });

    test('the final local value is the LAST tap even when the first rejects after the second resolved', async () => {
      const { store, data, saveLabelConfig, labelServer } = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(HELD) });
      store.start();
      labelServer(HELD);
      const first = deferred();
      saveLabelConfig.mockReturnValueOnce(first.promise);
      const a = store.saveLabelProfile({ dpi: 300 });
      const b = store.saveLabelProfile({ dpi: 600 });
      await b;
      first.reject(new Error('permission-denied'));
      await expect(a).rejects.toThrow('permission-denied');
      expect(store.getSnapshot().labelConfig).toEqual({ ...HELD, dpi: 600 });
      expect(JSON.parse(data.get(LABEL_CONFIG_KEY)!)).toEqual({ ...HELD, dpi: 600 });
    });

    test('⚠️ a rejected patch puts back ONLY its own keys, and not a key a later patch has set', async () => {
      const { store, data, saveLabelConfig, labelServer } = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(HELD) });
      store.start();
      labelServer(HELD);
      const first = deferred();
      saveLabelConfig.mockReturnValueOnce(first.promise);
      const a = store.saveLabelProfile({ widthMm: 25, heightMm: 40, showWeight: true });
      const b = store.saveLabelProfile({ heightMm: 99 });
      first.reject(new Error('offline'));
      await expect(a).rejects.toThrow('offline');
      await b;
      // width and showWeight are as they were (showWeight did not exist at all); height keeps the LATER 99.
      expect(store.getSnapshot().labelConfig).toEqual({ widthMm: 76, heightMm: 99, dpi: 203 });
      expect(JSON.parse(data.get(LABEL_CONFIG_KEY)!)).toEqual({ widthMm: 76, heightMm: 99, dpi: 203 });
    });

    test('a rejected save on a venue that had no document goes back to having none', async () => {
      const { store, data, saveLabelConfig, labelServer } = makeStore();
      store.start();
      labelServer(null);
      saveLabelConfig.mockRejectedValueOnce(new Error('permission-denied'));
      await expect(store.saveLabelProfile({ showDate: true })).rejects.toThrow('permission-denied');
      expect(store.getSnapshot().labelConfig).toBeNull();
      expect(data.get(LABEL_CONFIG_KEY)).toBe('null');
    });

    test('a source that throws at once is a rejection too, and the change is put back', async () => {
      const { store, saveLabelConfig, labelServer } = makeStore({ [LABEL_CONFIG_KEY]: JSON.stringify(HELD) });
      store.start();
      labelServer(HELD);
      saveLabelConfig.mockImplementationOnce(() => { throw new Error('sync'); });
      await expect(store.saveLabelProfile({ dpi: 300 })).rejects.toThrow('sync');
      expect(store.getSnapshot().labelConfig).toEqual(HELD);
    });
  });

  test('the snapshot is the SAME object until something changes', () => {
    const { store } = makeStore();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.bumpUsage('r1');
    expect(store.getSnapshot()).not.toBe(first);
  });
});
