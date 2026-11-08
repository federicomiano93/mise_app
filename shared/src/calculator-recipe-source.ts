// calculator-recipe-source.ts — where a Calculator tab's ingredients come from. PURE: no DOM, no Firestore.
//
// TypeScript FULL port of js/calculator-recipe-source.js for Mise 2. Behaviour is identical, input for
// input: calculator-recipe-source.spec.ts runs every test against BOTH files, parity.spec.ts compares their
// exports and odd-inputs.spec.ts feeds both the same strange values. The one intended difference it once had
// (a linked row in kilos read as grams × 1000, 18 Oct 2026) is gone: the current app made the same fix, and
// since 8 Nov 2026 both weigh a row through the Catalogue's own unit table (rowGrams, isWeighable).
//
// ⚠️ PORT OWED (release branch, 8 Nov 2026): `catalogueChoices` and `rowsToStamp` («Add a recipe» offers the
// recipe book first, linking stamps row ids — item 37 of docs/mise2-port-owed.md) are not here yet, so
// parity.spec.ts still expects the export lists to differ.
//
// NOT PART OF THIS FILE (it was never in the original either): `effectiveRecipe`, `isStillLoading`,
// `recipeToSave` and `problemMessage` live in js/calculator-catalogue-link.js, which holds the map of the
// linked Catalogue recipes already read (module state) and the sentences (`t()`). Mise 2 keeps that map in
// the screen's own state and hands it to `resolveRecipe` as `catalogueById`; the sentences are the app's.
// `PROBLEMS` is what the app maps to a sentence: missing → `calc.sourceMissing`, empty → `calc.sourceEmpty`,
// unweighable → `calc.sourceUnweighable` (with the row's name).
//
// Federico, 14 Aug 2026: «calculator non ha più ricette proprie ma le prende da recipe catalogue». One
// recipe, in one place — instead of two copies that silently disagree the moment one is fixed.
//
// ⚠️⚠️ IT READS BOTH SHAPES: the old one (a tab carrying its own ingredients) and the new one (a tab
// pointing at a Catalogue recipe). The data moved before the code could read it once, in July, and the app
// was left with no weights at all, for everybody.

import { ridOf } from './guided-model';
// The Catalogue's own unit table, never a copy of it: a second table is a second place for kg to drift.
import { ingredientGrams, isWeighableUnit, keepRows } from './catalogue-model';

// ── What can go wrong, named ─────────────────────────────────────────────────
//
// ⚠️ A LINKED RECIPE THAT CANNOT BE READ MUST REFUSE, NOT BAKE WITH NOTHING. An empty ingredient list
// computes perfectly happily and produces a dough of zero. Every problem below means the tab says what is
// wrong and calculates nothing.
export const PROBLEMS = Object.freeze({
  missing: 'missing',            // the Catalogue recipe is gone, or not loaded yet
  empty: 'empty',                // it exists but has no usable rows
  unweighable: 'unweighable',    // a row is a pinch / a piece / to taste
} as const);

export type RecipeProblem = (typeof PROBLEMS)[keyof typeof PROBLEMS];

// The Calculator's own ingredient shape, whichever side it came from.
export interface SourceIngredient {
  key: string;
  label: string;
  grams: number;
}

// What a tab actually calculates from.
export interface ResolvedRecipe {
  name: string;
  ingredients: SourceIngredient[];
  leaveningKey: string | null;
  // The indexes (into `ingredients`) of the rows with a divider line under them; absent when there is none.
  dividersAfter?: number[];
  linked: boolean;
  problem: RecipeProblem | null;
  problemRow: string;
  // On an `unweighable` refusal only: how many rows the linked recipe has, for the Recipes list's «N ingredients»
  // (ingredientCount). The refusal's `ingredients` stays empty.
  rowCount?: number;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Loose views of the inputs: every field is read defensively, as in the original.
type Row = { unit?: unknown; grams?: unknown; label?: unknown; dividerAfter?: unknown } | null | undefined;
type Tab = { catalogueId?: unknown; name?: unknown; ingredients?: unknown; leaveningKey?: unknown; leaveningRid?: unknown } | null | undefined;

// The row's unit as the Catalogue's table names it: no unit (a legacy row) and «gr» are grams.
const unitKey = (row: Row): string => {
  const unit = String(row?.unit || '').trim().toLowerCase();
  return unit === 'gr' || !unit ? 'g' : unit;
};

// A weighable row's amount IN GRAMS.
//
// ⚠️⚠️ THE CATALOGUE STORES THE NUMBER AS TYPED, IN ITS OWN UNIT. «Flour 1 kg» is saved as { grams: 1, unit: 'kg' } —
// the field is called `grams` for history, not because it holds grams. The unit is read loosely (trimmed, any case,
// «gr») because the linked recipe arrives raw from Firestore, not through the Catalogue's normaliser. Rounded to the
// milligram so 1.005 kg reads 1005 g, not 1004.9999999999999 g.
function rowGrams(row: Row): number {
  const g = ingredientGrams({ grams: num(row?.grams), unit: unitKey(row) });
  return Math.round(g * 1000) / 1000;
}

// Is this row something the Calculator can scale? The Calculator works in grams and multiplies everything
// by one factor; a row measured in pieces or "to taste" has no weight to multiply.
//
// ⚠️ IT BLOCKS THE WHOLE RECIPE AND NAMES THE ROW (decided 1 Aug 2026). Skipping it would produce a dough
// that is quietly light by exactly that ingredient — the one direction a recipe must not be wrong in.
//
// ⚠️⚠️ WEIGHABLE MEANS WHAT THE RECIPE BOOK SAYS IT MEANS — its own table, litres included at 1 ml = 1 g. This used
// to accept only g and kg, so a recipe-book recipe with «Acqua 0,65 l» refused the whole tab while the recipe book
// counted the same litres in its total and its Food cost (Panificio Miano, 30 Oct 2026: «Le ricette nel calcolatore
// non funzionano»; current app e7f3dac0).
export function isWeighable(row: unknown): boolean {
  const r = row as Row;
  return isWeighableUnit(unitKey(r)) && num(r?.grams) > 0;
}

// Which Catalogue recipes a Calculator config actually needs.
//
// ⚠️⚠️ THIS IS WHY THE CALCULATOR MUST NEVER WATCH THE WHOLE COLLECTION. The Catalogue is built for 500+
// recipes and the Calculator needs three; a listener on the collection would turn every app open from 3
// reads into 500+ (P14).
export function linkedRecipeIds(recipes: unknown): string[] {
  const ids = ((recipes || []) as Tab[])
    .map(r => String(r?.catalogueId || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function isLinked(recipe: unknown): boolean {
  return !!String((recipe as Tab)?.catalogueId || '').trim();
}

// How many ingredients the Recipes list says a recipe has, from the recipe as it resolves.
//
// ⚠️ A LINKED RECIPE'S OWN `ingredients` IS EMPTY (or a stale copy): its rows live in the recipe book. Counting the
// tab's copy made every linked recipe say «0 ingredienti» in Calculator → Settings → Recipes (found on the lab
// tablet, 31 Oct 2026; current app 535bcdb2). So the count comes from the resolved recipe — a recipe with a row the
// Calculator cannot weigh («salt, to taste») still has its rows, and says how many — and null, no number at all,
// when the linked recipe has not been read yet: a «0» there would be a wrong fact, while a recipe that really has no
// rows still says 0.
export function ingredientCount(recipe: unknown, resolved: Partial<ResolvedRecipe> | null | undefined): number | null {
  const tab = recipe as Tab;
  if (!isLinked(recipe)) return Array.isArray(tab?.ingredients) ? tab.ingredients.length : 0;
  if (!resolved || resolved.problem === PROBLEMS.missing) return null;
  if (resolved.problem === PROBLEMS.unweighable) return Number(resolved.rowCount) || 0;
  return Array.isArray(resolved.ingredients) ? resolved.ingredients.length : 0;
}

function blank(): ResolvedRecipe {
  return { name: '', ingredients: [], leaveningKey: null, linked: false, problem: null, problemRow: '' };
}

// The effective recipe a Calculator tab should use. `catalogueById` maps a Catalogue recipe's id to the
// recipe, or to null when it was looked for and is gone (a missing key = not looked yet; both read as
// `missing` here, the screen tells them apart).
//
// `ingredients` is always the Calculator's own shape — { key, label, grams } — whichever side it came from,
// so nothing downstream has to know the difference.
export function resolveRecipe(recipe: unknown, catalogueById?: unknown): ResolvedRecipe {
  if (!recipe) return blank();
  const tab = recipe as NonNullable<Tab>;

  // ── The shape today: the tab carries its own ingredients ──────────────────
  if (!isLinked(recipe)) {
    return {
      name: (tab.name || '') as string,
      ingredients: (Array.isArray(tab.ingredients) ? tab.ingredients : []) as SourceIngredient[],
      leaveningKey: (tab.leaveningKey || null) as string | null,
      linked: false,
      problem: null,
      problemRow: '',
    };
  }

  const source = ((catalogueById || {}) as Record<string, { name?: unknown; ingredients?: unknown } | null | undefined>)[
    String(tab.catalogueId).trim()];
  if (!source) {
    // ⚠️ NOT A FALLBACK TO THE OLD COPY. A stale copy is exactly what this change exists to remove, and
    // using one here would mean the app quietly bakes last month's recipe whenever the network hiccups.
    return { ...blank(), name: (tab.name || '') as string, linked: true, problem: PROBLEMS.missing };
  }

  const rows = (Array.isArray(source.ingredients) ? source.ingredients : []) as Row[];
  // keepRows, not filter: a blank row that carried a divider line hands it to the row above.
  const usable = keepRows(rows, r => r && String(r.label || '').trim());
  if (!usable.length) {
    return { ...blank(), name: (source.name || tab.name || '') as string, linked: true, problem: PROBLEMS.empty };
  }

  const blocker = usable.find(r => !isWeighable(r));
  if (blocker) {
    return {
      ...blank(),
      name: (source.name || tab.name || '') as string,
      linked: true,
      problem: PROBLEMS.unweighable,
      problemRow: String(blocker.label || '').trim(),
      rowCount: usable.length, // only for the Recipes list's «N ingredients» (ingredientCount)
    };
  }

  // ⚠️ THE KEY IS THE ROW'S OWN `rid`, NEVER ITS NAME AND NEVER ITS POSITION. By name, renaming "Yeast" to
  // "Fresh yeast" silently switches the leavening knob off — and that is not hypothetical: the real
  // Sourdough calls its leavening "Starter" in the Calculator and "Sourdough starter" in the Catalogue
  // TODAY. By position, inserting one row at the top makes the yeast step ask for the flour.
  //
  // ⚠️ THE AMOUNT IS READ IN ITS OWN UNIT (rowGrams): «1 kg» of flour is 1000 g, «0,65 l» of water 650 g.
  const ingredients = usable.map(r => ({
    key: ridOf(r) || String((r as NonNullable<Row>).label || '').trim(),
    label: String((r as NonNullable<Row>).label || '').trim(),
    grams: rowGrams(r),
  }));

  const wanted = String(tab.leaveningRid || '').trim();
  const leaveningKey = wanted && ingredients.some(i => i.key === wanted) ? wanted : null;

  // ⚠️ A SEPARATE LIST, NEVER A FLAG ON `ingredients`: those rows flow into sheetRecipe() and from there into the
  // saved Dough history, which must not learn about lines drawn on a PDF.
  const dividersAfter = usable.flatMap((r, i) => ((r as NonNullable<Row>).dividerAfter === true ? [i] : []));

  return {
    name: (source.name || tab.name || '') as string,
    ingredients,
    leaveningKey,
    ...(dividersAfter.length ? { dividersAfter } : {}),
    linked: true,
    problem: null,
    problemRow: '',
  };
}

// The recipe a SAVED dough is built and frozen from: the tab with its ingredients and leavening swapped for
// the resolved ones.
//
// ⚠️ THE LOG MUST SAVE WHAT THE SCREEN SHOWED. The screen scales from the resolved recipe; buildSheet and
// recipeSnapshot read recipe.ingredients, which on a linked tab is only the stale leftover copy — so a
// corrected Catalogue recipe showed new grams while Dough history stored the old ones (or zeros). An
// unlinked tab is returned untouched. The tab keeps its own name, id, logic and percentages.
export function sheetRecipe<T>(recipe: T, resolved: ResolvedRecipe | null | undefined): T {
  if (!recipe || !isLinked(recipe) || !resolved) return recipe;
  return { ...recipe, ingredients: resolved.ingredients, leaveningKey: resolved.leaveningKey };
}

// ⚠️ A TAB THAT CANNOT BE CALCULATED MUST BE ASKED ABOUT, NOT GUESSED AT. This is the one function every
// screen should call before showing a number — an answer that LOOKS complete and is not is worse than no
// answer.
export function canCalculate(resolved: ResolvedRecipe | null | undefined): boolean {
  return !!resolved && !resolved.problem && resolved.ingredients.length > 0;
}

// Does the tab show the sentence saying why it cannot be calculated?
//
// ⚠️ A REFUSAL THAT SAYS NOTHING READS AS A BROKEN APP. The tab used to refuse in silence — the total typed, no
// ingredient, no sentence — and the reason came out only after Confirm (Panificio Miano, 30 Oct 2026: «Le ricette nel
// calcolatore non funzionano»; current app 6713adab). Only a LINKED tab: an own recipe with no rows is still being
// written in Settings. And not while the recipe is on its way, which is not «it is gone».
export function showsSourceProblem(recipe: unknown, resolved: Partial<ResolvedRecipe> | null | undefined, stillLoading: unknown): boolean {
  return isLinked(recipe) && !!resolved?.problem && !stillLoading;
}

// Settings → Recipes: the leavening dropdown's answer, written on the tab being edited (a working copy, changed
// IN PLACE like the original's). `value` is the option's value — '' for «nothing rises», a row key, or
// '#<index>' for an own row that has no key yet. `linkedRows` is the resolved Catalogue list when the tab is
// linked, null when it carries its own. Returns true when the choice was understood.
//
// ⚠️ A LINKED CHOICE IS LOOKED UP IN THE CATALOGUE ROWS IT WAS OFFERED FROM (the current app once looked it up
// in the tab's own leftover list, where a Catalogue row id is never found). Mise 2's editor keeps its own
// copy-returning twin, app/src/calculator/recipesModel.ts chooseLeavening, which must say the same.
type LeaveningTab = {
  ingredients?: unknown; leaveningKey?: unknown; leaveningRid?: unknown;
  leaveningDefaultPct?: unknown; baselinePct?: unknown;
};
type OwnRow = { key?: string; label?: string } | null | undefined;
export function chooseLeavening(recipe: unknown, value: unknown, linkedRows: readonly { key?: unknown }[] | null | undefined): boolean {
  const tab = recipe as LeaveningTab | null | undefined;
  if (!tab) return false;
  const picked = String(value || '');
  if (!picked) {
    if (linkedRows) tab.leaveningRid = null; else tab.leaveningKey = null;
    return true;
  }

  if (linkedRows) {
    if (!linkedRows.some(row => row && row.key === picked)) return false;
    tab.leaveningRid = picked;
  } else {
    const own: OwnRow[] = Array.isArray(tab.ingredients) ? tab.ingredients as OwnRow[] : [];
    const index = picked.startsWith('#') ? Number(picked.slice(1)) : -1;
    const ing = index >= 0 ? own[index] : own.find(i => i && i.key === picked);
    if (!ing) return false;
    // An ingredient with no key cannot be pointed at yet; it gets one the moment it is chosen.
    if (!ing.key) {
      ing.key = (ing.label || 'ing').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + own.indexOf(ing);
    }
    tab.leaveningKey = ing.key;
  }
  if (!tab.leaveningDefaultPct) tab.leaveningDefaultPct = 1;
  // ⚠️ A LINKED PICK RESTARTS THE BASELINE AT THE STARTING %. The baseline is the % at which the rows' grams are
  // written; one left on the tab from before it was linked describes its OLD own recipe, and would silently
  // change the Catalogue's yeast at the very % every phone starts from (0.65 kept, 0.8 start → ×1.23).
  if (linkedRows || tab.baselinePct == null) tab.baselinePct = tab.leaveningDefaultPct;
  return true;
}

// ⚠️ AND A LINKED RECIPE WHOSE LEAVENING IS GONE SAYS SO. The dough still calculates — every other
// ingredient is there — but the knob must not silently scale nothing while the screen goes on showing it.
export function leaveningLost(recipe: unknown, resolved: Partial<ResolvedRecipe> | null | undefined): boolean {
  return isLinked(recipe)
    && !!String((recipe as Tab)?.leaveningRid || '').trim()
    && !resolved?.problem
    && !resolved?.leaveningKey;
}
