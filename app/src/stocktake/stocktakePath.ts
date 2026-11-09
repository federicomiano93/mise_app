import { isMonthId, monthKey } from '@mise/shared/inventory-model';

// The addresses of the Stocktake, in one place so the section, the month's arrows, a row and the
// screens one level down cannot disagree.
//
//   /stocktake                              no month named: the section lands on the current one
//   /stocktake/2026-10                      the counting list of that month
//   /stocktake/2026-10/product/<id>         one product of it (the id percent-encoded)
//   /stocktake/2026-10/cost                 «What the month cost»
//   anything else                           unknown: the section goes back to /stocktake
export const STOCKTAKE_PATH = '/stocktake';

// ⚠️ THE MONTH IS IN THE ADDRESS, so a phone that locks and reloads comes back to the month being
// counted, and Back out of a product lands on the same month. It is the id of the month's
// document (`YYYY-MM`), never a word or a date.
export type StocktakeView =
  | { readonly kind: 'start' }
  | { readonly kind: 'list'; readonly month: string }
  | { readonly kind: 'product'; readonly month: string; readonly id: string }
  | { readonly kind: 'cost'; readonly month: string }
  | { readonly kind: 'unknown' };

export const monthPath = (month: string): string => `${STOCKTAKE_PATH}/${month}`;
export const productPath = (month: string, id: string): string =>
  `${monthPath(month)}/product/${encodeURIComponent(id)}`;
export const costPath = (month: string): string => `${monthPath(month)}/cost`;

// The month of the clock, in LOCAL time (half past midnight on the 1st is already the new month).
//
// monthKey() is null only for a moment that is not a date, which the clock never gives; the
// fallback is a valid month so that no address built from it can loop.
export function currentMonthId(nowMs: number = Date.now()): string {
  return monthKey(nowMs) ?? '1970-01';
}

// A segment as it was typed, back to the id it stands for; null when it is not valid percent-
// encoding («%», «%E0%A4%A»).
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// `rest` is what follows /stocktake in the address AS IT IS WRITTEN (the location's pathname with
// the section's path cut off): each segment is split first and decoded after, so a product id with
// a slash, a percent sign or a space in it (it is a Firestore document id) comes back whole. React
// Router's own «*» parameter is not used for this: it has already decoded the address once, and a
// «%» in an id would be decoded a second time.
export function parseStocktakePath(rest: string | undefined): StocktakeView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  const [month, what, id] = parts;
  if (parts.length === 0) return { kind: 'start' };
  if (month === undefined || !isMonthId(month)) return { kind: 'unknown' };
  if (parts.length === 1) return { kind: 'list', month };
  if (parts.length === 2 && what === 'cost') return { kind: 'cost', month };
  if (parts.length === 3 && what === 'product' && id !== undefined) {
    const productId = decoded(id);
    // An empty id is not a product (and not a Firestore document id either).
    if (productId !== null && productId !== '') return { kind: 'product', month, id: productId };
  }
  return { kind: 'unknown' };
}

// The views that are drawn: the others are only ever a redirect.
export type ShownView = Exclude<StocktakeView, { readonly kind: 'start' } | { readonly kind: 'unknown' }>;

// What the section does with an address: show it, or replace it with another.
//
// ⚠️ A MONTH THAT HAS NOT HAPPENED HAS NOTHING ON ITS SHELVES TO COUNT: the arrows stop at the
// current month, and an address that names a later one (typed, or left over in a bookmark from
// before the clock moved) is replaced by the current month's list. The months compare as text:
// `YYYY-MM` sorts the way the calendar does. No month named lands on the current one; anything
// that leads nowhere goes back to `/stocktake`, which then lands on the current one.
export type Resolved = { readonly redirect: string } | { readonly view: ShownView };

export function resolveStocktakePath(rest: string | undefined, current: string): Resolved {
  const view = parseStocktakePath(rest);
  switch (view.kind) {
    case 'start':
      return { redirect: monthPath(current) };
    case 'unknown':
      return { redirect: STOCKTAKE_PATH };
    case 'list':
    case 'product':
    case 'cost':
      return view.month > current ? { redirect: monthPath(current) } : { view };
  }
}
