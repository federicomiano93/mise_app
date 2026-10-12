// What a recipe tab shows as its result, worked out from the configuration, the linked catalogue recipes and
// the numbers typed. Pure: the screen feeds in the text of its boxes and draws what comes back.
//
// A port of calc.js `calc(id)` (the maths and the refusals), with the tab's state held in the keys of
// calculator-tab-keys rather than in the page.

import { computeRecipeTarget, isProRata, recipeSpec, showsLeaveningKnob } from '@mise/shared/calculator-config';
import type { CalculatorConfig, Recipe } from '@mise/shared/calculator-config';
import { scaleRecipe } from '@mise/shared/calculator-dough-math';
import { canCalculate, isLinked, resolveRecipe, sheetRecipe } from '@mise/shared/calculator-recipe-source';
import type { ResolvedRecipe } from '@mise/shared/calculator-recipe-source';
import type { StoredDoc } from './calculatorSource';
import { leaveningPct } from './calculatorInput';

// What the boxes of one tab hold, as numbers.
export interface TabNumbers {
  // qtyId → the typed quantity.
  readonly qty: (qtyId: string) => number;
  readonly extraG: number;
  readonly totalG: number;
  readonly trays: unknown;
  // The knob's text, or null when it was never touched (the recipe's default applies).
  readonly knob: string | null;
}

export interface ResultRow {
  readonly name: string;
  readonly grams: number;
}

export type TabResult =
  // Nothing to make: the result is hidden.
  | { readonly kind: 'none'; readonly target: 0 }
  // The linked catalogue recipe has not arrived yet.
  | { readonly kind: 'loading'; readonly target: number }
  // It cannot be calculated: gone, empty, or a row with no weight (`row` names it).
  | { readonly kind: 'problem'; readonly target: number; readonly problem: 'missing' | 'empty' | 'unweighable'; readonly row: string }
  | {
    readonly kind: 'ready';
    readonly target: number;
    // The recipe the tab was calculated from (the linked recipe's rows, not the tab's leftover copy).
    readonly source: Recipe;
    readonly resolved: ResolvedRecipe;
    // One per ingredient; the rounded grams sum EXACTLY to Math.round(target).
    readonly rows: readonly ResultRow[];
    readonly totalG: number;
    readonly pct: number;
  };

// The recipe the screen calculates from and draws its knob for: a linked tab takes its rows and its leavening
// from the catalogue recipe; the tab keeps its own name, logic and percentages (sheetRecipe).
export function sourceRecipe(recipe: Recipe, linked: Readonly<Record<string, StoredDoc | null>>): { source: Recipe; resolved: ResolvedRecipe } {
  const resolved = resolveRecipe(recipe, linked);
  return { source: sheetRecipe(recipe, resolved), resolved };
}

// Whether the linked recipe has not been heard of yet. A key present with null is «looked, it is gone».
export function stillLoading(recipe: Recipe, linked: Readonly<Record<string, StoredDoc | null>>): boolean {
  return isLinked(recipe) &&!(String(recipe.catalogueId).trim() in linked);
}

export function calculateTab(
  config: CalculatorConfig,
  recipe: Recipe,
  linked: Readonly<Record<string, StoredDoc | null>>,
  numbers: TabNumbers,
): TabResult {
  const target = computeRecipeTarget(config, recipe, {
    getQty: numbers.qty, extraGrams: numbers.extraG, totalInput: numbers.totalG, trays: numbers.trays,
  });
  if (target <= 0) return { kind: 'none', target: 0 };

  // ⚠️ A LINKED RECIPE THAT HAS NOT ARRIVED IS NOT ONE THAT IS GONE: two sentences (js/calculator-catalogue-link.js).
  if (stillLoading(recipe, linked)) return { kind: 'loading', target };

  // ⚠️ THE INGREDIENTS COME THROUGH resolveRecipe, NEVER STRAIGHT OFF THE TAB: once a tab is linked,
  // recipe.ingredients is only its own leftover copy. And a recipe that cannot be read REFUSES instead of
  // baking nothing: an empty list scales happily into a dough of zero.
  const { source, resolved } = sourceRecipe(recipe, linked);
  if (!canCalculate(resolved)) {
    return {
      kind: 'problem',
      target,
      problem: resolved.problem ?? 'empty',
      row: resolved.problemRow,
    };
  }

  const pct = leaveningPct(showsLeaveningKnob(source) ? numbers.knob : null, recipe.leaveningDefaultPct);
  const spec = recipeSpec(source);
  // 'total' and the trays logics scale purely pro-rata.
  if (isProRata(recipe.logic)) spec.leaveningKey = null;
  const scaled = scaleRecipe(spec, target, pct);
  const rows = resolved.ingredients.map((ingredient, i) => ({ name: ingredient.label, grams: scaled[i] ?? 0 }));
  return { kind: 'ready', target, source, resolved, rows, totalG: Math.round(target), pct };
}
