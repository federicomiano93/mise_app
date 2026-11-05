import { ingredientGrams, unitDecimals, unitOf } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { ExportModel } from '@mise/shared/recipe-export';
import type { RecipeAmounts } from './recipeAmounts';

// The recipe screen's rows as the export reads them (port of exportModelOf, js/catalogue/catalogue-model.js). It is
// handed the very amounts the card drew (`recipeAmounts`), never recomputed, so the file
// starts from what the screen says (only the PDF's own «round the weights» switch prints a gram row differently):
// each row keeps its OWN unit, spelled as the screen spells it; `factor` is the grams in one of it (0 for
// pieces, spoons, a pinch, «to taste»); `decimals` and `text` keep a three-decimal kg row «0,727 kg» in Italian and
// never «1 kg»; `totalG` is the Total row's number, 0 when it is not a positive finite number.
//
// Not in ui/: it reads the dictionary's unit words and the Recipe catalogue's own shapes.
export function recipeExportModel(recipe: CatalogueRecipe, amounts: RecipeAmounts): ExportModel {
  return {
    name: recipe.name,
    trays: 0,
    totalG: Number.isFinite(amounts.totalGrams) && amounts.totalGrams > 0 ? Math.round(amounts.totalGrams) : 0,
    rows: recipe.ingredients.map((ingredient, index) => {
      const unit = unitOf(ingredient);
      const shown = amounts.rows[index];
      return {
        name: ingredient.label,
        value: amounts.values[index] ?? null,
        unit: shown?.unit ?? unit,
        // The grams in one unit of the row's own unit: a one-unit row converted by the catalogue's own table.
        factor: ingredientGrams({ unit, grams: 1 }),
        decimals: unitDecimals(unit),
        text: shown === undefined || shown.num === '' ? null : shown.num,
        // A line under this row, only when the recipe has one (no key otherwise, so a model without dividers is unchanged).
        ...(ingredient.dividerAfter === true ? { dividerAfter: true } : {}),
      };
    }),
  };
}
