import { baseAmounts, scaleCatalogue, unitOf, unitTextKey, weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// Whole numbers, no thousands separator, WHATEVER THE LANGUAGE: a baker reads «1000», not «1.000»
// (the current app's rule, parity Findings F). The amounts are whole already; the format is a belt on
// top, so a decimal can never show.
const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });
export const wholeNumber = (n: number): string => WHOLE.format(n);

export type AmountRow = {
  readonly label: string;
  // Empty for a «to taste» row: it has no number, and the unit slot says the words.
  readonly num: string;
  readonly unit: string;
};

export type RecipeAmounts = {
  readonly rows: readonly AmountRow[];
  readonly total: { readonly num: string; readonly unit: string };
};

// The word a person reads for a unit: the dictionary's for pieces, spoons, a pinch and «to taste»,
// the metric symbol as it is for the rest.
function unitWord(t: Translate, unit: string): string {
  const key = unitTextKey(unit);
  return key === null ? unit : t(key);
}

// The ingredient list as it is drawn: the SCALED amounts when a batch is applied (`target` > 0), the
// recipe as written otherwise. The total is the WEIGHABLE mass in grams (weight and volume rows):
// when scaled it is the target, at base the recipe's own. Pieces and «to taste» rows are shown above
// but never enter it.
export function recipeAmounts(recipe: CatalogueRecipe, target: number | null, t: Translate): RecipeAmounts {
  const goal = target !== null && target > 0 ? target : null;
  const amounts = goal !== null ? scaleCatalogue(recipe, goal) : baseAmounts(recipe);
  const rows = recipe.ingredients.map((ing, index): AmountRow => {
    const value = amounts[index] ?? null;
    return value === null
      ? { label: ing.label, num: '', unit: unitWord(t, 'to taste') }
      : { label: ing.label, num: wholeNumber(value), unit: unitWord(t, unitOf(ing)) };
  });
  const totalGrams = goal ?? weighableTotalGrams(recipe);
  return { rows, total: { num: wholeNumber(totalGrams), unit: 'g' } };
}

// «250 g», «3 pcs», «to taste»: one row's amount as a single piece of text (the full-screen view).
export const amountText = (row: { num: string; unit: string }): string => (row.num === '' ? row.unit : `${row.num} ${row.unit}`);
