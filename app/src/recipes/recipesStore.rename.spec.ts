import { afterEach, describe, expect, test, vi } from 'vitest';
import type { KeyValueStorage } from '../session/backend';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { RENAME_SOFT_MS, RenameNotConfirmed, RenameNotFinished, createRecipesStore } from './recipesStore';

// The store's category rename, end to end against the in-memory source: what the snapshot says while it is in the air, how it ends
// (done, refused, not finished, not confirmed, abandoned by a stop), and what is laid over the database's snapshots meanwhile.

afterEach(() => { vi.useRealTimers(); });

const NOW = Date.UTC(2026, 10, 28, 9, 0);

function memory() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  } as unknown as KeyValueStorage;
  return { data, storage };
}

async function started(labelConfig: Record<string, unknown> = { recipeCategories: ['Easter', 'Christmas'] }) {
  vi.useFakeTimers();
  const source = fakeRecipesSource({
    recipes: [
      { id: 'p', name: 'Panettone', category: 'Christmas', ingredients: [] },
      { id: 'b', name: 'Brioche', category: 'Christmas', ingredients: [] },
      { id: 'c', name: 'Colomba', category: 'Easter', ingredients: [] },
    ],
    labelConfig,
  });
  const { data, storage } = memory();
  const store = createRecipesStore(source, { storage, now: () => NOW, warn: vi.fn() });
  store.start();
  await vi.advanceTimersByTimeAsync(0);
  return { store, source, data };
}

const categoryOf = (store: Awaited<ReturnType<typeof started>>['store'], id: string) =>
  (store.getSnapshot().recipes.find(recipe => recipe.id === id) as { category?: string } | undefined)?.category;

describe('while it is in the air', () => {
  test('the snapshot says so, shows the new word only, and no database snapshot brings the old one back', async () => {
    const { store, source } = await started();
    const release = source.holdLabelSaves();
    const done = store.renameRecipeCategory('Christmas', 'Festive');
    expect(store.getSnapshot().renaming).toBe(true);
    expect([...store.getSnapshot().categories].sort()).toEqual(['Easter', 'Festive']);
    source.push();
    expect([...store.getSnapshot().categories].sort()).toEqual(['Easter', 'Festive']);
    expect(categoryOf(store, 'p')).toBe('Festive');
    expect(categoryOf(store, 'c')).toBe('Easter');
    release();
    await done;
    expect(store.getSnapshot().renaming).toBe(false);
    expect([...store.getSnapshot().categories].sort()).toEqual(['Easter', 'Festive']);
  });

  test('⚠️ the HACCP choice is laid over only when it was the renamed word when the rename began', async () => {
    const moving = await started({ recipeCategories: ['Easter', 'Christmas'], haccpCategory: 'christmas' });
    const release = moving.source.holdLabelSaves();
    const first = moving.store.renameRecipeCategory('Christmas', 'Festive');
    moving.source.push();
    expect(moving.store.getSnapshot().labelConfig?.haccpCategory).toBe('Festive');
    release();
    await first;
    vi.useRealTimers();

    const staying = await started({ recipeCategories: ['Easter', 'Christmas'], haccpCategory: 'Easter' });
    const hold = staying.source.holdLabelSaves();
    const second = staying.store.renameRecipeCategory('Christmas', 'Festive');
    staying.source.push();
    expect(staying.store.getSnapshot().labelConfig?.haccpCategory).toBe('Easter');
    hold();
    await second;
    expect(staying.store.getSnapshot().labelConfig?.haccpCategory).toBe('Easter');
    expect(staying.source.labelSaves).toEqual([]);
  });
});

describe('how it ends', () => {
  test('the first write refused: the flag clears and the state is the database\'s, with nothing else sent', async () => {
    const { store, source } = await started();
    source.refuse.labelSave = true;
    await expect(store.renameRecipeCategory('Christmas', 'Festive')).rejects.not.toBeInstanceOf(RenameNotFinished);
    expect(store.getSnapshot().renaming).toBe(false);
    expect([...store.getSnapshot().categories].sort()).toEqual(['Christmas', 'Easter']);
    expect(categoryOf(store, 'p')).toBe('Christmas');
    expect(source.recipeWrites).toEqual([]);
  });

  test('a recipe refused: RenameNotFinished, the flag clears, both words stay and the refused recipe is under the old word', async () => {
    const { store, source } = await started();
    source.refuseRecipeIds = ['b'];
    await expect(store.renameRecipeCategory('Christmas', 'Festive')).rejects.toBeInstanceOf(RenameNotFinished);
    expect(store.getSnapshot().renaming).toBe(false);
    expect([...store.getSnapshot().categories].sort()).toEqual(['Christmas', 'Easter', 'Festive']);
    expect(categoryOf(store, 'b')).toBe('Christmas');
    expect(categoryOf(store, 'p')).toBe('Festive');
  });

  test('⚠️ no answer in time: after the soft timeout the screen stops waiting, the state is the database\'s, and the late write finishes quietly', async () => {
    const { store, source } = await started();
    const release = source.holdLabelSaves();
    const outcome = store.renameRecipeCategory('Christmas', 'Festive');
    const rejected = expect(outcome).rejects.toBeInstanceOf(RenameNotConfirmed);
    await vi.advanceTimersByTimeAsync(RENAME_SOFT_MS - 1);
    expect(store.getSnapshot().renaming).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(store.getSnapshot().renaming).toBe(false);
    expect([...store.getSnapshot().categories].sort()).toEqual(['Christmas', 'Easter']);
    expect(categoryOf(store, 'p')).toBe('Christmas');
    // The write answers late: its steps go on and the database's snapshots are the state.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(source.categoryWrites).toEqual([{ add: 'Festive' }, { remove: ['Christmas'] }]);
    expect([...store.getSnapshot().categories].sort()).toEqual(['Easter', 'Festive']);
    expect(categoryOf(store, 'p')).toBe('Festive');
  });

  test('a late refusal changes nothing on the phone', async () => {
    const { store, source } = await started();
    const release = source.holdLabelSaves();
    const outcome = store.renameRecipeCategory('Christmas', 'Festive');
    const rejected = expect(outcome).rejects.toBeInstanceOf(RenameNotConfirmed);
    await vi.advanceTimersByTimeAsync(RENAME_SOFT_MS);
    await rejected;
    source.refuse.labelSave = true;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect([...store.getSnapshot().categories].sort()).toEqual(['Christmas', 'Easter']);
  });
});

describe('a stop', () => {
  test('⚠️ abandons the rename: its failure paths write nothing to the phone afterwards', async () => {
    const { store, source, data } = await started();
    const release = source.holdLabelSaves();
    const outcome = store.renameRecipeCategory('Christmas', 'Festive');
    const rejected = expect(outcome).rejects.toBeDefined();
    store.stop();
    const held = new Map(data);
    source.refuse.labelSave = true;
    release();
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(new Map(data)).toEqual(held);
  });
});
