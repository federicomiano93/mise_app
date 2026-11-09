// What the flat view draws (flatView.ts): rows A→Z across suppliers, the lines switched off kept apart, the frozen set.

import { describe, expect, it } from 'vitest';
import { flatView, notInUseLines, orderedIds } from './flatView';
import { buildOrdersLens } from './ordersLens';
import type { LensInput } from './ordersLens';
import type { StoredDoc } from './ordersSource';

const mill: StoredDoc = { id: 'mill', name: 'Mill' };
const dairy: StoredDoc = { id: 'dairy', name: 'Dairy' };
const closed: StoredDoc = { id: 'closed', name: 'Closed', active: false };

function lensOf(patch: Partial<LensInput> = {}) {
  return buildOrdersLens({
    suppliers: [mill, dairy, closed],
    suppliersLoaded: true,
    ingredients: [
      { id: 'flour25', name: 'Flour', weight: '25kg', supplierId: 'mill' },
      { id: 'flour5', name: 'Flour', weight: '5kg', supplierId: 'mill' },
      { id: 'semola', name: 'Semola', supplierId: 'mill', active: false },
      { id: 'butter', name: 'Butter', supplierId: 'dairy' },
      { id: 'cream', name: 'Cream', supplierId: 'dairy', active: false },
      { id: 'milk', name: 'Milk', supplierId: 'dairy' },
      { id: 'cheese', name: 'Cheese', supplierId: 'closed' },
      { id: 'orphan', name: 'Orphan', supplierId: 'deleted-one' },
    ],
    entries: {},
    supplierOrder: [],
    noSupplierName: 'No supplier',
    ...patch,
  });
}

const none = { query: '', only: null };

describe('flatView', () => {
  it('lists every line in use A→Z across the suppliers, each with its supplier\'s name', () => {
    const view = flatView(lensOf(), none);
    expect(view.rows.map(line => [line.row.ingredient.id, line.supplierName])).toEqual([
      ['butter', 'Dairy'], ['flour25', 'Mill'], ['flour5', 'Mill'], ['milk', 'Dairy'], ['orphan', 'No supplier'],
    ]);
    expect(view.total).toBe(5);
  });

  it('puts the letter on the first row of each run only, and after the search', () => {
    expect(flatView(lensOf(), none).rows.map(line => line.letter)).toEqual(['B', 'F', '', 'M', 'O']);
    const found = flatView(lensOf(), { query: 'mill', only: null });
    expect(found.rows.map(line => line.row.ingredient.id)).toEqual(['flour25', 'flour5']);
    expect(found.rows.map(line => line.letter)).toEqual(['F', '']);
    expect(found.total).toBe(5);
  });

  it('files a line sent to another supplier this time under THAT supplier, saying where it usually comes from', () => {
    const lens = lensOf({ entries: { milk: { qty: 2, stock: 0, supplierId: 'mill' } } });
    const milk = flatView(lens, none).rows.find(line => line.row.ingredient.id === 'milk');
    expect(milk?.supplier.id).toBe('mill');
    expect(milk?.supplierName).toBe('Mill');
    expect(milk?.row.usualLabel).toBe('Dairy');
    expect(milk?.row.elsewhere).toBe(false);
  });

  it('keeps only the frozen ids when given a set', () => {
    const view = flatView(lensOf(), { query: '', only: new Set(['milk', 'butter']) });
    expect(view.rows.map(line => line.row.ingredient.id)).toEqual(['butter', 'milk']);
    expect(view.total).toBe(5);
  });
});

describe('notInUseLines', () => {
  it('returns the lines switched off, A→Z, with the real line behind each row', () => {
    const lens = lensOf();
    const off = notInUseLines(lens, none);
    expect(off.map(line => line.row.ingredient.id)).toEqual(['cream', 'semola']);
    expect(off[0]?.row.ingredient).toBe(lens.lines.find(line => line.id === 'cream'));
    expect(off.map(line => line.supplierName)).toEqual(['Dairy', 'Mill']);
  });

  it('answers to the same search and the same frozen set', () => {
    const lens = lensOf();
    expect(notInUseLines(lens, { query: 'sem', only: null }).map(line => line.row.ingredient.id)).toEqual(['semola']);
    expect(notInUseLines(lens, { query: 'dairy', only: null }).map(line => line.row.ingredient.id)).toEqual(['cream']);
    expect(notInUseLines(lens, { query: '', only: new Set(['semola']) }).map(line => line.row.ingredient.id)).toEqual(['semola']);
    expect(notInUseLines(lens, { query: 'zzz', only: null })).toEqual([]);
  });

  it('is empty when nothing is switched off', () => {
    expect(notInUseLines(lensOf({ ingredients: [{ id: 'a', name: 'A', supplierId: 'mill' }] }), none)).toEqual([]);
  });
});

describe('orderedIds', () => {
  it('leaves out a line the view cannot show, a stopped supplier’s, even with a quantity', () => {
    const entries = { cheese: { qty: 3, stock: 0 }, milk: { qty: 1, stock: 0 } };
    expect([...orderedIds(lensOf({ entries }), entries)]).toEqual(['milk']);
  });

  it('collects the lines with a quantity, switched-off ones too, and ignores zero and junk', () => {
    const entries = { milk: { qty: 2, stock: 0 }, cream: { qty: 1, stock: 0 }, butter: { qty: 0, stock: 4 }, semola: { qty: Number.NaN, stock: 0 } };
    expect([...orderedIds(lensOf({ entries }), entries)].sort()).toEqual(['cream', 'milk']);
  });
});
