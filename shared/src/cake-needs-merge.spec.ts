// «What you need»: the same ingredient priced in one part and unpriced in another is ONE row. The cost-per-kilo block keys an
// unpriced part apart (`ing:X:no-price`), which would list the same flour on the lab's sheet twice; cakeNeeds folds them by
// ingredient and marks the row. The block is replaced here by fixed rows (a real one needs a price that is there and not there at
// once). Fake data only.

import { describe, expect, test, vi } from 'vitest';
import type { PerKgRow } from './per-kg-model';

const row = (key: string, kg: number | null, reason: PerKgRow['reason'], name = 'Flour'): PerKgRow => ({
  key, kind: 'ingredient', name, kg, pcs: null, pricePerKg: null, priceEach: null, cost: null, reason,
});

vi.mock('./per-kg-model', () => ({
  costPerKg: () => ({
    total: 1,
    rows: [row('ing:FLOUR', 0.5, null), row('ing:FLOUR:no-price', 0.25, 'no-price'), row('ing:SALT', 0.01, null, 'Salt')],
  }),
}));

import { cakeNeeds } from './cake-model';
import type { Product } from './foodcost-model';

describe('cakeNeeds: priced and unpriced parts of one ingredient', () => {
  const product = { components: [{ kind: 'semi', productId: 'A', qtyKg: 1 }] } as unknown as Product;
  const tables = { products: new Map([['A', { name: 'Sponge' }]]), ingredients: {}, labourCostPerHour: null } as never;

  test('are one row, kilos summed, marked unpriced', () => {
    const { ingredients } = cakeNeeds(product, tables, 2);
    expect(ingredients.map(i => i.key)).toEqual(['ing:FLOUR', 'ing:SALT']);
    expect(ingredients[0]).toMatchObject({ name: 'Flour', unpriced: true });
    expect(ingredients[0]?.kg).toBeCloseTo((0.5 + 0.25) * 2, 9);
    expect(ingredients[1]?.unpriced).toBe(false);
  });
});
