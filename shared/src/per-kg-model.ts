// per-kg-model.ts — what goes into ONE KILO of a product, and what each part costs.
// PURE: no DOM, no Firestore, so every rule below is asserted under Node (P15).
//
// TypeScript FULL port of js/foodcost/per-kg-model.js for Mise 2 (current app 574a0e3c, f0735d88, 9af66dd5; item 22 of
// docs/mise2-port-owed.md). Behaviour is identical, input for input, junk included (every function accepts `unknown`, as the
// original accepts anything, because a document is data). parity.spec.ts pairs it; per-kg-model.spec.ts runs every test against
// BOTH files. It reuses the ported foodcost-model, recipe-cost-model, catalogue-model, price-model and ingredient-name: the
// calculation is never copied.
//
// Federico, 4 Nov 2026: a block «Costo per 1 kg» in the Food cost card — every ingredient's weight scaled to one kilo of the
// product, with its price per kilo and what that line costs, the recipes on the product OPENED into their own ingredients.
//
// ⚠️ THE TOTAL IS THE CARD'S OWN COST, NEVER A SECOND SUM. It is productionCost()'s batch cost divided by the batch's kilos — the
// very figures the card shows above — and the lines below are those same figures cut into parts. Two sums of the same thing drift
// the first time one of them is changed; a block that disagreed with the card by a cent would be read as one of the two being wrong.
//
// ⚠️ ONE KILO OF WHAT COMES OUT. A recipe's price per kilo is per kilo of what comes out of the oven (recipe-cost-model), so a
// recipe that loses 15% needs more than a kilo of raw ingredients for a kilo of product: the weights below add up to MORE than 1 kg
// whenever there is a loss. That is the truth of the recipe, not a rounding error.
//
// ⚠️ THE KNOWN QUIRK, inherited and NOT corrected here: a recipe row that is not linked to an ingredient (water, typically) adds
// neither cost NOR weight to the recipe in the cost model, so the recipe's price per kilo is the price per kilo of its LINKED rows
// — too high by the share the unlinked rows weigh, until the row is linked to an ingredient priced at 0 per kilo. Such a row is
// shown here, with its weight, as «not counted»: the one place a person can see it, and fix it.
//
// ⚠️ THIS BLOCK IS DRAWN APART FROM «COMPOSTO DA», on purpose. That section used to show no money at all (Federico, 13 Sep 2026);
// he REVERSED it on 7 Nov 2026 — each line there now shows its own rate and cost (line-cost). This block stays what it was: the
// cost of ONE KILO of the finished product, cut into its parts.
//
// ⚠️⚠️ AFTER THE SWITCH (Mise 2, 10 Nov 2026: «il calo è del prodotto» — foodcost-model.ts says it all): the product's recipe
// lines are RAW dough, so each is opened at the recipe's RAW price, its own loss laid aside; the kilo is a kilo of what comes out
// of the PRODUCT's oven (its cooked weight), and `lossy` says the product loses — or a recipe inside one of its recipes does,
// which still keeps its own loss. A product the current app saved is read converted (currentProduct), so its block reads as
// it did. per-kg-model.spec.ts says where this file and js/foodcost/per-kg-model.js now part («post-switch»).
//
// ⚠️⚠️ POST-SWITCH (11 Nov 2026, «solo l'impasto»): Federico decided the cost of 1 kg is the DOUGH only — the lines of «Made of»
// (ingredients and recipes), NO packaging. Every Mise 2 screen that shows the kilo (the summary's kilo row, the «Baking» result
// line, «Cost breakdown») calls costPerKg with `{ packaging: false }`: the total is the lines' batch cost ÷ the batch's kilos,
// `partial` is the lines' own, no packaging row, `packagingLeftOut` always false. Without the option (two arguments, as the
// current app calls it) the answer is unchanged, so the pair stays paired by name and arity (the third parameter has a default).

import { ingredientDisplayName } from './ingredient-name';
import { pricePerKg as ingredientPricePerKg, roundTo, positiveNumber } from './price-model';
import { costRecipe } from './recipe-cost-model';
import { linkOf } from './catalogue-model';
import type { RowLink } from './catalogue-model';
import { currentProduct, productCooking, productionCost, unitsPerBatch, ingredientLineCost } from './foodcost-model';
import type { CostTables, IngredientLineReason } from './foodcost-model';

// Why a line is in the block but not in the total. The screen turns each into words.
//   'no-price'    — no price (not linked, no price on the ingredient, the ingredient gone)
//   'not-weighed' — in pieces or spoons, which a kilo cannot be cut into
//   'no-recipe'   — a recipe inside that has no price of its own (gone, a loop, too deep)
//   'no-piece-weight' — priced by the piece, used by weight, and nobody said what one weighs
//   'no-piece-price'  — counted in pieces, and neither a price per piece nor a piece weight
// ⚠️ THE LAST TWO ARE NOT «NO PRICE»: the ingredient HAS one, and saying otherwise sends a person to type a price that is already
// there. The same split as the card's own lines.
export const PER_KG_REASONS = Object.freeze(['no-price', 'not-weighed', 'no-recipe', 'no-piece-weight', 'no-piece-price'] as const);

export type PerKgReason = (typeof PER_KG_REASONS)[number];

export type PerKgKind = 'ingredient' | 'piece' | 'packaging';

export interface PerKgRow {
  key: string;
  kind: PerKgKind;
  name: string;
  kg: number | null;
  pcs: number | null;
  pricePerKg: number | null;
  priceEach: number | null;
  cost: number | null;
  reason: PerKgReason | null;
}

// POST-SWITCH (11 Nov 2026, «solo l'impasto»): a type only, so the module's exports are still the original's.
export interface PerKgOptions {
  // false: the dough only — no packaging row, packaging out of the total and out of `partial`. Default true (the original).
  packaging?: boolean;
}

export interface PerKgResult {
  kg: number | null;
  total: number | null;
  partial: boolean;
  packagingLeftOut: boolean;
  lossy: boolean;
  rows: PerKgRow[];
}

// The card's reason for an ingredient line (ingredientLineCost) → this block's.
const LINE_REASONS: Readonly<Record<IngredientLineReason, PerKgReason>> = {
  'no-ingredient-price': 'no-price',
  'no-piece-weight': 'no-piece-weight',
  'no-piece-price': 'no-piece-price',
};

const RECIPE_REASONS = new Set(['missing-recipe', 'sub-not-costable', 'cycle', 'too-deep']);

function lookup(table: unknown, id: unknown): unknown {
  if (!table || !id) return null;
  const t = table as { get?: unknown } & Record<PropertyKey, unknown>;
  if (typeof t.get === 'function') return (t.get as (id: unknown) => unknown).call(table, id) || null;
  return Object.prototype.hasOwnProperty.call(table, id as PropertyKey) ? t[id as PropertyKey] : null;
}

// How a recipe row's reason reads in this block.
function reasonOf(rowReason: unknown): PerKgReason {
  if (rowReason === 'not-weighable') return 'not-weighed';
  if (RECIPE_REASONS.has(rowReason as string)) return 'no-recipe';
  return 'no-price';
}

// The text two rows are merged on when neither points at an ingredient.
function labelKey(label: unknown): string {
  return String(label || '').trim().toLocaleLowerCase();
}

// One kilo of the product, line by line.
//
//   { kg, total, partial, packagingLeftOut, lossy, rows }
//
//   kg     — what one batch weighs (the divisor), or null
//   total  — what one kilo costs: the card's batch cost ÷ kg, or null when nothing is costed or nothing is weighed (never 0: a
//            kilo that reads as free is the one wrong answer)
//   rows   — [{ key, kind, name, kg, pcs, pricePerKg, priceEach, cost, reason }]
//            kind 'ingredient' (weighed, kg set), 'piece' (counted, pcs set) or 'packaging' (pcs set). A row with `reason` is
//            shown and NOT in the total: its cost and prices are null; its kg is set when it has a weight.
//            ONE ROW PER INGREDIENT: flour in the dough and flour in the cream is one line, its two weights and costs added
//            together — read like a lab sheet.
//   partial — something on the product has no price, exactly as the card says it. ⚠️ NOT «too low» here: a row with no price adds
//            neither cost nor weight, so a kilo can read too HIGH (water not linked) as well as too low — the screen says only
//            that the figure is not exact yet
//   packagingLeftOut — the product has packaging but not yet a way of selling it, so its share of a kilo cannot be known: left
//            out, as the card leaves it out
//   lossy  — the product loses weight in the oven, or a recipe inside one of its recipes does, so the ingredients weigh more than
//            the kilo they make: the screen says why the weights pass 1 kg
//
// options.packaging false (POST-SWITCH, 11 Nov 2026, «solo l'impasto»): the same answer without packaging — total = the lines'
// batch cost ÷ kg, partial = the lines' partial, no 'packaging' row, packagingLeftOut false.
export function costPerKg(product: unknown, tables: CostTables = {}, options: PerKgOptions = {}): PerKgResult {
  const p = currentProduct(product, tables);
  const empty: PerKgResult = { kg: null, total: null, partial: false, packagingLeftOut: false, lossy: false, rows: [] };
  if (!p) return empty;

  // POST-SWITCH (11 Nov 2026, «solo l'impasto»): `?.` because a junk third argument (null) must not throw where js/ does not.
  const withPackaging = (options as PerKgOptions | null)?.packaging !== false;
  const cost = productionCost(p, tables);
  const batchKg = cost.batch.kg;
  // The lines alone, or the lines and the packaging (the card's figure). batchCost is null exactly when the lines cost nothing.
  const partial = withPackaging ? cost.partial : cost.batch.partial;
  if (!(batchKg > 0) || cost.batchCost === null) {
    return { ...empty, kg: batchKg > 0 ? batchKg : null, partial };
  }

  // Every amount on the product is per BATCH; multiplied by this it is per kilo.
  const perKg = 1 / batchKg;
  const rows: PerKgRow[] = [];
  const byKey = new Map<string, PerKgRow>();
  let lossy = (productCooking(p, tables).lossPct || 0) > 0;

  function add(row: PerKgRow): void {
    const known = byKey.get(row.key);
    if (!known) {
      byKey.set(row.key, row);
      rows.push(row);
      return;
    }
    for (const field of ['kg', 'pcs', 'cost'] as const) {
      const value = row[field];
      if (value !== null) known[field] = (known[field] || 0) + value;
    }
  }

  function ingredientRow(ingredient: unknown, id: string, kg: number | null, rowCost: number | null): void {
    add({
      key: `ing:${id}`, kind: 'ingredient', name: ingredientDisplayName(ingredient),
      kg, pcs: null, pricePerKg: ingredientPricePerKg(ingredient), priceEach: null, cost: rowCost, reason: null,
    });
  }

  function uncounted(key: string, name: unknown, kg: number | null, reason: PerKgReason, kind: PerKgKind = 'ingredient', pcs: number | null = null): void {
    if (!String(name || '').trim()) return;
    // Keyed by its reason too: «1 tsp» of a salt priced by the kilo must not vanish into the salt weighed elsewhere on the product.
    add({ key: `${key}:${reason}`, kind, name: String(name).trim(), kg, pcs, pricePerKg: null, priceEach: null, cost: null, reason });
  }

  // `outKg` kilos of what comes OUT of `recipe`, opened into its rows. Recursion mirrors costRecipe() exactly — the same rows, the
  // same loss, the same guards — so the parts add up to the price the recipe line was costed at.
  function openRecipe(recipe: unknown, outKg: number | null, depth: number, seen: Set<string>, lossPct: number | null): void {
    const card = recipe as { id?: unknown; ingredients?: unknown; lossPct?: unknown };
    const costed = costRecipe(lossPct === null ? recipe : { ...card, lossPct }, tables, depth, seen);
    const source: unknown[] = Array.isArray(card.ingredients) ? card.ingredients : [];
    const branch = card.id ? new Set([...seen, String(card.id)]) : seen;
    // Grams of a row in the recipe → kilos of it in `outKg` kilos of what comes out.
    const scale = costed.yieldGrams > 0 && outKg !== null ? outKg / costed.yieldGrams : 0;
    if (costed.lossPct > 0) lossy = true;

    costed.rows.forEach((row, i) => {
      const raw = source[i];
      const link = linkOf(raw);
      const kg = row.grams > 0 && scale > 0 ? row.grams * scale : null;
      if (!row.costed) {
        if (row.reason === 'no-amount') return; // a line nobody finished typing
        const ingredient = link && link.kind === 'ingredient' ? lookup(tables.ingredients, link.refId) : null;
        const key = ingredient ? `ing:${(link as RowLink).refId}` : `label:${labelKey(row.label)}`;
        uncounted(key, ingredient ? ingredientDisplayName(ingredient) : row.label,
          row.reason === 'not-weighable' ? null : kg, reasonOf(row.reason));
        return;
      }
      const costedLink = link as RowLink;
      if (costedLink.kind === 'recipe') {
        // A recipe inside: opened in its turn, with ITS OWN loss (only the product's own lines are raw dough, opened at the raw
        // price — componentLineCost() says the same).
        openRecipe(lookup(tables.recipes, costedLink.refId), kg, depth + 1, new Set([...branch, costedLink.refId]), null);
        return;
      }
      ingredientRow(lookup(tables.ingredients, costedLink.refId), costedLink.refId, kg, (row.cost as number) * scale * 1000);
    });
  }

  for (const component of p.components) {
    if (component.kind === 'ingredient') {
      const ingredient = lookup(tables.ingredients, component.ingredientId);
      if (!ingredient) continue; // gone: the card already says so, and it has no name
      if (!(component.qty > 0)) continue; // a line nobody has given an amount yet
      const line = ingredientLineCost(component, ingredient);
      const key = `ing:${component.ingredientId}`;
      if (component.unit === 'pcs') {
        const pcs = component.qty * perKg;
        const each = (ingredient as { priceUnit?: unknown }).priceUnit === 'pcs' ? positiveNumber((ingredient as { pricePerUnit?: unknown }).pricePerUnit) : null;
        if (line.cost === null) {
          uncounted(`${key}:pcs`, ingredientDisplayName(ingredient), null, (line.reason && LINE_REASONS[line.reason]) || 'no-price', 'piece', pcs);
          continue;
        }
        add({
          key: `${key}:pcs`, kind: 'piece', name: ingredientDisplayName(ingredient),
          kg: line.kg > 0 ? line.kg * perKg : null, pcs,
          pricePerKg: each === null ? ingredientPricePerKg(ingredient) : null,
          priceEach: each, cost: line.cost * perKg, reason: null,
        });
        continue;
      }
      const kg = (component.unit === 'kg' ? component.qty : component.qty / 1000) * perKg;
      if (line.cost === null) {
        uncounted(key, ingredientDisplayName(ingredient), kg > 0 ? kg : null, (line.reason && LINE_REASONS[line.reason]) || 'no-price');
        continue;
      }
      ingredientRow(ingredient, component.ingredientId, line.kg * perKg, line.cost * perKg);
      continue;
    }

    const recipe = lookup(tables.recipes, component.recipeId) as { name?: unknown } | null;
    if (!recipe) continue; // gone: the card already says so
    // Raw dough, opened at the raw price: the recipe's own loss laid aside, as componentLineCost() costs the line.
    const outKg = component.qtyKg * perKg;
    const costed = costRecipe({ ...recipe, lossPct: 0 }, tables);
    if (costed.pricePerKg === null) {
      uncounted(`recipe:${component.recipeId}`, recipe.name, outKg > 0 ? outKg : null, 'no-recipe');
      continue;
    }
    if (outKg > 0) openRecipe(recipe, outKg, 1, new Set(), 0);
  }

  // Packaging: so many pieces per unit sold, and so many units in a kilo. Only once the way of selling says how many units a batch
  // makes — the card's own condition. POST-SWITCH (11 Nov 2026, «solo l'impasto»): none of it for the dough only.
  const units = withPackaging ? unitsPerBatch(p, cost.batch) : null;
  const packagingLeftOut = withPackaging && p.packaging.length > 0 && !(units !== null && units > 0);
  if (units !== null && units > 0) {
    const unitsPerKg = units * perKg;
    for (const item of p.packaging) {
      const ingredient = lookup(tables.ingredients, item.ingredientId);
      if (!ingredient || !(item.qtyPcs > 0)) continue;
      const pcs = item.qtyPcs * unitsPerKg;
      const price = (ingredient as { pricePerUnit?: unknown }).pricePerUnit;
      const each = (ingredient as { priceUnit?: unknown }).priceUnit === 'pcs' ? positiveNumber(price) : null;
      if (each === null) {
        // Bought by the kilo, or not priced at all — the card's two packaging answers.
        const reason = positiveNumber(price) === null ? 'no-price' : 'no-piece-price';
        uncounted(`pack:${item.ingredientId}`, ingredientDisplayName(ingredient), null, reason, 'packaging', pcs);
        continue;
      }
      add({
        key: `pack:${item.ingredientId}`, kind: 'packaging', name: ingredientDisplayName(ingredient),
        kg: null, pcs, pricePerKg: null, priceEach: each, cost: pcs * each, reason: null,
      });
    }
  }

  return {
    kg: batchKg,
    total: roundTo((withPackaging ? cost.batchCost : cost.batch.cost) * perKg, 4),
    partial,
    packagingLeftOut,
    lossy,
    rows: rows.map(row => ({
      ...row,
      kg: row.kg === null ? null : roundTo(row.kg, 6),
      pcs: row.pcs === null ? null : roundTo(row.pcs, 4),
      cost: row.cost === null ? null : roundTo(row.cost, 4),
    })),
  };
}
