import { describe, expect, it } from 'vitest';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { resolveScale } from './recipeScale';

// What the recipe screen draws from the batch remembered: the total, or the batch worked out again from the row it came from.
const rows = (sugar: Record<string, unknown> = {}) => [
  { label: 'Flour', grams: 2000, unit: 'g' },
  { label: 'Butter', grams: 800, unit: 'g' },
  { label: 'Sugar', grams: 800, unit: 'g', ...sugar },
  { label: 'Eggs', grams: 775, unit: 'g' },
];
const brioche = (ingredients: unknown[] = rows()) => ({ id: 'b', name: 'Brioche', ingredients }) as unknown as CatalogueRecipe;
const BY = { key: 'name:Sugar#1', amount: 1000, unit: 'g' };

describe('resolveScale', () => {
  it('no batch: nothing to scale', () => {
    expect(resolveScale(brioche(), null, BY)).toBeNull();
    expect(resolveScale(brioche(), 0, null)).toBeNull();
  });

  it('a total typed in the batch box: that total, no row', () => {
    expect(resolveScale(brioche(), 4000, null)).toEqual({ target: 4000, row: null });
  });

  it('a batch from a row: worked out again from the row as it is now, the row exact', () => {
    expect(resolveScale(brioche(), 5468.75, BY)).toEqual({ target: 5468.75, row: { index: 2, amount: 1000, key: BY.key } });
    // A row added above: found by its key, at its new place.
    const moved = resolveScale(brioche([{ label: 'Yeast', grams: 10, unit: 'g' }, ...rows()]), 5468.75, BY);
    expect(moved?.row).toEqual({ index: 3, amount: 1000, key: BY.key });
  });

  it('⚠️ the row’s unit changed since (800 g → 0.8 kg): the typed 1000 is not read in the new unit, the total remembered is shown', () => {
    expect(resolveScale(brioche(rows({ grams: 0.8, unit: 'kg' })), 5468.75, BY)).toEqual({ target: 5468.75, row: null });
    expect(resolveScale(brioche(rows({ grams: 6, unit: 'pcs' })), 5468.75, BY)).toEqual({ target: 5468.75, row: null });
  });

  it('⚠️ a batch worked out again past ten tonnes falls back to the total remembered', () => {
    expect(resolveScale(brioche(rows({ grams: 0.1 })), 5468.75, BY)).toEqual({ target: 5468.75, row: null });
  });

  it('the row gone, emptied or made «to taste»: the total remembered, no row', () => {
    for (const ingredients of [rows().filter(r => r.label !== 'Sugar'), rows({ grams: 0 }), rows({ grams: 0, unit: 'to taste' })]) {
      expect(resolveScale(brioche(ingredients), 5468.75, BY)).toEqual({ target: 5468.75, row: null });
    }
  });
});
