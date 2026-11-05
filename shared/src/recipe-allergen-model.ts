// recipe-allergen-model.ts — which allergens a recipe contains, gathered from the
// ingredients its rows point at. PURE, and asserted under Node (P15).
//
// TypeScript PARTIAL port of js/catalogue/recipe-allergen-model.js for Mise 2. Behaviour is identical, input
// for input, for everything ported: recipe-allergen-model.spec.ts runs every test against BOTH files and
// compares each ported export with the js/ file itself; odd-inputs.spec.ts feeds both the same strange
// values. It is NOT paired in parity.spec.ts, because two things differ BY DESIGN — both look a word up in the
// interface dictionary (`t()`), which in Mise 2 belongs to the app:
//   * `incompleteText` is LEFT OUT. The app says it from `result.gaps.length` itself, with its own typed
//     messages: `cat.nothingInThisRecipe` when the count is 0, `cat.alg.notDeclaredCount` (with `n`) otherwise.
//   * `blockingIngredients` takes a THIRD argument, the name to show for an ingredient that no longer exists
//     (the original reads `t('cat.unknownIngredient')`). The spec hands the original's English text to the
//     port so both answer the same.
// Everything else is here: ALLERGEN_REASON_TEXT (the dictionary KEYS), recipeAllergens, canLabel, ROW_STATES,
// rowState, rowIsBlocked, blockingIngredients and unlinkedRowNames.
//
// ⚠️⚠️ IT LOOKS LIKE recipe-cost-model.ts AND ITS CONCLUSION IS THE OPPOSITE.
//
// Both walk the same links, both meet the same gaps: a row nobody linked, an
// ingredient with nothing filled in, a sub-recipe that is itself incomplete. The
// cost model answers those by giving a PARTIAL number and saying so — a price per
// kilo of the part it could price, which is a useful, honest, slightly-too-low
// answer.
//
// Here a partial answer is not slightly wrong, it is DANGEROUS. The row nobody
// linked could be the one with the hazelnuts. So:
//
//     complete === false  ⇒  NOTHING may be printed as a label.
//
// The list of allergens found is still returned, because a working sheet can show
// "so far we know about milk and wheat, and these four rows are unaccounted for"
// — that is a job list. What must never happen is that list being presented as a
// declaration. The screens enforce it; this file makes it impossible to miss by
// putting `complete` in the same object.
//
// ⚠️ IT LIVES BESIDE recipe-cost-model.ts, and Food Cost imports it the same way it already imports that
// one. Walking a recipe's rows needs to know how a catalogue row is shaped — unitOf, linkOf,
// ingredientGrams — so the walk belongs where that shape is defined. The alternative, a second copy of the
// walk, is the thing this project refuses.

import { ingredientDisplayName } from './ingredient-name';
import { unitOf, ingredientGrams, linkOf } from './catalogue-model';
import type { CatalogueUnit } from './catalogue-model';
import { MAX_RECIPE_DEPTH } from './recipe-cost-model';
import { normalizeAllergens, normalizeMayContain, isDeclared } from './allergen-model';
import type { AllergenCode } from './allergen-model';

// Why a row could not be accounted for. The order is the order they are TESTED
// in, and each names one thing to go and do — the same shape as COST_REASON_TEXT
// in the cost model, so the two screens read alike.
//
// ⚠️ 'not-weighable' IS NOT AN EXCUSE HERE, and that is the sharpest difference
// from the cost model. A pinch of something still contains what it contains; a
// row measured in spoons can be pure mustard. The cost model can skip those
// because a pinch costs nothing worth counting — an allergen declaration cannot.
// ⚠⚠ KEYS, NOT PHRASES, AND THAT IS THE POINT. These were seven plain English
// sentences and could therefore never be anything else — they printed in English on a
// fully Italian screen, which is how Federico found them.
//
// ⚠ THEY ARE NOT t() CALLS EITHER. A module constant is evaluated ONCE, at first
// import — before a venue is open, so before the interface language (which comes from
// the venue) is known — and would freeze in whatever language the app started in.
// Fourteen constants in this app did exactly that, each holding a correct key with a
// correct translation, and each rendering English anyway: the defect is WHEN, not WHAT.
// The lookup lives in the screen that draws the reason, called while drawing.
export const ALLERGEN_REASON_TEXT = Object.freeze({
  'not-linked': 'cat.alg.reason.notLinked',
  'missing-ingredient': 'cat.alg.reason.missingIngredient',
  'not-declared': 'cat.alg.reason.notDeclared',
  'missing-recipe': 'cat.alg.reason.missingRecipe',
  'sub-incomplete': 'cat.alg.reason.subIncomplete',
  'cycle': 'cat.alg.reason.cycle',
  'too-deep': 'cat.alg.reason.tooDeep',
});

export type AllergenReason = keyof typeof ALLERGEN_REASON_TEXT;

// The two lookup tables: a Map or a plain object each (callers hand over whatever they already have).
export interface RecipeAllergenTables {
  recipes?: unknown;
  ingredients?: unknown;
}

// One row of a recipe, as the walk reports it.
export interface AllergenRow {
  label: string;
  grams: number;
  unit: CatalogueUnit;
  declared: boolean;
  reason: AllergenReason | null;
}

// What a recipe contains. `complete` is true only when EVERY row is accounted for.
export interface RecipeAllergens {
  allergens: AllergenCode[];
  mayContain: AllergenCode[];
  complete: boolean;
  rows: AllergenRow[];
  // The rows somebody can go and fix, in the order they appear.
  gaps: AllergenRow[];
}

function lookup(table: unknown, id: unknown): unknown {
  if (!table || !id) return null;
  const t = table as { get?: unknown } & Record<PropertyKey, unknown>;
  if (typeof t.get === 'function') return (t.get as (id: unknown) => unknown).call(table, id) || null;
  return Object.prototype.hasOwnProperty.call(table, id as PropertyKey) ? t[id as PropertyKey] : null;
}

type RowReading =
  | { reason: AllergenReason }
  | { reason: null; allergens: AllergenCode[]; mayContain: AllergenCode[] };

type SubReading = RowReading;

// Everything one row contributes, or the reason it contributes nothing.
function readRow(row: unknown, { ingredients }: RecipeAllergenTables, resolveRecipe: (refId: string) => SubReading): RowReading {
  const link = linkOf(row);
  if (!link) return { reason: 'not-linked' };

  if (link.kind === 'recipe') {
    const sub = resolveRecipe(link.refId);
    if (sub.reason) return { reason: sub.reason };
    return { allergens: sub.allergens, mayContain: sub.mayContain, reason: null };
  }

  const ingredient = lookup(ingredients, link.refId) as { allergens?: unknown; mayContain?: unknown } | null;
  if (!ingredient) return { reason: 'missing-ingredient' };
  // ⚠️ THE WHOLE FEATURE TURNS ON THIS LINE. An ingredient nobody has checked
  // contributes NOTHING and makes the recipe incomplete — it does not contribute
  // "no allergens". isDeclared() is the only thing allowed to answer that, and it
  // reads the verification stamp rather than the emptiness of a list.
  if (!isDeclared(ingredient)) return { reason: 'not-declared' };

  return {
    allergens: normalizeAllergens(ingredient.allergens),
    mayContain: normalizeMayContain(ingredient.mayContain),
    reason: null,
  };
}

// What a recipe contains.
//
//   { allergens, mayContain, complete, rows, gaps }
//
// `complete` is true only when EVERY row is accounted for. There is no middle.
export function recipeAllergens(recipe: unknown, tables: RecipeAllergenTables = {}, depth: number = 1, seen: Iterable<string> = new Set<string>()): RecipeAllergens {
  const card = recipe as { id?: unknown; ingredients?: unknown } | null | undefined;
  const rows: readonly unknown[] = (card && Array.isArray(card.ingredients)) ? card.ingredients : [];

  // The recipe being read is itself on the branch, so a row pointing back at it is
  // caught here rather than one level down, where the message would name the wrong
  // recipe. Same reasoning as the cost model.
  const branch: ReadonlySet<string> = card && card.id ? new Set([...seen, String(card.id)]) : seen as ReadonlySet<string>;

  const found = new Set<AllergenCode>();
  const traces = new Set<AllergenCode>();
  let complete = true;

  const detailed: AllergenRow[] = rows.map(row => {
    const label = String((row && (row as { label?: unknown }).label) || '').trim();
    const result = readRow(row, tables, refId => resolveIn(refId, tables, depth, branch));

    if (result.reason === null) {
      result.allergens.forEach(code => found.add(code));
      result.mayContain.forEach(code => traces.add(code));
    } else if (label) {
      // ⚠️ A BLANK LINE IS NOT A GAP. A row with no label at all is somebody
      // half-way through typing, not an undeclared ingredient — counting it would
      // make every recipe permanently incomplete for a reason nobody can fix.
      complete = false;
    }

    return {
      label,
      grams: ingredientGrams(row) || 0,
      unit: unitOf(row),
      declared: result.reason === null,
      reason: result.reason,
    };
  });

  // A recipe with no rows at all declares nothing, and saying "contains none of
  // the 14" about it would be a statement nobody made.
  if (!rows.length) complete = false;

  return {
    allergens: [...found].sort((a, b) => a.localeCompare(b)),
    mayContain: [...traces].filter(code => !found.has(code)).sort((a, b) => a.localeCompare(b)),
    complete,
    rows: detailed,
    // The rows somebody can go and fix, in the order they appear. Unlike the cost
    // model's `unpriced`, nothing is excluded for being un-weighable: a pinch of
    // mustard is still mustard.
    gaps: detailed.filter(r => !r.declared && r.label),
  };
}

// Descend into a sub-recipe. The branch set is COPIED on the way down, never
// shared between siblings: two rows may legitimately use the same sub-recipe, and
// one shared set would call the second a cycle.
function resolveIn(refId: string, tables: RecipeAllergenTables, depth: number, branch: ReadonlySet<string>): SubReading {
  if (branch.has(refId)) return { reason: 'cycle' };
  if (depth >= MAX_RECIPE_DEPTH) return { reason: 'too-deep' };

  const sub = lookup(tables.recipes, refId);
  if (!sub) return { reason: 'missing-recipe' };

  const result = recipeAllergens(sub, tables, depth + 1, new Set([...branch, refId]));
  // ⚠️ AN INCOMPLETE SUB-RECIPE POISONS THE WHOLE THING, and contributes nothing.
  // Taking its known allergens while ignoring its gaps is how doubt disappears one
  // level up and a half-known answer starts looking complete.
  if (!result.complete) return { reason: 'sub-incomplete' };
  return { allergens: result.allergens, mayContain: result.mayContain, reason: null };
}

// ⚠️ THE ONE FUNCTION EVERY LABEL MUST ASK, so there is a single place to look and
// a single place to break on purpose in a mutation test. A label screen that tests
// `result.allergens.length` instead would happily print a list gathered from three
// rows out of ten.
export function canLabel(result: unknown): boolean {
  return !!result && (result as { complete?: unknown }).complete === true;
}

// ── What a one-line row should say about a recipe ────────────────────────────
//
// ⚠️⚠️ THE THREE STATES, PLUS THE EMPTY RECIPE, AS ONE TESTED ANSWER. This
// decision used to live as a chain of ifs inside the allergen sheet, where no test
// could reach it — on the one screen in this app that can send somebody to
// hospital. Kept here beside canLabel(), the rest of the allergen judgement, so
// a mutation has something to break.
//
// ⚠️ 'declared-none' AND 'declared-listed' ARE BOTH STATEMENTS SOMEBODY MADE, and
// a screen must dress them the same way. The dangerous reading is a recipe whose
// allergens are simply absent looking like one checked and found clear.
export const ROW_STATES = Object.freeze([
  'declared-listed',  // checked: contains these
  'declared-none',    // checked: contains none of the 14
  'nothing-yet',      // no rows at all — nobody has said anything, and there is nothing to say it about
  'not-declared',     // has rows, and at least one of them is a gap
] as const);

export type RowState = (typeof ROW_STATES)[number];

// ⚠️ A MISSING RESULT ANSWERS 'not-declared', NEVER THE CLEAN-LOOKING ONE. Every
// default in this file points the same way: doubt reads as "we do not know".
export function rowState(result: unknown): RowState {
  if (!result) return 'not-declared';
  const card = result as { allergens?: unknown; gaps?: unknown };
  if (canLabel(result)) {
    return Array.isArray(card.allergens) && card.allergens.length
      ? 'declared-listed'
      : 'declared-none';
  }
  return Array.isArray(card.gaps) && card.gaps.length ? 'not-declared' : 'nothing-yet';
}

// Is this row one the screen must mark as having no answer?
export function rowIsBlocked(state: unknown): boolean {
  return state === 'not-declared' || state === 'nothing-yet';
}

// ── Where to start ───────────────────────────────────────────────────────────
//
// ⚠️ THE ANSWER TO "DO I REALLY HAVE TO FILL IN 65 INGREDIENTS?" — and it is
// usually no. A handful of ingredients appear in almost everything, so declaring
// six of them can unblock twenty recipes while the other fifty-nine matter to one
// recipe each. Handed a flat list, somebody starts at A and gives up at F having
// unblocked nothing; handed this, the first afternoon's work is the whole point.
//
// Counts each UNDECLARED ingredient once per recipe that is waiting on it,
// including through sub-recipes, and returns the busiest first.
//
// `unknownName` is the word for an ingredient that no longer exists (the original reads the dictionary's
// `cat.unknownIngredient`; here the app hands it over).
export interface BlockingIngredient {
  id: string;
  name: string;
  blocks: number;
}

export function blockingIngredients(recipes: unknown, tables: RecipeAllergenTables = {}, unknownName: string): BlockingIngredient[] {
  const list: readonly unknown[] = Array.isArray(recipes) ? recipes : [];
  const counts = new Map<string, { id: string; name: string; recipes: Set<unknown> }>();   // id -> { id, name, recipes: Set }

  for (const recipe of list) {
    const card = recipe as { id?: unknown } | null | undefined;
    if (!card || !card.id) continue;
    for (const id of undeclaredIdsIn(recipe, tables, 1, new Set<string>())) {
      if (!counts.has(id)) {
        const ingredient = lookup(tables.ingredients, id);
        counts.set(id, { id, // a SCREEN list (what to go and declare), so the name to show; the printed label keeps `name`
          name: (ingredient ? ingredientDisplayName(ingredient) : '') || unknownName, recipes: new Set() });
      }
      counts.get(id)?.recipes.add(card.id);
    }
  }

  return [...counts.values()]
    .map(entry => ({ id: entry.id, name: entry.name, blocks: entry.recipes.size }))
    // Busiest first; ties by name so the order is stable between two openings of
    // the screen rather than shuffling with Map insertion order.
    .sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name));
}

// ── The job BEFORE that one ──────────────────────────────────────────────────
//
// ⚠️ THIS EXISTS BECAUSE THE WORK LIST ABOVE WAS EMPTY ON THE REAL DATA, AND THAT
// WAS WORSE THAN USELESS — a screen whose whole point is "start here" showing
// nothing at all. blockingIngredients() counts ingredients that are LINKED and
// undeclared; on 11 August 2026 the bakery had 77 recipe rows and **none of them
// linked**, so it had nothing to count and no guidance appeared for the job that
// actually comes first.
//
// Linking and declaring are two different actions, and they are strictly ordered:
// an ingredient's declaration cannot reach a recipe that does not point at it. So
// this is asked first, and the screen shows it first.
//
// Counted by row LABEL rather than by ingredient, because an unlinked row has no
// ingredient — the label is the only handle it has. The same name across eleven
// recipes is eleven separate links to make, and knowing that is the point.
export interface UnlinkedRowName {
  name: string;
  rows: number;
}

export function unlinkedRowNames(recipes: unknown): UnlinkedRowName[] {
  const list: readonly unknown[] = Array.isArray(recipes) ? recipes : [];
  const counts = new Map<string, number>();

  for (const recipe of list) {
    const card = recipe as { ingredients?: unknown } | null | undefined;
    const rows: readonly unknown[] = (card && Array.isArray(card.ingredients)) ? card.ingredients : [];
    for (const row of rows) {
      if (linkOf(row)) continue;
      const label = String((row && (row as { label?: unknown }).label) || '').trim();
      // A blank line is somebody mid-edit, not a job — the same rule the walk uses.
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}

// Which linked-but-undeclared ingredient ids this recipe waits on. Rows that are
// not linked at all have no id to report — they are counted by the recipe's own
// `gaps`, and are a different job (link it) from this one (declare it).
function undeclaredIdsIn(recipe: unknown, tables: RecipeAllergenTables, depth: number, branch: ReadonlySet<string>): Set<string> {
  const card = recipe as { id?: unknown; ingredients?: unknown } | null | undefined;
  const rows: readonly unknown[] = (card && Array.isArray(card.ingredients)) ? card.ingredients : [];
  const here: ReadonlySet<string> = card && card.id ? new Set([...branch, String(card.id)]) : branch;
  const out = new Set<string>();

  for (const row of rows) {
    const link = linkOf(row);
    if (!link) continue;

    if (link.kind === 'recipe') {
      // The same guards as the walk above, for the same reasons — a cycle or a
      // runaway nesting must end here rather than hang the screen this feeds.
      if (here.has(link.refId) || depth >= MAX_RECIPE_DEPTH) continue;
      const sub = lookup(tables.recipes, link.refId);
      if (!sub) continue;
      undeclaredIdsIn(sub, tables, depth + 1, new Set([...here, link.refId]))
        .forEach(id => out.add(id));
      continue;
    }

    const ingredient = lookup(tables.ingredients, link.refId);
    // ⚠️ A DELETED INGREDIENT IS NOT A JOB FOR THIS LIST. It cannot be declared —
    // it does not exist — so it would sit at the top of the work list for ever.
    // The recipe's own gaps still report it, which is where it can be acted on.
    if (!ingredient) continue;
    if (!isDeclared(ingredient)) out.add(link.refId);
  }

  return out;
}
