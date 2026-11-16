import { baseAmounts, roundInUnit, scaledResult, shownTotalGrams, unitDecimals, unitOf, unitTextKey } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe, RowScale } from '@mise/shared/catalogue-model';
import type { TotalWarning } from '@mise/shared/clean-step';
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
  // What the rows were drawn FROM, for the export (it starts from what the screen says): each row's amount in its own
  // unit as shown (null = «to taste»), and the Total's grams: those rows added up.
  readonly values: readonly (number | null)[];
  readonly totalGrams: number;
  // Set when a batch scaled by its total does not add up to it — all grams: shared applyTargetTotal refused; with kg, l or ml rows:
  // the Total is 1 g or more from the batch — and the screen says «The total is off by … g» under the Total. Never from a row,
  // never unscaled, never in a file.
  readonly warning: TotalWarning | null;
};

// The word a person reads for a unit: the dictionary's for pieces, spoons, a pinch and «to taste»,
// the metric symbol as it is for the rest.
export function unitWord(t: Translate, unit: string): string {
  const key = unitTextKey(unit);
  return key === null ? unit : t(key);
}

// The ingredient list as it is drawn: the SCALED amounts when a batch is applied (`target` > 0), the recipe as written otherwise.
// `locale` is the interface's (useT().locale), for the decimal mark.
// ⚠️ THE TOTAL IS THE ROWS SHOWN, ADDED UP (the owner's decision, 16 Nov 2026): each weighable row (weight and volume) converted to
// grams, pieces and «to taste» left out — never the batch typed, never a figure worked out again. Scaled by its total with every
// weighable row in grams it IS the batch typed (the rows were corrected to it), unless the screen says under it that it is off; with
// kg, l or ml rows nothing is corrected, and the line under it says by how much it is off; from a row it can be a few grams from the
// batch with no line (the row typed is the batch), and it says what the rows really weigh.
// `row`: the batch was worked out from that row («Calculate from this ingredient»), which then shows exactly the amount typed
// (shared `scaledResult`, the one rule «Use as base recipe» saves by too).
export function recipeAmounts(recipe: CatalogueRecipe, target: number | null, t: Translate, locale: string, row?: RowScale | null): RecipeAmounts {
  const goal = target !== null && target > 0 ? target : null;
  const scaled = goal !== null ? scaledResult(recipe, goal, row) : null;
  const amounts = scaled !== null ? scaled.amounts : baseAmounts(recipe);
  const rows = recipe.ingredients.map((ing, index): AmountRow => {
    const value = amounts[index] ?? null;
    return value === null
      ? { label: ing.label, num: '', unit: unitWord(t, 'to taste') }
      : { label: ing.label, num: amountNumber(value, unitOf(ing), locale), unit: unitWord(t, unitOf(ing)) };
  });
  // The rows as shown, in grams, added up (shared shownTotalGrams: 0.714 l counts 714 g, pieces nothing, whole grams) — the same
  // function the mixed-unit warning measures against, so the line under the Total says exactly the gap the Total shows.
  const totalGrams = shownTotalGrams(recipe, amounts);
  return {
    rows,
    total: { num: wholeNumber(totalGrams), unit: 'g' },
    values: recipe.ingredients.map((_, index) => amounts[index] ?? null),
    totalGrams,
    warning: scaled?.warning ?? null,
  };
}

// «250 g», «3 pcs», «to taste»: one row's amount as a single piece of text (the full-screen view).
export const amountText = (row: { num: string; unit: string }): string => (row.num === '' ? row.unit : `${row.num} ${row.unit}`);
