// cake-label-model.ts — the label of a WHOLE CAKE: one ingredient list, one «Contains», one nutrition table for the finished cake
// (Mise 2 only, Torte step 2b). PURE, asserted under Node (P15).
//
// ⚠️⚠️ NO LABEL LAW IS WRITTEN HERE. The cake is turned into ONE synthetic recipe and handed to buildLabel / recipeAllergens
// (recipe-label-model.ts, recipe-allergen-model.ts), which decide everything: the allergen gate (one unchecked ingredient anywhere
// refuses the label), the flattening, the weight order, contains and may-contain kept apart, the nutrition. This file only does the
// part that is the cake's own: which raw amounts go into it.
//
// HOW THE CAKE BECOMES A RECIPE
//   • Every line of the cake (every tier and part) is one semi-finished card at some READY grams (resolveLines: typed grams, else the
//     rule's; packaging is never part of it). The same card in two places is ONE line, its grams summed.
//   • A card is made of components weighed RAW (foodcost-model, model 4) and weighs `outputKg` once baked. To get `readyKg` of a
//     card, `f = readyKg / outputKg` of every component is needed — the order a label asks for is the order at manufacture, so the raw
//     amounts are what is listed.
//   • A component that is a recipe becomes a recipe row (flattenIngredients opens it), an ingredient an ingredient row (pieces keep their
//     unit, so they land in the weightless tail exactly as on a recipe label), and a semi-finished line is the same walk one level down
//     with readyKg = qtyKg × f.
//   • `lossPct` of the synthetic recipe is what the cards, together, lose in the oven: nutritionPer100g divides by the FINISHED weight.
//
// ⚠️ A CARD THAT CANNOT BE WALKED (gone, no weights, a loop, too deep) IS A PROBLEM, NOT A SILENT GAP: its rows are missing from the
// recipe, so the allergen verdict over what is left would look complete. cakeLabel never says «ready» while a problem stands.

import { resolveLines, tierDiameters } from './cake-model';
import type { Cake, CakePart } from './cake-model';
import { currentProduct, lineRawKg, MAX_SEMI_DEPTH, productCooking } from './foodcost-model';
import type { CostTables } from './foodcost-model';
import { ingredientDisplayName } from './ingredient-name';
import { canLabel, recipeAllergens } from './recipe-allergen-model';
import type { AllergenReason } from './recipe-allergen-model';
import { buildLabel } from './recipe-label-model';
import type { DraftLabel, Label, LabelShows } from './recipe-label-model';

// One row of the synthetic recipe: the recipe row shape the label code reads (`label`, `grams`, `unit`, `kind`, `refId`).
export interface CakeLabelRow {
  label: string;
  grams: number;
  unit: 'g' | 'pcs';
  kind: 'ingredient' | 'recipe';
  refId: string;
}

// «Da quali schede»: one line per card, wherever it sits, with its grams in the cake added up.
export interface CakeLabelCard {
  productId: string;
  name: string;
  where: { part: CakePart; tier: number }[];
  grams: number;
}

export type CakeLabelProblemReason = 'card-gone' | 'card-no-weights' | 'too-deep' | 'loop';

export interface CakeLabelProblem {
  productId: string;
  name: string;
  reason: CakeLabelProblemReason;
}

export interface CakeLabelBuild {
  recipe: { id: string; name: string; lossPct: number; ingredients: CakeLabelRow[] };
  cards: CakeLabelCard[];
  // Row index → the card whose component the row is (the innermost one), to give a refused row its card.
  rowCard: Map<number, string>;
  problems: CakeLabelProblem[];
  // The finished weight of the cake, whole grams: the sum of its lines.
  totalGrams: number;
}

type Table = CostTables['recipes'];

function lookup(table: Table | undefined, id: unknown): Record<string, unknown> | null {
  if (!table || id === undefined || id === null || id === '') return null;
  const t = table as { get?: unknown } & Record<PropertyKey, unknown>;
  const found = typeof t.get === 'function'
    ? (t.get as (key: unknown) => unknown).call(table, id)
    : (Object.prototype.hasOwnProperty.call(table, id as PropertyKey) ? t[id as PropertyKey] : null);
  return found && typeof found === 'object' ? found as Record<string, unknown> : null;
}

const nameOf = (doc: Record<string, unknown> | null): string => String(doc && doc.name != null ? doc.name : '').trim();

// The synthetic recipe of a cake, the cards it is made of, and what could not be walked.
export function cakeLabelRecipe(cake: Cake, tables: CostTables): CakeLabelBuild {
  const cards = new Map<string, CakeLabelCard>();
  let totalGrams = 0;
  for (const line of resolveLines(cake)) {
    if (!(line.grams > 0)) continue;
    totalGrams += line.grams;
    let card = cards.get(line.productId);
    if (!card) {
      card = { productId: line.productId, name: nameOf(lookup(tables.products, line.productId)), where: [], grams: 0 };
      cards.set(line.productId, card);
    }
    card.grams += line.grams;
    if (!card.where.some(spot => spot.part === line.part && spot.tier === line.tier)) card.where.push({ part: line.part, tier: line.tier });
  }

  const rows: CakeLabelRow[] = [];
  const rowCard = new Map<number, string>();
  const problems: CakeLabelProblem[] = [];
  let rawG = 0;
  let pieceG = 0;

  const problem = (productId: string, name: string, reason: CakeLabelProblemReason): void => {
    if (!problems.some(p => p.productId === productId && p.reason === reason)) problems.push({ productId, name, reason });
  };
  const addRow = (row: CakeLabelRow, cardId: string): void => {
    rowCard.set(rows.length, cardId);
    rows.push(row);
  };

  const walk = (productId: string, readyKg: number, depth: number, chain: readonly string[]): void => {
    const doc = lookup(tables.products, productId);
    if (!doc) return problem(productId, cards.get(productId)?.name ?? '', 'card-gone');
    const name = nameOf(doc);
    if (chain.includes(productId)) return problem(productId, name, 'loop');
    if (depth >= MAX_SEMI_DEPTH) return problem(productId, name, 'too-deep');
    const card = { ...doc, id: productId };
    const product = currentProduct(card, tables);
    const outputKg = productCooking(card, tables).outputKg;
    if (!product || outputKg === null || !(outputKg > 0)) return problem(productId, name, 'card-no-weights');
    const f = readyKg / outputKg;

    for (const component of product.components) {
      if (component.kind === 'semi') {
        if (component.qtyKg > 0) walk(component.productId, component.qtyKg * f, depth + 1, [...chain, productId]);
      } else if (component.kind === 'ingredient') {
        if (!(component.qty > 0)) continue;
        const ingredient = lookup(tables.ingredients, component.ingredientId);
        const label = (ingredient ? ingredientDisplayName(ingredient) : '') || component.ingredientId;
        if (component.unit === 'pcs') {
          const pieceKg = lineRawKg(component, tables);
          if (pieceKg !== null) pieceG += pieceKg * 1000 * f;
          addRow({ label, grams: component.qty * f, unit: 'pcs', kind: 'ingredient', refId: component.ingredientId }, productId);
        } else {
          const grams = (component.unit === 'kg' ? component.qty * 1000 : component.qty) * f;
          rawG += grams;
          addRow({ label, grams, unit: 'g', kind: 'ingredient', refId: component.ingredientId }, productId);
        }
      } else {
        if (!(component.qtyKg > 0)) continue;
        const grams = component.qtyKg * 1000 * f;
        rawG += grams;
        const label = nameOf(lookup(tables.recipes, component.recipeId)) || component.recipeId;
        addRow({ label, grams, unit: 'g', kind: 'recipe', refId: component.recipeId }, productId);
      }
    }
  };

  for (const card of cards.values()) walk(card.productId, card.grams / 1000, 0, []);

  // What the oven took, over everything that has a weight on the label: the finished weight (without the pieces, which the label
  // lists without a weight) against the raw one. Never below 0 or above the recipes' own cap.
  const finishedG = totalGrams - pieceG;
  const lossPct = rawG > 0 ? Math.min(95, Math.max(0, (1 - finishedG / rawG) * 100)) : 0;

  return {
    recipe: { id: `cake:${cake.id}`, name: cake.name.trim(), lossPct, ingredients: rows },
    cards: [...cards.values()],
    rowCard,
    problems,
    totalGrams: Math.round(totalGrams),
  };
}

// Why a card, an ingredient or a recipe stops the label.
export type CakeLabelBlock =
  | { kind: 'card'; productId: string; name: string; reason: CakeLabelProblemReason }
  | { kind: 'ingredient' | 'recipe'; productId: string; cardName: string; refId: string; name: string; reason: AllergenReason }
  | { kind: 'no-weights' };

export type CakeLabelAnswer =
  // No card with any grams: nothing to label yet.
  | { state: 'empty'; build: CakeLabelBuild; blocks: []; blockedCards: 0; label: null }
  | { state: 'blocked'; build: CakeLabelBuild; blocks: CakeLabelBlock[]; blockedCards: number; label: Label }
  | { state: 'ready'; build: CakeLabelBuild; blocks: []; blockedCards: 0; label: DraftLabel };

// The cake's label, or what stands in the way of it. `blockedCards` counts the cards that block (a card with two undeclared
// ingredients is one).
export function cakeLabel(cake: Cake, tables: CostTables, shows: LabelShows = 'both'): CakeLabelAnswer {
  const build = cakeLabelRecipe(cake, tables);
  const label = buildLabel(build.recipe, tables, { shows });
  if (build.cards.length === 0) return { state: 'empty', build, blocks: [], blockedCards: 0, label: null };

  const blocks: CakeLabelBlock[] = build.problems.map(p => ({ kind: 'card', productId: p.productId, name: p.name, reason: p.reason }));
  const seen = new Set<string>();
  // The rows the label code refuses, one by one: index-aligned with the synthetic recipe's rows.
  const declared = recipeAllergens(build.recipe, tables);
  declared.rows.forEach((row, index) => {
    const source = build.recipe.ingredients[index];
    const productId = build.rowCard.get(index);
    if (!source || productId === undefined || row.declared || row.reason === null) return;
    const key = `${productId}|${source.kind}|${source.refId}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({
      kind: source.kind,
      productId,
      cardName: nameOf(lookup(tables.products, productId)),
      refId: source.refId,
      name: source.label,
      reason: row.reason,
    });
  });
  if (blocks.length === 0 && !label.ok) blocks.push({ kind: 'no-weights' });

  if (blocks.length > 0 || !label.ok || !canLabel(declared)) {
    const cardIds = new Set(blocks.flatMap(block => (block.kind === 'no-weights' ? [] : [block.productId])));
    return { state: 'blocked', build, blocks, blockedCards: cardIds.size, label };
  }
  return { state: 'ready', build, blocks: [], blockedCards: 0, label: label as DraftLabel };
}

// The diameters of the cake's tiers, bottom first (the label screen's «2 tiers (Ø 24 / 18 cm)»).
export function cakeLabelDiameters(cake: Pick<Cake, 'diameterCm' | 'tiers'>): number[] {
  return tierDiameters(cake.diameterCm, cake.tiers);
}

// An ingredient's card in «Ingredients & suppliers», or null for an id that cannot be one. ⚠️ A COPY OF suppliers/suppliersPath.ts'
// `ingredientPath` (a feature never imports another feature's folder): app/src/cakes/CakeLabelView.spec.tsx pins the two together.
export function ingredientCardPath(ingredientId: unknown): string | null {
  const id = typeof ingredientId === 'string' ? ingredientId.trim() : '';
  return id !== '' && id.length <= 200 && !id.includes('/') ? `/suppliers/ingredient/${encodeURIComponent(id)}` : null;
}
