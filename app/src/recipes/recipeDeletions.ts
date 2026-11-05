import { createContext, useContext } from 'react';

// The recipes THIS phone's screens have just deleted, so the recipe screen does not treat the disappearance as news.
//
// RecipeScreen (RecipesDetail.tsx) says «Recipe deleted.» and leaves when an open recipe vanishes from the list — the
// way it learns that another phone deleted it. A delete made here says the same sentence and leaves by itself
// (useDeleteRecipe), so without this the person would read it twice and the screen would step back twice. The screen asks
// `has(id)` before it says or leaves.
//
// The mark is taken off when the recipe comes back (a delete the database refused puts it back, and a later delete on
// another phone is then news again).

export interface RecipeDeletions {
  mark(recipeId: string): void;
  unmark(recipeId: string): void;
  has(recipeId: string): boolean;
}

const NOTHING: RecipeDeletions = {
  mark() { /* no section around */ },
  unmark() { /* ditto */ },
  has: () => false,
};

const RecipeDeletionsContext = createContext<RecipeDeletions>(NOTHING);
export const RecipeDeletionsProvider = RecipeDeletionsContext.Provider;

export function useRecipeDeletions(): RecipeDeletions {
  return useContext(RecipeDeletionsContext);
}

export function createRecipeDeletions(): RecipeDeletions {
  const marked = new Set<string>();
  return {
    mark(recipeId) { marked.add(recipeId); },
    unmark(recipeId) { marked.delete(recipeId); },
    has: recipeId => marked.has(recipeId),
  };
}
