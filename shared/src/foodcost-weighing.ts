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
//   untouched — nobody has typed. The raw box follows the recipe's own ingredient total, the cooked box is
//     EMPTY unless the recipe was weighed, the screen names what the recipe CARRIES, and no patch exists:
//     opening a product must never move what a recipe costs.
//   touched — a person has typed. The percentage comes from the boxes, and a patch exists only once the two
//     boxes actually answer the question.

import {
  weightLoss, normalizeWeight, normalizeLossPct, weighableTotalGrams, MAX_LOSS_PCT,
} from './catalogue-model';

// Anything at all may arrive (a document is data), so what is read off a recipe is `unknown` and read the
// way the original reads it.
type Loose = Readonly<Record<string, unknown>>;

export interface WeighingState {
  raw: number;
  cooked: number;
  // The raw box follows the recipe total until a person types in it, or until a stored weighing says what
  // it was.
  rawTyped: boolean;
  weighed: boolean;
  // Only a PERSON sets this, and nothing is ever written for a line where it is false.
  touched: boolean;
}

// What Save writes onto the recipe.
export interface WeighingPatch {
  lossPct: number;
  rawGrams: number;
  cookedGrams: number;
}

// { key, params }: dictionary keys the screen resolves.
export type WeighingMessage =
  | { key: 'fc.lossIs'; params: { pct: string } }
  | { key: 'fc.lossStored'; params: { pct: string } }
  | { key: 'fc.lossNotYet'; params: Record<string, never> };

export type WeighingWarning =
  | { key: 'fc.lossCookedHeavier'; params: Record<string, never> }
  | { key: 'fc.lossCapped'; params: { max: string } };

export interface WeighingReading {
  rawShown: string;
  message: WeighingMessage;
  warning: WeighingWarning | null;
  patch: WeighingPatch | null;
}

// Where a recipe line starts, before anybody types.
//
// ⚠️ A RECIPE THAT HAS BEEN WEIGHED OPENS SHOWING WHAT WAS WEIGHED. Every other recipe opens with the
// cooked box empty: «nobody has weighed this» is the truth, and a number derived from a stored 0 read as
// «weighed, and it loses nothing» (24 Aug 2026).
export function startWeighing(recipe: unknown): WeighingState {
  const r = recipe as Loose | null | undefined;
  const raw = normalizeWeight(r && r.rawGrams);
  const cooked = normalizeWeight(r && r.cookedGrams);
  const weighed = raw > 0 && cooked > 0;
  return {
    raw: weighed ? raw : 0,
    cooked: weighed ? cooked : 0,
    rawTyped: weighed,
    weighed,
    touched: false,
  };
}

// A person typed in the raw box. ⚠️ Clearing it hands the box back to the recipe total — the way out of an
// override, with no extra control on a screen already this long.
export function typeRaw(state: WeighingState, value: unknown): WeighingState {
  const text = String(value ?? '').trim();
  return { ...state, raw: normalizeWeight(text), rawTyped: text !== '', weighed: true, touched: true };
}

export function typeCooked(state: WeighingState, value: unknown): WeighingState {
  return { ...state, cooked: normalizeWeight(String(value ?? '').trim()), weighed: true, touched: true };
}

const lossIs = (pct: number): WeighingMessage => ({ key: 'fc.lossIs', params: { pct: String(pct) } });

// What the boxes mean right now:
//
//   { rawShown, message, warning, patch }
//
// `message` and `warning` are { key, params }: dictionary keys the screen resolves. `patch` is what Save
// writes onto the recipe, or null.
export function readWeighing(recipe: unknown, state: WeighingState): WeighingReading {
  const r = recipe as Loose | null | undefined;
  const total = weighableTotalGrams(recipe || { ingredients: [] });
  const raw = state.rawTyped ? normalizeWeight(state.raw) : normalizeWeight(total);
  const stored = normalizeLossPct(r && r.lossPct);
  // ⚠️⚠️ A STORED 0 IS «NOBODY HAS SAID», NOT «MEASURED ZERO», and the document cannot tell the two apart —
  // so an unweighed 0 gets no percentage sentence at all. «Loses 0%» is the false statement that makes
  // every baked product's cost per kilo too low.
  const storedMessage: WeighingMessage = stored > 0
    ? { key: 'fc.lossStored', params: { pct: String(stored) } }
    : { key: 'fc.lossNotYet', params: {} };
  const out: WeighingReading = {
    rawShown: raw > 0 ? String(Math.round(raw)) : '',
    message: storedMessage,
    warning: null,
    patch: null,
  };

  if (!state.touched) {
    // ⚠️ WHAT THE RECIPE CARRIES, NOT WHAT ITS BOXES WORK OUT TO. The two can disagree on an old document —
    // the recipe editor used to store a pair whose cooked weight was heavier, and keep the percentage it
    // had — and the one that is COSTED is the stored percentage, so that is the one the screen may state.
    if (state.weighed) out.message = lossIs(stored);
    return out;
  }

  const { pct, problem } = weightLoss(raw, state.cooked);
  out.warning = problem === 'cookedHeavier' ? { key: 'fc.lossCookedHeavier', params: {} }
    : problem === 'capped' ? { key: 'fc.lossCapped', params: { max: String(MAX_LOSS_PCT) } }
      : null;
  // ⚠️ NOT ZERO. Two numbers that do not answer the question leave the stored loss alone — and keep
  // SAYING it: a half-filled pair must not hide a real percentage.
  if (pct === null) return out;

  out.message = lossIs(pct);
  const cooked = normalizeWeight(state.cooked);
  const unchanged = pct === stored
    && raw === normalizeWeight(r && r.rawGrams)
    && cooked === normalizeWeight(r && r.cookedGrams);
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
  const onProduct = new Set((recipeIds || []) as Iterable<unknown>);
  const out: Record<string, WeighingPatch> = {};
  for (const [id, state] of Object.entries((states || {}) as Record<string, WeighingState | null | undefined>)) {
    if (!onProduct.has(id) || !state) continue;
    const recipe = recipes && Object.prototype.hasOwnProperty.call(recipes, id) ? (recipes as Record<string, unknown>)[id] : null;
    if (!recipe) continue;
    const { patch } = readWeighing(recipe, state);
    if (patch) out[id] = patch;
  }
  return out;
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

export function restoreAfterRefusal(now: unknown, prev: unknown, patch: unknown): Record<string, unknown> | null {
  if (!now || !prev || !patch) return null;
  const current = now as Loose;
  const before = prev as Loose;
  const change = patch as Loose;
  if (!LOSS_FIELDS.every(k => current[k] === change[k])) return null;
  const restored: Record<string, unknown> = { ...current };
  for (const k of LOSS_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(before, k)) restored[k] = before[k];
    else delete restored[k];
  }
  return restored;
}

// How many OTHER products use a recipe — the ones a weighing typed here changes too, without anybody
// opening them. Said on screen, because the loss belongs to the recipe.
export function otherProductsUsing(products: unknown, recipeId: unknown, productId: unknown): number {
  type Card = { id?: unknown; components?: readonly ({ recipeId?: unknown } | null | undefined)[] } | null | undefined;
  return ((products || []) as readonly Card[]).filter(p => p
    && p.id !== productId
    && (p.components || []).some(c => c && c.recipeId === recipeId)).length;
}
