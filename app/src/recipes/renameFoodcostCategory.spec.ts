import { afterEach, describe, expect, it, vi } from 'vitest';
import { renameFoodcostCategory } from './renameFoodcostCategory';
import type { CategoryDocsSource } from './renameFoodcostCategory';

// The Food cost half of a Ricettario rename: every document the old word names is renamed, from the SERVER's answer only.

afterEach(() => { vi.useRealTimers(); });

type Answer = { list: Array<{ id: string } & Record<string, unknown>>; fromServer: boolean };

function sourceAnswering(answers: Answer[] | 'never' | 'error') {
  const stop = vi.fn();
  const saved: Array<{ id: string; data: { name: string; rank: number } }> = [];
  const source: CategoryDocsSource = {
    watchCategories: vi.fn((onChange, onError) => {
      if (answers === 'error') queueMicrotask(() => { onError(new Error('refused')); });
      else if (answers !== 'never') queueMicrotask(() => { for (const answer of answers) onChange(answer.list, { fromServer: answer.fromServer }); });
      return stop;
    }),
    saveCategory: vi.fn(async (id, data) => { saved.push({ id, data }); }),
  };
  return { source, stop, saved };
}

const DOCS = [
  { id: 'a', name: 'Pane  rustico', rank: 3 },
  { id: 'b', name: 'pane rustico', rank: 9 },
  { id: 'c', name: 'Dolci', rank: 4 },
  { id: 'd', name: 'Pane', rank: 5 },
];

describe('renameFoodcostCategory', () => {
  it('renames EVERY document that matches (capitals and repeated spaces not counting), keeping each rank', async () => {
    const { source, stop, saved } = sourceAnswering([{ list: DOCS, fromServer: true }]);
    expect(await renameFoodcostCategory(source, 'Pane rustico', 'Focacce')).toBe('done');
    expect(saved).toEqual([
      { id: 'a', data: { name: 'Focacce', rank: 3 } },
      { id: 'b', data: { name: 'Focacce', rank: 9 } },
    ]);
    expect(stop).toHaveBeenCalled();
  });

  it('accents are not folded: «Pane» is not «Pàne»', async () => {
    const { source, saved } = sourceAnswering([{ list: [{ id: 'x', name: 'Pàne', rank: 1 }], fromServer: true }]);
    expect(await renameFoodcostCategory(source, 'Pane', 'Pani')).toBe('done');
    expect(saved).toEqual([]);
  });

  it('⚠️ a cache-only answer is no answer: nothing is renamed, and the wait ends by the timeout', async () => {
    vi.useFakeTimers();
    const { source, stop, saved } = sourceAnswering([{ list: DOCS, fromServer: false }]);
    const outcome = renameFoodcostCategory(source, 'Pane', 'Pani', 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await outcome).toBe('failed');
    expect(saved).toEqual([]);
    expect(stop).toHaveBeenCalled();
  });

  it('a cache copy followed by the server\'s answer renames from the server\'s', async () => {
    const { source, saved } = sourceAnswering([{ list: [], fromServer: false }, { list: DOCS, fromServer: true }]);
    expect(await renameFoodcostCategory(source, 'Dolci', 'Torte')).toBe('done');
    expect(saved).toEqual([{ id: 'c', data: { name: 'Torte', rank: 4 } }]);
  });

  it('no answer in time (offline) is a failure, with the listener removed', async () => {
    vi.useFakeTimers();
    const { source, stop, saved } = sourceAnswering('never');
    const outcome = renameFoodcostCategory(source, 'Pane', 'Pani');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe('failed');
    expect(saved).toEqual([]);
    expect(stop).toHaveBeenCalled();
  });

  it('a read that fails, or a write that is refused, is a failure and never throws', async () => {
    expect(await renameFoodcostCategory(sourceAnswering('error').source, 'Pane', 'Pani')).toBe('failed');
    const { source } = sourceAnswering([{ list: DOCS, fromServer: true }]);
    source.saveCategory = vi.fn(async () => { throw new Error('permission-denied'); });
    expect(await renameFoodcostCategory(source, 'Pane', 'Pani')).toBe('failed');
  });
});
