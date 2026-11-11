import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// Food cost shows every figure with exactly TWO decimals, in the venue's own layout (the owner, 8 Nov 2026; current app 151ea191,
// tests/foodcost-two-decimals-render.test.mjs). What the existing Mise 2 screens DRAW: the list row, the answer, the labour line, the
// weighing sentence, the packaging note and the margin history. Only the text changes: the boxes a person types in are untouched.
// The screens Mise 2 does not have yet (the per-kg block, the list preview, the read sections, the line costs) come with their own slices.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// jest-dom and Testing Library normalise a no-break space to a plain one in the text they read, not in the text they are given.
const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;
const madeOf = () => screen.getByRole('region', { name: /^(Made of|Composto da)$/ });

describe('a venue in Italy', () => {
  it('writes the list row with two decimals and the comma: «40,00%», «0,20 €», and «< 0,01 €» for a cost under a cent', async () => {
    const fake = editorSource([
      product('Rosso', { sellingPrice: 0.5, vatRate: 0 }),
      product('Pizzico', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1, unit: 'g' }], piecesPerBatch: 1, sellingPrice: 1, vatRate: 0 }),
    ]);
    renderFoodcost('/food-cost', { source: fake, ...ITALY });
    const rosso = await screen.findByRole('button', { name: /^Rosso/ }, LOAD);
    expect(rosso).toHaveTextContent('40,00%');
    expect(rosso).toHaveTextContent(`0,20 € di costo`);
    expect(rosso).toHaveTextContent(`0,30 € di margine`);
    // A gram of flour at 2 € a kilo is 0,002 €: a real cost never reads as «0,00 €» (free).
    const pizzico = screen.getByRole('button', { name: /^Pizzico/ });
    expect(pizzico).toHaveTextContent(`< 0,01 € di costo`);
    expect(pizzico).not.toHaveTextContent(/[^,\d]0,00/);
  });

  it('writes the answer, the production cost and the labour lines with two decimals and the comma', async () => {
    const fake = editorSource(
      [product('Loaf', { labourMinutes: 60, labourPeople: 1, foodCostTarget: 25 })],
      { settings: { labourCostPerHour: 12 } },
    );
    renderFoodcost('/food-cost/product/Loaf', { source: fake, ...ITALY });
    const answer = await screen.findByRole('group', { name: 'Food cost' }, LOAD);
    await vi.waitFor(() => { expect(answer).toHaveTextContent('Lavoro 120,00% · tutto 140,00%'); });
    expect(answer).toHaveTextContent('20,00%');
    expect(screen.getByRole('group', { name: 'Costo di produzione' })).toHaveTextContent('0,20 €');
    expect(screen.getByRole('group', { name: 'Prezzo consigliato' })).toHaveTextContent('Con IVA al 20,00%, per un food cost del 25,00%.');
  });

  it('writes a product’s oven loss as 12,00%, in the layout of the venue', async () => {
    const fake = editorSource(
      [product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 880, model: 3 })],
      { recipes: [recipe('Dough')] },
    );
    renderFoodcost('/food-cost/product/Loaf', { source: fake, ...ITALY });
    const made = await screen.findByRole('region', { name: 'Cottura' }, LOAD);
    expect(within(made).getByText('Calo', { selector: 'dt' }).parentElement).toHaveTextContent('12,00%');
  });
});

describe('a venue in Britain', () => {
  it('writes a packaging note with two decimals, and «< £0.01» for a price under a cent', async () => {
    const fake = editorSource(
      [product('Green', { packaging: [{ ingredientId: 'box', qtyPcs: 3 }] })],
      { prices: { flour: { priceUnit: 'kg', pricePerUnit: 2 }, box: { priceUnit: 'pcs', pricePerUnit: 0.004 } } },
    );
    renderFoodcost('/food-cost/product/Green', { source: fake });
    const packaging = await screen.findByRole('region', { name: 'Packaging' }, LOAD);
    // 3 boxes at 0.004 each is 0.012 in all: «£0.01», while one box alone is under a cent.
    expect(within(packaging).getByText(`< £0.01 each · this amount £0.01`)).toBeInTheDocument();
  });

  it('writes a product’s oven loss as «12.00%»', async () => {
    const fake = editorSource(
      [product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 880, model: 3 })],
      { recipes: [recipe('Dough')] },
    );
    renderFoodcost('/food-cost/product/Loaf', { source: fake });
    const made = await screen.findByRole('region', { name: 'Baking' }, LOAD);
    expect(within(made).getByText('Oven loss', { selector: 'dt' }).parentElement).toHaveTextContent('12.00%');
  });
});
