// favourite-suppliers.js — pure helpers for the venue's favourite suppliers (config/orders
// `favouriteSuppliers`). No DOM, no Firestore: the screen and the data layer call these.

export const MAX_FAVOURITES = 300;

// A stored value → a clean list of ids: unique, non-empty strings, order kept, capped.
// Anything that is not an array (missing field, corrupt value) is «no favourites».
export function normalizeFavourites(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const id of value) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_FAVOURITES) break;
  }
  return out;
}

// Splits suppliers into the starred ones and the rest, each in the input order. An id in the
// list that matches no supplier (a deleted one) is ignored.
export function splitByFavourite(suppliers, favouriteIds) {
  const starred = new Set(normalizeFavourites(favouriteIds));
  const favourites = [];
  const others = [];
  for (const supplier of Array.isArray(suppliers) ? suppliers : []) {
    (starred.has(supplier?.id) ? favourites : others).push(supplier);
  }
  return { favourites, others };
}
