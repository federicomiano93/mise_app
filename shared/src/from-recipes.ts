// from-recipes.ts — what one whole recipe weighs once made. PURE: no DOM, no Firestore.
//
// PARTIAL port of js/foodcost/from-recipes.js: only `wholeRecipeKg`, which the «too much of a recipe» warning under a Food
// cost «Made of» line needs (current app a7f4c75d, 8 Nov 2026). The rest of the file — the products made from the recipe
// book (`recipesWithoutProducts`, `productFromRecipe`, …) — is item 29 of docs/mise2-port-owed.md, deferred until after the
// switch. So parity.spec.ts does NOT pair it; from-recipes.spec.ts runs `wholeRecipeKg` against both files.

import { normalizeLossPct, weighableTotalGrams } from './catalogue-model';
import { roundTo } from './price-model';

// What one whole recipe weighs once made, in kilos: its weighable rows less its oven loss — the kilos its cost per kilo is
// counted on. 0 for a recipe of pieces and spoons only, which he then weighs himself.
export function wholeRecipeKg(recipe: unknown): number {
  const grams = weighableTotalGrams(recipe);
  if (!(grams > 0)) return 0;
  const loss = normalizeLossPct((recipe as { lossPct?: unknown } | null | undefined)?.lossPct);
  return roundTo(grams * (1 - loss / 100) / 1000, 3);
}
