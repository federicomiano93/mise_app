import { describe, expect, it } from 'vitest';
import { FROM_RECIPE_LINK } from '@mise/shared/recipe-link';
import { cameFromRecipe, entryState, keepDepth, pushDepth, recipeDepth } from './foodcostNav';

describe('the recipe depth in the navigation state', () => {
  it('the recipe link means one entry behind', () => {
    expect(recipeDepth(FROM_RECIPE_LINK)).toBe(1);
  });

  it('a positive whole number is read as it is', () => {
    expect(recipeDepth({ recipeDepth: 3 })).toBe(3);
  });

  it.each([0, -1, Number.NaN, 1.5, '2', Number.POSITIVE_INFINITY, 1e9, null, undefined, {}])('junk %s is no depth', junk => {
    expect(recipeDepth({ recipeDepth: junk })).toBeNull();
  });

  it('a state that says nothing is no depth', () => {
    for (const state of [null, undefined, 'x', 4, {}, { fromList: true }]) expect(recipeDepth(state)).toBeNull();
    expect(cameFromRecipe({})).toBe(false);
  });

  it('a push is one deeper, a replace is the same, no depth stays none', () => {
    expect(pushDepth(FROM_RECIPE_LINK)).toEqual({ recipeDepth: 2 });
    expect(pushDepth({ recipeDepth: 4 })).toEqual({ recipeDepth: 5 });
    expect(keepDepth({ recipeDepth: 4 })).toEqual({ recipeDepth: 4 });
    expect(keepDepth(FROM_RECIPE_LINK)).toEqual({ recipeDepth: 1 });
    expect(pushDepth({})).toEqual({});
    expect(keepDepth(null)).toEqual({});
  });

  it('the entry carries the incoming depth unchanged', () => {
    expect(entryState({ recipeDepth: 2 })).toMatchObject({ recipeDepth: 2 });
    expect(entryState(FROM_RECIPE_LINK)).toMatchObject({ recipeDepth: 1, fromRecipeLink: true });
    expect(entryState(null)).not.toHaveProperty('recipeDepth');
  });
});
