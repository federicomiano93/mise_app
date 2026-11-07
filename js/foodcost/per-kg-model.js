// per-kg-model.js — what goes into ONE KILO of a product, and what each part costs.
// PURE: no DOM, no Firestore, so every rule below is asserted under Node (P15).
//
// Federico, 4 Nov 2026: a block «Costo per 1 kg» in the Food cost card — every
// ingredient's weight scaled to one kilo of the product, with its price per kilo and
// what that line costs, the recipes on the product OPENED into their own ingredients.
//
// ⚠️ THE TOTAL IS THE CARD'S OWN COST, NEVER A SECOND SUM. It is productionCost()'s batch
// cost divided by the batch's kilos — the very figures the card shows above — and the
// lines below are those same figures cut into parts. Two sums of the same thing drift
// the first time one of them is changed; a block that disagreed with the card by a cent
// would be read as one of the two being wrong.
//
// ⚠️ ONE KILO OF WHAT COMES OUT. A recipe's price per kilo is per kilo of what comes out
// of the oven (recipe-cost-model.js), so a recipe that loses 15% needs more than a kilo of
// raw ingredients for a kilo of product: the weights below add up to MORE than 1 kg
// whenever there is a loss. That is the truth of the recipe, not a rounding error.
//
// ⚠️ THE KNOWN QUIRK, inherited and NOT corrected here: a recipe row that is not linked to
// an ingredient (water, typically) adds neither cost NOR weight to the recipe in the cost
// model, so the recipe's price per kilo is the price per kilo of its LINKED rows — too
// high by the share the unlinked rows weigh, until the row is linked to an ingredient
// priced at 0 per kilo. Such a row is shown here, with its weight, as «not counted»: the
// one place a person can see it, and fix it.
//
// ⚠️ THIS BLOCK IS DRAWN APART FROM «COMPOSTO DA», on purpose. That section used to show no
// money at all (Federico, 13 Sep 2026: «nella sezione "composto da" non mostrare il prezzo»);
// he REVERSED it on 7 Nov 2026 — «il costo dell'ingrediente al kg e il costo della quantità
// selezionata» — so each line there now shows its own rate and cost (line-cost.js). This block
// stays what it was: the cost of ONE KILO of the finished product, cut into its parts.

import { ingredientDisplayName } from '../ingredient-name.js';
import { pricePerKg as ingredientPricePerKg, roundTo, positiveNumber } from '../price-model.js';
import { costRecipe } from '../catalogue/recipe-cost-model.js';
import { linkOf } from '../catalogue/catalogue-model.js';
import { normalizeProduct, productionCost, unitsPerBatch, ingredientLineCost } from './foodcost-model.js';

// Why a line is in the block but not in the total. The screen turns each into words.
//   'no-price'    — no price (not linked, no price on the ingredient, the ingredient gone)
//   'not-weighed' — in pieces or spoons, which a kilo cannot be cut into
//   'no-recipe'   — a recipe inside that has no price of its own (gone, a loop, too deep)
//   'no-piece-weight' — priced by the piece, used by weight, and nobody said what one weighs
//   'no-piece-price'  — counted in pieces, and neither a price per piece nor a piece weight
// ⚠️ THE LAST TWO ARE NOT «NO PRICE»: the ingredient HAS one, and saying otherwise sends a
// person to type a price that is already there. The same split as the card's own lines.
export const PER_KG_REASONS = Object.freeze(['no-price', 'not-weighed', 'no-recipe', 'no-piece-weight', 'no-piece-price']);

// The card's reason for an ingredient line (ingredientLineCost) → this block's.
const LINE_REASONS = { 'no-ingredient-price': 'no-price', 'no-piece-weight': 'no-piece-weight', 'no-piece-price': 'no-piece-price' };

const RECIPE_REASONS = new Set(['missing-recipe', 'sub-not-costable', 'cycle', 'too-deep']);

function lookup(table, id) {
  if (!table || !id) return null;
  if (typeof table.get === 'function') return table.get(id) || null;
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// How a recipe row's reason reads in this block.
function reasonOf(rowReason) {
  if (rowReason === 'not-weighable') return 'not-weighed';
  if (RECIPE_REASONS.has(rowReason)) return 'no-recipe';
  return 'no-price';
}

// The text two rows are merged on when neither points at an ingredient.
function labelKey(label) {
  return String(label || '').trim().toLocaleLowerCase();
}

// One kilo of the product, line by line.
//
//   { kg, total, partial, packagingLeftOut, lossy, rows }
//
//   kg     — what one batch weighs (the divisor), or null
//   total  — what one kilo costs: the card's batch cost ÷ kg, or null when nothing is
//            costed or nothing is weighed (never 0: a kilo that reads as free is the one
//            wrong answer)
//   rows   — [{ key, kind, name, kg, pcs, pricePerKg, priceEach, cost, reason }]
//            kind 'ingredient' (weighed, kg set), 'piece' (counted, pcs set) or
//            'packaging' (pcs set). A row with `reason` is shown and NOT in the total:
//            its cost and prices are null; its kg is set when it has a weight.
//            ONE ROW PER INGREDIENT: flour in the dough and flour in the cream is one
//            line, its two weights and costs added together — read like a lab sheet.
//   partial — something on the product has no price, exactly as the card says it. ⚠️ NOT
//            «too low» here: a row with no price adds neither cost nor weight, so a kilo
//            can read too HIGH (water not linked) as well as too low — the screen says
//            only that the figure is not exact yet
//   packagingLeftOut — the product has packaging but not yet a way of selling it, so its
//            share of a kilo cannot be known: left out, as the card leaves it out
//   lossy  — a recipe opened here loses weight in the oven, so its ingredients weigh
//            more than the kilo they make: the screen says why the weights pass 1 kg
export function costPerKg(product, tables = {}) {
  const p = normalizeProduct(product);
  const empty = { kg: null, total: null, partial: false, packagingLeftOut: false, lossy: false, rows: [] };
  if (!p) return empty;

  const cost = productionCost(p, tables);
  const batchKg = cost.batch.kg;
  if (!(batchKg > 0) || cost.batchCost === null) {
    return { ...empty, kg: batchKg > 0 ? batchKg : null, partial: cost.partial };
  }

  // Every amount on the product is per BATCH; multiplied by this it is per kilo.
  const perKg = 1 / batchKg;
  const rows = [];
  const byKey = new Map();
  let lossy = false;

  function add(row) {
    const known = byKey.get(row.key);
    if (!known) {
      byKey.set(row.key, row);
      rows.push(row);
      return;
    }
    for (const field of ['kg', 'pcs', 'cost']) {
      if (row[field] !== null) known[field] = (known[field] || 0) + row[field];
    }
  }

  function ingredientRow(ingredient, id, kg, rowCost) {
    add({
      key: `ing:${id}`, kind: 'ingredient', name: ingredientDisplayName(ingredient),
      kg, pcs: null, pricePerKg: ingredientPricePerKg(ingredient), priceEach: null, cost: rowCost, reason: null,
    });
  }

  function uncounted(key, name, kg, reason, kind = 'ingredient', pcs = null) {
    if (!String(name || '').trim()) return;
    // Keyed by its reason too: «1 tsp» of a salt priced by the kilo must not vanish into
    // the salt weighed elsewhere on the product.
    add({ key: `${key}:${reason}`, kind, name: String(name).trim(), kg, pcs, pricePerKg: null, priceEach: null, cost: null, reason });
  }

  // `outKg` kilos of what comes OUT of `recipe`, opened into its rows. Recursion mirrors
  // costRecipe() exactly — the same rows, the same loss, the same guards — so the parts
  // add up to the price the recipe line was costed at.
  function openRecipe(recipe, outKg, depth, seen, lossPct) {
    const costed = costRecipe(lossPct === null ? recipe : { ...recipe, lossPct }, tables, depth, seen);
    const source = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const branch = recipe.id ? new Set([...seen, String(recipe.id)]) : seen;
    // Grams of a row in the recipe → kilos of it in `outKg` kilos of what comes out.
    const scale = costed.yieldGrams > 0 ? outKg / costed.yieldGrams : 0;
    if (costed.lossPct > 0) lossy = true;

    costed.rows.forEach((row, i) => {
      const raw = source[i];
      const link = linkOf(raw);
      const kg = row.grams > 0 && scale > 0 ? row.grams * scale : null;
      if (!row.costed) {
        if (row.reason === 'no-amount') return; // a line nobody finished typing
        const ingredient = link && link.kind === 'ingredient' ? lookup(tables.ingredients, link.refId) : null;
        const key = ingredient ? `ing:${link.refId}` : `label:${labelKey(row.label)}`;
        uncounted(key, ingredient ? ingredientDisplayName(ingredient) : row.label,
          row.reason === 'not-weighable' ? null : kg, reasonOf(row.reason));
        return;
      }
      if (link.kind === 'recipe') {
        // A recipe inside: opened in its turn, with ITS OWN loss (only the product's own
        // lines lose theirs on a finished product — batchTotals() says the same).
        openRecipe(lookup(tables.recipes, link.refId), kg, depth + 1, new Set([...branch, link.refId]), null);
        return;
      }
      ingredientRow(lookup(tables.ingredients, link.refId), link.refId, kg, row.cost * scale * 1000);
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
        const each = ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
        if (line.cost === null) {
          uncounted(`${key}:pcs`, ingredientDisplayName(ingredient), null, LINE_REASONS[line.reason] || 'no-price', 'piece', pcs);
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
        uncounted(key, ingredientDisplayName(ingredient), kg > 0 ? kg : null, LINE_REASONS[line.reason] || 'no-price');
        continue;
      }
      ingredientRow(ingredient, component.ingredientId, line.kg * perKg, line.cost * perKg);
      continue;
    }

    const recipe = lookup(tables.recipes, component.recipeId);
    if (!recipe) continue; // gone: the card already says so
    const outKg = component.qtyKg * perKg;
    const lossPct = p.noWeightLoss ? 0 : null;
    const costed = costRecipe(lossPct === null ? recipe : { ...recipe, lossPct: 0 }, tables);
    if (costed.pricePerKg === null) {
      uncounted(`recipe:${component.recipeId}`, recipe.name, outKg > 0 ? outKg : null, 'no-recipe');
      continue;
    }
    if (outKg > 0) openRecipe(recipe, outKg, 1, new Set(), lossPct);
  }

  // Packaging: so many pieces per unit sold, and so many units in a kilo. Only once the
  // way of selling says how many units a batch makes — the card's own condition.
  const units = unitsPerBatch(p, cost.batch);
  const packagingLeftOut = p.packaging.length > 0 && !(units > 0);
  if (units > 0) {
    const unitsPerKg = units * perKg;
    for (const item of p.packaging) {
      const ingredient = lookup(tables.ingredients, item.ingredientId);
      if (!ingredient || !(item.qtyPcs > 0)) continue;
      const pcs = item.qtyPcs * unitsPerKg;
      const each = ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
      if (each === null) {
        // Bought by the kilo, or not priced at all — the card's two packaging answers.
        const reason = positiveNumber(ingredient.pricePerUnit) === null ? 'no-price' : 'no-piece-price';
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
    total: roundTo(cost.batchCost * perKg, 4),
    partial: cost.partial,
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

