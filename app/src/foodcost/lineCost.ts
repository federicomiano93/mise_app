import { componentLineCost, packagingLineCost } from '@mise/shared/foodcost-model';
import type { CostTables } from '@mise/shared/foodcost-model';
import type { Money } from '@mise/shared/currency';
import { fcMoney } from '@mise/shared/fc-number';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// The words under every «Made of» and packaging line: what the thing is priced at, and what the amount on the line
// costs (current app line-cost.js, PR #485, after the two-decimals change of PR #490).
//
// Federico, 7 Nov 2026: «il costo dell'ingrediente al kg e il costo della quantità selezionata». This REVERSES his
// 13 Sep 2026 rule «nella sezione "composto da" non mostrare il prezzo». The note under the line (lineNotes.ts) keeps
// saying what a person must DO; this says the money, in its own element above it, in the form and in the read view.
//
// PURE of the screen: the figures come from foodcost-model (componentLineCost, packagingLineCost — the very call the
// batch total is built from), only the words are chosen here, so the form and the read view say the same thing.
//
// ⚠️ UNKNOWN IS «— No price», NEVER 0. A price that exists but cannot be used (a price per piece on a line counted in
// grams) shows the rate it has and nothing else; the note says what to do.
// ⚠️ fcMoney FOR BOTH THE RATE AND THE AMOUNT, like the «Cost per 1 kg» box (two decimals): a 2 g pinch of salt costing
// less than a cent reads «< £0.01», never «£0.00» (free).

// What a line is, as the cost model reads it. A recipe line is { recipeId, qtyKg }; an ingredient line
// { kind: 'ingredient', ingredientId, qty, unit }; a packaging item { ingredientId, qtyPcs }.
export type LineCostKind = 'recipe' | 'ingredient' | 'packaging';

export type LineCost = {
  // '' when there is nothing to say (the line's recipe or item no longer exists: the note says so).
  text: string;
  // True when `text` is «— No price», which already says what the note would: the note then stays out of the way.
  noPrice: boolean;
};

const NONE: LineCost = { text: '', noPrice: false };

const positive = (value: unknown): boolean => Number.isFinite(Number(value)) && Number(value) > 0;

type Entry = Readonly<Record<string, unknown>>;

export function lineCostView(
  t: Translate,
  money: Money,
  entry: Entry,
  kind: LineCostKind,
  tables: CostTables,
  { noWeightLoss = false }: { noWeightLoss?: boolean } = {},
): LineCost {
  let rate: number | null;
  let rateUnit: 'kg' | 'pcs' | null;
  let cost: number | null;
  let reason: string | null;
  let qty: unknown;
  let partial = false;

  if (kind === 'packaging') {
    const ingredient = lookupIngredient(tables, entry.ingredientId);
    if (ingredient === null) return NONE;
    ({ rate, rateUnit, cost, reason } = packagingLineCost(entry, ingredient));
    qty = entry.qtyPcs;
  } else {
    const line = componentLineCost(kind === 'ingredient' ? { ...entry, kind: 'ingredient' } : entry, tables, { noWeightLoss });
    if (line.reason === 'missing-recipe' || line.reason === 'missing-ingredient') return NONE;
    ({ rate, rateUnit, cost, reason } = line);
    qty = kind === 'recipe' ? entry.qtyKg : entry.qty;
    // «Not exact yet» is for a recipe priced only in part; an ingredient line is either costed or not.
    partial = kind === 'recipe' && line.partial;
  }

  if (rate === null) {
    return reason === 'no-price' || reason === 'no-recipe-cost' || reason === 'no-ingredient-price'
      ? { text: t('fc.line.noPrice'), noPrice: true }
      : NONE;
  }

  const rateText = t(rateUnit === 'pcs' ? 'fc.line.each' : 'fc.line.perKg', { rate: fcMoney(rate, money) });
  // The amount only where it can be known and there is an amount to price.
  let text = cost !== null && positive(qty) ? t('fc.line.withAmount', { rate: rateText, cost: fcMoney(cost, money) }) : rateText;
  if (partial) text = t('fc.line.notExact', { text });
  return { text, noPrice: false };
}

function lookupIngredient(tables: CostTables, id: unknown): unknown {
  const table = tables.ingredients;
  if (!table || typeof id !== 'string' || id === '') return null;
  if (table instanceof Map) return table.get(id) ?? null;
  const record = table as Readonly<Record<string, unknown>>;
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] ?? null : null;
}
