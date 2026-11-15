import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen } from '@testing-library/react';
import { FROM_RECIPE_LINK } from '@mise/shared/recipe-link';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';
import { entriesBehind, madeWith } from '../testing/recipeLinkHelpers';

// Under StrictMode every effect runs twice: the entry must still move ONCE, replacing itself — a second move would
// push the target a second time, or leave the entry between the recipe and the product.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./FoodcostSection');
}, 60_000);

afterAll(() => { configure({ reactStrictMode: false }); });

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const fromRecipe = () => ['/recipes/dough', { pathname: '/food-cost', search: '?recipe=dough', state: FROM_RECIPE_LINK }];
const DOUGH = recipe('dough', { name: 'Dough' });
const LOAF = product('Loaf', { name: 'Loaf', components: madeWith('dough') });
const ROLL = product('Roll', { name: 'Roll', components: madeWith('dough') });

describe('under StrictMode: the entry from a recipe', () => {
  it.each([
    ['one product', [LOAF], '/food-cost/product/Loaf', 'Loaf'],
    ['several products', [LOAF, ROLL], '/food-cost', 'Products with “Dough”'],
    ['no product', [], '/food-cost/new', 'New product'],
  ])('with %s it moves once and replaces itself', async (_name, products, pathname, title) => {
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource(products, { recipes: [DOUGH] }) });
    const moves = vi.spyOn(router, 'navigate');
    expect(await screen.findByRole('heading', { level: 2, name: title }, LOAD)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(pathname);
    expect(router.state.historyAction).toBe('REPLACE');
    // The effect ran twice; the move was made once.
    expect(moves.mock.calls.filter(([to]) => typeof to === 'string' && to.startsWith('/food-cost'))).toHaveLength(1);
    expect(await entriesBehind(router)).toBe(1);
  });
});
