// unpriced-rows.js — which rows of a recipe Food cost cannot price. PURE: no DOM, no
// Firestore (P15).
//
// Federico, 28 Oct 2026: a row Food cost cannot price gets a small crossed-out euro at the
// end of its link line in the recipe editor — no words, no banner, no amount. It partly
// reverses his 13 Sep 2026 decision that the catalogue reads no prices, and was agreed on
// exactly these terms: prices are read only while the editor is open, only for somebody who
// may read Food cost, never stored, and no money is shown or formatted anywhere.
//
// ⚠️ THIS FILE IS THE ONE PLACE THE CATALOGUE TOUCHES THE COST MODEL. It asks the model
// «could this row be priced?» and hands back BOOLEANS ONLY — never a number, never a cost,
// never the merged ingredients — so no screen can show a price by accident.
// tests/catalogue-no-money.test.mjs pins both the shape and the isolation.
//
// Marked: not linked, linked to something that is gone, an ingredient with no price, a
// sub-recipe that is gone or cannot be costed, a cycle, a chain that is too deep.
// NOT marked: a row with no amount yet (a line still being typed) or a unit that is not
// weighed (to taste, pieces) — Food cost does not price those either, and a mark there
// would be noise. A sub-recipe that is only PARTLY priced but has a price is not marked.

import { withPrices } from '../price-model.js';
import { costRecipe } from './recipe-cost-model.js';

const UNPRICED_REASONS = new Set([
  'not-linked', 'missing-ingredient', 'no-price', 'missing-recipe',
  'sub-not-costable', 'cycle', 'too-deep',
]);

// `ingredients`: the catalogue's map by id. `recipes`: the catalogue's LIST. `prices`: a
// map id -> price document (or null/undefined: then nothing is priced).
export function unpricedRowFlags(recipe, { ingredients, recipes, prices } = {}) {
  const rows = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  const merged = {};
  // The map's key is the id even where a value does not repeat it.
  const list = Array.isArray(ingredients)
    ? ingredients
    : Object.entries(ingredients || {}).map(([id, ing]) => ({ ...ing, id }));
  withPrices(list, prices || {}).forEach(ing => { if (ing && ing.id) merged[ing.id] = ing; });

  const recipeTable = {};
  (Array.isArray(recipes) ? recipes : Object.values(recipes || {}))
    .forEach(r => { if (r && r.id) recipeTable[r.id] = r; });

  const result = costRecipe(recipe, { ingredients: merged, recipes: recipeTable });
  return rows.map((_, i) => {
    const row = result.rows[i];
    return !!(row && UNPRICED_REASONS.has(row.reason));
  });
}
