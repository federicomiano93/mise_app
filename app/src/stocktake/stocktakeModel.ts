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

// How many of the month's rows nobody has counted — what the close question warns about.
export function uncountedIn(month: InventoryMonth, products: readonly Product[]): number {
  return products.filter(product => !consumption(month, product.id).counted).length;
}
