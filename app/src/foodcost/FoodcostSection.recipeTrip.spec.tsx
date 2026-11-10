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
    await user.click(await screen.findByRole('button', { name: 'Open the card' }, LOAD));
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
  // The recipe, then the narrowed list with the product it ranks first beside it (item 23: the entry opens it — here Loaf,
  // both being unpriced, by name). Another product picked from the list replaces it beside the list (a lateral move, same
  // depth); the list's Back must reach the recipe, never push a second one. (A product PUSHED from the list at depth 2 is
  // the phone turned into the split, FoodcostSection.recipeFixes.spec.tsx.)
  async function narrowedOnSplit() {
    split();
    const trip = await openTheRecipe([LOAF, ROLL, TART]);
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await screen.findByRole('region', { name: 'Loaf' }, LOAD);
    expect(where(trip.router)).toBe('/food-cost/product/Loaf?using=dough');
    return trip;
  }
  async function narrowedWithProduct(name: string) {
    const trip = await narrowedOnSplit();
    await trip.user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
    await screen.findByRole('region', { name }, LOAD);
    return trip;
  }
  const listBack = () => within(screen.getByRole('main')).getAllByRole('button', { name: 'Back' })[0]!;

  it('the product the entry opened beside the list: the list’s Back is the recipe, with no second entry', async () => {
    const { router, user } = await narrowedOnSplit();
    await user.click(listBack());
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  // Code review of item 23: the entry's product sits at depth 1 and not «from the list»; its own Back replaced it with the
  // list WITHOUT the depth, and the list's Back then put the recipe in the history a second time.
  it('⚠️ that product’s OWN Back, then the list’s Back: the recipe, with no second entry', async () => {
    const { router, user } = await narrowedOnSplit();
    await user.click(within(screen.getByRole('region', { name: 'Loaf' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost?using=dough'); });
    expect(screen.getByText('Choose a product')).toBeInTheDocument();
    await user.click(listBack());
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('another product picked from the list (a lateral replace): the list’s Back is the recipe, with no second entry', async () => {
    const { router, user } = await narrowedWithProduct('Roll');
    await user.click(listBack());
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('another product picked from the list, its own Back, then the list’s Back: the recipe, with no second entry', async () => {
    const { router, user } = await narrowedWithProduct('Roll');
    await user.click(within(screen.getByRole('region', { name: 'Roll' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost?using=dough'); });
    await user.click(listBack());
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('its margin history beside the list: the list’s Back is the recipe, with no second entry', async () => {
    const { router, user } = await narrowedWithProduct('Roll');
    await user.click(within(screen.getByRole('region', { name: 'Roll' })).getByRole('button', { name: 'Margin history' }));
    await screen.findByRole('region', { name: 'Margin history' }, LOAD);
    await user.click(listBack());
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('a second lateral move, back to the first product: the list’s Back is the recipe, with no second entry', async () => {
    const { router, user } = await narrowedWithProduct('Roll');
    await user.click(screen.getByRole('button', { name: /^Loaf/ }));
    await screen.findByRole('region', { name: 'Loaf' }, LOAD);
    await user.click(listBack());
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
