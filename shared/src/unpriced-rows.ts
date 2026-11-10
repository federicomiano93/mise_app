// unpriced-rows.ts — which rows of a recipe Food cost cannot price. PURE: no DOM, no Firestore (P15).
//
// TypeScript FULL port of js/catalogue/unpriced-rows.js for Mise 2 (current app ff1a2d38, 28 Oct 2026; item 30 of
// docs/mise2-port-owed.md). Behaviour is identical, input for input. parity.spec.ts pairs it; unpriced-rows.spec.ts runs every
// test against BOTH files, each with its OWN cost model, as the apps are.
//
// Federico, 28 Oct 2026: a row Food cost cannot price gets a small crossed-out euro at the end of its link line in the recipe
// editor — no words, no banner, no amount. It partly reverses his 13 Sep 2026 decision that the catalogue reads no prices, and was
// agreed on exactly these terms: prices are read only while the editor is open, only for somebody who may read Food cost, never
// stored, and no money is shown or formatted anywhere.
//
// ⚠️ THIS FILE IS THE ONE PLACE THE CATALOGUE TOUCHES THE COST MODEL. It asks the model «could this row be priced?» and hands back
// BOOLEANS ONLY — never a number, never a cost, never the merged ingredients — so no screen can show a price by accident.
// `app/src/recipes/unpricedMarks.spec.ts` pins both the shape and the isolation in the app.
//
// Marked: not linked, linked to something that is gone, an ingredient with no price, a sub-recipe that is gone or cannot be
// costed, a cycle, a chain that is too deep.
// NOT marked: a row with no amount yet (a line still being typed) or a unit that is not weighed (to taste, pieces) — Food cost
// does not price those either, and a mark there would be noise. A sub-recipe that is only PARTLY priced but has a price is not
// marked.

import { withPrices } from './price-model';
import { costRecipe } from './recipe-cost-model';

const UNPRICED_REASONS: ReadonlySet<string | null> = new Set([
  'not-linked', 'missing-ingredient', 'no-price', 'missing-recipe',
  'sub-not-costable', 'cycle', 'too-deep',
]);

export interface UnpricedTables {
  // The catalogue's map by id (or a list: then each carries its id).
  ingredients?: unknown;
  // The catalogue's LIST (or a map by id).
  recipes?: unknown;
  // id -> price document; null/undefined: then nothing is priced.
  prices?: Readonly<Record<string, object | null | undefined>> | null;
}

// One boolean per row of `recipe`, true where Food cost cannot price it.
export function unpricedRowFlags(recipe: unknown, { ingredients, recipes, prices }: UnpricedTables = {}): boolean[] {
  const given = (recipe as { ingredients?: unknown } | null | undefined)?.ingredients;
  const rows: unknown[] = Array.isArray(given) ? given : [];
  const merged: Record<string, unknown> = {};
  // The map's key is the id even where a value does not repeat it.
  const list: object[] = Array.isArray(ingredients)
    ? ingredients as object[]
    : Object.entries((ingredients || {}) as Record<string, object>).map(([id, ing]) => ({ ...ing, id }));
  withPrices(list, prices || {}).forEach(ing => {
    const id = (ing as { id?: string } | null)?.id;
    if (ing && id) merged[id] = ing;
  });

  const recipeTable: Record<string, unknown> = {};
  (Array.isArray(recipes) ? recipes : Object.values((recipes || {}) as Record<string, unknown>))
    .forEach((r: unknown) => {
      const id = (r as { id?: string } | null)?.id;
      if (r && id) recipeTable[id] = r;
    });

  const result = costRecipe(recipe, { ingredients: merged, recipes: recipeTable });
  return rows.map((_, i) => {
    const row = result.rows[i];
    return !!(row && UNPRICED_REASONS.has(row.reason));
  });
}
