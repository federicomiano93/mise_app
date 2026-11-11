import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { recipeAddress, recipeIdParam } from '@mise/shared/recipe-link';

// A supplier's screen opened from a recipe row's «Order» (item 32, 10 Nov 2026; the current app's 70325def): the address carries the recipe
// to go back to (`?recipe=`) and the ingredient whose quantity box takes the focus (`&ingredient=`); the navigation state says the
// recipe is the history entry right behind (`fromRecipeLink`, as the recipe's Food cost button does).
//
// (A copy of foodcost/foodcostNav.ts' recipeDepth and useBackToRecipe, cut down to what Orders needs: a feature never imports from
// another feature's folder.)

export interface RecipeOrigin {
  readonly recipeId: string;
  // The ingredient the recipe row asked for, or null.
  readonly ingredientId: string | null;
}

// «The recipe is one entry behind this screen»: the state the recipe's button pushes with. Anything else, a reload included, says
// nothing about the history.
export function cameFromRecipeEntry(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromRecipeLink' in state;
}

// The recipe an address names, or null. ⚠️ STRICT, as the current app's hash reader was: an id with a slash, an empty one or one over
// 200 characters is no recipe, so the screen is an ordinary supplier screen and Back goes to the list.
export function recipeOriginOf(search: string): RecipeOrigin | null {
  const recipeId = recipeIdParam(search, 'recipe');
  if (recipeId === null) return null;
  return { recipeId, ingredientId: recipeIdParam(search, 'ingredient') };
}

// How a screen opened from a recipe steps back to it.
//
// ⚠️ NEVER A SECOND ENTRY FOR THE RECIPE (the current app showed two pages per trip). Opened by the recipe's button, the entry
// behind IS the recipe, so Back is the browser's Back and the history after the trip is what it was before it. With nothing behind
// it (an address typed, a reload that lost the state) the screen REPLACES itself with the recipe.
export function useBackToRecipe(origin: RecipeOrigin | null): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const behind = cameFromRecipeEntry(state);
  const recipeId = origin?.recipeId ?? null;
  return useCallback(() => {
    if (recipeId === null) return;
    if (behind) {
      void navigate(-1);
      return;
    }
    const to = recipeAddress(recipeId);
    if (to !== null) void navigate(to, { replace: true });
  }, [navigate, behind, recipeId]);
}
