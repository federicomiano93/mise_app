// The addresses of Food cost, in one place so the section, the list's rows and the screens one
// level down cannot disagree.
//
//   /food-cost                       the list of products
//   /food-cost/new                   a new product
//   /food-cost/product/<id>          one product (the id percent-encoded)
//   /food-cost/product/<id>/history  that product's margin history
//   /food-cost/settings              the hourly labour cost (whoever runs the place)
//   anything else                    unknown: the section goes back to /food-cost
export const FOODCOST_PATH = '/food-cost';

export type FoodcostView =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'product'; readonly id: string }
  | { readonly kind: 'history'; readonly id: string }
  | { readonly kind: 'settings' }
  | { readonly kind: 'unknown' };

export const newPath = `${FOODCOST_PATH}/new`;
export const settingsPath = `${FOODCOST_PATH}/settings`;
export const productPath = (id: string): string => `${FOODCOST_PATH}/product/${encodeURIComponent(id)}`;
export const historyPath = (id: string): string => `${productPath(id)}/history`;

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

// The views that are drawn: an unknown address is only ever a redirect.
export type ShownView = Exclude<FoodcostView, { readonly kind: 'unknown' }>;

export type Resolved = { readonly redirect: string } | { readonly view: ShownView };

export function resolveFoodcostPath(rest: string | undefined): Resolved {
  const view = parseFoodcostPath(rest);
  if (view.kind === 'unknown') return { redirect: FOODCOST_PATH };
  return { view };
}
