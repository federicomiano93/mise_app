// settingsProducts.ts — the «Prodotti» group of Bookings' «Impostazioni», the pure half (bookings settings, 18 Nov 2026).
//
// The bookings price list (`price-list/bookings`, shared/src/price-list.ts) moved here from Food cost: the owner ticks which
// Food cost products the counter books and, for each, whether it is a favourite, asked per piece, the weights offered and the
// ingredients a customer may leave out. Saving the settings PUBLISHES the list (no button of its own). This file turns Food
// cost's products and the published list into the screen's working copy, and the working copy back into the items published.

import { itemIsStale, priceItemOf, recipeIngredientNames } from '@mise/shared/price-list';
import type { PriceItem, PriceList } from '@mise/shared/price-list';

// A Food cost product as its source hands it over: its id beside its fields.
export type ProductDoc = { readonly id: string } & Record<string, unknown>;

// What the owner chose for one product. `removable` null: never chosen (the recipe's ingredients are offered).
export type ProductChoice = {
  readonly ticked: boolean;
  readonly favourite: boolean;
  readonly perPiece: boolean;
  readonly weights: readonly number[];
  readonly removable: readonly string[] | null;
};

export const NO_CHOICE: ProductChoice = Object.freeze({ ticked: false, favourite: false, perPiece: false, weights: [], removable: null });

// One product the counter could book: its line as Food cost prices it NOW, and its recipe's ingredient names (the pre-fill of
// «Si può togliere»; empty for a product with no recipe).
export type ProductRow = { readonly item: PriceItem; readonly prefill: readonly string[] };

// The products with a selling price, A→Z, and the names of the ones without (said under the group, one line each).
export function productRows(
  products: readonly ProductDoc[],
  recipeById: (id: string) => unknown,
  locale?: string,
): { rows: ProductRow[]; unpriced: string[] } {
  const rows: ProductRow[] = [];
  const unpriced: string[] = [];
  for (const product of products) {
    const item = priceItemOf({
      id: product.id,
      name: typeof product.name === 'string' ? product.name : '',
      sellingMode: product.sellingMode,
      sellingPrice: product.sellingPrice,
      packSize: product.packSize,
      packUnit: product.packUnit,
    });
    if (item !== null) rows.push({ item, prefill: recipeIngredientNames(product, recipeById) });
    else if (typeof product.name === 'string' && product.name.trim() !== '') unpriced.push(product.name.trim());
  }
  rows.sort((a, b) => a.item.name.localeCompare(b.item.name, locale));
  unpriced.sort((a, b) => a.localeCompare(b, locale));
  return { rows, unpriced };
}

// The working copy as the published list says it: each published product ticked, with what was chosen for it.
export function choicesFrom(published: PriceList): ReadonlyMap<string, ProductChoice> {
  return new Map(published.items.map(item => [item.productId, {
    ticked: true, favourite: item.favourite, perPiece: item.perPiece, weights: item.weights, removable: item.removable,
  }]));
}

export const choiceOf = (choices: ReadonlyMap<string, ProductChoice>, id: string): ProductChoice => choices.get(id) ?? NO_CHOICE;

// The ingredients a customer may leave out, as the dialog opens on them: what was chosen, else the recipe's (pre-filled: the
// owner unticks the basic ones).
export function removableOf(choice: ProductChoice, row: ProductRow): readonly string[] {
  return choice.removable ?? row.prefill;
}

// A product ticked for the counter: its «Si può togliere» is PRE-FILLED from its recipe at that moment, as a visible change the
// owner sees and can untick before saving. ⚠️ NEVER SILENTLY AT SAVE (review, 18 Nov 2026): a product published before, never
// opened in the dialog, keeps «not chosen» — a Save that only switched off the phone must not publish «without flour, water, salt»
// for every product. With no recipe (or the recipes not read yet) nothing is pre-filled.
export function tickChoice(choice: ProductChoice, row: ProductRow, ticked: boolean): ProductChoice {
  if (!ticked) return { ...choice, ticked: false };
  const removable = choice.removable ?? (row.prefill.length > 0 ? row.prefill : null);
  return { ...choice, ticked: true, removable };
}

// The items a Save publishes: the ticked products, at Food cost's name and price NOW, with what was chosen for each.
export function itemsToPublish(rows: readonly ProductRow[], choices: ReadonlyMap<string, ProductChoice>): PriceItem[] {
  return rows
    .filter(row => choiceOf(choices, row.item.productId).ticked)
    .map(row => {
      const choice = choiceOf(choices, row.item.productId);
      return {
        ...row.item,
        favourite: choice.favourite,
        perPiece: choice.perPiece,
        // Weights only for a product sold by the kilo: a piece or a pack has none to offer.
        weights: row.item.per === 'kg' ? choice.weights : [],
        // Only what was chosen: never the recipe's pre-fill unless it became a choice (tickChoice, the dialog's «Fatto»).
        removable: choice.removable,
      };
    });
}

// Whether two working copies tick and choose the same (what «unsaved changes» compares). Unticked products count only by
// being unticked: what is chosen for a product nobody books is not a change.
export function sameChoices(a: ReadonlyMap<string, ProductChoice>, b: ReadonlyMap<string, ProductChoice>): boolean {
  const ticked = (m: ReadonlyMap<string, ProductChoice>) => JSON.stringify(
    [...m.entries()].filter(([, c]) => c.ticked).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
  );
  return ticked(a) === ticked(b);
}

const storedText = (items: readonly PriceItem[]): string => JSON.stringify(
  [...items].sort((x, y) => (x.productId < y.productId ? -1 : x.productId > y.productId ? 1 : 0)).map(item => ({
    ...item, weights: [...item.weights], removable: item.removable === null ? null : [...item.removable],
  })),
);

// Whether a Save has anything to publish: what it would publish differs from what the counter has.
export function publishDiffers(next: readonly PriceItem[], published: PriceList): boolean {
  return storedText(next) !== storedText(published.items);
}

// What changed in Food cost since the last publish, which the counter does not see until a Save: a ticked product whose name
// or price moved, and published products that no longer have a selling price (`gone`, dropped by the next Save).
export function changesSincePublish(rows: readonly ProductRow[], published: PriceList): { stale: boolean; gone: number } {
  const current = new Map(rows.map(row => [row.item.productId, row.item]));
  let stale = false;
  let gone = 0;
  for (const item of published.items) {
    const now = current.get(item.productId) ?? null;
    if (now === null) gone += 1;
    else if (itemIsStale(item, now)) stale = true;
  }
  return { stale, gone };
}
