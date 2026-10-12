import { ingredientLineCost } from '@mise/shared/foodcost-model';
import type { CostTables, IngredientLineReason, Table } from '@mise/shared/foodcost-model';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { formatMoney, formatRate } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import { costRecipe } from '@mise/shared/recipe-cost-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { WorkingComponent, WorkingPackaging } from './productEditorModel';
import { readQty } from './productEditorModel';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// What stops an ingredient line from being costed, in words. Keys, resolved when a note is drawn.
const REASON_TEXT = {
  'no-ingredient-price': 'fc.ingredientNoPrice',
  'no-piece-weight': 'fc.ingredientNoPieceWeight',
  'no-piece-price': 'fc.ingredientNoPiecePrice',
} as const satisfies Record<IngredientLineReason, MessageKey>;

type Doc = Readonly<Record<string, unknown>>;

// A document out of a table that is a Map or a plain object, whichever the caller has.
function lookup(table: Table | null | undefined, id: string): Doc | null {
  if (!table || !id) return null;
  if (table instanceof Map) return (table.get(id) as Doc | undefined) ?? null;
  const record = table as Readonly<Record<string, unknown>>;
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] as Doc : null;
}

export function recipeOf(tables: CostTables, id: string): Doc | null {
  return lookup(tables.recipes, id);
}

export type LineName = { text: string; missing: boolean };

// What has been heard from the stores yet. A phone with no local copies has neither at first, and a
// line must not be called «gone» before what it points at has been asked for.
export type Loaded = { recipes: boolean; ingredients: boolean };

// The name a line wears: what the recipe or the item is called now, or that it no longer exists.
export function lineName(
  t: Translate, line: WorkingComponent | WorkingPackaging, tables: CostTables, loaded: Loaded,
): LineName {
  if ('kind' in line && line.kind === 'recipe') {
    const recipe = lookup(tables.recipes, line.recipeId);
    if (recipe) return { text: String(recipe.name ?? '').trim(), missing: false };
    return loaded.recipes
      ? { text: t('fc.thisRecipeNoLonger'), missing: true }
      : { text: t('session.loading'), missing: false };
  }
  const item = lookup(tables.ingredients, (line as { ingredientId: string }).ingredientId);
  if (item) return { text: ingredientDisplayName(item).trim(), missing: false };
  return loaded.ingredients
    ? { text: t('fc.thisItemNoLonger'), missing: true }
    : { text: t('session.loading'), missing: false };
}

// ⚠️ NO MONEY UNDER A RECIPE OR AN INGREDIENT LINE (his decision, 13 Sep 2026: the price is not shown
// in «made of»). What stays is what a person must ACT on — a recipe with no price, or only part of
// one — because a silent gap is a cost too low. Packaging is the exception: it is counted in pieces,
// and its price each and the line total are what says whether it was counted right.
export function lineNote(
  t: Translate, money: Money, line: WorkingComponent | WorkingPackaging, tables: CostTables, loaded: Loaded,
): string {
  if ('kind' in line && line.kind === 'recipe') {
    const recipe = lookup(tables.recipes, line.recipeId);
    if (!recipe) return line.recipeId && loaded.recipes ? t('fc.thisRecipeNoLonger') : '';
    const costed = costRecipe(recipe, tables);
    if (costed.pricePerKg === null) return t('fc.thisRecipeIsNot');
    return costed.partial ? t('fc.thisRecipePartlyPriced') : '';
  }

  const ingredientId = (line as { ingredientId: string }).ingredientId;
  const ingredient = lookup(tables.ingredients, ingredientId);
  if (!ingredient) return ingredientId && loaded.ingredients ? t('fc.thisItemNoLonger') : '';

  if ('kind' in line && line.kind === 'ingredient') {
    // No money here either — only what stops the line from being costed.
    const cost = ingredientLineCost({ kind: 'ingredient', ingredientId, qty: readQty(line.qty), unit: line.unit }, ingredient);
    return cost.reason === null ? '' : t(REASON_TEXT[cost.reason]);
  }

  // Packaging, counted in pieces, so it has to be BOUGHT by the piece. Said plainly rather than
  // silently costing nothing.
  if (ingredient.priceUnit !== 'pcs') return t('fc.pricedByWeightSet');
  const each = Number(ingredient.pricePerUnit) || 0;
  return `${t('fc.priceEach', { price: formatRate(each, money) })}  ·  ${formatMoney(readQty((line as WorkingPackaging).qty) * each, money)}`;
}
