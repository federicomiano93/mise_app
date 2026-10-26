// Which supplier each line of the order sits under (ordersLens.ts): «No supplier» (parity L10, L11), a line ordered from
// another supplier this time (L38's read side), the venue's supplier order and Favourites (L10, L14), the counts, and his
// decision F6 — switched-off lines LAST instead of left out.

import { describe, expect, it } from 'vitest';
import { buildOrdersLens, orderingCount, supplierListGroups } from './ordersLens';
import type { LensInput } from './ordersLens';
import type { StoredDoc } from './ordersSource';

const mill: StoredDoc = { id: 'mill', name: 'Mill' };
const dairy: StoredDoc = { id: 'dairy', name: 'Dairy' };
const gone: StoredDoc = { id: 'gone', name: 'Gone', active: false };

function lensOf(patch: Partial<LensInput> = {}) {
  return buildOrdersLens({
    suppliers: [mill, dairy, gone],
    suppliersLoaded: true,
    ingredients: [
      { id: 'flour25', name: 'Flour', weight: '25kg', supplierId: 'mill' },
      { id: 'flour5', name: 'Flour', weight: '5kg', supplierId: 'mill' },
      { id: 'semola', name: 'Semola', supplierId: 'mill', active: false },
      { id: 'milk', name: 'Milk', supplierId: 'dairy' },
      { id: 'orphan', name: 'Orphan', supplierId: 'deleted-one' },
    ],
    entries: {},
    supplierOrder: [],
    noSupplierName: 'No supplier',
    ...patch,
  });
}

describe('ordersLens — the suppliers', () => {
  it('shows the active suppliers in the venue\'s order, then «No supplier» last when something is filed under it', () => {
    const lens = lensOf({ supplierOrder: ['mill', 'dairy'] });
    expect(lens.suppliers.map(s => s.id)).toEqual(['mill', 'dairy', 'no-supplier']);
    expect(lens.supplierById('no-supplier')?.name).toBe('No supplier');
    expect(lensOf({ supplierOrder: [] }).suppliers.map(s => s.id)).toEqual(['dairy', 'mill', 'no-supplier']);
  });

  it('⚠️ files nothing under «No supplier» until the suppliers have really arrived', () => {
    const lens = lensOf({ suppliersLoaded: false });
    expect(lens.suppliers.map(s => s.id)).not.toContain('no-supplier');
  });

  it('search and the «Ordering» filter cut the list; Favourites come first under their heading', () => {
    const lens = lensOf({ entries: { milk: { qty: 2, stock: 0 } } });
    expect(orderingCount(lens)).toBe(1);
    expect(supplierListGroups(lens, { query: '', orderingOnly: true, favourites: [] })
      .flatMap(g => g.suppliers.map(s => s.id))).toEqual(['dairy']);
    expect(supplierListGroups(lens, { query: 'mìll', orderingOnly: false, favourites: [] })
      .flatMap(g => g.suppliers.map(s => s.id))).toEqual(['mill']);
    const groups = supplierListGroups(lens, { query: '', orderingOnly: false, favourites: ['mill'] });
    expect(groups[0]?.headingKey).toBeTruthy();
    expect(groups[0]?.suppliers.map(s => s.id)).toEqual(['mill']);
  });
});

describe('ordersLens — a supplier\'s rows', () => {
  it('A→Z by the label a person reads, numeric-aware («5kg» before «25kg»)', () => {
    expect(lensOf().rowsFor('mill').active.map(r => r.ingredient.id)).toEqual(['flour5', 'flour25']);
  });

  it('F6: a switched-off line is not left out, it comes LAST in its own list', () => {
    const rows = lensOf().rowsFor('mill');
    expect(rows.inactive.map(r => r.ingredient.id)).toEqual(['semola']);
  });

  it('a line ordered elsewhere this time stays on its own supplier, marked, and appears on the other one too', () => {
    const lens = lensOf({ entries: { flour5: { qty: 3, stock: 0, supplierId: 'dairy' } } });
    const own = lens.rowsFor('mill').active.find(r => r.ingredient.id === 'flour5');
    expect(own).toMatchObject({ elsewhere: true, elsewhereLabel: 'Dairy' });
    const there = lens.rowsFor('dairy').active.find(r => r.ingredient.id === 'flour5');
    expect(there).toMatchObject({ elsewhere: false, usualLabel: 'Mill' });
    // Counted where it is ordered, never twice.
    expect(lens.filledFor('dairy')).toBe(1);
    expect(lens.filledFor('mill')).toBe(0);
  });

  it('an override to a switched-off supplier falls back: the line never vanishes', () => {
    const lens = lensOf({ entries: { flour5: { qty: 3, stock: 0, supplierId: 'gone' } } });
    expect(lens.rowsFor('mill').active.find(r => r.ingredient.id === 'flour5')?.elsewhere).toBe(false);
    expect(lens.filledFor('mill')).toBe(1);
  });

  it('T10: a switched-off line with a quantity counts in the order', () => {
    expect(lensOf({ entries: { semola: { qty: 1, stock: 0 } } }).filledFor('mill')).toBe(1);
  });
});
