// calculator-recipe-source.ts — where a Calculator tab's ingredients come from. PURE: no DOM, no Firestore.
//
// TypeScript FULL port of js/calculator-recipe-source.js for Mise 2. Behaviour is identical, input for
// input, with ONE intended difference: `resolveRecipe` reads a linked row in kilos as grams × 1000 (18 Oct
// 2026, see there). calculator-recipe-source.spec.ts runs every test against BOTH files, parity.spec.ts
// compares their exports and odd-inputs.spec.ts feeds both the same strange values (none with a kg row).
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
  linked: boolean;
  problem: RecipeProblem | null;
  problemRow: string;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Loose views of the inputs: every field is read defensively, as in the original.
type Row = { unit?: unknown; grams?: unknown; label?: unknown } | null | undefined;
type Tab = { catalogueId?: unknown; name?: unknown; ingredients?: unknown; leaveningKey?: unknown; leaveningRid?: unknown } | null | undefined;

// Is this row something the Calculator can scale? The Calculator works in grams and multiplies everything
// by one factor; a row measured in pieces or "to taste" has no weight to multiply.
//
// ⚠️ IT BLOCKS THE WHOLE RECIPE AND NAMES THE ROW (decided 1 Aug 2026). Skipping it would produce a dough
// that is quietly light by exactly that ingredient — the one direction a recipe must not be wrong in.
export function isWeighable(row: unknown): boolean {
  const r = row as Row;
  const unit = String(r?.unit || '').trim().toLowerCase();
  if (unit && unit !== 'g' && unit !== 'gr' && unit !== 'kg') return false;
  return num(r?.grams) > 0;
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
  const usable = rows.filter(r => r && String(r.label || '').trim());
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
    };
  }

  // ⚠️ THE KEY IS THE ROW'S OWN `rid`, NEVER ITS NAME AND NEVER ITS POSITION. By name, renaming "Yeast" to
  // "Fresh yeast" silently switches the leavening knob off — and that is not hypothetical: the real
  // Sourdough calls its leavening "Starter" in the Calculator and "Sourdough starter" in the Catalogue
  // TODAY. By position, inserting one row at the top makes the yeast step ask for the flour.
  //
  // ⚠️ A ROW IN KILOS IS READ AS GRAMS × 1000 (NEW IN MISE 2, 18 Oct 2026). isWeighable accepts `kg`, but the original
  // read the amount as it stands, so «1 kg» of flour became 1 g: a dough a thousand times too light, with no warning.
  // This is the one intended difference from js/calculator-recipe-source.js, whose fix for the live app is a separate
  // change; until it lands the two files disagree on a `kg` row (and only there).
  const ingredients = usable.map(r => ({
    key: ridOf(r) || String((r as NonNullable<Row>).label || '').trim(),
    label: String((r as NonNullable<Row>).label || '').trim(),
    grams: num((r as NonNullable<Row>).grams) * (String((r as NonNullable<Row>).unit || '').trim().toLowerCase() === 'kg' ? 1000 : 1),
  }));

  const wanted = String(tab.leaveningRid || '').trim();
  const leaveningKey = wanted && ingredients.some(i => i.key === wanted) ? wanted : null;

  return {
    name: (source.name || tab.name || '') as string,
    ingredients,
    leaveningKey,
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
