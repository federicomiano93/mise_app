import { baseAmounts, roundInUnit, scaleCatalogue, unitDecimals, unitOf, unitTextKey, weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// Whole GRAMS, no thousands separator, WHATEVER THE LANGUAGE: a baker reads «1000», not «1.000» (the current
// app's rule, parity Findings F). For the Total and the batch confirm.
const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });
export const wholeNumber = (n: number): string => WHOLE.format(n);

// One row's number: kg and l keep their decimals (roundInUnit), written with the language's decimal mark —
// «1,846» in Italian, «1.846» in English — and still no thousands separator. Same as the current app's
// formatAmount (js/catalogue/catalogue-model.js).
export function amountNumber(value: number, unit: string, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: unitDecimals(unit), useGrouping: false })
    .format(roundInUnit(value, unit));
}

export type AmountRow = {
  readonly label: string;
  // Empty for a «to taste» row: it has no number, and the unit slot says the words.
  readonly num: string;
  readonly unit: string;
};

export type RecipeAmounts = {
  readonly rows: readonly AmountRow[];
  readonly total: { readonly num: string; readonly unit: string };
  // What the rows were drawn FROM, for the export (it must say what the screen says): each row's amount in its own
  // unit, unrounded (null = «to taste»), and the Total's grams, unrounded.
  readonly values: readonly (number | null)[];
  readonly totalGrams: number;
};

// The word a person reads for a unit: the dictionary's for pieces, spoons, a pinch and «to taste»,
// the metric symbol as it is for the rest.
function unitWord(t: Translate, unit: string): string {
  const key = unitTextKey(unit);
  return key === null ? unit : t(key);
}

// The ingredient list as it is drawn: the SCALED amounts when a batch is applied (`target` > 0), the
// recipe as written otherwise. `locale` is the interface's (useT().locale), for the decimal mark. The total is the WEIGHABLE mass in grams (weight and volume rows):
// when scaled it is the target, at base the recipe's own. Pieces and «to taste» rows are shown above
// but never enter it.
export function recipeAmounts(recipe: CatalogueRecipe, target: number | null, t: Translate, locale: string): RecipeAmounts {
  const goal = target !== null && target > 0 ? target : null;
  const amounts = goal !== null ? scaleCatalogue(recipe, goal) : baseAmounts(recipe);
  const rows = recipe.ingredients.map((ing, index): AmountRow => {
    const value = amounts[index] ?? null;
    return value === null
      ? { label: ing.label, num: '', unit: unitWord(t, 'to taste') }
      : { label: ing.label, num: amountNumber(value, unitOf(ing), locale), unit: unitWord(t, unitOf(ing)) };
  });
  const totalGrams = goal ?? weighableTotalGrams(recipe);
  return { rows, total: { num: wholeNumber(totalGrams), unit: 'g' }, values: recipe.ingredients.map((_, index) => amounts[index] ?? null), totalGrams };
}

// «250 g», «3 pcs», «to taste»: one row's amount as a single piece of text (the full-screen view).
export const amountText = (row: { num: string; unit: string }): string => (row.num === '' ? row.unit : `${row.num} ${row.unit}`);
