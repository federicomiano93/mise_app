import { vi } from 'vitest';
import type { StoredDoc } from '../foodcost/foodcostSource';
import { fakeFoodcostSource } from './fakeFoodcostSource';
import type { FakeFoodcostSource } from './fakeFoodcostSource';
import { renderApp } from './renderApp';

// Draws the real app at a Food cost address, with an in-memory source behind it.
type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  source?: FakeFoodcostSource;
};

export function renderFoodcost(path = '/food-cost', { source = fakeFoodcostSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { foodcost: () => source, ...options.data } });
  return { ...view, source };
}

// The one flour every costed product below is made of: £2.00 a kilo.
export const FLOUR = { id: 'flour', name: 'Flour', active: true, unit: 'kg' } as const;
export const FLOUR_PRICES = { flour: { priceUnit: 'kg', pricePerUnit: 2 } } as const;

// A product the fake can cost: a kilo of flour (£2.00) in a batch of 10 pieces, so one piece costs
// £0.20. With a selling price of 1.20 and 20% VAT the net price is £1.00: a food cost of 20%.
export function product(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return {
    id,
    name: id,
    components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }],
    packaging: [],
    sellingMode: 'piece',
    piecesPerBatch: 10,
    sellingPrice: 1.2,
    vatRate: 20,
    foodCostTarget: 25,
    model: 2,
    ...fields,
  };
}

// A product with nothing said about it yet: it cannot be costed.
export function bareProduct(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return { id, name: id, components: [], packaging: [], model: 2, ...fields };
}

// A source with the flour priced and the given products.
export function sourceWith(products: StoredDoc[], extra: Parameters<typeof fakeFoodcostSource>[0] = {}): FakeFoodcostSource {
  return fakeFoodcostSource({ products, ingredients: [FLOUR], prices: FLOUR_PRICES, ...extra });
}

// The tablet's split: jsdom applies no media query, so the query is answered by hand.
export function split(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1000px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

// Those who run the place, and an employee at a venue that shows them Food cost.
export const MANAGER = { canManage: true, isOwner: false, role: 'manager' as const };
export const EMPLOYEE = {
  canManage: false,
  isOwner: false,
  role: 'staff' as const,
  location: { staffShownCards: { foodcost: true } },
};

export const LOAD = { timeout: 10_000 };
