import { vi } from 'vitest';
import type { StoredDoc } from '../foodcost/foodcostSource';
import { fakeCakesSource } from './fakeCakesSource';
import type { FakeCakesSource } from './fakeCakesSource';
import { fakeFoodcostSource } from './fakeFoodcostSource';
import type { FakeFoodcostSource } from './fakeFoodcostSource';
import { renderApp } from './renderApp';
import { FLOUR, FLOUR_PRICES, product } from './renderFoodcost';

// Draws the real app at a Cakes address, with in-memory sources behind it: Food cost's (the tables every cake is costed from) and the
// cakes' own. The venue's people: the default session is the owner; EMPLOYEE and MANAGER come from renderFoodcost.
type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  cakes?: FakeCakesSource;
  foodcost?: FakeFoodcostSource;
};

export function renderCakes(path = '/cakes', { cakes = fakeCakesSource(), foodcost = cardsSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { cakes: () => cakes, foodcost: () => foodcost, ...options.data } });
  return { ...view, cakes, foodcost };
}

// Flour at 2.00 a kilo, and one semi-finished card made of a kilo of it: 2.00 a kilo, no labour.
export const SPONGE = product('SPONGE', {
  name: 'Sponge', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null,
});

export function cardsSource(extra: StoredDoc[] = []): FakeFoodcostSource {
  return fakeFoodcostSource({ products: [SPONGE, ...extra], ingredients: [FLOUR], prices: FLOUR_PRICES });
}

// A cake costed from the sponge: 1000 g of it is 2.00, sold at 12.00 with 20% VAT (net 10.00): a food cost of 20%.
export function cakeDoc(id: string, name: string, fields: Record<string, unknown> = {}): StoredDoc {
  return {
    id, name, diameterCm: 20, tiers: 1, discs: 2, slices: 8,
    lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 1000 }],
    packaging: [], assemblyMinutes: null, sellingPrice: 12, vatRate: 20, foodCostTarget: 30,
    categoryId: null, ref: null, model: 1,
    ...fields,
  };
}

// A cake with a card that is not on the books: its cost is incomplete.
export function incompleteCake(id: string, name: string): StoredDoc {
  return cakeDoc(id, name, { lines: [{ tier: 0, part: 'base', productId: 'GHOST', grams: 500 }] });
}

export const REFERENCE = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };
export const storedReference = (grams: Record<string, number> = REFERENCE) => ({ bakery: 'bakery', grams, updatedAt: '2026-11-20T10:00:00.000Z' });

// Cakes' split starts at 1280px: jsdom applies no media query, so the query is answered by hand.
export function splitCakes(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1280px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
