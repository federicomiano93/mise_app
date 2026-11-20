import { describe, expect, it } from 'vitest';
import { normalizeCake } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import type { CostTables } from '@mise/shared/foodcost-model';
import { cakeSubLine, costCakes, matchingCakes, sortCakes } from './cakesListModel';

const cake = (id: string, name: string, fields: Record<string, unknown> = {}): Cake => {
  const made = normalizeCake({ id, name, diameterCm: 24, tiers: 1, discs: 3, slices: 8, ...fields });
  if (!made) throw new Error('not a cake');
  return made;
};

const TABLES: CostTables = {
  recipes: {},
  ingredients: { flour: { id: 'flour', name: 'Flour', unit: 'kg', pricePerUnit: 2, priceUnit: 'kg' } },
  products: {
    SPONGE: { id: 'SPONGE', name: 'Sponge', kind: 'semi', model: 4, components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }] },
  },
  labourCostPerHour: null,
} as unknown as CostTables;

const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`;

describe('sortCakes', () => {
  it('sorts by name in Italian collation, ignoring case, and leaves the input alone', () => {
    const input = [cake('1', 'torta'), cake('2', 'Ciambella'), cake('3', 'àrancia'), cake('4', 'Zuccotto')];
    expect(sortCakes(input).map(c => c.name)).toEqual(['àrancia', 'Ciambella', 'torta', 'Zuccotto']);
    expect(input.map(c => c.id)).toEqual(['1', '2', '3', '4']);
  });

  it('breaks a tie on the id, so the order is stable', () => {
    expect(sortCakes([cake('b', 'Same'), cake('a', 'Same')]).map(c => c.id)).toEqual(['a', 'b']);
  });
});

describe('costCakes', () => {
  const priced = (id: string, name: string) => cake(id, name, {
    lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 1000 }], sellingPrice: 12, vatRate: 20, foodCostTarget: 30,
  });

  it('costs a cake from its own lines through cakeTotals: 2.00 of materials on a net 10.00 is 20%', () => {
    const [row] = costCakes([priced('1', 'A')], TABLES);
    expect(row?.pct).toBeCloseTo(20, 6);
    expect(row?.partial).toBe(false);
    expect(row?.status).toBe('green');
  });

  it('marks a cake with a card that has no price as partial', () => {
    const half = cake('2', 'B', { lines: [{ tier: 0, part: 'base', productId: 'NOPE', grams: 500 }], sellingPrice: 12, vatRate: 20 });
    expect(costCakes([half], TABLES)[0]?.partial).toBe(true);
  });

  it('has no figure for a cake with no price to sell it at', () => {
    const unsold = cake('3', 'C', { lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 1000 }] });
    expect(costCakes([unsold], TABLES)[0]?.pct).toBeNull();
  });
});

describe('matchingCakes', () => {
  it('keeps the rows whose name contains the text, ignoring case and accents; empty text keeps all', () => {
    const rows = costCakes([cake('1', 'Sacher'), cake('2', 'Crostata di Mela')], TABLES);
    expect(matchingCakes(rows, 'sach').map(r => r.cake.id)).toEqual(['1']);
    expect(matchingCakes(rows, '').length).toBe(2);
    expect(matchingCakes(rows, 'zzz')).toEqual([]);
  });
});

describe('cakeSubLine', () => {
  it('says tiers only from two up, then the diameter and the discs, then «cost incomplete» when it is', () => {
    expect(cakeSubLine(t, cake('1', 'A'), false)).toBe('cakes.row.diameter{"d":24} · cakes.row.discs{"n":3}');
    expect(cakeSubLine(t, cake('2', 'B', { tiers: 2 }), true))
      .toBe('cakes.row.tiers{"n":2} · cakes.row.diameter{"d":24} · cakes.row.discs{"n":3} · cakes.row.incomplete');
  });
});
