// favourite-suppliers.ts — pure helpers for the venue's favourite suppliers (config/orders
// `favouriteSuppliers`). No DOM, no Firestore: the screen and the data layer call these.
//
// TypeScript port of js/orders/favourite-suppliers.js for Mise 2. Behaviour is identical, input
// for input: favourite-suppliers.spec.ts runs every test against BOTH files, parity.spec.ts
// compares their exports and odd-inputs.spec.ts feeds both the same strange values.

export const MAX_FAVOURITES = 300;

// A stored value → a clean list of ids: unique, non-empty strings, order kept, capped.
// Anything that is not an array (missing field, corrupt value) is «no favourites».
export function normalizeFavourites(value?: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_FAVOURITES) break;
  }
  return out;
}

// Splits suppliers into the starred ones and the rest, each in the input order. An id in the
// list that matches no supplier (a deleted one) is ignored. A supplier is data: whatever
// arrives in the list is handed back as it came.
export function splitByFavourite<T>(suppliers: readonly T[] | null | undefined, favouriteIds?: unknown): { favourites: T[]; others: T[] } {
  const starred = new Set<unknown>(normalizeFavourites(favouriteIds));
  const favourites: T[] = [];
  const others: T[] = [];
  for (const supplier of Array.isArray(suppliers) ? suppliers : []) {
    (starred.has((supplier as { id?: unknown } | null | undefined)?.id) ? favourites : others).push(supplier);
  }
  return { favourites, others };
}

// The heading keys are DATA the app maps to its own words; null = no heading.
export type FavouriteHeadingKey = 'orders.favourites.title' | 'orders.favourites.others' | null;

export interface FavouriteGroup<T> {
  headingKey: FavouriteHeadingKey;
  suppliers: T[];
}

// The groups a supplier list is drawn in, from rows the search and the filter have ALREADY
// cut down. No starred supplier in view = one group with no heading (the plain list). The
// heading is an i18n key, so the caller translates it inside its drawing code.
export function favouriteGroups<T>(visible: readonly T[] | null | undefined, favouriteIds?: unknown): FavouriteGroup<T>[] {
  const { favourites, others } = splitByFavourite(visible, favouriteIds);
  if (!favourites.length) return [{ headingKey: null, suppliers: others }];
  const groups: FavouriteGroup<T>[] = [{ headingKey: 'orders.favourites.title', suppliers: favourites }];
  if (others.length) groups.push({ headingKey: 'orders.favourites.others', suppliers: others });
  return groups;
}
