import { describe, expect, it } from 'vitest';
import { recipeAllergens } from '@mise/shared/recipe-allergen-model';
import { gapEntries, gapKey } from './allergenGaps';

const declared = { allergens: [], allergensCheckedAt: '2026-01-01' };
const tables = {
  ingredients: { salt: declared, yeast: { allergens: [] }, nuts: { allergens: [] } },
  recipes: {
    // A sub-recipe with a row nobody linked: incomplete.
    sub: { id: 'sub', name: 'Sub', ingredients: [{ label: 'Mystery', grams: 10, unit: 'g' }] },
  },
};
const row = (label: string, extra: Record<string, unknown> = {}) => ({ label, grams: 10, unit: 'g', ...extra });

describe('the gaps of the allergen card, each with where a tap goes', () => {
  const recipe = {
    id: 'cake',
    ingredients: [
      row('Salt', { refId: 'salt' }),
      row('Yeast', { refId: 'yeast' }),
      row('Free text'),
      row(''),
      row('Ghost', { refId: 'gone' }),
      row('Filling', { kind: 'recipe', refId: 'sub' }),
      row('Lost cream', { kind: 'recipe', refId: 'missing' }),
    ],
  };
  const result = recipeAllergens(recipe, tables);
  const entries = gapEntries(recipe.ingredients, result.rows);

  it('lists exactly the rows the model calls gaps, in the same order', () => {
    expect(entries.map(entry => entry.label)).toEqual(result.gaps.map(gap => gap.label));
    expect(entries.map(entry => entry.reason)).toEqual(result.gaps.map(gap => gap.reason));
  });

  it('sends a linked ingredient nobody declared to its card', () => {
    expect(entries.find(entry => entry.label === 'Yeast')?.target).toEqual({ kind: 'ingredient', refId: 'yeast' });
  });

  it('sends an incomplete sub-recipe to that recipe', () => {
    const filling = entries.find(entry => entry.label === 'Filling');
    expect(filling?.reason).toBe('sub-incomplete');
    expect(filling?.target).toEqual({ kind: 'recipe', refId: 'sub' });
  });

  it('sends every other reason — a free row, a deleted ingredient, a deleted recipe — to this recipe’s editor', () => {
    for (const label of ['Free text', 'Ghost', 'Lost cream']) {
      expect(entries.find(entry => entry.label === label)?.target).toEqual({ kind: 'editor' });
    }
  });

  it('keeps the recipe row’s own place, so a blank line in between does not shift the others', () => {
    expect(entries.find(entry => entry.label === 'Yeast')?.index).toBe(1);
    expect(entries.find(entry => entry.label === 'Ghost')?.key).toBe(gapKey(4));
    expect(entries.some(entry => entry.label === '')).toBe(false);
  });

  it('has nothing to say about a recipe with no gap', () => {
    const clean = { id: 'c', ingredients: [row('Salt', { refId: 'salt' })] };
    expect(gapEntries(clean.ingredients, recipeAllergens(clean, tables).rows)).toEqual([]);
  });
});
