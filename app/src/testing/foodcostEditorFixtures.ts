import type { StoredDoc } from '../foodcost/foodcostSource';
import { FLOUR, FLOUR_PRICES, sourceWith } from './renderFoodcost';
import type { FakeFoodcostSource } from './fakeFoodcostSource';

// The pieces the editor's specs are built from, on top of renderFoodcost's flour (£2.00 a kilo).

// A recipe of one kilo of flour: £2.00 a kilo.
const FLOUR_ROW = { kind: 'ingredient', refId: 'flour', unit: 'g', grams: 1000, label: 'Flour' };

export function recipe(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return { id, name: id, ingredients: [FLOUR_ROW], lossPct: 0, ...fields };
}

// A recipe whose only row points at something that does not exist: it cannot be priced.
export function unpricedRecipe(id: string): StoredDoc {
  return { id, name: id, ingredients: [{ kind: 'ingredient', refId: 'ghost', unit: 'g', grams: 500, label: 'Ghost' }], lossPct: 0 };
}

// A recipe with a priced row and an unpriced one: priced, but only in part.
export function halfPricedRecipe(id: string): StoredDoc {
  return {
    id,
    name: id,
    ingredients: [FLOUR_ROW, { kind: 'ingredient', refId: 'salt', unit: 'g', grams: 20, label: 'Salt' }],
    lossPct: 0,
  };
}

// An ingredient nobody has priced.
export const SALT = { id: 'salt', name: 'Salt', active: true, unit: 'kg', weight: '1 kg' } as const;

// Packaging bought by the piece (£0.25 each), packaging priced by weight, and one nobody priced.
export const BOX = { id: 'box', name: 'Box', kind: 'packaging', active: true } as const;
export const RIBBON = { id: 'ribbon', name: 'Ribbon', kind: 'packaging', active: true } as const;
export const TISSUE = { id: 'tissue', name: 'Tissue', kind: 'packaging', active: true } as const;
export const INACTIVE = { id: 'old', name: 'Old tin', kind: 'packaging', active: false } as const;

export const PACKAGING_PRICES = {
  box: { priceUnit: 'pcs', pricePerUnit: 0.25 },
  ribbon: { priceUnit: 'kg', pricePerUnit: 4 },
} as const;

// A source with the flour and the salt, the three packaging items, and the given products and recipes.
export function editorSource(
  products: StoredDoc[],
  extra: Parameters<typeof sourceWith>[1] = {},
): FakeFoodcostSource {
  return sourceWith(products, {
    ingredients: [FLOUR, SALT, BOX, RIBBON, TISSUE, INACTIVE],
    prices: { ...FLOUR_PRICES, ...PACKAGING_PRICES },
    ...extra,
  });
}
