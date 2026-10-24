// catalogue-model.ts — the part of the recipe catalogue's model that Food cost reads.
//
// TypeScript PARTIAL port of js/catalogue/catalogue-model.js for Mise 2. Behaviour is identical, input
// for input, for everything ported EXCEPT the Calculator import, which LINKS the tab instead of copying it
// (owner's decision, 18 Oct 2026: `toCalculatorRecipe`, `mergeImportedRecipe`, `findCalculatorImport` and
// the Mise-2-only `calculatorImportKind` / `calculatorRefusal`, each marked where it differs).
// catalogue-model.spec.ts runs every test against BOTH files and
// compares each ported export with the js/ file itself; odd-inputs.spec.ts feeds both the same strange
// values. It is NOT paired in parity.spec.ts, because the original holds much more than Food cost needs.
//
// PORTED: the unit table (`CATALOGUE_UNITS`, `DEFAULT_UNIT`, `unitOf`, `isWeighableUnit`,
// `ingredientGrams`, `weighableTotalGrams`), the row link (`ROW_KINDS`, `linkOf`), the oven loss
// (`MAX_LOSS_PCT`, `normalizeLossPct`, `MAX_WEIGHT_G`, `normalizeWeight`, `weightLoss`), the link
// suggestions Food cost draws under a product's name (`normalizeSearchText`, `SUGGEST_MIN_CHARS`,
// `SUGGEST_LIMIT`, `suggestLinks`) and, since step 3d-1, the recipe itself: the normalisers
// (`normalizeCatalogueRecipe(s)`, `labelFieldsOf`, `normalizeShelfLifeDays`, `MAX_SHELF_LIFE_DAYS`, with the
// types `CatalogueRecipe` and `CatalogueRow`), the list helpers (`sortByUsage`, `filterByName`), the kg
// scaling (`scaleCatalogue`, `baseAmounts`, `MAX_SANE_BATCH_G`, `MAX_SANE_MULTIPLE`, `formatWeight`) and the
// persisted-batch freshness (`SCALED_TTL_MS`, `isScaledEntryFresh`) and, since step 3d-6, what the recipe
// editor needs: the chooser (`linkOptions`, with the types `LinkOption` and `LinkOptionsInput`), writing a row's
// link (`linkedItemName`, `isSameLink`, `applyLink`), `moveRow`, the Save validation (`findInvalidRecipe`, with
// the type `InvalidRecipeProblem`) and `findCalculatorImport` (the delete warning) and, since step 3d-7, the rest
// of the Calculator import (`toCalculatorRecipe`, `nonWeighableLabels`, `mergeImportedRecipe`,
// `importFailureKey`).
//
// ADDED, from another file: `nameTaken` is the one export that is NOT in catalogue-model.js — its original is
// at the bottom of js/catalogue/ingredient-suggest.js (the rest of that file draws a screen). It answers over
// the same set `linkOptions` offers, so it sits beside it.
//
// ADAPTED (the two functions that look a word up in the interface dictionary, which in Mise 2 belongs to
// the app; same results given the same words):
//   • `batchWarning(target, base, t)` takes the translator as its third argument and returns the same
//     sentences (keys `cat.batchWarning` / `cat.batchWarningVsRecipe`, whole sentences with {weight},
//     {times}, {base} holes). Its arity therefore differs from the original, by design.
//   • `unitText(unit)` is NOT exported; `unitTextKey(unit)` answers the dictionary key
//     (`cat.unitText.pcs|tsp|tbsp|pinch|toTaste`), or null for a metric symbol and anything unknown, which the
//     original hands back untouched — so the app writes `key ? t(key) : unit`.
//
// PRIVATE, ported only because something above calls them and not exported: `normalizeIngredient(s)` (the
// row normaliser), `fixRounding`, `matchRank`, `bestRank`, and a copy of `supplierLabel` of
// js/supplier-label.js (pure, three lines; there is no shared port of that file yet).
// `ingredientDisplayName` is imported from ingredient-name.ts, never copied.
//
// LEFT OUT: `unitText`, `formatAmount` and `exportModelOf` (they read the interface dictionary or the screen's
// number, which belong to the app).
//
// Weight and volume are "weighable": they convert to grams (volume at 1 ml = 1 g, the standard bakery
// approximation). Pieces / spoons / pinch / to-taste are NOT weighable, so they stay out of the weight
// total. Legacy rows with no unit are treated as grams.

import { isWeighable as isWeighableRow, resolveRecipe } from './calculator-recipe-source';
import { ridOf } from './guided-model';
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
export function supplierLabel(s: unknown): string {
  const supplier = s as { shortName?: unknown; name?: unknown } | null | undefined;
  const short = typeof supplier?.shortName === 'string' ? supplier.shortName.trim() : '';
  if (short) return short;
  return String(supplier?.name || '');
}

// An ingredient the chooser may offer, or a recipe (which has only an id and a name).
export interface LinkOption {
  id: unknown;
  name: string;
  displayName?: string;
  shortName?: string;
  weight?: string;
  supplierName?: string;
  ingredient?: unknown;
}

export interface LinkOptionsInput {
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
export function linkOptions({ ingredients, recipes, suppliers, query, excludeRecipeId }: LinkOptionsInput = {}): { ingredients: LinkOption[]; recipes: LinkOption[] } {
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

// ── Writing a row's link (the editor's chooser) ──────────────────────────────

// The name a link line shows for a link — and the name a row takes when it is picked (9 Oct 2026): an
// ingredient's display name (short name, else name), a recipe's name; the chosen name when the item is not
// loaded (just created); '' when there is nothing to show. `ingredients` is the id -> ingredient map,
// `recipes` the list.
export function linkedItemName(link: unknown, ingredients: unknown, recipes: unknown): string {
  if (!link || typeof link !== 'object') return '';
  const l = link as { refId?: unknown; name?: unknown; kind?: unknown };
  const refId = l.refId != null ? String(l.refId) : '';
  const fallback = String(l.name ?? '').trim();
  if (l.kind === 'recipe') {
    const sub = (Array.isArray(recipes) ? recipes as ({ id?: unknown; name?: unknown } | null)[] : []).find(r => r && r.id === refId);
    return String((sub && sub.name) || '').trim() || fallback;
  }
  if (l.kind !== 'ingredient') return '';
  const ing = ingredients && (ingredients as Record<string, unknown>)[refId];
  return (ing ? ingredientDisplayName(ing).trim() : '') || fallback;
}

// Is `chosen` the very link the row already has (same kind, same id)? Choosing it again changes nothing — and
// so must not rename the row.
export function isSameLink(current: unknown, chosen: unknown): boolean {
  if (!current || !chosen) return false;
  const a = current as { kind?: unknown; refId?: unknown };
  const b = chosen as { kind?: unknown; refId?: unknown };
  return a.kind === b.kind && String(a.refId) === String(b.refId);
}

// Point a recipe row at what was chosen — `null` removes the link. The ONE place a row's link is written: the
// suggestion list and the full chooser both come through here, so the two cannot treat a row differently.
// MUTATES the row in place and hands it back, as the original does (the editor works on a copy of the recipe).
//
// ⚠️⚠️ THE NAME FOLLOWS A PERSON'S PICK (9 Oct 2026). A caller that passes `{ label }` (the name the link line
// under the row shows) gets the row's name SET to it, whatever was typed. Without `label` the old rule holds:
// the chosen name fills the row only when it has no name at all. Removing a link (null) never touches the name.
export function applyLink<R>(row: R, chosen: unknown, { label }: { label?: unknown } = {}): R {
  if (!row || typeof row !== 'object') return row;
  const r = row as Record<string, unknown>;
  if (chosen === null) {
    delete r.kind;
    delete r.refId;
    return row;
  }
  const c = chosen as { kind?: unknown; refId?: unknown; name?: unknown } | undefined;
  const refId = c && c.refId != null ? String(c.refId).trim() : '';
  if (!c || !(ROW_KINDS as readonly unknown[]).includes(c.kind) || !refId) return row;
  r.kind = c.kind;
  r.refId = refId;
  const setTo = String(label ?? '').trim();
  if (setTo) r.label = setTo;
  else if (!String(r.label ?? '').trim() && c.name) r.label = String(c.name);
  return row;
}

// The rows in a new order: the one at `from` moved to `to`. Returns a NEW list holding the SAME row objects — a
// row keeps its link and, above all, its `rid`, which is what a guided mixing step points at. An index outside
// the list, or a move to where it already is, gives the list back as it was (still a new array).
export function moveRow<T>(list: readonly T[] | null | undefined, from: unknown, to: unknown): T[] {
  const rows = Array.isArray(list) ? list.slice() : [];
  const a = Math.trunc(Number(from));
  const b = Math.trunc(Number(to));
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b
    || a < 0 || b < 0 || a >= rows.length || b >= rows.length) return rows;
  const [row] = rows.splice(a, 1);
  rows.splice(b, 0, row as T);
  return rows;
}

// Is there already an ingredient called exactly this (ignoring case and spaces at the ends) among the ones a
// recipe row can be LINKED to — active, and food rather than packaging?
//
// NOT AN EXPORT OF catalogue-model.js: its original is `nameTaken` at the bottom of
// js/catalogue/ingredient-suggest.js (that file draws the screen, so it is not ported). It lives here because it
// must stay in step with `linkOptions`.
// ⚠️ THE SAME SET linkOptions() offers. Counting a switched-off ingredient or a box here withheld the «create»
// row while the list above offered nothing: a dead end with no reason given. `ingredients` is the store's map
// by id, or a list.
export function nameTaken(ingredients: unknown, name: unknown): boolean {
  const wanted = String(name ?? '').trim().toLowerCase();
  return (Object.values(ingredients || {}) as ({ name?: unknown; shortName?: unknown; active?: unknown; kind?: unknown } | null)[])
    .some(ing => ing && ing.active !== false && ing.kind !== 'packaging'
      && [ing.name, ing.shortName].some(v => String(v ?? '').trim().toLowerCase() === wanted));
}

// ── The editor's validation ──────────────────────────────────────────────────

export type InvalidRecipeProblem = 'name' | 'ingredients' | 'weight';

// The first problem with a recipe, or null if it is valid: 'name' (blank name), 'ingredients' (no ingredient
// with a non-empty label), or 'weight' (every named ingredient is 0, so the recipe can never be scaled). Used
// to block Save.
export function findInvalidRecipe(recipe: unknown): InvalidRecipeProblem | null {
  const r = recipe as { name?: unknown; ingredients?: unknown } | null | undefined;
  if (!r || !String(r.name || '').trim()) return 'name';
  const ings = Array.isArray(r.ingredients) ? r.ingredients as ({ label?: unknown; grams?: unknown } | null)[] : [];
  const named = ings.filter((i): i is { label?: unknown; grams?: unknown } => !!i && !!String(i.label || '').trim());
  if (!named.length) return 'ingredients';
  // At least one named ingredient must carry a positive amount (in any unit), so the recipe is more than a list
  // of names. ('weight' is kept as the problem key.)
  if (!named.some(i => (Number(i.grams) || 0) > 0)) return 'weight';
  return null;
}

// The Calculator tab that stands for a catalogue recipe, or null: the first tab LINKED to it (`catalogueId`, however it got
// linked — by this import or by hand in the Calculator's settings), else the old copy imported as 'cat-<id>' — but only if
// that copy is still UNLINKED (a tab with that id linked to ANOTHER recipe is somebody else's). Pure — used to find the tab
// an import should refresh, and to WARN before deleting a catalogue recipe the Calculator uses.
//
// ⚠️ NEW IN MISE 2 (owner's decision, 18 Oct 2026): an import LINKS the tab to the recipe instead of copying it, so
// this no longer agrees with js/catalogue/catalogue-model.js, which only knows the 'cat-<id>' copies.
export function findCalculatorImport(config: unknown, catalogueId: unknown): Record<string, unknown> | null {
  const c = config as { recipes?: unknown } | null | undefined;
  const recipes = (c && Array.isArray(c.recipes)) ? c.recipes as (Record<string, unknown> | null)[] : [];
  const wanted = String(catalogueId ?? '').trim();
  const importId = 'cat-' + (catalogueId as string);
  const linked = wanted === '' ? undefined : recipes.find(r => r && String(r.catalogueId ?? '').trim() === wanted);
  return linked || recipes.find(r => r && r.id === importId && String(r.catalogueId ?? '').trim() === '') || null;
}

// Which kind of Calculator tab stands for a catalogue recipe: 'linked' (a tab reads the recipe live — ANY tab, wherever it
// is in the list), 'copy' (an old unlinked import 'cat-<id>' that carries its own rows), or null (none).
export type CalculatorImportKind = 'linked' | 'copy';

export function calculatorImportKind(config: unknown, catalogueId: unknown): CalculatorImportKind | null {
  const tab = findCalculatorImport(config, catalogueId);
  if (tab === null) return null;
  return String(tab.catalogueId ?? '').trim() === '' ? 'copy' : 'linked';
}

// ── Import into the Calculator (the single coupling; still pure here) ────────

// The raw Calculator-recipe shape the Calculator's normaliser accepts, as an import writes it.
export interface CalculatorImportRecipe {
  id: string;
  name: unknown;
  logic: 'total';
  // The link: the tab reads the catalogue recipe live (calculator-recipe-source.ts). NEW IN MISE 2.
  catalogueId: string;
  ingredients: { label: unknown; grams: number }[];
  visible: false;
}

// 'already': the tab was linked to this recipe before, so nothing is written.
export type ImportAction = 'added' | 'updated' | 'already';

type ImportableRecipe = { id: unknown; name: unknown; ingredients?: unknown };

// Map a catalogue recipe to the raw Calculator-recipe shape the Calculator's normalizeRecipe accepts.
// 'cat-' + the opaque Firestore id is a stable, unique id; logic 'total' = plain pro-rata;
// visible:false keeps it out of the max-4 tab bar until the owner opts it in from Calculator Settings.
//
// ⚠️ NEW IN MISE 2 (owner's decision, 18 Oct 2026): THE TAB IS LINKED, NOT COPIED — `catalogueId` makes the Calculator
// read the recipe live (rows read-only), so a change made in the catalogue changes the doughs. The weighable rows are
// still written as `ingredients`: that is the leftover copy the tab shows if someone later picks «own» in the
// Calculator's source box (unlinking leaves the rows as they were). The Calculator is grams-only: weighable rows become
// grams, the others are left out of that leftover; a LINKED tab with any other row calculates nothing, which is why the
// screen refuses before it writes (resolveRecipe, problem `unweighable`).
export function toCalculatorRecipe(recipe: ImportableRecipe): CalculatorImportRecipe {
  const rows = (recipe.ingredients || []) as ({ label?: unknown } | null)[];
  return {
    id: 'cat-' + (recipe.id as string),
    name: recipe.name,
    logic: 'total',
    catalogueId: recipe.id as string,
    ingredients: rows
      .filter(i => isWeighableUnit(unitOf(i)))
      .map(i => ({ label: (i as { label?: unknown }).label, grams: Math.round(ingGrams(i)) })),
    visible: false,
  };
}

// The labels of ingredients that CAN'T be imported into the grams-only Calculator. Empty when the whole recipe
// is weighable; drives the pre-import warning.
export function nonWeighableLabels(recipe: unknown): unknown[] {
  const r = recipe as { ingredients?: unknown } | null | undefined;
  const ings = (r && Array.isArray(r.ingredients)) ? r.ingredients as ({ label?: unknown } & Record<string, unknown>)[] : [];
  return ings
    .filter(i => String(i.label || '').trim() && !isWeighableUnit(unitOf(i)))
    .map(i => i.label);
}

// Why the Calculator could not follow a recipe, asked of the Calculator's OWN check (`resolveRecipe` on a tab linked to the
// recipe) so the two can never disagree: null (it can), 'empty' (no rows), or the first row it cannot follow — 'notByWeight'
// (pieces, spoons, «to taste», millilitres, litres…) or 'noAmount' (a row in grams or kilos with nothing in it). NEW IN MISE 2.
export type CalculatorRefusal = { kind: 'empty' } | { kind: 'notByWeight' | 'noAmount'; row: string };

export function calculatorRefusal(recipe: unknown): CalculatorRefusal | null {
  const resolved = resolveRecipe({ catalogueId: 'x' }, { x: recipe });
  if (resolved.problem === null) return null;
  if (resolved.problem !== 'unweighable') return { kind: 'empty' };
  const rows = ((recipe as { ingredients?: unknown } | null)?.ingredients ?? []) as ({ label?: unknown; unit?: unknown } | null)[];
  const blocker = rows.find(r => r && String(r.label || '').trim() && !isWeighableRow(r));
  const unit = String(blocker?.unit || '').trim().toLowerCase();
  return { kind: unit === '' || unit === 'g' || unit === 'gr' || unit === 'kg' ? 'noAmount' : 'notByWeight', row: resolved.problemRow };
}

// Add or update an imported recipe inside a config's recipes[]. The tab that already stands for the recipe is, in order: the
// first one LINKED to it (`catalogueId`, however it got linked), else the old copy 'cat-<id>' if it is still UNLINKED; else
// the recipe is appended. Pure: returns a new config plus the action taken.
//
// ⚠️ NEW IN MISE 2 (owner's decision, 18 Oct 2026): the result is LINKED (`catalogueId`, from toCalculatorRecipe), and a tab
// that is reused LOSES NOTHING: it is kept whole (its id, name, order, visibility, logic, tray weight, leavening and every
// percentage) and only `catalogueId` and the leftover `ingredients` change. A tab already linked to this recipe is not
// touched at all ('already'), so no write follows. A tab linked to ANOTHER recipe is never hijacked, even under the id
// 'cat-<id>': the new tab then takes the next free id ('cat-<id>-2', '-3'…), never a duplicate one.
//
// ⚠️ THE YEAST KNOB SURVIVES THE LINK. An unlinked copy names its leavening by its OWN row key (`leaveningKey`), but a linked
// tab reads it only from `leaveningRid`, the catalogue row's id (calculator-recipe-source). Kept as it was, the old key would
// sit in the document doing nothing: the % control gone, the yeast scaling at the recipe's own ratio, nobody told. So the
// copy's leavening row is found again in the recipe BY LABEL (the copy was made from these rows) and its rid is written as
// `leaveningRid`; the copy's percentages then still apply. `sourceRows` = the catalogue recipe's rows; no match = no rid.
export function mergeImportedRecipe<C extends object>(config: C, recipe: object & { id: unknown }, sourceRows?: unknown): { config: C; action: ImportAction } {
  const current = (config as { recipes?: unknown }).recipes;
  const recipes = Array.isArray(current) ? current.slice() as (Record<string, unknown> | null)[] : [];
  const incoming = (recipe ?? {}) as { id?: unknown; catalogueId?: unknown; ingredients?: unknown };
  const catalogueId = String(incoming.catalogueId ?? '').trim();
  const linkOf = (r: Record<string, unknown> | null): string => String(r?.catalogueId ?? '').trim();
  let idx = catalogueId === '' ? -1 : recipes.findIndex(r => r && linkOf(r) === catalogueId);
  if (idx < 0) idx = recipes.findIndex(r => r && r.id === incoming.id && linkOf(r) === '');
  if (idx >= 0) {
    const prev = recipes[idx] as Record<string, unknown>;
    if (catalogueId !== '' && linkOf(prev) === catalogueId) return { config, action: 'already' };
    const leaveningRid = catalogueId !== '' && linkOf(prev) === '' && !String(prev.leaveningRid ?? '').trim()
      ? leaveningRidFor(prev, sourceRows) : '';
    recipes[idx] = {
      ...prev,
      ...(catalogueId !== '' ? { catalogueId } : {}),
      ...(leaveningRid !== '' ? { leaveningRid } : {}),
      ...(incoming.ingredients !== undefined ? { ingredients: incoming.ingredients } : {}),
    };
    return { config: { ...config, recipes }, action: 'updated' };
  }
  let id = incoming.id;
  const taken = new Set(recipes.map(r => r?.id));
  for (let n = 2; taken.has(id); n++) id = `${String(incoming.id)}-${n}`;
  recipes.push({ ...recipe, id });
  return { config: { ...config, recipes }, action: 'added' };
}

// The catalogue row an unlinked copy's leavening came from, as the key a linked tab reads (`ridOf(row) || label`, the same
// key resolveRecipe builds), or '' when the copy has no leavening or its label is no longer in the recipe.
function leaveningRidFor(tab: Record<string, unknown>, sourceRows: unknown): string {
  const key = String(tab.leaveningKey ?? '').trim();
  if (key === '' || !Array.isArray(sourceRows)) return '';
  const own = Array.isArray(tab.ingredients) ? tab.ingredients as ({ key?: unknown; label?: unknown } | null)[] : [];
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const row = own.find(r => r && String(r.key ?? '').trim() === key);
  const label = norm(row ? row.label : key);
  if (label === '') return '';
  const source = (sourceRows as ({ label?: unknown } | null)[]).find(r => r && norm(r.label) === label && isWeighableRow(r));
  return source ? (ridOf(source) || String(source.label ?? '').trim()) : '';
}

export type ImportFailureKey ='calc.notSavedOutOfDate' | 'cat.importFailedCheckYour';

// Which sentence explains a refused import. permission-denied = the server REFUSED: this app is older than the
// data (configModel), which a connection check would never fix, so it says «out of date» (the Calculator's own key,
// same rule as saveFailureKey in calculator-config). Anything else: the connection.
export function importFailureKey(err: unknown): ImportFailureKey {
  return err && (err as { code?: unknown }).code === 'permission-denied' ? 'calc.notSavedOutOfDate' : 'cat.importFailedCheckYour';
}

// ── The recipe, normalised ───────────────────────────────────────────────────

// One ingredient row as the catalogue keeps it. `kind` + `refId` (the link) and `rid` (the stable id a guided
// mixing step points at) are ABSENT, not empty, on a row without them.
export interface CatalogueRow {
  label: string;
  grams: number;
  unit: CatalogueUnit;
  kind?: RowKind;
  refId?: string;
  rid?: string;
}

// A catalogue recipe from arbitrary input. `steps` and `endNote` are carried through as stored and SHAPED by
// guided-model (the original keeps this file free of that import, and so does the port: `steps` stays
// `unknown[]`). Every optional field is absent, never 0 or empty, on a recipe that has none.
export interface CatalogueRecipe {
  id: string;
  name: string;
  ingredients: CatalogueRow[];
  lossPct: number;
  steps?: unknown[];
  endNote?: string;
  rawGrams?: number;
  cookedGrams?: number;
  netWeightG?: number;
  shelfLifeDays?: number;
}

// Ten years. Long enough for anything a bakery sells, and short enough that a mistyped phone number cannot
// become a shelf life.
export const MAX_SHELF_LIFE_DAYS = 3650;

// One ingredient row: a display label, a non-negative amount, and a unit. Non-numeric or negative amounts
// coerce to 0 so the scaling math never sees NaN; an unknown or missing unit falls back to grams.
//
// ⚠️ THE LINK AND THE `rid` HAVE TO BE CARRIED THROUGH HERE. This function rebuilds every row from scratch,
// so a field it does not mention is DROPPED — silently, on the way in from Firestore. Both are absent rather
// than null when there is none (rows written today stay byte-identical), and `rid` is carried, never MINTED:
// an id invented on read would be a different one on every load and would match nothing.
function normalizeIngredient(input: unknown): CatalogueRow | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const label = String(raw.label != null ? raw.label : (raw.name || '')).trim();
  const grams = Number(raw.grams);
  const unit: CatalogueUnit = (typeof raw.unit === 'string' && (CATALOGUE_UNITS as readonly string[]).includes(raw.unit))
    ? raw.unit as CatalogueUnit : DEFAULT_UNIT;
  const row: CatalogueRow = { label, grams: Number.isFinite(grams) && grams >= 0 ? grams : 0, unit };

  const link = linkOf(raw);
  if (link) { row.kind = link.kind; row.refId = link.refId; }

  const rid = raw.rid != null ? String(raw.rid).trim() : '';
  if (rid) row.rid = rid;
  return row;
}

function normalizeIngredients(list: unknown): CatalogueRow[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeIngredient).filter((row): row is CatalogueRow => Boolean(row));
}

// How many days the finished food keeps. `null` means nobody has said — which is NOT the same as 0, and the
// difference is a date printed on somebody's food.
//
// ⚠️ A BOOLEAN IS NOT A NUMBER OF DAYS. Number(true) is 1, which would turn a corrupt flag into «keeps for
// one day» on a product that keeps for a year.
export function normalizeShelfLifeDays(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n > MAX_SHELF_LIFE_DAYS) return null;
  return n;
}

// A catalogue recipe from arbitrary (e.g. Firestore) input. Returns null only for non-object input; an empty
// name is kept (the editor's validation blocks saving it).
export function normalizeCatalogueRecipe(input: unknown): CatalogueRecipe | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const out: CatalogueRecipe = {
    id: raw.id != null ? String(raw.id) : '',
    name: String(raw.name != null ? raw.name : '').trim(),
    ingredients: normalizeIngredients(raw.ingredients),
    lossPct: normalizeLossPct(raw.lossPct),
  };
  // The guided mixing procedure and its closing message: carried through as stored, absent rather than empty.
  if (Array.isArray(raw.steps) && raw.steps.length) out.steps = raw.steps;
  if (typeof raw.endNote === 'string' && raw.endNote.trim()) out.endNote = raw.endNote;
  // The two weighings the loss is worked out FROM: absent rather than 0, so every recipe written before they
  // existed stays byte-identical until somebody actually puts a scale under the dough.
  const rawG = normalizeWeight(raw.rawGrams);
  const cookedG = normalizeWeight(raw.cookedGrams);
  if (rawG > 0) out.rawGrams = rawG;
  if (cookedG > 0) out.cookedGrams = cookedG;
  // What a full label needs and a PPDS one does not.
  // ⚠️ AND ABSENT IS NOT ZERO HERE EITHER: a shelf life of 0 means «today», and printing today's date as a USE
  // BY on food that keeps for a week is a safety statement nobody made.
  const netG = normalizeWeight(raw.netWeightG);
  if (netG > 0) out.netWeightG = netG;
  const shelf = normalizeShelfLifeDays(raw.shelfLifeDays);
  if (shelf !== null) out.shelfLifeDays = shelf;
  return out;
}

// A list of catalogue recipes, dropping junk entries.
export function normalizeCatalogueRecipes(list: unknown): CatalogueRecipe[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeCatalogueRecipe).filter((r): r is CatalogueRecipe => Boolean(r));
}

// The two label fields exactly as the catalogue store WRITES them: a real number, or `null` for «nobody has
// said» — which the data layer turns into a removal, because the rules refuse a stored null and a merge that
// leaves a key out keeps the old one.
export function labelFieldsOf(recipe: unknown): { netWeightG: number | null; shelfLifeDays: number | null } {
  const r = recipe as { netWeightG?: unknown; shelfLifeDays?: unknown } | null | undefined;
  const netG = normalizeWeight(r && r.netWeightG);
  return {
    netWeightG: netG > 0 ? netG : null,
    shelfLifeDays: normalizeShelfLifeDays(r && r.shelfLifeDays),
  };
}

// ── List helpers (used by the catalogue list) ────────────────────────────────

// Most-used first: sort by open-count (from the local usage map) descending, then by name ascending as a
// stable tie-break. Never mutates the input array.
export function sortByUsage<T extends { id?: unknown; name?: unknown }>(recipes: readonly T[], usageMap: Readonly<Record<string, number>> = {}): T[] {
  return recipes.slice().sort((a, b) => {
    const ua = usageMap[a.id as string] || 0;
    const ub = usageMap[b.id as string] || 0;
    if (ub !== ua) return ub - ua;
    return String(a.name).localeCompare(String(b.name));
  });
}

// Case-insensitive substring filter by recipe name. Empty query returns all (the very same array).
export function filterByName<T extends { name?: unknown }>(recipes: readonly T[], query: unknown): readonly T[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return recipes;
  return recipes.filter(r => String(r.name).toLowerCase().includes(q));
}

// ── kg scaling (pure pro-rata "total") ───────────────────────────────────────

// Round an array of gram values so the displayed integers sum EXACTLY to Math.round(total). Any ±rounding
// residual is assigned to the largest ingredient.
function fixRounding(amounts: readonly number[], total: number): number[] {
  const rounded = amounts.map(a => Math.round(a));
  if (!rounded.length) return rounded;
  const diff = Math.round(total) - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i]! > rounded[maxIdx]!) maxIdx = i;
    }
    rounded[maxIdx]! += diff;
  }
  return rounded;
}

// A null or undefined row THROWS a TypeError here, as in the original (`.grams` read off nothing).
const gramsOfRow = (row: unknown): number => Number((row as { grams?: unknown }).grams) || 0;
const rowsOf = (recipe: unknown): readonly unknown[] => {
  const r = recipe as { ingredients?: unknown } | null | undefined;
  return (r && Array.isArray(r.ingredients)) ? r.ingredients : [];
};

// ⚠️ THE BIG UNITS KEEP THEIR DECIMALS, DOWN TO ONE GRAM OR ONE MILLILITRE. Every amount used to be rounded
// to a whole number in its own unit, so 1.84 kg of flour read «2 kg» and 0.4 kg read «0 kg» (Federico,
// 14 Oct 2026: «correggi i decimali di kg e litri»; the current app's fix is PR #361). A unit not listed is whole.
const UNIT_DECIMALS: Readonly<Record<string, number>> = { kg: 3, l: 3, dl: 2, cl: 1 };
export function unitDecimals(unit: string): number {
  return UNIT_DECIMALS[unit] ?? 0;
}

// An amount rounded to what its unit can show: 1.8375 kg -> 1.838, 2.4 g -> 2.
export function roundInUnit(value: unknown, unit: string): number {
  const f = 10 ** unitDecimals(unit);
  return Math.round((Number(value) || 0) * f) / f;
}

// Scale a recipe to a target TOTAL weight in grams: every ingredient in proportion to the weighable total.
// Returns an array aligned with recipe.ingredients — a number in EACH ingredient's own unit, rounded by
// roundInUnit (whole, but kg / l to the gram or millilitre), or null for a 'to taste' row (no quantity). Empty recipe / non-positive target / no weighable mass → zeros (no NaN).
export function scaleCatalogue(recipe: unknown, targetGrams: unknown): (number | null)[] {
  const ings = rowsOf(recipe);
  const target = Number(targetGrams);
  const weighTotal = weighableTotalGrams(recipe);
  if (!Number.isFinite(target) || target <= 0 || weighTotal <= 0) {
    return ings.map(i => unitOf(i) === 'to taste' ? null : 0);
  }
  const factor = target / weighTotal;
  // Common case — every ingredient in grams: exact-sum to the target.
  if (ings.every(i => unitOf(i) === 'g')) {
    return fixRounding(ings.map(i => gramsOfRow(i) * factor), target);
  }
  // Mixed units: proportional, each rounded in its own unit (roundInUnit); to-taste has no number.
  return ings.map(i => unitOf(i) === 'to taste' ? null : roundInUnit(gramsOfRow(i) * factor, unitOf(i)));
}

// The base (unscaled) amounts, aligned with recipe.ingredients — rounded in each ingredient's own unit by
// roundInUnit (null for 'to taste'). For an all-grams recipe the integer rows sum exactly to the rounded total.
export function baseAmounts(recipe: unknown): (number | null)[] {
  const ings = rowsOf(recipe);
  if (ings.every(i => unitOf(i) === 'g')) {
    const raw = ings.map(gramsOfRow);
    return fixRounding(raw, raw.reduce((a, b) => a + b, 0));
  }
  return ings.map(i => unitOf(i) === 'to taste' ? null : roundInUnit(gramsOfRow(i), unitOf(i)));
}

// ── Batch size: a readable weight, and a guard against a mistyped total ──────
// The "Total dough weight" field takes GRAMS. Grams remove the kilograms trap (typing 17500 and getting a
// 17.5-tonne batch) but not the fat-finger one, so a total far outside any real batch is FLAGGED before it is
// applied — a loud confirm, never a silent scale, and never a hard block.

// Beyond any bakery mixer, and far out of proportion to the recipe as written.
export const MAX_SANE_BATCH_G = 100000; // 100 kg
export const MAX_SANE_MULTIPLE = 50;    // 50x the base recipe

const gnum = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
// Drop a trailing '.0' so 17.5 kg stays "17.5 kg" but 18.0 kg reads "18 kg".
const trim = (n: number): string => String(Math.round(n * 100) / 100);

// A weight named the way a person would say it, so a wrong order of magnitude is obvious at a glance:
// 17500 g → "17.5 kg"; 17500000 g → "17.5 tonnes". The unit words are English literals in the original too
// (not dictionary words), copied as they are.
export function formatWeight(grams: unknown): string {
  const g = gnum(grams);
  if (g >= 1000000) return trim(g / 1000000) + ' tonnes';
  if (g >= 1000) return trim(g / 1000) + ' kg';
  return trim(g) + ' g';
}

export type BatchWarningKey = 'cat.batchWarning' | 'cat.batchWarningVsRecipe';

// The translate function batchWarning needs: Mise 2's `t` (whose keys are a wider union) fits.
export type BatchWarningTranslate = (key: BatchWarningKey, params: Readonly<Record<string, string | number>>) => string;

// null when the batch is plausible; otherwise a plain-language warning naming the weight and how it compares to
// the recipe as written. ADAPTED: the original calls the interface dictionary; here the translator is the third
// argument. ⚠️ ONE KEY PER WHOLE SENTENCE (the original's rule): never three fragments glued together.
export function batchWarning(targetGrams: unknown, baseGrams: unknown, t: BatchWarningTranslate): string | null {
  const target = gnum(targetGrams);
  const base = gnum(baseGrams);
  if (!target) return null;

  const tooHeavy = target > MAX_SANE_BATCH_G;
  const tooBig = base > 0 && target / base > MAX_SANE_MULTIPLE;
  if (!tooHeavy && !tooBig) return null;

  return base > 0
    ? t('cat.batchWarningVsRecipe', {
      weight: formatWeight(target), times: trim(target / base), base: formatWeight(base),
    })
    : t('cat.batchWarning', { weight: formatWeight(target) });
}

// ── Persisted "scaled batch" freshness ───────────────────────────────────────

export const SCALED_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// True if a stored { target, ts } entry is still valid: a positive gram target calculated less than
// SCALED_TTL_MS ago (relative to nowMs).
export function isScaledEntryFresh(entry: unknown, nowMs: unknown): boolean {
  const e = entry as { target?: unknown; ts?: unknown } | null | undefined;
  return !!e
    && Number.isFinite(e.target) && (e.target as number) > 0
    && Number.isFinite(e.ts) && ((nowMs as number) - (e.ts as number)) < SCALED_TTL_MS;
}

// ── What a person reads for a unit ───────────────────────────────────────────

// ⚠️ THE STORED UNIT IS AN IDENTIFIER; WHAT A PERSON READS IS THE DICTIONARY'S. ADAPTED: the original's
// `unitText(unit)` looks the word up itself. Here `unitTextKey(unit)` answers the dictionary KEY, so the app
// translates with its own typed i18n, or null for a metric symbol (g, kg, mg, ml, cl, dl, l — the same in
// every language, shown as they are) and for anything unknown, which the original also hands back untouched.
export type UnitTextKey =
  | 'cat.unitText.pcs' | 'cat.unitText.tsp' | 'cat.unitText.tbsp' | 'cat.unitText.pinch' | 'cat.unitText.toTaste';

export function unitTextKey(unit: unknown): UnitTextKey | null {
  switch (unit) {
    case 'pcs': return 'cat.unitText.pcs';
    case 'tsp': return 'cat.unitText.tsp';
    case 'tbsp': return 'cat.unitText.tbsp';
    case 'pinch': return 'cat.unitText.pinch';
    case 'to taste': return 'cat.unitText.toTaste';
    default: return null;
  }
}
