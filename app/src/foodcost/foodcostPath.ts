// The addresses of Food cost, in one place so the section, the list's rows and the screens one
// level down cannot disagree.
//
//   /food-cost                       the list of products
//   /food-cost/new                   a new product
//   /food-cost/product/<id>          one product (the id percent-encoded)
//   /food-cost/product/<id>/history  that product's margin history
//   /food-cost/settings              the hourly labour cost (whoever runs the place)
//   anything else                    unknown: the section goes back to /food-cost
//
// A recipe can lead here, and says so in the QUERY of the address (read with recipeIdParam; an id that
// cannot be one is ignored, which is the plain address):
//   /food-cost?recipe=<rid>          the ENTRY: «Loading…» that decides, once, where the recipe goes
//   /food-cost?using=<rid>           the list narrowed to the products made with that recipe
//   /food-cost/product/<id>?recipe=<rid>   the product the recipe opened (Back returns to the recipe)
//   /food-cost/new?recipe=<rid>      a new product prefilled from the recipe
//   /food-cost/product/<id>?using=<rid>    a product opened from the narrowed list (the column stays narrowed)
// The history of a product keeps whichever of the two its product had.
import { recipeIdParam } from '@mise/shared/recipe-link';

export const FOODCOST_PATH = '/food-cost';

// Where the person came from, when it was a recipe: at most one of the two is set.
export interface Origin {
  readonly recipe: string | null;
  readonly using: string | null;
}
export const NO_ORIGIN: Origin = { recipe: null, using: null };

export type FoodcostView =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'product'; readonly id: string }
  | { readonly kind: 'history'; readonly id: string }
  | { readonly kind: 'settings' }
  | { readonly kind: 'unknown' };

const queryOf = (origin: Origin): string => {
  if (origin.recipe !== null) return `?recipe=${encodeURIComponent(origin.recipe)}`;
  if (origin.using !== null) return `?using=${encodeURIComponent(origin.using)}`;
  return '';
};

export const newPath = `${FOODCOST_PATH}/new`;
export const settingsPath = `${FOODCOST_PATH}/settings`;
export const productPath = (id: string, origin: Origin = NO_ORIGIN): string =>
  `${FOODCOST_PATH}/product/${encodeURIComponent(id)}${queryOf(origin)}`;
export const historyPath = (id: string, origin: Origin = NO_ORIGIN): string =>
  `${FOODCOST_PATH}/product/${encodeURIComponent(id)}/history${queryOf(origin)}`;
export const entryPath = (recipeId: string): string => `${FOODCOST_PATH}${queryOf({ recipe: recipeId, using: null })}`;
export const usingPath = (recipeId: string): string => `${FOODCOST_PATH}${queryOf({ recipe: null, using: recipeId })}`;
export const newForRecipePath = (recipeId: string): string => `${newPath}${queryOf({ recipe: recipeId, using: null })}`;

// A segment as it was typed, back to the id it stands for; null when it is not valid percent-
// encoding («%», «%E0%A4%A»).
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// `rest` is what follows /food-cost in the address AS IT IS WRITTEN (the location's pathname with
// the section's path cut off): each segment is split first and decoded after, so a product id with
// a slash, a percent sign or a space in it (it is a Firestore document id) comes back whole. React
// Router's own «*» parameter is not used for this: it has already decoded the address once, and a
// «%» in an id would be decoded a second time.
export function parseFoodcostPath(rest: string | undefined): FoodcostView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  const [first, second, third] = parts;
  if (parts.length === 0) return { kind: 'list' };
  if (parts.length === 1 && first === 'new') return { kind: 'new' };
  if (parts.length === 1 && first === 'settings') return { kind: 'settings' };
  if (first === 'product' && second !== undefined && (parts.length === 2 || (parts.length === 3 && third === 'history'))) {
    const id = decoded(second);
    // An empty id is not a product (and not a Firestore document id either).
    if (id !== null && id !== '') return parts.length === 2 ? { kind: 'product', id } : { kind: 'history', id };
  }
  return { kind: 'unknown' };
}

// The views that are drawn: an unknown address is only ever a redirect. `entry` is the list's address
// with a recipe in its query: it draws «Loading…» and replaces itself.
export type ShownView =
  | Exclude<FoodcostView, { readonly kind: 'unknown' }>
  | { readonly kind: 'entry'; readonly recipeId: string };

export type Resolved = { readonly redirect: string } | { readonly view: ShownView; readonly origin: Origin };

// `search` is the address's query string as it is written. A recipe wins over a «using»; settings and an
// unknown address take no query.
export function resolveFoodcostPath(rest: string | undefined, search: string = ''): Resolved {
  const view = parseFoodcostPath(rest);
  if (view.kind === 'unknown') return { redirect: FOODCOST_PATH };
  if (view.kind === 'settings') return { view, origin: NO_ORIGIN };
  const recipe = recipeIdParam(search, 'recipe');
  if (view.kind === 'list' && recipe !== null) return { view: { kind: 'entry', recipeId: recipe }, origin: { recipe, using: null } };
  if (view.kind === 'new') return { view, origin: { recipe, using: null } };
  if (recipe !== null) return { view, origin: { recipe, using: null } };
  return { view, origin: { recipe: null, using: recipeIdParam(search, 'using') } };
}
