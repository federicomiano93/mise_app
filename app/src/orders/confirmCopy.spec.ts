import { describe, expect, it } from 'vitest';
import { buildConfirmGroups, confirmedItems } from './confirmCopy';
import { EMPTY_DRAFT } from './draftSync';
import type { DraftView } from './draftSync';
import { buildOrdersLens } from './ordersLens';

const TODAY = '2026-10-28';
const SUPPLIERS = [{ id: 's-alp', name: 'Alpine Mills' }, { id: 's-zed', name: 'Zed Dairy', shortName: 'Zed' }];
const INGREDIENTS = [
  { id: 'i-rye', name: 'Rye', weight: '25kg', supplierId: 's-alp', unit: 'kg' },
  { id: 'i-flour', name: 'Flour', supplierId: 's-alp', unit: 'kg' },
  { id: 'i-box', name: 'Cake box', supplierId: 's-alp', unit: 'carton', packUnit: 'bag' },
  { id: 'i-milk', name: 'Milk', supplierId: 's-zed', unit: 'l' },
];

function setup(entries: DraftView['entries'], days: DraftView['days'] = {}) {
  const draft: DraftView = { ...EMPTY_DRAFT, entries, days };
  const lens = buildOrdersLens({
    suppliers: SUPPLIERS, suppliersLoaded: true, ingredients: INGREDIENTS, entries, supplierOrder: [], noSupplierName: 'No supplier',
  });
  return { draft, lens };
}

describe('buildConfirmGroups', () => {
  it('takes the lines above zero A to Z, with the unit each one shows and the supplier’s name', () => {
    const { draft, lens } = setup({
      'i-rye': { qty: 2 }, 'i-flour': { qty: 5 }, 'i-box': { qty: 3, unit: 'bag' }, 'i-milk': { stock: 4 },
    });
    const groups = buildConfirmGroups({ ids: ['s-alp', 's-zed'], checks: [], lens, draft, today: TODAY });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ supplierId: 's-alp', name: 'Alpine Mills', date: TODAY, exists: false, later: false });
    expect(groups[0]?.rows).toEqual([
      { id: 'i-box', name: 'Cake box', unit: 'bag', qty: 3 },
      { id: 'i-flour', name: 'Flour', unit: 'kg', qty: 5 },
      { id: 'i-rye', name: 'Rye 25kg', unit: 'kg', qty: 2 },
    ]);
  });

  it('keeps the suppliers in the order given and uses the short name', () => {
    const { draft, lens } = setup({ 'i-rye': { qty: 1 }, 'i-milk': { qty: 1 } });
    const groups = buildConfirmGroups({ ids: ['s-zed', 's-alp'], checks: [], lens, draft, today: TODAY });
    expect(groups.map(group => group.name)).toEqual(['Zed', 'Alpine Mills']);
  });

  it('knows a record already exists, and files a future stamp under today (decision F3)', () => {
    const { draft, lens } = setup({ 'i-rye': { qty: 1 } }, { 's-alp': '2026-10-31' });
    const [group] = buildConfirmGroups({
      ids: ['s-alp'], lens, draft, today: TODAY,
      checks: [{ supplierId: 's-alp', date: TODAY, exists: true, conflicts: [] }],
    });
    expect(group).toMatchObject({ exists: true, later: true, date: TODAY });
  });

  it('files an older stamp under that day', () => {
    const { draft, lens } = setup({ 'i-rye': { qty: 1 } }, { 's-alp': '2026-10-26' });
    const [group] = buildConfirmGroups({ ids: ['s-alp'], checks: [], lens, draft, today: TODAY });
    expect(group).toMatchObject({ later: false, date: '2026-10-26' });
  });

  it('files under the day a pending banner pinned, whatever the draft says, and is not «later»', () => {
    const { draft, lens } = setup({ 'i-rye': { qty: 1 } }, { 's-alp': '2026-10-31' });
    const [group] = buildConfirmGroups({ ids: ['s-alp'], checks: [], lens, draft, today: TODAY, pinnedDay: '2026-10-27' });
    expect(group).toMatchObject({ date: '2026-10-27', later: false });
  });

  it('leaves out a supplier that is gone and one with nothing typed', () => {
    const { draft, lens } = setup({ 'i-rye': { qty: 1 } });
    expect(buildConfirmGroups({ ids: ['s-gone', 's-zed'], checks: [], lens, draft, today: TODAY })).toEqual([]);
  });
});

describe('confirmedItems', () => {
  it('keeps the corrected quantities above zero and the unit every row showed', () => {
    const { draft, lens } = setup({ 'i-rye': { qty: 2 }, 'i-flour': { qty: 5 } });
    const groups = buildConfirmGroups({ ids: ['s-alp'], checks: [], lens, draft, today: TODAY });
    const items = confirmedItems(groups, { 's-alp': { 'i-rye': 7, 'i-flour': 0 } });
    expect(items).toEqual([{
      supplierId: 's-alp', date: TODAY, quantities: { 'i-rye': 7 }, units: { 'i-flour': 'kg', 'i-rye': 'kg' },
    }]);
  });

  it('leaves a supplier out when every quantity was set to 0', () => {
    const { draft, lens } = setup({ 'i-rye': { qty: 2 } });
    const groups = buildConfirmGroups({ ids: ['s-alp'], checks: [], lens, draft, today: TODAY });
    expect(confirmedItems(groups, { 's-alp': { 'i-rye': 0 } })).toEqual([]);
  });
});
