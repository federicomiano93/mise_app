import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { currentProduct } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { FLOUR, FLOUR_PRICES, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// Product model 3: the oven loss belongs to the PRODUCT (rawGrams / cookedGrams) and a recipe line is RAW kilos. What the SCREENS do
// with a product saved before (model 2): it waits for the recipes and the prices, shows the converted lines, and Save writes model 3.
// The conversion itself is shared/src/foodcost-model.spec.ts.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const pencil = () => screen.findByRole('button', { name: 'Edit product' }, LOAD);
const cardNamed = (name: string) => screen.getByRole('region', { name });
const rowOf = (scope: HTMLElement, label: string): HTMLElement =>
  within(scope).getByText(label, { selector: 'dt' }).parentElement as HTMLElement;

// A recipe of one kilo of flour (£2.00 a kilo raw) that loses 10% in the oven: 0.9 kg come out.
const DOUGH = recipe('Dough', { lossPct: 10 });
// The product as production holds it today: model 2, the line in FINISHED kilos.
const LEGACY = product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 0.9 }], model: 2 });

// The same product, converted on the very tables the screen has: what the expected figures are computed from.
const converted = (): Product => {
  const tables = {
    recipes: { Dough: DOUGH },
    ingredients: { flour: { ...FLOUR, ...FLOUR_PRICES.flour } },
  };
  const out = currentProduct(LEGACY, tables as never);
  if (!out) throw new Error('not converted');
  return out;
};

describe('a product saved before model 3 (production today)', () => {
  it('(i) waits for the prices: loading at its address, neither the read view nor the form, then it opens', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdIngredients();
    renderFoodcost('/food-cost/product/Loaf', { source: fake });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    // Give the screen every chance to open on unconverted lines.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Made of' })).not.toBeInTheDocument();

    act(() => { fake.releaseIngredients(); });
    expect(await pencil()).toBeInTheDocument();
  });

  it('(ii) reads the line in RAW kilos, with the raw weight, the cooked weight and the loss of the product', async () => {
    renderFoodcost('/food-cost/product/Loaf', { source: editorSource([LEGACY], { recipes: [DOUGH] }) });
    await pencil();
    const made = cardNamed('Made of');
    // The line is the converted one, never the 0.9 kg stored: 0.9 kg of a dough that loses 10% was ONE kilo raw — the round
    // weight a person typed, never «999.99 g» (the conversion takes the roundest weight that keeps the cost).
    expect(rowOf(made, 'Dough')).toHaveTextContent('1.00 kg');
    expect(rowOf(made, 'Dough')).not.toHaveTextContent('900.00 g');
    // The weighings are written in grams, as they are typed.
    expect(rowOf(made, 'Raw dough')).toHaveTextContent('1000.00 g');
    expect(rowOf(made, 'Cooked dough')).toHaveTextContent('900.00 g');
    expect(rowOf(made, 'Oven loss')).toHaveTextContent('10.00%');
  });

  it('(iii)(iv) Save without changes writes model 3 with the raw kilos and the cooked weight, no flag, no margin point, and the cost does not move', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    await pencil();
    const costBefore = screen.getByRole('group', { name: 'Production cost' }).textContent;
    await user.click(screen.getByRole('button', { name: 'Edit product' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }, LOAD));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Save' }));
    await screen.findByText('Product saved.');

    const now = converted();
    expect(fake.saved.map(write => write.kind)).toEqual(['product']);
    expect(fake.saved[0]).toMatchObject({ snapshot: null, data: { model: 3, components: now.components, cookedGrams: now.cookedGrams } });
    expect(fake.saved[0]?.data).not.toHaveProperty('noWeightLoss');
    expect(fake.saved[0]?.data).not.toHaveProperty('rawGrams');

    // Back on the read view of what was saved (a model 3 product now): the same cost.
    await pencil();
    expect(screen.getByRole('group', { name: 'Production cost' }).textContent).toBe(costBefore);
  });
});

describe('the cooking of a model 3 product, read', () => {
  it('(d) a cooked weight heavier than the raw one shows the red warning and no «Oven loss» row', async () => {
    const heavy = product('Heavy', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 1200, model: 3 });
    renderFoodcost('/food-cost/product/Heavy', { source: editorSource([heavy], { recipes: [DOUGH] }) });
    await pencil();
    const made = cardNamed('Made of');
    expect(within(made).getByText('The cooked dough cannot weigh more than the raw dough.')).toBeInTheDocument();
    expect(within(made).queryByText('Oven loss', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('(d) a product with recipe lines and no cooked weight says «No oven loss.»', async () => {
    const plain = product('Plain', { components: [{ recipeId: 'Dough', qtyKg: 1 }], model: 3 });
    renderFoodcost('/food-cost/product/Plain', { source: editorSource([plain], { recipes: [DOUGH] }) });
    await pencil();
    expect(cardNamed('Made of')).toHaveTextContent('No oven loss.');
  });
});
