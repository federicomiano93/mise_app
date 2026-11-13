import { scaleFromRow } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { rowKeysOf } from '@mise/shared/row-actions-model';
import type { ScaledBy } from './recipesStore';

// The batch a recipe is shown at, as every card of the recipe screen reads it: the total in grams, and — when the batch was worked
// out from one ingredient («Calculate from this ingredient», 14 Nov 2026) — that row, by its place NOW, with the amount typed.
export type RecipeScale = {
  readonly target: number;
  readonly row: { readonly index: number; readonly amount: number; readonly key: string } | null;
};

// What the store remembers, read against the recipe as it is NOW. A batch from a row is worked out again from the row's current
// amount (another phone may have changed it), so the row still shows exactly what was typed and the total follows. When the row
// is gone, or can no longer be scaled from (its amount emptied, made «to taste»), the batch falls back to the total remembered —
// the batch box's own behaviour — and no row is named.
export function resolveScale(recipe: CatalogueRecipe, target: number | null, by: ScaledBy | null): RecipeScale | null {
  if (target === null || !(target > 0)) return null;
  if (by !== null) {
    const index = rowKeysOf(recipe.ingredients).indexOf(by.key);
    const result = index < 0 ? null : scaleFromRow(recipe, index, by.amount);
    if (result !== null) return { target: result.target, row: { index, amount: result.amount, key: by.key } };
  }
  return { target, row: null };
}
