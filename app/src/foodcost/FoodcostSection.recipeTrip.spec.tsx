import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { renderApp } from '../testing/renderApp';
import { entriesBehind, madeWith } from '../testing/recipeLinkHelpers';
import { LOAD, product, split } from '../testing/renderFoodcost';
import { recipe as catalogueRecipe } from '../testing/renderRecipes';

// Step 3d-7, slice B: the whole trip — the recipe's «Open in Food cost» button, Food cost, Back — through the real
// router and both sections. The current app showed TWO pages for the recipe per trip; here the history after the
// trip must be exactly what it was before it.

beforeAll(async () => {
  await import('./FoodcostSection');
  await import('../recipes/RecipesSection');
}, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const where = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

const LOAF = product('Loaf', { name: 'Loaf', components: madeWith('dough') });
const ROLL = product('Roll', { name: 'Roll', components: madeWith('dough') });
const TART = product('Tart', { name: 'Tart' });

async function openTheRecipe(products: ReturnType<typeof product>[]) {
  const recipes = fakeRecipesSource({ recipes: [catalogueRecipe('dough', { name: 'Dough' })] });
  const foodcost = editorSource(products, { recipes: [recipe('dough', { name: 'Dough' })] });
  const view = renderApp('/recipes/dough', { data: { recipes: () => recipes, foodcost: () => foodcost } });
  await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
  await view.user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Open in Food cost' }));
  return { ...view, foodcost };
}

describe('⚠️ the trip from the recipe and back', () => {
  it('one product: the recipe, the product, Back is the recipe, and the history is as it was', async () => {
    const { router, user } = await openTheRecipe([LOAF, TART]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');

    await user.click(within(screen.getByRole('region', { name: 'Loaf' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD)).toBeInTheDocument();
    // The recipe was the first entry, and it still is the only one before this.
    expect(await entriesBehind(router)).toBe(0);
  });

  it('several products: the narrowed list, Back is the recipe', async () => {
    const { router, user } = await openTheRecipe([LOAF, ROLL, TART]);
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD)).toBeInTheDocument();
    expect(await entriesBehind(router)).toBe(0);
  });

  it('several products, one opened and left: still one step to the recipe, through the narrowed list', async () => {
    const { router, user } = await openTheRecipe([LOAF, ROLL, TART]);
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Loaf/ }));
    await user.click(within(screen.getByRole('region', { name: 'Loaf' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost?using=dough'); });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('no product: the draft, Back is the recipe', async () => {
    const { router, user } = await openTheRecipe([TART]);
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD)).toBeInTheDocument();
    expect(await entriesBehind(router)).toBe(0);
  });

  it('exactly one entry sits between the start and the product: the recipe', async () => {
    const { router } = await openTheRecipe([LOAF]);
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');
    expect(await entriesBehind(router)).toBe(1);
    expect(where(router)).toBe('/recipes/dough');
  });
});

describe('⚠️ the same trip on the split: Back counts the entries between the list and the recipe', () => {
  // The recipe, the narrowed list, and a product beside it: the list's Back must reach the recipe, not push a second one.
  async function narrowedWithProduct(name: string) {
    split();
    const trip = await openTheRecipe([LOAF, ROLL, TART]);
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await trip.user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
    await screen.findByRole('region', { name }, LOAD);
    return trip;
  }

  it('a product opened beside the narrowed list: the list’s Back is the recipe, with no second entry', async () => {
    const { router, user } = await narrowedWithProduct('Loaf');
    await user.click(within(screen.getByRole('main')).getAllByRole('button', { name: 'Back' })[0]!);
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('its margin history beside the list: the list’s Back is the recipe, with no second entry', async () => {
    const { router, user } = await narrowedWithProduct('Loaf');
    await user.click(within(screen.getByRole('region', { name: 'Loaf' })).getByRole('button', { name: 'Margin history' }));
    await screen.findByRole('region', { name: 'Margin history' }, LOAD);
    await user.click(within(screen.getByRole('main')).getAllByRole('button', { name: 'Back' })[0]!);
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('a lateral move to another product: the list’s Back is the recipe, with no second entry', async () => {
    const { router, user } = await narrowedWithProduct('Loaf');
    await user.click(screen.getByRole('button', { name: /^Roll/ }));
    await screen.findByRole('region', { name: 'Roll' }, LOAD);
    await user.click(within(screen.getByRole('main')).getAllByRole('button', { name: 'Back' })[0]!);
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });
});

describe('⚠️ Back brings the recipe back as it was left', () => {
  it('the focus is on «Open in Food cost» and the scroll is where it was', async () => {
    const recipes = fakeRecipesSource({ recipes: [catalogueRecipe('dough', { name: 'Dough' })] });
    const foodcost = editorSource([LOAF, TART], { recipes: [recipe('dough', { name: 'Dough' })] });
    const { router, user } = renderApp('/recipes/dough', { data: { recipes: () => recipes, foodcost: () => foodcost } });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    const area = screen.getByRole('main');
    Object.defineProperty(area, 'scrollTop', { value: 0, writable: true });
    area.scrollTop = 240;
    await user.click(within(area).getByRole('button', { name: 'Open in Food cost' }));
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);

    await user.click(within(screen.getByRole('region', { name: 'Loaf' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    const door = await within(area).findByRole('button', { name: 'Open in Food cost' }, LOAD);
    await waitFor(() => { expect(door).toHaveFocus(); });
    expect(area.scrollTop).toBe(240);
  });
});
