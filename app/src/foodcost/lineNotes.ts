import { ingredientLineCost, packagingLineCost } from '@mise/shared/foodcost-model';
import type { CostTables, IngredientLineReason, Table } from '@mise/shared/foodcost-model';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import type { Money } from '@mise/shared/currency';
import { costRecipe } from '@mise/shared/recipe-cost-model';
import { fcWeight } from '@mise/shared/fc-number';
import { wholeRecipeKg } from '@mise/shared/from-recipes';
import { tooMuchOfRecipe } from '@mise/shared/line-quantity';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { WorkingComponent, WorkingPackaging } from './productEditorModel';
import { readQty, recipeLineKg } from './productEditorModel';
import { lineCostView } from './lineCost';
import type { LineCost } from './lineCost';

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

// The money under a line (lineCost.ts): its rate and what the amount typed costs. ⚠️ A FAULT HERE MUST NOT TAKE THE LINES
// DOWN (P17): the money is a reading aid drawn inside every row; on a fault the line simply shows none, like the summary and
// the per-kilo box.
export function lineMoney(
  t: Translate, money: Money, line: WorkingComponent | WorkingPackaging, tables: CostTables,
): LineCost {
  try {
    if ('kind' in line && line.kind === 'recipe') {
      return lineCostView(t, money, { recipeId: line.recipeId, qtyKg: recipeLineKg(line) }, 'recipe', tables);
    }
    if ('kind' in line) {
      return lineCostView(t, money, { kind: 'ingredient', ingredientId: line.ingredientId, qty: readQty(line.qty), unit: line.unit }, 'ingredient', tables);
    }
    return lineCostView(t, money, { ingredientId: line.ingredientId, qtyPcs: readQty(line.qty) }, 'packaging', tables);
  } catch {
    return { text: '', noPrice: false };
  }
}

// What a person must ACT on, under the money (current app PR #485). THE MONEY IS NOT DRAWN HERE — it used to be none (his
// decision, 13 Sep 2026: «nella sezione "composto da" non mostrare il prezzo»), reversed by him on 7 Nov 2026 («il costo
// dell'ingrediente al kg e il costo della quantità selezionata»). Where the money line already says «No price» the note that
// said the same thing is left out: one sentence, not two. What stays is a recipe priced in part, because a silent gap is a cost
// too low, and what stops an ingredient or a packaging item from being counted.
export function lineNote(
  t: Translate, money: Money, line: WorkingComponent | WorkingPackaging, tables: CostTables, loaded: Loaded,
): string {
  if ('kind' in line && line.kind === 'recipe') {
    const recipe = lookup(tables.recipes, line.recipeId);
    if (!recipe) return line.recipeId && loaded.recipes ? t('fc.thisRecipeNoLonger') : '';
    const costed = costRecipe(recipe, tables);
    const priced = costed.pricePerKg !== null && costed.partial ? t('fc.thisRecipePartlyPriced') : '';
    // ⚠️ A NOTE only, never a block, and FIRST (current app a7f4c75d, 8 Nov 2026): more than 20 whole batches is almost
    // surely grams typed as kilos — production had 16 such lines in 11 products, every cost ×1000.
    const qtyKg = recipeLineKg(line as Extract<WorkingComponent, { kind: 'recipe' }>);
    // Model 3: a recipe line is RAW kilos, so it is measured against the RAW whole recipe, its own oven loss laid aside.
    const whole = wholeRecipeKg({ ...recipe, lossPct: 0 });
    const tooMuch = tooMuchOfRecipe(qtyKg, whole)
      ? t('fc.line.tooMuchRecipe', { qty: fcWeight(qtyKg, money), whole: fcWeight(whole, money), grams: fcWeight(qtyKg / 1000, money) })
      : '';
    return [tooMuch, priced].filter(Boolean).join(' ');
  }

  const ingredientId = (line as { ingredientId: string }).ingredientId;
  const ingredient = lookup(tables.ingredients, ingredientId);
  if (!ingredient) return ingredientId && loaded.ingredients ? t('fc.thisItemNoLonger') : '';

  if ('kind' in line && line.kind === 'ingredient') {
    const cost = ingredientLineCost({ kind: 'ingredient', ingredientId, qty: readQty(line.qty), unit: line.unit }, ingredient);
    return cost.reason === null || cost.reason === 'no-ingredient-price' ? '' : t(REASON_TEXT[cost.reason]);
  }

  // Packaging, counted in pieces, so it has to be BOUGHT by the piece. Said plainly rather than silently costing nothing; a
  // packaging item with no price at all is «No price» above instead, and one priced each says its money there.
  return packagingLineCost(line, ingredient).reason === 'no-piece-price' ? t('fc.pricedByWeightSet') : '';
}
