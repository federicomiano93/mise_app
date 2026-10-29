// ordersLens.ts — which supplier each line of the order sits under, and what each screen of the order list draws
// (step 3f-1). Pure: no React, no Firebase; the store hands it its data and the screens draw what it returns.
//
// The current app's derived views of js/orders/orders-main.js (orderIngredients, catalogueIngredients, activeSuppliers,
// orderSupplierList, ingredientsBySupplier, screenRowsFor), decision for decision, with ONE difference — his decision F6
// (docs/parity/orders.md): an ingredient switched off («Non in uso», `active === false`) is not left out of a supplier's
// screen any more; it comes LAST, under its own heading, and can be typed into like any other line (T10).
//
// ⚠️ THE LENS IS THE ONE PLACE THAT DECIDES AN INGREDIENT'S SUPPLIER (no-supplier.js resolveSuppliers): which screen it is
// on, which order it will be recorded in and which lines a clear removes all read it, so they can never disagree.

import { favouriteGroups } from '@mise/shared/favourite-suppliers';
import { filterSuppliers } from '@mise/shared/ingredient-search';
import { NO_SUPPLIER_ID, orderSuppliers, resolveSuppliers } from '@mise/shared/no-supplier';
import { sortByLabel, wholeNumber } from '@mise/shared/archive';
import { supplierLabel } from '@mise/shared/supplier-label';
import { sortSuppliersByOrder } from '@mise/shared/supplier-order';
import type { DraftEntries } from './draftSync';
import type { StoredDoc } from './ordersSource';

export { NO_SUPPLIER_ID };

// An ingredient as the order list files it: `supplierId` is the supplier whose order the line is in RIGHT NOW (its own,
// «No supplier» when its own is gone, or the one the draft sends it to this time — `usualSupplierId` then names its own).
export type LensIngredient = StoredDoc & {
  readonly supplierId?: string;
  readonly usualSupplierId?: string;
};

// One row of a supplier's own screen.
export interface OrderRow {
  readonly ingredient: LensIngredient;
  // A line of THIS supplier's that is ordered from another one this time: its box is empty (that number is the other
  // order's) and it says «this time from …». Typing a quantity takes it back. '' = none.
  readonly elsewhereLabel: string;
  readonly elsewhere: boolean;
  // A line sent HERE from its usual supplier: it says «usually from …». '' = none.
  readonly usualLabel: string;
}

export interface SupplierRows {
  // Every line in use, A→Z by the label a person reads (archive.js sortByLabel, numeric-aware).
  readonly active: readonly OrderRow[];
  // The lines switched off («Non in uso»), A→Z, drawn after the others (his decision F6).
  readonly inactive: readonly OrderRow[];
}

export interface LensInput {
  readonly suppliers: readonly StoredDoc[];
  // Whether the suppliers have really arrived: before that every ingredient would flash under «No supplier» (parity L11).
  readonly suppliersLoaded: boolean;
  readonly ingredients: readonly StoredDoc[];
  readonly entries: DraftEntries;
  // config/orders.supplierOrder, normalised (parity M8); [] = alphabetical.
  readonly supplierOrder: readonly string[];
  // The pseudo-supplier's name in the interface language («No supplier» / «Senza fornitore»).
  readonly noSupplierName: string;
}

export interface OrdersLens {
  // The suppliers of the order list: the active ones in the venue's order, then «No supplier» when something is filed
  // under it (parity L10).
  readonly suppliers: readonly StoredDoc[];
  supplierById(id: string): StoredDoc | undefined;
  // The rows of one supplier's own screen (parity L22–L25, decision F6).
  rowsFor(supplierId: string): SupplierRows;
  // How many lines of a supplier's order have a quantity (the count on its row, «Order placed…» enabled — parity L14).
  filledFor(supplierId: string): number;
  // Every line IN this supplier's order now (its own, less those sent elsewhere this time, plus those sent here), switched-off
  // ones included: what placing records and clears, and what «Clear quantities» clears (js/orders/orders-main.js
  // ingredientsOf(…, orderIngredients(), { activeOnly: false })).
  linesOf(supplierId: string): readonly LensIngredient[];
}

const isActive = (item: object) => (item as { readonly active?: unknown }).active !== false;

function groupBySupplier(list: readonly LensIngredient[]): Map<string, LensIngredient[]> {
  const out = new Map<string, LensIngredient[]>();
  for (const item of list) {
    const key = typeof item.supplierId === 'string' ? item.supplierId : '';
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

export function buildOrdersLens(input: LensInput): OrdersLens {
  const { suppliers, suppliersLoaded, ingredients, entries, supplierOrder, noSupplierName } = input;
  // The lines as they are ordered now (overrides applied) and as each supplier SELLS them (no overrides): a supplier's
  // own screen keeps showing its line that is ordered elsewhere this time (orders-main.js screenRowsFor).
  const lens = resolveSuppliers(ingredients, suppliers, suppliersLoaded, entries) as readonly LensIngredient[];
  const catalogue = resolveSuppliers(ingredients, suppliers, suppliersLoaded) as readonly LensIngredient[];
  const active = sortSuppliersByOrder(suppliers.filter(isActive), supplierOrder, supplierLabel) as StoredDoc[];
  const list = orderSuppliers(active, lens, noSupplierName) as StoredDoc[];
  const byId = new Map(list.map(s => [s.id, s]));
  const lensById = new Map(lens.map(i => [i.id, i]));
  const lensBySupplier = groupBySupplier(lens);
  const catalogueBySupplier = groupBySupplier(catalogue);
  const labelOf = (id: string | undefined) => (id ? supplierLabel(byId.get(id)) || '' : '');
  const qtyOf = (id: string) => wholeNumber(entries[id]?.qty);

  return {
    suppliers: list,
    supplierById: id => byId.get(id),

    rowsFor(supplierId) {
      const own: OrderRow[] = (catalogueBySupplier.get(supplierId) ?? []).map(ingredient => {
        const now = lensById.get(ingredient.id);
        const awayTo = now && now.supplierId !== supplierId ? now.supplierId : undefined;
        return { ingredient, elsewhere: Boolean(awayTo), elsewhereLabel: labelOf(awayTo), usualLabel: '' };
      });
      const incoming: OrderRow[] = (lensBySupplier.get(supplierId) ?? [])
        .filter(i => i.usualSupplierId)
        .map(ingredient => ({ ingredient, elsewhere: false, elsewhereLabel: '', usualLabel: labelOf(ingredient.usualSupplierId) }));
      const rows = [...own, ...incoming];
      const sorted = sortByLabel(rows.map(r => r.ingredient)) as LensIngredient[];
      const rowOf = new Map(rows.map(r => [r.ingredient, r]));
      const ordered = sorted.map(i => rowOf.get(i) as OrderRow);
      return {
        active: ordered.filter(r => isActive(r.ingredient)),
        inactive: ordered.filter(r => !isActive(r.ingredient)),
      };
    },

    // ⚠️ COUNTED ON THE LENS, where a line is in ONE order: a line sent elsewhere counts for the supplier it is ordered
    // from, never for both. A switched-off line with a quantity counts too: it is in the order (decision T10).
    filledFor: supplierId => (lensBySupplier.get(supplierId) ?? []).filter(i => qtyOf(i.id) > 0).length,

    linesOf: supplierId => lensBySupplier.get(supplierId) ?? [],
  };
}

// The supplier list as the screen draws it: «All» or only the suppliers being ordered from, then the search (name and
// category, ignoring accents and capitals — parity L14, L15), then Favourites first under their headings when the venue
// starred some (favourite-suppliers.js; each group keeps the venue's order).
export function supplierListGroups(
  lens: OrdersLens,
  { query, orderingOnly, favourites }: { query: string; orderingOnly: boolean; favourites: readonly string[] },
): ReadonlyArray<{ readonly headingKey: string | null; readonly suppliers: readonly StoredDoc[] }> {
  const inScope = orderingOnly ? lens.suppliers.filter(s => lens.filledFor(s.id) > 0) : lens.suppliers;
  const rows = filterSuppliers(inScope, query);
  return favouriteGroups(rows, favourites).map(group => ({
    headingKey: group.headingKey ?? null,
    suppliers: group.suppliers as StoredDoc[],
  }));
}

// How many suppliers have something typed (the «Ordering (N)» filter; parity L14).
export function orderingCount(lens: OrdersLens): number {
  return lens.suppliers.filter(s => lens.filledFor(s.id) > 0).length;
}
