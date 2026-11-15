import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECIPE_COUNT_WAIT_MS, countWithin } from './IngredientCard';

// Mise 2, 15 Nov 2026: the recipe count Save waits for before it warns that a food item leaves food. It never hangs Save and never
// turns «could not count» into «no recipe».
afterEach(() => { vi.useRealTimers(); });

describe('countWithin', () => {
  it('hands the count on', async () => {
    await expect(countWithin(() => Promise.resolve(3))).resolves.toBe(3);
    await expect(countWithin(() => Promise.resolve(0))).resolves.toBe(0);
  });

  it('no counter, a failed count, null or a value that is no count: null («may be used»)', async () => {
    await expect(countWithin(undefined)).resolves.toBeNull();
    await expect(countWithin(() => Promise.reject(new Error('unavailable')))).resolves.toBeNull();
    await expect(countWithin(() => Promise.resolve(null))).resolves.toBeNull();
    await expect(countWithin(() => Promise.resolve(Number.NaN))).resolves.toBeNull();
  });

  it(`⚠️ no answer within ${String(RECIPE_COUNT_WAIT_MS)} ms: null, and a late answer changes nothing`, async () => {
    vi.useFakeTimers();
    let answer: (n: number) => void = () => undefined;
    const result = countWithin(() => new Promise<number>(resolve => { answer = resolve; }));
    vi.advanceTimersByTime(RECIPE_COUNT_WAIT_MS - 1);
    let settled: number | null | undefined;
    void result.then(n => { settled = n; });
    await Promise.resolve();
    expect(settled).toBeUndefined();
    vi.advanceTimersByTime(1);
    await expect(result).resolves.toBeNull();
    answer(2);
    await expect(result).resolves.toBeNull();
  });
});
