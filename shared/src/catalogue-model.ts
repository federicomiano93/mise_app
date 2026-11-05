// catalogue-model.ts — the part of the recipe catalogue's model that Food cost reads.
//
// TypeScript PARTIAL port of js/catalogue/catalogue-model.js for Mise 2. Behaviour is identical, input
// for input, for everything ported: catalogue-model.spec.ts runs every test against BOTH files and
// compares each ported export with the js/ file itself; odd-inputs.spec.ts feeds both the same strange
// values. It is NOT paired in parity.spec.ts, because the original holds much more than Food cost needs.
//
// PORTED: the unit table (`CATALOGUE_UNITS`, `DEFAULT_UNIT`, `unitOf`, `isWeighableUnit`,
// `ingredientGrams`, `weighableTotalGrams`), the row link (`ROW_KINDS`, `linkOf`), the oven loss
// (`MAX_LOSS_PCT`, `normalizeLossPct`, `MAX_WEIGHT_G`, `normalizeWeight`, `weightLoss`) and the link
// suggestions Food cost draws under a product's name (`normalizeSearchText`, `SUGGEST_MIN_CHARS`,
// `SUGGEST_LIMIT`, `suggestLinks`).
//
// PRIVATE, ported only because `suggestLinks` calls them and not exported: `linkOptions` (whole, as the
// original, though `suggestLinks` only ever calls it with an empty query), `matchRank`, `bestRank`, and
// a copy of `supplierLabel` of js/supplier-label.js (pure, three lines; there is no shared port of that
// file yet). `ingredientDisplayName` is imported from ingredient-name.ts, never copied.
//
// LEFT OUT, because Food cost does not read it: the recipe normalisers (`normalizeCatalogueRecipe(s)`,
// `labelFieldsOf`, `normalizeShelfLifeDays`, `MAX_SHELF_LIFE_DAYS`), the list helpers (`sortByUsage`,
// `filterByName`), `linkOptions` as an export, `linkedItemName`, `isSameLink`, `applyLink`, `moveRow`,
// the kg scaling (`scaleCatalogue`, `baseAmounts`, `MAX_SANE_*`, `formatWeight`, `batchWarning`), the
// persisted-batch freshness (`SCALED_TTL_MS`, `isScaledEntryFresh`), `findInvalidRecipe`, the Calculator
// import (`toCalculatorRecipe`, `nonWeighableLabels`, `mergeImportedRecipe`, `importFailureKey`,
// `findCalculatorImport`), and the two functions that look a word up in the interface dictionary
// (`unitText`, and `batchWarning`, which the dictionary also feeds).
//
// Weight and volume are "weighable": they convert to grams (volume at 1 ml = 1 g, the standard bakery
// approximation). Pieces / spoons / pinch / to-taste are NOT weighable, so they stay out of the weight
// total. Legacy rows with no unit are treated as grams.

import { ingredientDisplayName } from './ingredient-name';

export type CatalogueUnit = 'g' | 'kg' | 'mg' | 'ml' | 'cl' | 'dl' | 'l' | 'pcs' | 'tsp' | 'tbsp' | 'pinch' | 'to taste';

// Not frozen, as in the original (parity of frozen-ness is pinned by the spec).
export const CATALOGUE_UNITS: CatalogueUnit[] = ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'pcs', 'tsp', 'tbsp', 'pinch', 'to taste'];
export const DEFAULT_UNIT: CatalogueUnit = 'g';

// Grams per one of each weighable unit; a unit absent here is not weighable.
const UNIT_TO_GRAMS: Readonly<Record<string, number>> = { g: 1, kg: 1000, mg: 0.001, ml: 1, cl: 10, dl: 100, l: 1000 };

// The ingredient's unit, defaulting to grams for legacy rows with no unit field.
export function unitOf(ing: unknown): CatalogueUnit {
  const u = ing && (ing as { unit?: unknown }).unit;
  return (typeof u === 'string' && (CATALOGUE_UNITS as readonly string[]).includes(u)) ? u as CatalogueUnit : DEFAULT_UNIT;
}

// True when a unit contributes to the weight total.
export function isWeighableUnit(unit: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(UNIT_TO_GRAMS, unit as PropertyKey);
}

// One ingredient's amount converted to grams, or 0 when its unit isn't weighable. Exported because the
// cost model needs exactly this conversion: costing a row is "how many grams is it" times "what does a
// gram cost", and a second copy of the unit table is a second place for ml-to-g to drift.
//
// QUIRK COPIED: `ingredientGrams(null)` (or undefined) THROWS a TypeError — unitOf() answers 'g' for it,
// then `.grams` is read off nothing. No real input reaches it (a recipe's rows are objects); it is
// copied, not tidied, and odd-inputs.spec.ts demands that both files throw alike.
export function ingredientGrams(ing: unknown): number {
  const factor = UNIT_TO_GRAMS[unitOf(ing)];
  return factor ? (Number((ing as { grams?: unknown }).grams) || 0) * factor : 0;
}
const ingGrams = ingredientGrams;

// The recipe's total WEIGHABLE mass in grams (weight + volume rows only).
export function weighableTotalGrams(recipe: unknown): number {
  const r = recipe as { ingredients?: unknown } | null | undefined;
  const ings: readonly unknown[] = (r && Array.isArray(r.ingredients)) ? r.ingredients : [];
  return ings.reduce<number>((s, i) => s + ingGrams(i), 0);
}

// What a row points at, or null for a plain hand-typed row. `kind` decides where refId is looked up — an
// ingredient in Orders, or another recipe in this catalogue — and defaults to 'ingredient', which is what
// every link written by the current editor is unless it says otherwise.
export const ROW_KINDS = Object.freeze(['ingredient', 'recipe'] as const);

export type RowKind = (typeof ROW_KINDS)[number];

export interface RowLink {
  kind: RowKind;
  refId: string;
}

export function linkOf(raw: unknown): RowLink | null {
  const row = raw as { refId?: unknown; kind?: unknown } | null | undefined;
  const refId = row && row.refId != null ? String(row.refId).trim() : '';
  if (!refId) return null;
  // Past the check above `row` is an object.
  const kind = (ROW_KINDS as readonly unknown[]).includes((row as { kind?: unknown }).kind)
    ? (row as { kind: RowKind }).kind : 'ingredient';
  return { kind, refId };
}

// How much weight a recipe loses on the way to being finished — evaporation in the oven, mostly. 0 by
// default, which is what every recipe written before this field existed means: nothing is assumed to be
// lost unless somebody says so.
//
// ⚠️ CAPPED AT 99, AND THE CAP IS LOAD-BEARING. The yield weight is the divisor of the price per kilo, so
// a loss of 100 would divide by zero and a recipe would cost Infinity per kilo — shown, and carried into
// every product built on it. Nothing real loses all of its weight.
export const MAX_LOSS_PCT = 99;

export function normalizeLossPct(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_LOSS_PCT);
}

// ── The two weighings the loss is worked out FROM ────────────────────────────
//
// A percentage is a number nobody has: it has to be worked out from a dough weighed before the oven and
// the same dough weighed after. Asking for the percentage is why the field sat at 0 on every recipe, and
// a 0 there is what makes a baked product look cheaper than it is.
//
// ⚠️ WHAT IS STORED IS STILL `lossPct`. The cost model, the label, Food Cost and the recipe screen all
// read that field. The weights are kept beside it only so reopening the editor can show the numbers
// somebody typed.

// A bound, not a judgement: it exists to stop a runaway value reaching the database. Ten tonnes of dough.
export const MAX_WEIGHT_G = 10000000;

export function normalizeWeight(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_WEIGHT_G);
}

export type WeightLossProblem = 'cookedHeavier' | 'capped';

export interface WeightLoss {
  pct: number | null;
  problem: WeightLossProblem | null;
}

// (raw − cooked) / raw, as a percentage.
//
// ⚠️ THE WHOLE DECISION LIVES HERE, NOT IN THE VIEW, so a test can reach it. `pct: null` is NOT zero: zero
// is "nothing is lost", null is "these two numbers do not answer the question", and the editor must keep
// the recipe's stored loss in that case rather than overwrite it.
export function weightLoss(rawGrams: unknown, cookedGrams: unknown): WeightLoss {
  const before = normalizeWeight(rawGrams);
  const after = normalizeWeight(cookedGrams);
  if (before <= 0 || after <= 0) return { pct: null, problem: null };
  // ⚠️ Nothing gains weight in an oven. Answering 0 here would quietly turn a typo into "this recipe
  // loses nothing", which is the exact direction that makes a product look cheaper than it is.
  if (after > before) return { pct: null, problem: 'cookedHeavier' };
  // Rounded to a tenth so the number SHOWN is the number STORED — 8380 g down to 7374 g is 12.005%, and a
  // screen saying 12% while the database holds 12.005 is a screen nobody can reconcile.
  const exact = Math.round(((before - after) / before) * 1000) / 10;
  const pct = normalizeLossPct(exact);
  // ⚠️ Capped at 99 like every other route to this field, and the view says so: a cooked weight of almost
  // nothing is a typo far more often than it is a recipe.
  return { pct, problem: exact > MAX_LOSS_PCT ? 'capped' : null };
}

// (The original also says, here, that cookedFromLossPct must never come back: with lossPct 0 it returned
// the raw total, so the screen showed a cooked weight identical to the raw one and read as «weighed, and
// it loses nothing». Nothing else ever needed it: the cost model and the label divide by lossPct.)

// ── Choosing what a row points at ─────────────────────────────────────────────

// Lower-cased and stripped of accents, so "però" is found by typing "pero".
//
// ⚠️ js/orders/ingredient-search.js has the same three lines, and that duplication is ACCEPTED: two copies
// of a price calculation that drift produce two different food-cost percentages with nothing to say which
// is right, while two copies of this produce a search that finds one row more or fewer.
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// js/supplier-label.js supplierLabel, copied (pure): the short name when there is one, else the name.
function supplierLabel(s: unknown): string {
  const supplier = s as { shortName?: unknown; name?: unknown } | null | undefined;
  const short = typeof supplier?.shortName === 'string' ? supplier.shortName.trim() : '';
  if (short) return short;
  return String(supplier?.name || '');
}

// An ingredient the chooser may offer, or a recipe (which has only an id and a name).
interface LinkOption {
  id: unknown;
  name: string;
  displayName?: string;
  shortName?: string;
  weight?: string;
  supplierName?: string;
  ingredient?: unknown;
}

interface LinkOptionsInput {
  ingredients?: unknown;
  recipes?: unknown;
  suppliers?: unknown;
  query?: unknown;
  excludeRecipeId?: unknown;
}

// The things a recipe row can be linked to, filtered by what was typed. Ingredients first, because they
// are what almost every row is. Deactivated ones are left out — they are not orderable, so building a
// live cost on one would be building on something the kitchen has stopped buying.
//
// `excludeRecipeId` keeps a recipe out of its own picker. The cost model catches a cycle anyway, but
// offering the choice and then refusing it is a worse screen than never offering it.
function linkOptions({ ingredients, recipes, suppliers, query, excludeRecipeId }: LinkOptionsInput = {}): { ingredients: LinkOption[]; recipes: LinkOption[] } {
  const q = normalizeSearchText(query);
  const matches = (...fields: unknown[]): boolean => !q || fields.some(f => normalizeSearchText(f).includes(q));
  const supplierName = (id: unknown): string => supplierLabel(suppliers && (suppliers as Record<string, unknown>)[id as string]);

  type Card = { id?: unknown; name?: unknown; shortName?: unknown; weight?: unknown; supplierId?: unknown; active?: unknown; kind?: unknown };
  const ingredientList = (Object.values(ingredients || {}) as Card[])
    // ⚠️ PACKAGING IS NOT AN INGREDIENT (13 Sep 2026): a box filed under «Imballaggi» in Fornitori e
    // ingredienti has no allergens to declare and no place in a recipe.
    .filter(ing => ing && ing.active !== false && ing.kind !== 'packaging')
    .map((ing): LinkOption => ({
      id: ing.id,
      // `name` stays the invoice name (what the chooser hands back, and the fallback for a row's name);
      // `displayName` is what the lists SHOW and sort by (ingredient-name.ts).
      name: String(ing.name || '').trim(),
      displayName: ingredientDisplayName(ing).trim(),
      shortName: String(ing.shortName || '').trim(),
      weight: String(ing.weight || '').trim(),
      supplierName: supplierName(ing.supplierId),
      ingredient: ing,
    }))
    .filter(row => row.name && matches(row.name, row.shortName, row.weight, row.supplierName))
    .sort((a, b) => (a.displayName as string).localeCompare(b.displayName as string) || String(a.id).localeCompare(String(b.id)));

  type RecipeCard = { id?: unknown; name?: unknown };
  const recipeList = ((Array.isArray(recipes) ? recipes : Object.values(recipes || {})) as RecipeCard[])
    .filter(r => r && r.id !== excludeRecipeId && String(r.name || '').trim())
    .filter(r => matches(r.name))
    .map((r): LinkOption => ({ id: r.id, name: String(r.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ingredients: ingredientList, recipes: recipeList };
}

// ── Suggesting a link while a row's name is typed ────────────────────────────
//
// Federico, 13 Sep 2026: «digito burro subito dopo mi si apre la piccola finestra dove scelgo tra i burri
// che abbiamo a disposizione». What the little list under the name offers, decided here where a test can
// run it (the screen only draws it).

export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_LIMIT = 5;

// How well a name answers what was typed: 0 it starts with it, 1 one of its words does, 2 it is somewhere
// inside, -1 not at all. Both sides already normalised.
function matchRank(name: string, q: string): number {
  const first = name.indexOf(q);
  if (first === -1) return -1;
  if (first === 0) return 0;
  for (let at = first; at !== -1; at = name.indexOf(q, at + 1)) {
    if (!/[a-z0-9]/.test(name.charAt(at - 1))) return 1;
  }
  return 2;
}

// The best rank an option gets across BOTH its names (the name to show and the invoice name).
function bestRank(opt: LinkOption, q: string): number {
  const ranks = [opt.displayName ?? opt.name, opt.name, opt.shortName]
    .filter(v => v !== undefined && v !== null && String(v) !== '')
    .map(v => matchRank(normalizeSearchText(v), q))
    .filter(r => r >= 0);
  return ranks.length ? Math.min(...ranks) : -1;
}

export interface SuggestOptions {
  ingredients?: unknown;
  recipes?: unknown;
  suppliers?: unknown;
  query?: unknown;
  excludeRecipeId?: unknown;
  linked?: { kind?: unknown; refId?: unknown } | null;
  limit?: unknown;
}

export interface SuggestedLink {
  kind: RowKind;
  refId: unknown;
  name: string;
  displayName: string;
  weight: string;
  supplierName: string;
  linked: boolean;
}

// ⚠️ THE NAME ONLY, never the supplier or the pack weight the full chooser also searches. This list
// answers a name being typed: «bra» must not bring up every product of a supplier called Brava while
// somebody is writing «brace».
// ⚠️ INGREDIENTS BEFORE RECIPES, whatever the ranking — they are what almost every row is — and nothing
// below two characters, when a single letter matches half the catalogue. `total` counts every match, so
// the screen can offer the rest.
export function suggestLinks({
  ingredients, recipes, suppliers, query, excludeRecipeId, linked = null, limit = SUGGEST_LIMIT,
}: SuggestOptions = {}): { items: SuggestedLink[]; total: number } {
  const q = normalizeSearchText(query);
  if (q.length < SUGGEST_MIN_CHARS) return { items: [], total: 0 };
  const max = Number.isFinite(Number(limit)) && Number(limit) >= 1 ? Math.floor(Number(limit)) : SUGGEST_LIMIT;

  // The same candidates as the full chooser: active ingredients, never this recipe.
  const all = linkOptions({ ingredients, recipes, suppliers, query: '', excludeRecipeId });
  const ranked = (list: readonly LinkOption[], kind: RowKind): SuggestedLink[] => list
    .map(opt => ({ opt, rank: bestRank(opt, q) }))
    .filter(entry => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank
      || (a.opt.displayName ?? a.opt.name).localeCompare(b.opt.displayName ?? b.opt.name) || String(a.opt.id).localeCompare(String(b.opt.id)))
    .map(({ opt }) => ({
      kind,
      refId: opt.id,
      name: opt.name,
      displayName: opt.displayName ?? opt.name,
      weight: opt.weight || '',
      supplierName: opt.supplierName || '',
      linked: !!linked && linked.kind === kind && linked.refId === opt.id,
    }));

  const every = [...ranked(all.ingredients, 'ingredient'), ...ranked(all.recipes, 'recipe')];
  return { items: every.slice(0, max), total: every.length };
}
