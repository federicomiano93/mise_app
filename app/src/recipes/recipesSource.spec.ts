import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { PRICE_FIELDS } from '@mise/shared/price-model';
import { createFirestoreRecipesSource, newRecipeId } from './recipesSource';

// The ONLY code in Mise 2 that reads the Recipe catalogue from the real database, against a recording
// fake of the Firestore SDK. A slip here — another venue's path, a listener without metadata changes
// (so the server's identical answer is never heard), an id lost behind a field called `id` — would
// first show as an empty or a wrong catalogue on somebody's phone.

type Ref = { kind: string; path: string };

function fakeKit() {
  const listeners: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  const added: { target: Ref; data: unknown }[] = [];
  const fs = {
    addDoc: vi.fn(async (target: Ref, data: unknown) => { added.push({ target, data }); return { id: 'new' }; }),
    setDoc: vi.fn(async (_target: Ref, _data: unknown, _options: unknown) => undefined),
    collection:(_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    onSnapshot: vi.fn((target: Ref, ...rest: unknown[]) => {
      const options = typeof rest[0] === 'function' ? undefined : rest.shift();
      const [next, error] = rest as [(snap: unknown) => void, (err: unknown) => void];
      const entry = { target, options, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return { kit, fs, listeners, added };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function snapOf(docs: Array<Record<string, unknown> & { id: string }>, fromCache = false) {
  return {
    docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
    metadata: { fromCache },
  };
}

describe('the Recipe catalogue source', () => {
  test('watches the open venue’s recipes, with metadata changes, and says where each answer came from', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano');
    const onChange = vi.fn();
    source.watchRecipes(onChange, vi.fn());
    await settle();
    expect(listeners).toHaveLength(1);
    expect(listeners[0]!.target.path).toBe('locations/panificio-miano/recipes');
    expect(listeners[0]!.options).toEqual({ includeMetadataChanges: true });
    listeners[0]!.next(snapOf([{ id: 'r1', name: 'Focaccia' }], true));
    listeners[0]!.next(snapOf([{ id: 'r1', name: 'Focaccia' }], false));
    expect(onChange).toHaveBeenNthCalledWith(1, [{ name: 'Focaccia', id: 'r1' }], { fromServer: false });
    expect(onChange).toHaveBeenNthCalledWith(2, [{ name: 'Focaccia', id: 'r1' }], { fromServer: true });
  });

  test('⚠️ the document id wins over a stored field called `id`', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    const onChange = vi.fn();
    source.watchRecipes(onChange, vi.fn());
    await settle();
    listeners[0]!.next({ docs: [{ id: 'real', data: () => ({ id: 'forged', name: 'X' }) }], metadata: { fromCache: false } });
    expect(onChange.mock.calls[0]![0]).toEqual([{ id: 'real', name: 'X' }]);
  });

  test('a stop before Firestore has loaded attaches nothing; a stop after ends the listener', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    source.watchRecipes(vi.fn(), vi.fn())();
    await settle();
    expect(listeners).toHaveLength(0);
    const stop = source.watchRecipes(vi.fn(), vi.fn());
    await settle();
    stop();
    expect(listeners[0]!.stopped).toBe(true);
  });

  test('a refused stream and a Firestore that cannot load both reach onError', async () => {
    const { kit, listeners } = fakeKit();
    const onError = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').watchRecipes(vi.fn(), onError);
    await settle();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listeners[0]!.error(new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
    const failed = vi.fn();
    createFirestoreRecipesSource(() => Promise.reject(new Error('chunk')), 'bakery').watchRecipes(vi.fn(), failed);
    await settle();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  test('watches the open venue’s ingredients, with metadata changes, the id winning over a stored `id`', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano');
    const onChange = vi.fn();
    source.watchIngredients(onChange, vi.fn());
    await settle();
    expect(listeners).toHaveLength(1);
    expect(listeners[0]!.target.path).toBe('locations/panificio-miano/ingredients');
    expect(listeners[0]!.options).toEqual({ includeMetadataChanges: true });
    listeners[0]!.next({ docs: [{ id: 'real', data: () => ({ id: 'forged', name: 'Flour' }) }], metadata: { fromCache: true } });
    expect(onChange).toHaveBeenCalledWith([{ id: 'real', name: 'Flour' }], { fromServer: false });
  });

  test('⚠️ NO PRICE reaches the catalogue: every old price key on an ingredient is dropped by the source', async () => {
    // tests/catalogue-no-money.test.mjs: prices entered before v270 sit on the ingredient document itself
    // until it is saved again; the catalogue never shows a price, so none may reach its store or its copy.
    const { kit, listeners } = fakeKit();
    const onChange = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').watchIngredients(onChange, vi.fn());
    await settle();
    const priced: Record<string, unknown> = { name: 'Butter', allergens: ['milk'], allergensCheckedAt: '2026-09-01' };
    for (const key of PRICE_FIELDS) priced[key] = key === 'priceUnit' ? 'kg' : 4.2;
    listeners[0]!.next({ docs: [{ id: 'b', data: () => priced }], metadata: { fromCache: false } });
    const [list] = onChange.mock.calls[0]!;
    expect(list).toEqual([{ id: 'b', name: 'Butter', allergens: ['milk'], allergensCheckedAt: '2026-09-01' }]);
    for (const key of PRICE_FIELDS) expect(Object.keys(list[0]), key).not.toContain(key);
  });

  test('the catalogue never opens a listener on ingredient-prices', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    source.watchRecipes(vi.fn(), vi.fn());
    source.watchIngredients(vi.fn(), vi.fn());
    await settle();
    expect(listeners.map(l => l.target.path)).toEqual(['locations/bakery/recipes', 'locations/bakery/ingredients']);
  });

  test('a refused ingredients stream reaches onError QUIETLY (a warning, never an error in the console)', async () => {
    const { kit, listeners } = fakeKit();
    const onError = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').watchIngredients(vi.fn(), onError);
    await settle();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listeners[0]!.error(new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('watches the open venue’s label profile (config/labels) as ONE document, with metadata changes', async () => {
    const { kit, listeners } = fakeKit();
    const onChange = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano').watchLabelConfig(onChange, vi.fn());
    await settle();
    expect(listeners).toHaveLength(1);
    expect(listeners[0]!.target).toEqual({ kind: 'doc', path: 'locations/panificio-miano/config/labels' });
    expect(listeners[0]!.options).toEqual({ includeMetadataChanges: true });
    listeners[0]!.next({ exists: () => true, data: () => ({ widthMm: 57, heightMm: 32 }), metadata: { fromCache: true } });
    expect(onChange).toHaveBeenLastCalledWith({ widthMm: 57, heightMm: 32 }, { fromServer: false });
  });

  test('⚠️ a MISSING label profile is an answer (null), not an error: the defaults are right for it', async () => {
    const { kit, listeners } = fakeKit();
    const onChange = vi.fn();
    const onError = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').watchLabelConfig(onChange, onError);
    await settle();
    listeners[0]!.next({ exists: () => false, data: () => undefined, metadata: { fromCache: false } });
    expect(onChange).toHaveBeenCalledWith(null, { fromServer: true });
    expect(onError).not.toHaveBeenCalled();
  });

  test('a refused label profile reaches onError QUIETLY (a warning), and nothing else is ever read beside it', async () => {
    const { kit, listeners } = fakeKit();
    const onError = vi.fn();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    source.watchRecipes(vi.fn(), vi.fn());
    source.watchIngredients(vi.fn(), vi.fn());
    source.watchLabelConfig(vi.fn(), onError);
    await settle();
    expect(listeners.map(l => l.target.path)).toEqual([
      'locations/bakery/recipes', 'locations/bakery/ingredients', 'locations/bakery/config/labels',
    ]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listeners[2]!.error(new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    error.mockRestore();
    warn.mockRestore();
  });

  test('watches the open venue’s print agents as a plain list, the document id winning over a stored `id`', async () => {
    const { kit, listeners } = fakeKit();
    const onChange = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano').watchPrintAgents(onChange, vi.fn());
    await settle();
    expect(listeners).toHaveLength(1);
    expect(listeners[0]!.target).toEqual({ kind: 'collection', path: 'locations/panificio-miano/print-agents' });
    listeners[0]!.next({ docs: [{ id: 'pc', data: () => ({ id: 'forged', lastSeenAt: '2026-10-13T09:00:00.000Z' }) }], metadata: { fromCache: false } });
    expect(onChange).toHaveBeenCalledWith([{ id: 'pc', lastSeenAt: '2026-10-13T09:00:00.000Z' }]);
  });

  test('a refused print agents stream reaches onError QUIETLY (a warning, never an error)', async () => {
    const { kit, listeners } = fakeKit();
    const onError = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').watchPrintAgents(vi.fn(), onError);
    await settle();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listeners[0]!.error(new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    error.mockRestore();
    warn.mockRestore();
  });

  test('⚠️ a print job is ADDED to the open venue’s print-jobs, stamped with that venue, whatever the caller said', async () => {
    const { kit, added } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.queuePrintJob({ bakery: 'someone-else', status: 'queued', payload: '^XA^XZ', copies: 1, createdAt: 'x', createdBy: 'u1' });
    expect(added).toEqual([{
      target: { kind: 'collection', path: 'locations/panificio-miano/print-jobs' },
      data: { bakery: 'panificio-miano', status: 'queued', payload: '^XA^XZ', copies: 1, createdAt: 'x', createdBy: 'u1' },
    }]);
  });

  test('⚠️ a print job is NOT local-first: a refused write and a Firestore that cannot load both reject', async () => {
    const { kit, fs } = fakeKit();
    fs.addDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').queuePrintJob({})).rejects.toThrow('permission-denied');
    await expect(createFirestoreRecipesSource(() => Promise.reject(new Error('chunk')), 'bakery').queuePrintJob({})).rejects.toThrow('chunk');
  });

  test('⚠️ a label setting is MERGED into the open venue’s config/labels, stamped with that venue, whatever the caller said', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.saveLabelConfig({ dpi: 300, bakery: 'someone-else' });
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    expect(fs.setDoc).toHaveBeenCalledWith(
      { kind: 'doc', path: 'locations/panificio-miano/config/labels' },
      { dpi: 300, bakery: 'panificio-miano' },
      { merge: true },
    );
  });

  test('⚠️ a label setting rejects when the write is refused or Firestore cannot load', async () => {
    const { kit, fs } = fakeKit();
    fs.setDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').saveLabelConfig({ dpi: 300 })).rejects.toThrow('permission-denied');
    await expect(createFirestoreRecipesSource(() => Promise.reject(new Error('chunk')), 'bakery').saveLabelConfig({})).rejects.toThrow('chunk');
  });

  // ── Writing recipes (step 3d-6) ──

  test('⚠️ a recipe save is a MERGE at its id, stamped with the venue last, never sending `id`; a null box is a removal', async () => {
    const { kit, fs } = fakeKit();
    const removal = { removal: true };
    (fs as unknown as { deleteField: () => unknown }).deleteField = vi.fn(() => removal);
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.saveRecipeDoc('R1', {
      id: 'forged', name: 'Focaccia', ingredients: [], netWeightG: null, shelfLifeDays: 3, bakery: 'someone-else',
    });
    expect(fs.setDoc).toHaveBeenCalledWith(
      { kind: 'doc', path: 'locations/panificio-miano/recipes/R1' },
      { name: 'Focaccia', ingredients: [], netWeightG: removal, shelfLifeDays: 3, bakery: 'panificio-miano' },
      { merge: true },
    );
  });

  test('a recipe delete removes that document; the Calculator configuration is read once, or null', async () => {
    const { kit, fs } = fakeKit();
    const deleteDoc = vi.fn(async () => undefined);
    let stored: Record<string, unknown> | null = { recipes: [{ id: 'cat-R1' }] };
    const getDoc = vi.fn(async () => ({ exists: () => stored !== null, data: () => stored }));
    Object.assign(fs, { deleteDoc, getDoc });
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    await source.removeRecipeDoc('R1');
    expect(deleteDoc).toHaveBeenCalledWith({ kind: 'doc', path: 'locations/bakery/recipes/R1' });
    await expect(source.getCalculatorConfig()).resolves.toEqual({ recipes: [{ id: 'cat-R1' }] });
    expect(getDoc).toHaveBeenCalledWith({ kind: 'doc', path: 'locations/bakery/config/calculator' });
    stored = null;
    await expect(source.getCalculatorConfig()).resolves.toBeNull();
  });

  test('⚠️ a refused recipe write rejects, so the store can take the change back', async () => {
    const { kit, fs } = fakeKit();
    fs.setDoc.mockRejectedValueOnce(new Error('permission-denied'));
    Object.assign(fs, { deleteField: vi.fn(), deleteDoc: vi.fn(async () => { throw new Error('permission-denied'); }) });
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveRecipeDoc('R1', { name: 'X', ingredients: [] })).rejects.toThrow('permission-denied');
    await expect(source.removeRecipeDoc('R1')).rejects.toThrow('permission-denied');
  });

  test('the suppliers are watched quietly under the open venue, with metadata changes', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    const onChange = vi.fn();
    source.watchSuppliers(onChange, vi.fn());
    await settle();
    expect(listeners[0]!.target.path).toBe('locations/bakery/suppliers');
    expect(listeners[0]!.options).toEqual({ includeMetadataChanges: true });
    listeners[0]!.next(snapOf([{ id: 'S1', name: 'Latteria' }]));
    expect(onChange).toHaveBeenCalledWith([{ name: 'Latteria', id: 'S1' }], { fromServer: true });
  });

  test('a new recipe id has Firestore’s shape (20 letters and digits), every character equally likely', () => {
    expect(newRecipeId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(newRecipeId()).not.toBe(newRecipeId());
    // Bytes of 248 and over are thrown away: 0 → 'A', 61 → '9', 62 → 'A' again, 255 skipped.
    let call = 0;
    const id = newRecipeId(bytes => {
      call++;
      bytes.fill(call === 1 ? 255 : 61);
      return bytes;
    });
    expect(id).toBe('9'.repeat(20));
  });

  test('⚠️ a venue id that could name another path is refused before anything is read', () => {
    const { kit } = fakeKit();
    expect(() => createFirestoreRecipesSource(() => Promise.resolve(kit), '../other')).toThrow();
  });
});
