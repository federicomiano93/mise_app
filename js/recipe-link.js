// recipe-link.js — the way from a recipe to its Food cost product, and back.
//
// Federico, 13 Sep 2026: «aggiungi un tasto nella scheda ricetta che mi porta
// direttamente alla sua scheda food cost corrispondente». Two features meet here, and
// neither may import the other's folder — so the ADDRESS they share lives in js/ root,
// pure, together with the one judgement both sides must make identically: may this
// person open Food cost at all.
//
// ⚠️ A FRAGMENT (#recipe=<id>), NEVER A QUERY (?recipe=<id>). The service worker looks a
// page up in its cache by the exact request (sw.js), and a query string is part of the
// request: offline, `foodcost.html?recipe=x` would find nothing and show the browser's
// own error page. A fragment never leaves the browser, so the cached page is found —
// the same reason the join link carries its code after a `#`.

import { isSectionAllowed } from './sections.js';
import { cardVisibleTo } from './home-cards.js';

const KEY = 'recipe';

// A Firestore document id: not empty, no slash, not absurdly long. Anything else in the
// address is ignored rather than trusted — it only ever selects among ids already held.
function cleanId(value) {
  const id = String(value ?? '').trim();
  return id && id.length <= 200 && !id.includes('/') ? id : null;
}

export function recipeHash(recipeId) {
  const id = cleanId(recipeId);
  return id ? `#${KEY}=${encodeURIComponent(id)}` : '';
}

// The recipe's Food cost, and the way back to the recipe.
export function foodCostHref(recipeId) { return `foodcost.html${recipeHash(recipeId)}`; }
export function recipeHref(recipeId) { return `catalogue.html${recipeHash(recipeId)}`; }

// The recipe id an address names, or null.
export function recipeIdFromHash(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return null;
  let params;
  try { params = new URLSearchParams(raw); } catch (e) { return null; }
  return cleanId(params.get(KEY));
}

// May this person open Food cost in this venue?
//
// ⚠️ THE SAME QUESTION js/auth-gate.js ASKS BEFORE IT LETS ANYBODY STAY ON foodcost.html —
// a page that names its card is judged by its section AND its card. A button that
// answered differently would be a door that bounces its user straight back Home.
//
// ⚠️ NO VENUE, NO. Before the session has opened a venue there is nothing to judge by,
// and allowedSections() alone would answer «allowed» for a document that is not there.
export function mayOpenFoodCost(locationDoc, canManage) {
  if (!locationDoc || typeof locationDoc !== 'object') return false;
  return isSectionAllowed(locationDoc, 'foodcost')
    && cardVisibleTo(locationDoc, canManage === true, 'foodcost');
}
