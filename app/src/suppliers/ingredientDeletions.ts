import { createContext, useContext } from 'react';

// The ingredients THIS phone's screens have just deleted, so the ingredient card does not treat the disappearance as news.
//
// IngredientCardScreen says «This ingredient no longer exists.» and leaves when an ingredient that was not open yet vanishes
// from the list. A delete made here says «Ingredient deleted.» and leaves by itself (useDeleteIngredient), so without this the
// person would read both. The mark is taken off when the ingredient is back (a refused delete puts it back): the section calls
// `prune` with the ingredients it can see.
//
// (The suppliers' supplierDeletions.ts, for ingredients: a feature never imports from another feature's folder.)

export interface IngredientDeletions {
  mark(ingredientId: string): void;
  has(ingredientId: string): boolean;
  // Forgets every mark whose ingredient is in `presentIds`.
  prune(presentIds: Iterable<string>): void;
}

const NOTHING: IngredientDeletions = {
  mark() { /* no section around */ },
  has: () => false,
  prune() { /* ditto */ },
};

const IngredientDeletionsContext = createContext<IngredientDeletions>(NOTHING);
export const IngredientDeletionsProvider = IngredientDeletionsContext.Provider;

export function useIngredientDeletions(): IngredientDeletions {
  return useContext(IngredientDeletionsContext);
}

export function createIngredientDeletions(): IngredientDeletions {
  const marked = new Set<string>();
  return {
    mark(ingredientId) { marked.add(ingredientId); },
    has: ingredientId => marked.has(ingredientId),
    prune(presentIds) {
      for (const id of presentIds) marked.delete(id);
    },
  };
}
