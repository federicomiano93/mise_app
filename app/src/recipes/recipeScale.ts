import { MAX_WEIGHT_G, scaleFromRow, unitOf } from '@mise/shared/catalogue-model';
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
// ⚠️ TWO MORE FALLBACKS, BECAUSE NOTHING ELSE CHECKS A BATCH WORKED OUT AGAIN: the dialog's 10-tonne ceiling and the louder question
// run only when the amount is typed. (1) The row's unit has changed since: the typed number was meant in the old unit (1000 g read as
// 1000 kg is a thousandfold batch), so it is not reused. (2) The batch worked out again is past the database's bound on a weighing
// (MAX_WEIGHT_G, ten tonnes): a colleague cut the row's amount tenfold, say. Both show the total remembered, which was checked.
export function resolveScale(recipe: CatalogueRecipe, target: number | null, by: ScaledBy | null): RecipeScale | null {
  if (target === null || !(target > 0)) return null;
  if (by !== null) {
    const index = rowKeysOf(recipe.ingredients).indexOf(by.key);
    const sameUnit = index >= 0 && unitOf(recipe.ingredients[index]) === by.unit;
    const result = sameUnit ? scaleFromRow(recipe, index, by.amount) : null;
    if (result !== null && result.target <= MAX_WEIGHT_G) return { target: result.target, row: { index, amount: result.amount, key: by.key } };
  }
  return { target, row: null };
}
