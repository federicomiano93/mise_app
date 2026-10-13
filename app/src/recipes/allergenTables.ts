import { useMemo } from 'react';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { StoredDoc } from './recipesSource';

// The two lookup tables every allergen verdict is worked out from: the recipes by id (a row may point
// at a sub-recipe) and the ingredients by id (a row may point at an ingredient). The shared model accepts
// a Map or a plain object for each.
//
// ⚠️ THE INGREDIENTS CARRY NO PRICE (the store strips every price key before it keeps them), so nothing
// that is built from these tables can show money.
export interface AllergenTables {
  readonly recipes: ReadonlyMap<string, CatalogueRecipe>;
  readonly ingredients: Readonly<Record<string, StoredDoc>>;
}

// One object per change of the data, so a card that memoises on it recomputes only when something
// really changed.
export function useAllergenTables(
  recipes: readonly CatalogueRecipe[],
  ingredients: Readonly<Record<string, StoredDoc>>,
): AllergenTables {
  return useMemo(
    () => ({ recipes: new Map(recipes.map(recipe => [recipe.id, recipe] as const)), ingredients }),
    [recipes, ingredients],
  );
}
