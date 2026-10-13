// recipe-label-model.ts — the contents of a food label: the ingredient list in
// the order the law requires, which of them carry allergens, and the nutrition
// declaration per 100 g of the FINISHED food. PURE, asserted under Node (P15).
//
// TypeScript port of js/catalogue/recipe-label-model.js for Mise 2. Behaviour is identical, input for input:
// recipe-label-model.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports,
// odd-inputs.spec.ts feeds both the same strange values, and label-corpus.spec.ts runs a whole corpus of
// recipes through both and through a golden file. It is a FULL port: every export of the original is here.
// The comments below are the ones the original paid for in bugs.
//
// ⚠️⚠️ NOTHING HERE PRODUCES A LABEL UNLESS recipe-allergen-model.ts SAYS THE
// RECIPE IS FULLY DECLARED. That check is not repeated here; it is asked once, at
// the top of buildLabel(), and a caller that reaches past it into the parts is
// building a declaration out of a recipe with holes in it.
//
// ⚠️ AND WHAT IT PRODUCES IS A DRAFT FOR A HUMAN TO CHECK, NOT A COMPLIANT LABEL.
// The app knows what it was told about ingredients. It does not know what else is
// on the bench, what the last-minute substitution was, or that a supplier changed
// their recipe last month. Every screen that shows this says so.

import { unitOf, isWeighableUnit, ingredientGrams, linkOf, normalizeLossPct } from './catalogue-model';
import { MAX_RECIPE_DEPTH } from './recipe-cost-model';
import { recipeAllergens, canLabel } from './recipe-allergen-model';
import type { AllergenRow } from './recipe-allergen-model';
import {
  normalizeAllergens, normalizeNutrition, hasFullNutrition,
  NUTRIENT_KEYS, NUTRIENTS,
} from './allergen-model';
import type { AllergenCode, NutrientKey } from './allergen-model';
// ⚠️ From the shared base, like allergen-model.ts above it and for the same reason: what
// language a label is printed in is decided by the venue's country, and that
// judgement must be the same one for every screen that prints one.
import { allergenName, labelWord, nutrientName } from './market';

// The two lookup tables: a Map or a plain object each (callers hand over whatever they already have).
export interface RecipeLabelTables {
  recipes?: unknown;
  ingredients?: unknown;
}

function lookup(table: unknown, id: unknown): unknown {
  if (!table || !id) return null;
  const t = table as { get?: unknown } & Record<PropertyKey, unknown>;
  if (typeof t.get === 'function') return (t.get as (id: unknown) => unknown).call(table, id) || null;
  return Object.prototype.hasOwnProperty.call(table, id as PropertyKey) ? t[id as PropertyKey] : null;
}

// ── The ingredient list ──────────────────────────────────────────────────────
//
// ⚠️ SUB-RECIPES ARE FLATTENED, NOT NAMED. A label may not say "filling" and stop
// — the person reading it needs the actual ingredients. So a row pointing at
// another recipe contributes that recipe's OWN rows, scaled to how much of it
// goes in.
//
// ⚠️ AND THE SAME INGREDIENT USED TWICE IS ONE LINE, SUMMED. Butter in the dough
// and butter in the filling is butter, and listing it twice would both look wrong
// and put it in the wrong position — the order is by weight, and two half-weights
// sort lower than the one real weight.
export interface FlatIngredient {
  id: string;
  name: string;
  grams: number;
}

export function flattenIngredients(recipe: unknown, tables: RecipeLabelTables = {}, scale: number = 1, depth: number = 1, seen: Iterable<string> = new Set<string>()): FlatIngredient[] {
  const card = recipe as { id?: unknown; ingredients?: unknown } | null | undefined;
  const rows: readonly unknown[] = (card && Array.isArray(card.ingredients)) ? card.ingredients : [];
  const branch: ReadonlySet<string> = card && card.id ? new Set([...seen, String(card.id)]) : seen as ReadonlySet<string>;
  const totals = new Map<string, FlatIngredient>();   // ingredient id -> { id, name, grams }

  const add = (id: string, name: string, grams: number): void => {
    let entry = totals.get(id);
    if (!entry) {
      entry = { id, name, grams: 0 };
      totals.set(id, entry);
    }
    entry.grams += grams;
  };

  for (const row of rows) {
    const link = linkOf(row);
    if (!link) continue;
    // A row with no weight cannot take a place in a list ORDERED by weight. It is
    // not lost: canLabel() has already refused the whole recipe if such a row is
    // undeclared, and a declared one with no amount is a recipe-writing problem
    // the allergen panel already reports.
    const grams = isWeighableUnit(unitOf(row)) ? (ingredientGrams(row) || 0) : 0;
    if (grams <= 0) continue;

    if (link.kind === 'recipe') {
      if (branch.has(link.refId) || depth >= MAX_RECIPE_DEPTH) continue;
      const sub = lookup(tables.recipes, link.refId);
      if (!sub) continue;
      // How much of the sub-recipe goes in, as a fraction of what the sub-recipe
      // makes. Its own rows are scaled by that, so 200 g of a 1000 g filling
      // contributes a fifth of each of its ingredients.
      const subTotal = weighableGramsOf(sub);
      if (subTotal <= 0) continue;
      const inner = flattenIngredients(sub, tables, scale * (grams / subTotal), depth + 1, new Set([...branch, link.refId]));
      inner.forEach(item => add(item.id, item.name, item.grams));
      continue;
    }

    const ingredient = lookup(tables.ingredients, link.refId) as { name?: unknown } | null;
    if (!ingredient) continue;
    add(link.refId, String(ingredient.name || '').trim() || 'Unnamed ingredient', grams * scale);
  }

  // ⚠️ DESCENDING BY WEIGHT — the order is not a presentation choice, it is what
  // the regulation asks for. Ties break by name so two runs produce the same
  // label rather than shuffling with Map insertion order.
  return [...totals.values()].sort((a, b) => b.grams - a.grams || a.name.localeCompare(b.name));
}

// The weight the flattening divides by: only rows that HAVE a weight.
function weighableGramsOf(recipe: unknown): number {
  const card = recipe as { ingredients?: unknown } | null | undefined;
  const rows: readonly unknown[] = (card && Array.isArray(card.ingredients)) ? card.ingredients : [];
  return rows.reduce<number>((sum, row) =>
    sum + (isWeighableUnit(unitOf(row)) ? (ingredientGrams(row) || 0) : 0), 0);
}

// ── The nutrition declaration ────────────────────────────────────────────────
//
// ⚠️ PER 100 g OF THE FINISHED FOOD, NOT OF THE DOUGH. Water leaves in the oven:
// 100 g of dough becomes about 80 g of bread, so every value per 100 g of the
// finished loaf is HIGHER than per 100 g of what went in the mixer. `lossPct`
// already exists on a recipe for exactly this, and recipe-cost-model.ts divides
// by the same yield. Using the mixing weight instead understates a bread label by
// roughly a fifth.
export type NutritionPer100g = Record<NutrientKey, number> & { yieldGrams: number; lossPct: number };

export function nutritionPer100g(recipe: unknown, tables: RecipeLabelTables = {}): NutritionPer100g | null {
  const items = flattenIngredients(recipe, tables);
  if (!items.length) return null;

  const totals = {} as Record<NutrientKey, number>;
  NUTRIENT_KEYS.forEach(key => { totals[key] = 0; });
  let grams = 0;

  for (const item of items) {
    const ingredient = lookup(tables.ingredients, item.id) as { nutrition?: unknown } | null;
    // ⚠️ ONE INGREDIENT WITHOUT A FULL TABLE MEANS NO TABLE AT ALL. A declaration
    // is defined as a whole; summing the seven over the ingredients that happen to
    // have them would under-declare every value by however much is missing, and
    // nothing on the label would say so.
    if (!ingredient || !hasFullNutrition(ingredient)) return null;
    const per100 = normalizeNutrition(ingredient.nutrition);
    const factor = item.grams / 100;
    // hasFullNutrition() has just said all seven are there.
    NUTRIENT_KEYS.forEach(key => { totals[key] += (per100[key] as number) * factor; });
    grams += item.grams;
  }

  if (grams <= 0) return null;
  const lossPct = normalizeLossPct((recipe as { lossPct?: unknown } | null | undefined) && (recipe as { lossPct?: unknown }).lossPct);
  const yieldGrams = grams * (1 - lossPct / 100);
  if (yieldGrams <= 0) return null;

  const out = {} as NutritionPer100g;
  NUTRIENT_KEYS.forEach(key => {
    // Energy to whole units, everything else to one decimal — the precision a
    // declaration is printed at. Salt is the exception: it is routinely under
    // 0.1 g and rounding it there would print 0.0 for something real.
    const value = totals[key] / (yieldGrams / 100);
    out[key] = (key === 'kj' || key === 'kcal') ? Math.round(value)
      : (key === 'salt' ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10);
  });
  out.yieldGrams = Math.round(yieldGrams);
  out.lossPct = lossPct;
  return out;
}

// ── The whole thing ──────────────────────────────────────────────────────────

export const LABEL_SHOWS = Object.freeze(['allergens', 'nutrition', 'both'] as const);

export type LabelShows = (typeof LABEL_SHOWS)[number];

// One line of the ingredient list, with the allergens it carries itself.
export interface LabelIngredient {
  id: string;
  name: string;
  grams: number;
  allergens: AllergenCode[];
  emphasise: boolean;
}

export type RefusedLabel =
  | { ok: false; reason: 'not-declared'; gaps: AllergenRow[] }
  | { ok: false; reason: 'no-ingredients'; gaps: never[] };

export interface DraftLabel {
  ok: true;
  reason: null;
  shows: LabelShows;
  name: string;
  ingredients: LabelIngredient[];
  allergens: AllergenCode[];
  mayContain: AllergenCode[];
  nutrition: NutritionPer100g | null;
  nutritionMissing: boolean;
}

export type Label = DraftLabel | RefusedLabel;

// What a label can say about this recipe, or why it cannot say anything.
//
//   { ok, reason, name, ingredients, allergens, mayContain, nutrition }
//
// `ingredients` carries `emphasise: true` on the ones that ARE an allergen, so
// the screen can put them in bold — the regulation asks for the allergen to be
// emphasised INSIDE the ingredient list, not only summarised underneath.
export function buildLabel(recipe: unknown, tables: RecipeLabelTables = {}, { shows = 'both' }: { shows?: unknown } = {}): Label {
  const declared = recipeAllergens(recipe, tables);

  // ⚠️ THE ONE GATE. Everything below assumes every row is accounted for.
  if (!canLabel(declared)) {
    return { ok: false, reason: 'not-declared', gaps: declared.gaps };
  }

  const items = flattenIngredients(recipe, tables);
  if (!items.length) return { ok: false, reason: 'no-ingredients', gaps: [] };

  const ingredients: LabelIngredient[] = items.map(item => {
    const ingredient = lookup(tables.ingredients, item.id) as { allergens?: unknown } | null;
    const own = normalizeAllergens(ingredient && ingredient.allergens);
    return {
      id: item.id,
      name: item.name,
      grams: Math.round(item.grams * 10) / 10,
      // The allergens this line itself carries, so the screen can emphasise the
      // word rather than only listing it at the bottom.
      allergens: own,
      emphasise: own.length > 0,
    };
  });

  const wants: LabelShows = (LABEL_SHOWS as readonly unknown[]).includes(shows) ? shows as LabelShows : 'both';
  const nutrition = wants === 'allergens' ? null : nutritionPer100g(recipe, tables);

  return {
    ok: true,
    reason: null,
    shows: wants,
    name: String(((recipe as { name?: unknown } | null | undefined) && (recipe as { name?: unknown }).name) || '').trim(),
    ingredients,
    allergens: declared.allergens,
    mayContain: declared.mayContain,
    nutrition,
    // ⚠️ SAID OUT LOUD RATHER THAN LEFT TO THE SCREEN. A label asked to show
    // nutrition that cannot be worked out must say which it is missing, not
    // quietly print the allergens half and look finished.
    nutritionMissing: wants !== 'allergens' && nutrition === null,
  };
}

// The label functions below are handed whatever a caller has: the result of buildLabel, or anything at
// all (a screen may pass a half-built object). They read it as the original does.
const asLabel = (label: unknown): DraftLabel => label as DraftLabel;

// The ingredient list as one line of text, allergens in CAPITALS — the plainest
// way to emphasise them in a medium that has no bold, and the fallback the screen
// falls back to when it is copied into a message.
export function ingredientLine(label: unknown): string {
  if (!label || !asLabel(label).ok) return '';
  return asLabel(label).ingredients
    .map(item => (item.emphasise ? item.name.toUpperCase() : item.name))
    .join(', ');
}

// "Contains: Wheat, Milk" — the summary under the list. Empty when there are none,
// because "Contains: nothing" is not a sentence anybody prints.
//
// ⚠️ THE LANGUAGE COMES FROM THE VENUE'S COUNTRY, never from a preference — see
// market.ts. It defaults to English so a caller that forgets prints what this
// app has always printed, rather than nothing; the screens that matter pass it,
// and a test pins that they do.
export function containsLine(label: unknown, lang: unknown = 'en'): string {
  if (!label || !asLabel(label).ok || !asLabel(label).allergens.length) return '';
  return `${labelWord('contains', lang)}: ${asLabel(label).allergens.map(c => allergenName(c, lang)).join(', ')}`;
}

// "May contain: Nuts" — the traces line. ⚠️ NEVER MERGED INTO `contains`: a warning
// that something MIGHT be present is a different statement from a declaration that it
// IS, and the law treats them differently.
export function mayContainLine(label: unknown, lang: unknown = 'en'): string {
  if (!label || !asLabel(label).ok || !asLabel(label).mayContain.length) return '';
  return `${labelWord('mayContain', lang)}: ${asLabel(label).mayContain.map(c => allergenName(c, lang)).join(', ')}`;
}

// ── The whole declaration, as plain text ─────────────────────────────────────
//
// ⚠️⚠️ ONE BUILDER, USED BY EVERY SCREEN THAT HANDS THIS TEXT TO SOMEBODY. It was
// written inline inside the label screen's copy button; the recipe card now offers the
// same text by WhatsApp and by email, and three places each assembling it is three
// texts that can disagree about what is in somebody's food.
//
// ⚠️ THE LANGUAGE IS THE VENUE'S COUNTRY'S, never a preference — see market.ts. A
// copy in English pasted onto Italian packaging is the defect this rule exists to
// prevent, and it would arrive through whichever door nobody thought of.
//
// `withNutrition` is false for a message: some mail clients silently drop a body past
// about 2000 characters, and the nutrition table is most of the length. The label
// screen's own copy button passes true.
export function declarationText(label: unknown, lang: unknown = 'en', { withNutrition = true }: { withNutrition?: boolean } = {}): string {
  if (!label || !asLabel(label).ok) return '';
  const card = asLabel(label);
  const lines: string[] = [card.name, `${labelWord('ingredients', lang)}: ${ingredientLine(label)}.`];
  const contains = containsLine(label, lang);
  if (contains) lines.push(contains);
  const traces = mayContainLine(label, lang);
  if (traces) lines.push(traces);
  if (withNutrition && card.nutrition) {
    const nutrition = card.nutrition;
    lines.push(`${labelWord('typicalValues', lang)} ${labelWord('per100g', lang)}:`);
    NUTRIENTS.forEach(n => lines.push(`  ${nutrientName(n, lang)}: ${nutrition[n.key]} ${n.unit}`));
  }
  return lines.join('\n');
}
