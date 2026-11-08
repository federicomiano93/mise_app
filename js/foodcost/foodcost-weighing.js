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
//   untouched — nobody has typed. Both boxes are EMPTY unless the recipe was weighed, the
//     screen names what the recipe CARRIES, and no patch exists: opening a product must
//     never move what a recipe costs.
//   touched — a person has typed. The percentage comes from the boxes, and a patch
//     exists only once BOTH boxes hold a weight.
//
// ⚠️ THE RAW BOX NO LONGER FOLLOWS THE RECIPE'S INGREDIENT TOTAL (Federico, Nov 2026):
// until a person has written BOTH weights the system takes the recipe's whole weight, that
// is, NO loss. Filling the raw box with the total — and costing with it — made one typed
// cooked weight enough to invent a loss nobody had measured.

import {
  weightLoss, normalizeWeight, normalizeLossPct, MAX_LOSS_PCT,
} from '../catalogue/catalogue-model.js';

// Where a recipe line starts, before anybody types.
//
// ⚠️ A RECIPE THAT HAS BEEN WEIGHED OPENS SHOWING WHAT WAS WEIGHED. Every other recipe
// opens with both boxes empty: «nobody has weighed this» is the truth, and a number
// derived from a stored 0 read as «weighed, and it loses nothing» (24 Aug 2026).
export function startWeighing(recipe) {
  const raw = normalizeWeight(recipe && recipe.rawGrams);
  const cooked = normalizeWeight(recipe && recipe.cookedGrams);
  const weighed = raw > 0 && cooked > 0;
  return {
    raw: weighed ? raw : 0,
    cooked: weighed ? cooked : 0,
    weighed,
    // Only a PERSON sets this, and nothing is ever written for a line where it is false.
    touched: false,
  };
}

// A person typed in the raw box. ⚠️ Clearing it empties the box, and an emptied box leaves
// the pair unfinished: no patch, and the stored loss stays as it is.
export function typeRaw(state, value) {
  return { ...state, raw: normalizeWeight(String(value ?? '').trim()), weighed: true, touched: true };
}

export function typeCooked(state, value) {
  return { ...state, cooked: normalizeWeight(String(value ?? '').trim()), weighed: true, touched: true };
}

const lossIs = pct => ({ key: 'fc.lossIs', params: { pct: String(pct) } });
const cookedHeavier = { key: 'fc.lossCookedHeavier', params: {} };

// What the boxes mean right now:
//
//   { message, warning, patch, keepsOnly }
//
// `message` and `warning` are { key, params }: dictionary keys the screen resolves.
// `patch` is what Save writes onto the recipe, or null. `keepsOnly` is true when the patch
// only KEEPS the two numbers a person typed and leaves the loss exactly as it was.
export function readWeighing(recipe, state) {
  const raw = normalizeWeight(state.raw);
  const stored = normalizeLossPct(recipe && recipe.lossPct);
  // ⚠️⚠️ A STORED 0 IS «NOBODY HAS SAID», NOT «MEASURED ZERO», and the document cannot
  // tell the two apart — so an unweighed 0 gets no percentage sentence at all. «Loses
  // 0%» is the false statement that makes every baked product's cost per kilo too low.
  const storedMessage = stored > 0
    ? { key: 'fc.lossStored', params: { pct: String(stored) } }
    : { key: 'fc.lossNotYet', params: {} };
  const out = {
    message: storedMessage,
    warning: null,
    patch: null,
    keepsOnly: false,
  };
  const cooked = normalizeWeight(state.cooked);
  const storedRaw = normalizeWeight(recipe && recipe.rawGrams);
  const storedCooked = normalizeWeight(recipe && recipe.cookedGrams);

  if (!state.touched) {
    // ⚠️ WHAT THE RECIPE CARRIES, NOT WHAT ITS BOXES WORK OUT TO. The two can disagree
    // on an old document — the recipe editor used to store a pair whose cooked weight
    // was heavier, and keep the percentage it had — and the one that is COSTED is the
    // stored percentage, so that is the one the screen may state.
    // ⚠️ A KEPT WRONG PAIR OPENS RED AGAIN (Federico, Nov 2026): the numbers are kept
    // on purpose, so the warning that went with them must come back with them, even
    // though nobody has typed. And it states what is COSTED — never «loses 0%» for a
    // recipe that was never given a loss.
    if (state.weighed) {
      if (weightLoss(raw, cooked).problem === 'cookedHeavier') out.warning = cookedHeavier;
      else out.message = lossIs(stored);
    }
    return out;
  }

  const { pct, problem } = weightLoss(raw, cooked);
  out.warning = problem === 'cookedHeavier' ? cookedHeavier
    : problem === 'capped' ? { key: 'fc.lossCapped', params: { max: String(MAX_LOSS_PCT) } }
      : null;

  if (pct === null) {
    // ⚠️ A WRONG PAIR IS KEPT, IN RED, AND COSTS NOTHING NEW. Federico, Nov 2026: he typed
    // a cooked weight above the raw one, saved, and the numbers were gone when he came back.
    // Both boxes hold a weight, so both are written — but the loss is the recipe's
    // STORED one, untouched: a typo must never make a product look cheaper.
    // ⚠️ THE PATCH CARRIES NO `lossPct` AT ALL, not even the stored one: it is whatever THIS
    // phone last saw, and sending it back could overwrite a correct weighing another phone
    // has saved since. Only the two numbers that were typed travel.
    if (problem === 'cookedHeavier'
      && !(raw === storedRaw && cooked === storedCooked)) {
      out.patch = { rawGrams: raw, cookedGrams: cooked };
      out.keepsOnly = true;
    }
    // ⚠️ ONE BOX ALONE SAYS SO, in words: «weigh the baked dough» used to be enough, and now
    // a loss is worked out only from the two weights together.
    if (problem === null && (raw > 0) !== (cooked > 0)) out.message = { key: 'fc.lossNeedBoth', params: {} };
    // ⚠️ NOT ZERO. Two numbers that do not answer the question leave the stored loss
    // alone — and keep SAYING it: a half-filled pair must not hide a real percentage.
    return out;
  }

  out.message = lossIs(pct);
  const unchanged = pct === stored && raw === storedRaw && cooked === storedCooked;
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
  return collectWeighings(recipes, states, recipeIds).patches;
}

// Whether any of those patches changes what a product COSTS — which is what a margin point
// records. ⚠️ A KEPT WRONG PAIR (cooked heavier than raw) writes the two numbers and leaves
// the loss alone, so it changes nothing: recording it would put a point on the history for
// something that did not happen.
export function weighingsChangeCost(recipes, states, recipeIds) {
  return collectWeighings(recipes, states, recipeIds).changesCost;
}

function collectWeighings(recipes, states, recipeIds) {
  const onProduct = new Set(recipeIds || []);
  const patches = {};
  let changesCost = false;
  for (const [id, state] of Object.entries(states || {})) {
    if (!onProduct.has(id) || !state) continue;
    const recipe = recipes && Object.prototype.hasOwnProperty.call(recipes, id) ? recipes[id] : null;
    if (!recipe) continue;
    const { patch, keepsOnly } = readWeighing(recipe, state);
    if (!patch) continue;
    patches[id] = patch;
    if (!keepsOnly) changesCost = true;
  }
  return { patches, changesCost };
}

// What a recipe must look like again after the database REFUSED a weighing — or null,
// when it must be left as it is.
//
// ⚠️ ONLY IF NOTHING NEWER HAS LANDED. The recipes listener may already have delivered
// somebody else's weighing by the time the refusal arrives, and rolling back over it
// would throw a real number away to put an older one back.
// ⚠️ A FIELD THE RECIPE DID NOT HAVE BEFORE IS REMOVED, never set to 0: an absent
// rawGrams means «never weighed», and a 0 would be a claim somebody weighed nothing.
const LOSS_FIELDS = Object.freeze(['lossPct', 'rawGrams', 'cookedGrams']);

// ⚠️ ONLY THE FIELDS THE PATCH CARRIED: a kept wrong pair carries two, and the loss it never
// sent is neither compared nor rolled back.
export function restoreAfterRefusal(now, prev, patch) {
  if (!now || !prev || !patch) return null;
  const fields = LOSS_FIELDS.filter(k => Object.prototype.hasOwnProperty.call(patch, k));
  if (!fields.length) return null;
  if (!fields.every(k => now[k] === patch[k])) return null;
  const restored = { ...now };
  for (const k of fields) {
    if (Object.prototype.hasOwnProperty.call(prev, k)) restored[k] = prev[k];
    else delete restored[k];
  }
  return restored;
}

// How many OTHER products use a recipe — the ones a weighing typed here changes too,
// without anybody opening them. Said on screen, because the loss belongs to the recipe.
// ⚠️ NOT THE FINISHED PRODUCTS: one marked «no weight loss» lays the loss aside, so a loss
// typed here moves nothing of what it costs.
export function otherProductsUsing(products, recipeId, productId) {
  return (products || []).filter(p => p
    && p.id !== productId
    && p.noWeightLoss !== true
    && (p.components || []).some(c => c && c.recipeId === recipeId)).length;
}
