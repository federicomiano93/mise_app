// Which supplier each line of the order sits under (ordersLens.ts): «No supplier» (parity L10, L11), a line ordered from
// another supplier this time (L38's read side), the venue's supplier order and Favourites (L10, L14), the counts, and his
// decision F6 — switched-off lines LAST instead of left out.

import { describe, expect, it } from 'vitest';
import { buildOrdersLens, orderingCount, supplierGroups } from './ordersLens';
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

  it('counts the suppliers with something typed', () => {
    expect(orderingCount(lensOf({ entries: { milk: { qty: 2, stock: 0 } } }))).toBe(1);
  });
});

// The three groups of the redesign (16 Nov 2026, item 4).
describe('ordersLens — the supplier groups', () => {
  const none = new Set<string>();
  const ids = (groups: ReturnType<typeof supplierGroups>) => groups.map(group => [group.key, group.suppliers.map(s => s.id)]);

  it('puts «To order» first (due today, or with quantities), then Favourites, then the others — each supplier once', () => {
    const lens = buildOrdersLens({
      suppliers: [mill, dairy, { id: 'fish', name: 'Fish' }, { id: 'eggs', name: 'Eggs' }],
      suppliersLoaded: true,
      ingredients: [{ id: 'milk', name: 'Milk', supplierId: 'dairy' }],
      entries: { milk: { qty: 2, stock: 0 } },
      supplierOrder: [],
      noSupplierName: 'No supplier',
    });
    // Dairy has quantities AND is a favourite: «To order» wins. Fish is due today. Mill is a favourite. Eggs is neither.
    const groups = supplierGroups(lens, { query: '', favourites: ['mill', 'dairy'], due: new Set(['fish']), closedToday: none });
    expect(ids(groups)).toEqual([['due', ['dairy', 'fish']], ['favourites', ['mill']], ['others', ['eggs']]]);
    expect(groups.every(group => group.heading)).toBe(true);
  });

  it('takes a supplier closed today as «not needed» out of «To order», even with quantities typed', () => {
    const lens = lensOf({ entries: { milk: { qty: 2, stock: 0 } } });
    const groups = supplierGroups(lens, { query: '', favourites: [], due: new Set(['mill']), closedToday: new Set(['dairy', 'mill']) });
    expect(groups.map(group => group.key)).toEqual(['others']);
  });

  it('leaves out an empty group, and draws no heading when only one group is left', () => {
    const groups = supplierGroups(lensOf(), { query: '', favourites: [], due: none, closedToday: none });
    expect(ids(groups)).toEqual([['others', ['dairy', 'mill', 'no-supplier']]]);
    expect(groups[0]?.heading).toBe(false);
    expect(supplierGroups(lensOf(), { query: '', favourites: ['mill'], due: none, closedToday: none }).map(group => group.key))
      .toEqual(['favourites', 'others']);
  });

  it('searches before it groups, ignoring accents and capitals', () => {
    const groups = supplierGroups(lensOf(), { query: 'mìll', favourites: [], due: none, closedToday: none });
    expect(ids(groups)).toEqual([['others', ['mill']]]);
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

describe('ordersLens — lines (what the reminders read)', () => {
  it('holds every line as it is ordered now: overrides applied, switched-off lines and «No supplier» included', () => {
    const lens = lensOf({ entries: { milk: { qty: 2, stock: 0, supplierId: 'mill' } } });
    const filed = Object.fromEntries(lens.lines.map(line => [line.id, line.supplierId]));
    expect(filed).toEqual({ flour25: 'mill', flour5: 'mill', semola: 'mill', milk: 'mill', orphan: 'no-supplier' });
    // The same lines `linesOf` draws from.
    expect(lens.linesOf('mill').map(line => line.id).sort()).toEqual(['flour25', 'flour5', 'milk', 'semola']);
  });
});
