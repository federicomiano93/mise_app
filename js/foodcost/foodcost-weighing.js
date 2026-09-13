// foodcost-weighing.js — a recipe's dough weighed before the oven and after, typed on
// a product's recipe line. PURE: no DOM, no Firestore, no dictionary, so a test RUNS
// every rule below instead of reading the file for it (P15).
//
// Federico, 13 Sep 2026: «togli dalla scheda ricetta il peso crudo e cotto e
// aggiungilo nella scheda del food cost». Asked whether the loss belongs to the recipe
// or to each product, he chose THE RECIPE — so the number stays exactly where it was
// (`lossPct` on recipes/{id}, `rawGrams` and `cookedGrams` beside it) and the cost
// model, the recipe screen and the label read it unchanged. Only the place it is typed
// moved, from the catalogue's recipe editor to here.
//
// ⚠️ THIS FILE IMPORTS FROM js/catalogue/, as foodcost-model.js already does through
// recipe-cost-model.js: the arithmetic of a loss is the catalogue model's, and a copy
// of a CALCULATION is worse than a crossing — the price-model.js argument.
//
// ⚠️⚠️ THE TWO STATES CAME HERE WITH THE BOXES, AND THEY ARE STILL THE WHOLE SAFETY:
//   untouched — nobody has typed. The raw box follows the recipe's own ingredient
//     total, the cooked box is EMPTY unless the recipe was weighed, the screen names
//     what the recipe CARRIES, and no patch exists: opening a product must never move
//     what a recipe costs.
//   touched — a person has typed. The percentage comes from the boxes, and a patch
//     exists only once the two boxes actually answer the question.

import {
  weightLoss, normalizeWeight, normalizeLossPct, weighableTotalGrams, MAX_LOSS_PCT,
} from '../catalogue/catalogue-model.js';

// Where a recipe line starts, before anybody types.
//
// ⚠️ A RECIPE THAT HAS BEEN WEIGHED OPENS SHOWING WHAT WAS WEIGHED. Every other recipe
// opens with the cooked box empty: «nobody has weighed this» is the truth, and a number
// derived from a stored 0 read as «weighed, and it loses nothing» (24 Aug 2026).
export function startWeighing(recipe) {
  const raw = normalizeWeight(recipe && recipe.rawGrams);
  const cooked = normalizeWeight(recipe && recipe.cookedGrams);
  const weighed = raw > 0 && cooked > 0;
  return {
    raw: weighed ? raw : 0,
    cooked: weighed ? cooked : 0,
    // The raw box follows the recipe total until a person types in it, or until a
    // stored weighing says what it was.
    rawTyped: weighed,
    weighed,
    // Only a PERSON sets this, and nothing is ever written for a line where it is false.
    touched: false,
  };
}

// A person typed in the raw box. ⚠️ Clearing it hands the box back to the recipe total —
// the way out of an override, with no extra control on a screen already this long.
export function typeRaw(state, value) {
  const text = String(value ?? '').trim();
  return { ...state, raw: normalizeWeight(text), rawTyped: text !== '', weighed: true, touched: true };
}

export function typeCooked(state, value) {
  return { ...state, cooked: normalizeWeight(String(value ?? '').trim()), weighed: true, touched: true };
}

const lossIs = pct => ({ key: 'fc.lossIs', params: { pct: String(pct) } });

// What the boxes mean right now:
//
//   { rawShown, message, warning, patch }
//
// `message` and `warning` are { key, params }: dictionary keys the screen resolves.
// `patch` is what Save writes onto the recipe, or null.
export function readWeighing(recipe, state) {
  const total = weighableTotalGrams(recipe || { ingredients: [] });
  const raw = state.rawTyped ? normalizeWeight(state.raw) : normalizeWeight(total);
  const stored = normalizeLossPct(recipe && recipe.lossPct);
  // ⚠️⚠️ A STORED 0 IS «NOBODY HAS SAID», NOT «MEASURED ZERO», and the document cannot
  // tell the two apart — so an unweighed 0 gets no percentage sentence at all. «Loses
  // 0%» is the false statement that makes every baked product's cost per kilo too low.
  const storedMessage = stored > 0
    ? { key: 'fc.lossStored', params: { pct: String(stored) } }
    : { key: 'fc.lossNotYet', params: {} };
  const out = {
    rawShown: raw > 0 ? String(Math.round(raw)) : '',
    message: storedMessage,
    warning: null,
    patch: null,
  };

  if (!state.touched) {
    // ⚠️ WHAT THE RECIPE CARRIES, NOT WHAT ITS BOXES WORK OUT TO. The two can disagree
    // on an old document — the recipe editor used to store a pair whose cooked weight
    // was heavier, and keep the percentage it had — and the one that is COSTED is the
    // stored percentage, so that is the one the screen may state.
    if (state.weighed) out.message = lossIs(stored);
    return out;
  }

  const { pct, problem } = weightLoss(raw, state.cooked);
  out.warning = problem === 'cookedHeavier' ? { key: 'fc.lossCookedHeavier', params: {} }
    : problem === 'capped' ? { key: 'fc.lossCapped', params: { max: String(MAX_LOSS_PCT) } }
      : null;
  // ⚠️ NOT ZERO. Two numbers that do not answer the question leave the stored loss
  // alone — and keep SAYING it: a half-filled pair must not hide a real percentage.
  if (pct === null) return out;

  out.message = lossIs(pct);
  const cooked = normalizeWeight(state.cooked);
  const unchanged = pct === stored
    && raw === normalizeWeight(recipe && recipe.rawGrams)
    && cooked === normalizeWeight(recipe && recipe.cookedGrams);
  // Retyping the numbers a recipe already carries is not a change, and writing it would
  // record a margin point for something that did not happen.
  if (!unchanged) out.patch = { lossPct: pct, rawGrams: raw, cookedGrams: cooked };
  return out;
}

// The recipes as this screen must cost them: the stored ones, with every weighing a
// person has typed laid over the top. Without it the answer at the top of the product
// would show the OLD cost until after Save — and the margin history would record it.
export function withWeighings(tables, patches) {
  const ids = Object.keys(patches || {});
  if (!ids.length) return tables;
  const recipes = { ...((tables && tables.recipes) || {}) };
  for (const id of ids) {
    if (recipes[id]) recipes[id] = { ...recipes[id], ...patches[id] };
  }
  return { ...tables, recipes };
}

// What Save writes: one patch per recipe a person weighed on THIS product.
//
// ⚠️ ONLY FOR RECIPES STILL ON THE PRODUCT. A line weighed and then removed took its
// weighing with it; writing it anyway would change a recipe the person had just taken
// off the screen.
// ⚠️ ONLY FOR RECIPES THAT STILL EXIST. A patch on a deleted one is refused by the
// rules, and there is nothing left for it to describe.
export function weighingPatches(recipes, states, recipeIds) {
  const onProduct = new Set(recipeIds || []);
  const out = {};
  for (const [id, state] of Object.entries(states || {})) {
    if (!onProduct.has(id) || !state) continue;
    const recipe = recipes && Object.prototype.hasOwnProperty.call(recipes, id) ? recipes[id] : null;
    if (!recipe) continue;
    const { patch } = readWeighing(recipe, state);
    if (patch) out[id] = patch;
  }
  return out;
}

// How many OTHER products use a recipe — the ones a weighing typed here changes too,
// without anybody opening them. Said on screen, because the loss belongs to the recipe.
export function otherProductsUsing(products, recipeId, productId) {
  return (products || []).filter(p => p
    && p.id !== productId
    && (p.components || []).some(c => c && c.recipeId === recipeId)).length;
}
