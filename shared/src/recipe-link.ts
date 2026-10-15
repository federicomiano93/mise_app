// recipe-link.ts — the way from a recipe to its Food cost product, and back: the judgement both sides must make
// identically, and (new in Mise 2) the addresses.
//
// TypeScript PARTIAL port of js/recipe-link.js for Mise 2. Behaviour is identical, input for input, for the three
// functions ported; recipe-link.spec.ts runs every test against BOTH files. It is NOT paired in parity.spec.ts,
// because the original also holds the page addresses of the current app.
//
// PORTED: `mayOpenFoodCost`, `mayOpenOrders`, `recipeIdFromHash` (with its private `cleanId`).
//
// LEFT OUT: `recipeHash`, `foodCostHref`, `recipeHref`, `ordersHref` and `catalogueOriginFromHash` — they build
// and read the page addresses of the current app (`foodcost.html#recipe=…`, `orders.html#from=…`); Mise 2 has
// routes instead, and Orders is not built in Mise 2.
//
// NEW IN MISE 2, NO ORIGINAL: `foodCostForRecipePath`, `recipeAddress`, `recipeIdParam` and `FROM_RECIPE_LINK`.
// Mise 2 is one page with real routes, so a recipe's Food cost is `/food-cost?recipe=<id>` (a query, not the
// fragment the current app needs for its service worker's sake: Mise 2's router owns the address) and the way
// back is `/recipes/<id>`.
//
// Federico, 13 Sep 2026: «aggiungi un tasto nella scheda ricetta che mi porta direttamente alla sua scheda food
// cost corrispondente».

import { isSectionAllowed } from './sections';
import { cardVisibleTo } from './home-cards';

// shared/ is compiled without the DOM types; URLSearchParams exists in every browser and in Node.
declare const URLSearchParams: new (init: string) => { get(name: string): string | null };

// A Firestore document id: not empty, no slash, not absurdly long. Anything else in the address is ignored
// rather than trusted — it only ever selects among ids already held.
function cleanId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return id && id.length <= 200 && !id.includes('/') ? id : null;
}

// The recipe id an address names, or null.
export function recipeIdFromHash(hash: unknown): string | null {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return null;
  let params: { get(name: string): string | null };
  try { params = new URLSearchParams(raw); } catch { return null; }
  return cleanId(params.get('recipe'));
}

// May this person open Orders in this venue? The same question js/auth-gate.js asks for orders.html: its section
// AND its card.
export function mayOpenOrders(locationDoc: unknown, canManage: unknown): boolean {
  if (!locationDoc || typeof locationDoc !== 'object') return false;
  return isSectionAllowed(locationDoc, 'orders')
    && cardVisibleTo(locationDoc, canManage === true, 'orders');
}

// May this person open Food cost in this venue?
//
// ⚠️ THE SAME QUESTION js/auth-gate.js ASKS BEFORE IT LETS ANYBODY STAY ON foodcost.html — a page that names its
// card is judged by its section AND its card. A button that answered differently would be a door that bounces its
// user straight back Home.
//
// ⚠️ NO VENUE, NO. Before the session has opened a venue there is nothing to judge by, and allowedSections() alone
// would answer «allowed» for a document that is not there.
export function mayOpenFoodCost(locationDoc: unknown, canManage: unknown): boolean {
  if (!locationDoc || typeof locationDoc !== 'object') return false;
  return isSectionAllowed(locationDoc, 'foodcost')
    && cardVisibleTo(locationDoc, canManage === true, 'foodcost');
}

// ── New in Mise 2, no original ────────────────────────────────────────────────

// The route state the recipe screen hands Food cost, so Food cost knows the recipe is the history entry behind it
// and Back can step to it instead of pushing a second copy.
export const FROM_RECIPE_LINK = Object.freeze({ fromRecipeLink: true });

// A recipe's Food cost, or null for an id that cannot be one.
export function foodCostForRecipePath(recipeId: unknown): string | null {
  const id = cleanId(recipeId);
  return id ? `/food-cost?recipe=${encodeURIComponent(id)}` : null;
}

// The recipe's own address, or null for an id that cannot be one.
export function recipeAddress(recipeId: unknown): string | null {
  const id = cleanId(recipeId);
  return id ? `/recipes/${encodeURIComponent(id)}` : null;
}

// The recipe id carried by one query (or fragment) parameter of an address's search string, or null. A leading `?`
// or `#` is allowed.
export function recipeIdParam(search: unknown, key: string): string | null {
  const raw = String(search ?? '').replace(/^[?#]/, '');
  if (!raw) return null;
  let params: { get(name: string): string | null };
  try { params = new URLSearchParams(raw); } catch { return null; }
  return cleanId(params.get(key));
}
