// foodcost-weighing.ts — a recipe's dough weighed before the oven and after, typed on a product's recipe
// line. PURE: no DOM, no Firestore, no dictionary, so a test RUNS every rule below instead of reading the
// file for it (P15).
//
// TypeScript port of js/foodcost/foodcost-weighing.js for Mise 2. Behaviour is identical, input for input:
// foodcost-weighing.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. It imports the arithmetic of a loss from
// catalogue-model.ts (the PARTIAL port: only what Food cost reads), as the original imports it from the
// catalogue's model — a copy of a CALCULATION is worse than a crossing.
//
// Federico, 13 Sep 2026: «togli dalla scheda ricetta il peso crudo e cotto e aggiungilo nella scheda del
// food cost». Asked whether the loss belongs to the recipe or to each product, he chose THE RECIPE — so the
// number stays exactly where it was (`lossPct` on recipes/{id}, `rawGrams` and `cookedGrams` beside it) and
// the cost model, the recipe screen and the label read it unchanged. Only the place it is typed moved, from
// the catalogue's recipe editor to here.
//
// ⚠️⚠️ THE TWO STATES CAME HERE WITH THE BOXES, AND THEY ARE STILL THE WHOLE SAFETY:
//   untouched — nobody has typed. Both boxes are EMPTY unless the recipe was weighed, the screen names what
//     the recipe CARRIES, and no patch exists: opening a product must never move what a recipe costs.
//   touched — a person has typed. The percentage comes from the boxes, and a patch exists only once BOTH
//     boxes hold a weight.
//
// ⚠️ THE RAW BOX NO LONGER FOLLOWS THE RECIPE'S INGREDIENT TOTAL (Federico, Nov 2026; current app df7e6313):
// until a person has written BOTH weights the system takes the recipe's whole weight, that is, NO loss.
// Filling the raw box with the total — and costing with it — made one typed cooked weight enough to invent a
// loss nobody had measured.
//
// ⚠️⚠️ AFTER THE SWITCH (Mise 2, 10 Nov 2026) Federico reversed the 13 Sep choice: «il calo è del prodotto».
// The product owns its raw and cooked weights (foodcost-model.ts, productCooking) and a recipe's loss no longer
// moves what a product saved in the new shape costs. What stays here is the recipe's OWN weighing — its label
// still reads it, and a product made of one recipe writes its loss back onto that recipe — and
// `otherProductsUsing`, which now counts only the products still read through a recipe's loss (post-switch:
// foodcost-weighing.spec.ts says where this file and js/foodcost/foodcost-weighing.js part).

import {
  weightLoss, normalizeWeight, normalizeLossPct, MAX_LOSS_PCT,
} from './catalogue-model';
import { isLegacyProduct } from './foodcost-model';

// Anything at all may arrive (a document is data), so what is read off a recipe is `unknown` and read the
// way the original reads it.
type Loose = Readonly<Record<string, unknown>>;

export interface WeighingState {
  raw: number;
  cooked: number;
  weighed: boolean;
  // Only a PERSON sets this, and nothing is ever written for a line where it is false.
  touched: boolean;
}

// What Save writes onto the recipe. ⚠️ A KEPT WRONG PAIR (cooked heavier than raw) carries NO `lossPct`: only the
// two numbers a person typed travel.
export interface WeighingPatch {
  lossPct?: number;
  rawGrams: number;
  cookedGrams: number;
}

// { key, params }: dictionary keys the screen resolves.
export type WeighingMessage =
  | { key: 'fc.lossIs'; params: { pct: string } }
  | { key: 'fc.lossStored'; params: { pct: string } }
  | { key: 'fc.lossNotYet'; params: Record<string, never> }
  | { key: 'fc.lossNeedBoth'; params: Record<string, never> };

export type WeighingWarning =
  | { key: 'fc.lossCookedHeavier'; params: Record<string, never> }
  | { key: 'fc.lossCapped'; params: { max: string } };

export interface WeighingReading {
  message: WeighingMessage;
  warning: WeighingWarning | null;
  patch: WeighingPatch | null;
  // True when the patch only KEEPS the two numbers a person typed and leaves the loss exactly as it was.
  keepsOnly: boolean;
}

// Where a recipe line starts, before anybody types.
//
// ⚠️ A RECIPE THAT HAS BEEN WEIGHED OPENS SHOWING WHAT WAS WEIGHED. Every other recipe opens with both
// boxes empty: «nobody has weighed this» is the truth, and a number derived from a stored 0 read as
// «weighed, and it loses nothing» (24 Aug 2026).
export function startWeighing(recipe: unknown): WeighingState {
  const r = recipe as Loose | null | undefined;
  const raw = normalizeWeight(r && r.rawGrams);
  const cooked = normalizeWeight(r && r.cookedGrams);
  const weighed = raw > 0 && cooked > 0;
  return {
    raw: weighed ? raw : 0,
    cooked: weighed ? cooked : 0,
    weighed,
    touched: false,
  };
}

// A person typed in the raw box. ⚠️ Clearing it empties the box, and an emptied box leaves the pair unfinished:
// no patch, and the stored loss stays as it is.
export function typeRaw(state: WeighingState, value: unknown): WeighingState {
  return { ...state, raw: normalizeWeight(String(value ?? '').trim()), weighed: true, touched: true };
}

export function typeCooked(state: WeighingState, value: unknown): WeighingState {
  return { ...state, cooked: normalizeWeight(String(value ?? '').trim()), weighed: true, touched: true };
}

const lossIs = (pct: number): WeighingMessage => ({ key: 'fc.lossIs', params: { pct: String(pct) } });
const cookedHeavier: WeighingWarning = { key: 'fc.lossCookedHeavier', params: {} };

// What the boxes mean right now:
//
//   { message, warning, patch, keepsOnly }
//
// `message` and `warning` are { key, params }: dictionary keys the screen resolves. `patch` is what Save writes
// onto the recipe, or null. `keepsOnly` is true when the patch only KEEPS the two numbers a person typed and
// leaves the loss exactly as it was.
export function readWeighing(recipe: unknown, state: WeighingState): WeighingReading {
  const r = recipe as Loose | null | undefined;
  const raw = normalizeWeight(state.raw);
  const stored = normalizeLossPct(r && r.lossPct);
  // ⚠️⚠️ A STORED 0 IS «NOBODY HAS SAID», NOT «MEASURED ZERO», and the document cannot tell the two apart —
  // so an unweighed 0 gets no percentage sentence at all. «Loses 0%» is the false statement that makes
  // every baked product's cost per kilo too low.
  const storedMessage: WeighingMessage = stored > 0
    ? { key: 'fc.lossStored', params: { pct: String(stored) } }
    : { key: 'fc.lossNotYet', params: {} };
  const out: WeighingReading = {
    message: storedMessage,
    warning: null,
    patch: null,
    keepsOnly: false,
  };
  const cooked = normalizeWeight(state.cooked);
  const storedRaw = normalizeWeight(r && r.rawGrams);
  const storedCooked = normalizeWeight(r && r.cookedGrams);

  if (!state.touched) {
    // ⚠️ WHAT THE RECIPE CARRIES, NOT WHAT ITS BOXES WORK OUT TO. The two can disagree on an old document —
    // the recipe editor used to store a pair whose cooked weight was heavier, and keep the percentage it
    // had — and the one that is COSTED is the stored percentage, so that is the one the screen may state.
    // ⚠️ A KEPT WRONG PAIR OPENS RED AGAIN (Federico, Nov 2026): the numbers are kept on purpose, so the
    // warning that went with them must come back with them, even though nobody has typed. And it states what
    // is COSTED — never «loses 0%» for a recipe that was never given a loss.
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
    // ⚠️ A WRONG PAIR IS KEPT, IN RED, AND COSTS NOTHING NEW. Federico, Nov 2026: he typed a cooked weight above
    // the raw one, saved, and the numbers were gone when he came back. Both boxes hold a weight, so both are
    // written — but the loss is the recipe's STORED one, untouched: a typo must never make a product look cheaper.
    // ⚠️ THE PATCH CARRIES NO `lossPct` AT ALL, not even the stored one: it is whatever THIS phone last saw, and
    // sending it back could overwrite a correct weighing another phone has saved since. Only the two numbers
    // that were typed travel.
    if (problem === 'cookedHeavier' && !(raw === storedRaw && cooked === storedCooked)) {
      out.patch = { rawGrams: raw, cookedGrams: cooked };
      out.keepsOnly = true;
    }
    // ⚠️ ONE BOX ALONE SAYS SO, in words: «weigh the baked dough» used to be enough, and now a loss is worked
    // out only from the two weights together.
    if (problem === null && (raw > 0) !== (cooked > 0)) out.message = { key: 'fc.lossNeedBoth', params: {} };
    // ⚠️ NOT ZERO. Two numbers that do not answer the question leave the stored loss alone — and keep SAYING
    // it: a half-filled pair must not hide a real percentage.
    return out;
  }

  out.message = lossIs(pct);
  const unchanged = pct === stored && raw === storedRaw && cooked === storedCooked;
  // Retyping the numbers a recipe already carries is not a change, and writing it would record a margin
  // point for something that did not happen.
  if (!unchanged) out.patch = { lossPct: pct, rawGrams: raw, cookedGrams: cooked };
  return out;
}

// The recipes as this screen must cost them: the stored ones, with every weighing a person has typed laid
// over the top. Without it the answer at the top of the product would show the OLD cost until after Save —
// and the margin history would record it.
export function withWeighings<T extends object>(tables: T, patches: unknown): T {
  const ids = Object.keys((patches || {}) as object);
  if (!ids.length) return tables;
  const recipes: Record<string, unknown> = { ...(((tables && (tables as Loose).recipes) || {}) as Record<string, unknown>) };
  for (const id of ids) {
    if (recipes[id]) recipes[id] = { ...(recipes[id] as object), ...(patches as Record<string, object>)[id] };
  }
  return { ...tables, recipes };
}

// What Save writes: one patch per recipe a person weighed on THIS product.
//
// ⚠️ ONLY FOR RECIPES STILL ON THE PRODUCT. A line weighed and then removed took its weighing with it;
// writing it anyway would change a recipe the person had just taken off the screen.
// ⚠️ ONLY FOR RECIPES THAT STILL EXIST. A patch on a deleted one is refused by the rules, and there is
// nothing left for it to describe.
export function weighingPatches(recipes: unknown, states: unknown, recipeIds: unknown): Record<string, WeighingPatch> {
  return collectWeighings(recipes, states, recipeIds).patches;
}

// Whether any of those patches changes what a product COSTS — which is what a margin point records.
// ⚠️ A KEPT WRONG PAIR (cooked heavier than raw) writes the two numbers and leaves the loss alone, so it changes
// nothing: recording it would put a point on the history for something that did not happen.
export function weighingsChangeCost(recipes: unknown, states: unknown, recipeIds: unknown): boolean {
  return collectWeighings(recipes, states, recipeIds).changesCost;
}

function collectWeighings(
  recipes: unknown, states: unknown, recipeIds: unknown,
): { patches: Record<string, WeighingPatch>; changesCost: boolean } {
  const onProduct = new Set((recipeIds || []) as Iterable<unknown>);
  const patches: Record<string, WeighingPatch> = {};
  let changesCost = false;
  for (const [id, state] of Object.entries((states || {}) as Record<string, WeighingState | null | undefined>)) {
    if (!onProduct.has(id) || !state) continue;
    const recipe = recipes && Object.prototype.hasOwnProperty.call(recipes, id) ? (recipes as Record<string, unknown>)[id] : null;
    if (!recipe) continue;
    const { patch, keepsOnly } = readWeighing(recipe, state);
    if (!patch) continue;
    patches[id] = patch;
    if (!keepsOnly) changesCost = true;
  }
  return { patches, changesCost };
}

// What a recipe must look like again after the database REFUSED a weighing — or null, when it must be left
// as it is.
//
// ⚠️ ONLY IF NOTHING NEWER HAS LANDED. The recipes listener may already have delivered somebody else's
// weighing by the time the refusal arrives, and rolling back over it would throw a real number away to put
// an older one back.
// ⚠️ A FIELD THE RECIPE DID NOT HAVE BEFORE IS REMOVED, never set to 0: an absent rawGrams means «never
// weighed», and a 0 would be a claim somebody weighed nothing.
const LOSS_FIELDS = Object.freeze(['lossPct', 'rawGrams', 'cookedGrams'] as const);

// ⚠️ ONLY THE FIELDS THE PATCH CARRIED: a kept wrong pair carries two, and the loss it never sent is neither
// compared nor rolled back.
export function restoreAfterRefusal(now: unknown, prev: unknown, patch: unknown): Record<string, unknown> | null {
  if (!now || !prev || !patch) return null;
  const current = now as Loose;
  const before = prev as Loose;
  const change = patch as Loose;
  const fields = LOSS_FIELDS.filter(k => Object.prototype.hasOwnProperty.call(change, k));
  if (!fields.length) return null;
  if (!fields.every(k => current[k] === change[k])) return null;
  const restored: Record<string, unknown> = { ...current };
  for (const k of fields) {
    if (Object.prototype.hasOwnProperty.call(before, k)) restored[k] = before[k];
    else delete restored[k];
  }
  return restored;
}

// How many OTHER products use a recipe — the ones a weighing typed here changes too, without anybody
// opening them. Said on screen, because the loss belongs to the recipe.
// ⚠️ NOT THE FINISHED PRODUCTS: one marked «no weight loss» lays the loss aside, so a loss typed here moves nothing of what
// it costs.
// ⚠️ MISE 2 (post-switch, 10 Nov 2026): NOR A PRODUCT SAVED IN THE NEW SHAPE (model 3) — its lines are raw dough at the raw
// price and it owns its loss, so a recipe's loss moves nothing of what it costs. Only a product the current app saved, still
// read through the recipe's loss until its next Save (fromLegacyProduct), is counted.
export function otherProductsUsing(products: unknown, recipeId: unknown, productId: unknown): number {
  type Card = { id?: unknown; noWeightLoss?: unknown; components?: readonly ({ recipeId?: unknown } | null | undefined)[] } | null | undefined;
  return ((products || []) as readonly Card[]).filter(p => p
    && p.id !== productId
    && p.noWeightLoss !== true
    && isLegacyProduct(p)
    && (p.components || []).some(c => c && c.recipeId === recipeId)).length;
}
