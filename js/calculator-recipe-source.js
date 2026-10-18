// calculator-recipe-source.js — where a Calculator tab's ingredients come from. PURE.
//
// Federico, 14 Aug 2026: «calculator non ha più ricette proprie ma le prende da
// recipe catalogue». One recipe, in one place, edited in one screen — instead of
// the two copies that exist today and silently disagree the moment one is fixed.
//
// ⚠️⚠️ IT READS BOTH SHAPES, AND THAT IS THE WHOLE POINT OF SHIPPING IT FIRST.
// The rule this project paid for in July: the data moved before the code could
// read it, and the app was left with no weights at all, for everybody. So the
// code that understands BOTH the old shape (a tab carrying its own ingredients)
// and the new one (a tab pointing at a Catalogue recipe) goes live FIRST, works
// with today's untouched data, and only then is anything linked.
//
// No DOM, no Firestore. Every rule below is asserted in a unit test, because the
// numbers it decides are how much dough gets made.

import { ridOf } from './catalogue/guided-model.js';
// The Catalogue's own unit table, never a copy of it: a second table is a second
// place for kg to drift. No new coupling either — guided-model.js above already
// imports catalogue-model.js, so this file depended on it before this import.
import { ingredientGrams } from './catalogue/catalogue-model.js';

// ── What can go wrong, named ─────────────────────────────────────────────────
//
// ⚠️ A LINKED RECIPE THAT CANNOT BE READ MUST REFUSE, NOT BAKE WITH NOTHING. An
// empty ingredient list computes perfectly happily and produces a dough of zero —
// which is the July defect wearing a different hat. Every problem below means the
// tab says what is wrong and calculates nothing.
export const PROBLEMS = Object.freeze({
  missing: 'missing',            // the Catalogue recipe is gone, or not loaded yet
  empty: 'empty',                // it exists but has no usable rows
  unweighable: 'unweighable',    // a row is a pinch / a piece / to taste
});

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const unitKey = row => String(row?.unit || '').trim().toLowerCase();

// A weighable row's amount IN GRAMS.
//
// ⚠️⚠️ THE CATALOGUE STORES THE NUMBER AS TYPED, IN ITS OWN UNIT. «Flour 1 kg» is
// saved as { grams: 1, unit: 'kg' } — the field is called `grams` for history,
// not because it holds grams. Copying it raw made a linked tab read 1 kg of flour
// as 1 g, and a 1720 g dough of Flour 1 kg / Water 700 g / Salt 20 g came out as
// 2 g of flour and almost all water, with no warning, frozen into the saved
// dough. The unit is read loosely (trimmed, any case, «gr») because the linked
// recipe arrives raw from Firestore, not through the Catalogue's normaliser.
// Rounded to the milligram so 1.005 kg reads 1005 g, not 1004.9999999999999 g.
function rowGrams(row) {
  const unit = unitKey(row);
  const g = ingredientGrams({ grams: num(row?.grams), unit: unit === 'gr' || !unit ? 'g' : unit });
  return Math.round(g * 1000) / 1000;
}

// Is this row something the Calculator can scale? The Calculator works in grams
// and multiplies everything by one factor; a row measured in pieces or "to taste"
// has no weight to multiply.
//
// ⚠️ IT BLOCKS THE WHOLE RECIPE AND NAMES THE ROW (decided 1 Aug 2026). Skipping
// it would produce a dough that is quietly light by exactly that ingredient —
// the one direction a recipe must not be wrong in.
export function isWeighable(row) {
  const unit = unitKey(row);
  if (unit && unit !== 'g' && unit !== 'gr' && unit !== 'kg') return false;
  return num(row?.grams) > 0;
}

// Which Catalogue recipes a Calculator config actually needs.
//
// ⚠️⚠️ THIS IS WHY THE CALCULATOR MUST NEVER WATCH THE WHOLE COLLECTION. The
// Catalogue is built for 500+ recipes and the Calculator needs three; a listener
// on the collection would turn every app open from 3 reads into 500+ (P14). The
// same mistake was made and corrected on the Home's order badge (v207).
export function linkedRecipeIds(recipes) {
  const ids = (recipes || [])
    .map(r => String(r?.catalogueId || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function isLinked(recipe) {
  return !!String(recipe?.catalogueId || '').trim();
}

// The effective recipe a Calculator tab should use.
//
// Returns { name, ingredients, leaveningKey, linked, problem, problemRow }.
// `ingredients` is always the Calculator's own shape — { key, label, grams } —
// whichever side it came from, so nothing downstream has to know the difference.
export function resolveRecipe(recipe, catalogueById) {
  if (!recipe) return blank();

  // ── The shape today: the tab carries its own ingredients ──────────────────
  // Untouched by this release. A tab nobody has linked keeps working exactly as
  // it does now, which is what lets this ship before any data moves.
  if (!isLinked(recipe)) {
    return {
      name: recipe.name || '',
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      leaveningKey: recipe.leaveningKey || null,
      linked: false,
      problem: null,
      problemRow: '',
    };
  }

  const source = (catalogueById || {})[String(recipe.catalogueId).trim()];
  if (!source) {
    // ⚠️ NOT A FALLBACK TO THE OLD COPY. A stale copy is exactly what this change
    // exists to remove, and using one here would mean the app quietly bakes last
    // month's recipe whenever the network hiccups. Better to say so.
    return { ...blank(), name: recipe.name || '', linked: true, problem: PROBLEMS.missing };
  }

  const rows = Array.isArray(source.ingredients) ? source.ingredients : [];
  const usable = rows.filter(r => r && String(r.label || '').trim());
  if (!usable.length) {
    return { ...blank(), name: source.name || recipe.name || '', linked: true, problem: PROBLEMS.empty };
  }

  const blocker = usable.find(r => !isWeighable(r));
  if (blocker) {
    return {
      ...blank(),
      name: source.name || recipe.name || '',
      linked: true,
      problem: PROBLEMS.unweighable,
      problemRow: String(blocker.label || '').trim(),
    };
  }

  // ⚠️ THE KEY IS THE ROW'S OWN `rid`, NEVER ITS NAME AND NEVER ITS POSITION.
  // By name, renaming "Yeast" to "Fresh yeast" silently switches the leavening
  // knob off — and that is not hypothetical: the real Sourdough calls its
  // leavening "Starter" in the Calculator and "Sourdough starter" in the
  // Catalogue TODAY. By position, inserting one row at the top makes the yeast
  // step ask for the flour. Guided mixing settled this already; this reuses it.
  const ingredients = usable.map(r => ({
    key: ridOf(r) || String(r.label || '').trim(),
    label: String(r.label || '').trim(),
    grams: rowGrams(r),
  }));

  const wanted = String(recipe.leaveningRid || '').trim();
  const leaveningKey = wanted && ingredients.some(i => i.key === wanted) ? wanted : null;

  return {
    name: source.name || recipe.name || '',
    ingredients,
    leaveningKey,
    linked: true,
    problem: null,
    problemRow: '',
  };
}

// The recipe a SAVED dough is built and frozen from: the tab with its ingredients
// and leavening swapped for the resolved ones.
//
// ⚠️ THE LOG MUST SAVE WHAT THE SCREEN SHOWED. The screen scales from the resolved
// recipe; buildSheet and recipeSnapshot read recipe.ingredients, which on a linked
// tab is only the stale leftover copy — so a corrected Catalogue recipe showed new
// grams while Dough history stored the old ones (or zeros). An unlinked tab is
// returned untouched. The tab keeps its own name, id, logic and percentages.
export function sheetRecipe(recipe, resolved) {
  if (!recipe || !isLinked(recipe) || !resolved) return recipe;
  return { ...recipe, ingredients: resolved.ingredients, leaveningKey: resolved.leaveningKey };
}

// ⚠️ A TAB THAT CANNOT BE CALCULATED MUST BE ASKED ABOUT, NOT GUESSED AT. This is
// the one function every screen should call before showing a number — the same
// shape as canLabel() on the allergen sheet, and for the same reason: an answer
// that LOOKS complete and is not is worse than no answer.
export function canCalculate(resolved) {
  return !!resolved && !resolved.problem && resolved.ingredients.length > 0;
}

// ⚠️ AND A LINKED RECIPE WHOSE LEAVENING IS GONE SAYS SO. The dough still
// calculates — every other ingredient is there — but the knob must not silently
// scale nothing while the screen goes on showing it.
export function leaveningLost(recipe, resolved) {
  return isLinked(recipe)
    && !!String(recipe?.leaveningRid || '').trim()
    && !resolved?.problem
    && !resolved?.leaveningKey;
}

function blank() {
  return { name: '', ingredients: [], leaveningKey: null, linked: false, problem: null, problemRow: '' };
}
