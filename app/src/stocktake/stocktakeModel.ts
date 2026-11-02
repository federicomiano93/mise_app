// stocktakeModel.ts — the Stocktake's own small decisions that are not in the shared models:
// what a product is CALLED on these screens, and what closing a month freezes into it. Pure; the
// screens and the store call it so the list, the close dialog and the frozen names agree.

import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { consumption } from '@mise/shared/inventory-model';
import type { InventoryMonth } from '@mise/shared/inventory-model';
import { packKgFor, packPrice } from '@mise/shared/inventory-value';
import type { Frozen } from './stocktakeStore';

type Product = { readonly id: string } & Readonly<Record<string, unknown>>;

// The name the Stocktake shows: the short name (else the name), then the pack text — «Farina 00
// 25kg». '' when a product has neither; the screen then says «Product with no name».
export function productLabel(product: Readonly<Record<string, unknown>>): string {
  const weight = typeof product.weight === 'string' ? product.weight : '';
  return [ingredientDisplayName(product), weight].filter(Boolean).join(' ').trim();
}

// What closing a month freezes into it (js/inventory/inventory-main.js handleClose).
//
// ⚠️ EVERYTHING THE MONTH'S COST DEPENDS ON BUT DOES NOT OWN: the label (a product deleted next
// spring is still readable here), what ONE counted unit cost, and how many kilos a pack held.
// Without the last two, opening this month next year would recompute it at next year's prices and
// quietly disagree with itself. Worked out on the OPEN month (closed: false), from the rows the
// screen shows — the same list the progress figure and the close question count.
export function frozenFor(month: InventoryMonth, products: readonly Product[]): Frozen {
  const names: Record<string, string> = {};
  const unitPrice: Record<string, number> = {};
  const packKg: Record<string, number> = {};
  for (const product of products) {
    names[product.id] = productLabel(product);
    const price = packPrice(month, product, false);
    if (price !== null) unitPrice[product.id] = price;
    const kg = packKgFor(month, product, false);
    if (kg !== null) packKg[product.id] = kg;
  }
  return { names, unitPrice, packKg };
}

// ⚠️ THE TWO BELOW ARE THE CURRENT APP'S (js/inventory/inventory-model.js, PR #442), HERE AND NOT IN @mise/shared/inventory-model
// FOR NOW: that port is paired, parity.spec.ts wants the same exports on both sides, and the stack does not hold the fix yet.
// When main is merged into the stack they move there, under the paired tests.

// A month's write without its empty maps.
//
// ⚠️⚠️ AN EMPTY MAP IN A MERGE DOES NOT MEAN «NOTHING TO ADD»: IT REPLACES THE STORED MAP WITH AN EMPTY ONE. A map with keys
// merges key by key; `opening: {}` wipes every opening of that month. Driven on the emulator: an ordinary close with nothing
// counted emptied the opening and the pack weights the next month already held. No write of this feature means to wipe a
// map: a box is emptied by name, with deleteField(), which is not a plain map and goes through.
export function withoutEmptyMaps(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const plainMap = value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
    if (!plainMap || Object.keys(value).length > 0) out[key] = value;
  }
  return out;
}

// Whether what this phone holds is enough to ACT on the month: to close it, carry into it, fill it from the orders, or say
// what it cost.
//
// ⚠️⚠️ AN OPEN MONTH NEEDS ALL THREE ANSWERS: ITSELF, THE INGREDIENTS AND THEIR PRICES. Rows on screen are not enough: they
// can come from the phone's copy of the ingredients with the month never read here, and that month may already be counted,
// or closed, on the server. And a close freezes what a unit cost, so with the prices still out a month would be closed with
// no money in it.
// ⚠️ A CLOSED MONTH'S ROWS ARE ITS OWN (productsOfMonth): it is ready as soon as it has any.
export function monthReady({ monthAnswered, ingredientsAnswered, pricesAnswered, closed, rows }: {
  readonly monthAnswered: boolean;
  readonly ingredientsAnswered: boolean;
  readonly pricesAnswered: boolean;
  readonly closed: boolean;
  readonly rows: number;
}): boolean {
  const answered = monthAnswered && ingredientsAnswered;
  return closed ? rows > 0 || answered : answered && pricesAnswered;
}

// How many of the month's rows nobody has counted — what the close question warns about.
export function uncountedIn(month: InventoryMonth, products: readonly Product[]): number {
  return products.filter(product => !consumption(month, product.id).counted).length;
}
