import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { FROM_RECIPE_LINK } from '@mise/shared/recipe-link';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost, split } from '../testing/renderFoodcost';
import { entriesBehind, madeWith } from '../testing/recipeLinkHelpers';

// Step 3d-7, slice B: the way BACK to the recipe — one step of the history, never a second entry for the recipe — and
// what a product opened from a recipe (or from the list narrowed to it) carries in its address. The entry itself is in
// FoodcostSection.recipe.spec.tsx.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const DOUGH = recipe('dough', { name: 'Dough' });
const LOAF = product('Loaf', { name: 'Loaf', components: madeWith('dough') });
const ROLL = product('Roll', { name: 'Roll', components: madeWith('dough') });
const TART = product('Tart', { name: 'Tart' });

// The history the recipe's button leaves behind: the recipe, then the entry carrying the marker.
const fromRecipe = () => [
  '/recipes/dough',
  { pathname: '/food-cost', search: '?recipe=dough', state: FROM_RECIPE_LINK },
];

const where = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

const productRegion = (name: string) => within(screen.getByRole('region', { name }));
const confirmQuestion = () => screen.findByRole('alertdialog', undefined, LOAD);

describe('⚠️ Back to the recipe', () => {
  it('from the product: one step back, and the history did not grow', async () => {
    const { router, user } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([LOAF, TART], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.click(productRegion('Loaf').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(router.state.historyAction).toBe('POP');
    expect(await entriesBehind(router)).toBe(0);
  });

  it('from the list narrowed to the recipe', async () => {
    const { router, user } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([LOAF, ROLL, TART], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('from an untouched draft: no question, one step back', async () => {
    const { router, user } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([TART], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await entriesBehind(router)).toBe(0);
  });

  it('from a draft something was typed on: asks first; Cancel stays, Discard goes back to the recipe', async () => {
    const { router, user } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([TART], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    await user.type(screen.getByRole('combobox', { name: 'Name' }), '!');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    let question = await confirmQuestion();
    expect(within(question).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(where(router)).toBe('/food-cost/new?recipe=dough');
    expect(screen.getByRole('combobox', { name: 'Name' })).toHaveValue('Dough!');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    question = await confirmQuestion();
    await user.click(within(question).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('from a product something was typed on: asks first as well', async () => {
    const { router, user } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([LOAF], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.type(screen.getByRole('combobox', { name: 'Name' }), '!');
    await user.click(productRegion('Loaf').getByRole('button', { name: 'Back' }));
    const question = await confirmQuestion();
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');
    await user.click(within(question).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
  });

  it('a product that no longer exists, opened from the recipe, also goes back to the recipe', async () => {
    const { router, user } = renderFoodcost('/food-cost', {
      entries: ['/recipes/dough', { pathname: '/food-cost/product/Gone', search: '?recipe=dough', state: FROM_RECIPE_LINK }],
      source: editorSource([TART], { recipes: [DOUGH] }),
    });
    await screen.findByRole('heading', { level: 2, name: 'This product no longer exists.' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });
});

describe('Back with nothing behind it (the address was typed, or the state was lost)', () => {
  it('REPLACES itself with the recipe: one entry before, one entry after', async () => {
    const { router, user } = renderFoodcost('/food-cost/product/Loaf?recipe=dough', { source: editorSource([LOAF], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.click(productRegion('Loaf').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await entriesBehind(router)).toBe(0);
  });

  it('does the same from the narrowed list', async () => {
    const { router, user } = renderFoodcost('/food-cost?using=dough', { source: editorSource([LOAF, ROLL], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await entriesBehind(router)).toBe(0);
  });

  it('keeps the recipe behind it when the history holds some other page, not the recipe (no marker)', async () => {
    const { router, user } = renderFoodcost('/food-cost', {
      entries: ['/more', '/food-cost/product/Loaf?recipe=dough'],
      source: editorSource([LOAF], { recipes: [DOUGH] }),
    });
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.click(productRegion('Loaf').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(router.state.historyAction).toBe('REPLACE');
    // The page before is still the page before: /more, then the recipe — never the recipe twice.
    expect(await entriesBehind(router)).toBe(1);
  });
});

describe('a product picked from the narrowed list', () => {
  const open = (options: Parameters<typeof renderFoodcost>[1] = {}) => renderFoodcost('/food-cost', {
    entries: fromRecipe(), source: editorSource([LOAF, ROLL, TART], { recipes: [DOUGH] }), ...options,
  });

  it('on a phone: keeps ?using= in its address, and its Back returns to the narrowed list (one step)', async () => {
    const { router, user } = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Loaf/ }));
    expect(where(router)).toBe('/food-cost/product/Loaf?using=dough');
    expect(router.state.historyAction).toBe('PUSH');

    await user.click(productRegion('Loaf').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost?using=dough'); });
    expect(router.state.historyAction).toBe('POP');
    expect(screen.getByRole('heading', { level: 2, name: 'Products with “Dough”' })).toBeInTheDocument();
    // Narrowed list, then the recipe: nothing in between.
    expect(await entriesBehind(router)).toBe(1);
  });

  it('on a phone: its Back goes to the narrowed list even when the address was typed (no entry behind)', async () => {
    const { router, user } = renderFoodcost('/food-cost/product/Loaf?using=dough', { source: editorSource([LOAF, ROLL], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.click(productRegion('Loaf').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost?using=dough'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('on the split: the column stays narrowed beside the product, and another product replaces it', async () => {
    split();
    const { router, user } = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Loaf/ }));
    expect(where(router)).toBe('/food-cost/product/Loaf?using=dough');
    expect(await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Products with “Dough”' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tart/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Roll/ }));
    expect(where(router)).toBe('/food-cost/product/Roll?using=dough');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('heading', { level: 2, name: 'Roll' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Products with “Dough”' })).toBeInTheDocument();
  });

  it('«Show all» beside an open product keeps the product open and drops the narrowing', async () => {
    split();
    const { router, user } = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Loaf/ }));
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(where(router)).toBe('/food-cost/product/Loaf');
    expect(screen.queryByRole('heading', { level: 2, name: /^Products with/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Loaf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Tart/ })).toBeInTheDocument();
  });

  it('a product picked from the PLAIN list does not carry the recipe', async () => {
    const { router, user } = renderFoodcost('/food-cost', { source: editorSource([LOAF, TART], { recipes: [DOUGH] }) });
    await user.click(await screen.findByRole('button', { name: /^Tart/ }, LOAD));
    expect(where(router)).toBe('/food-cost/product/Tart');
  });
});

describe('the margin history of a product opened from a recipe', () => {
  const POINT = { id: 'h1', recordedAt: '2026-10-14T09:00:00.000Z', foodCostPct: 30, unitCost: 0.3, sellingPrice: 1, vatRate: 0 };

  it.each([
    ['recipe', '?recipe=dough'],
    ['using', '?using=dough'],
  ])('keeps ?%s= in its address, and its Back returns to the product with the same query', async (_name, query) => {
    const { router, user } = renderFoodcost('/food-cost', {
      entries: ['/recipes/dough', { pathname: '/food-cost/product/Loaf', search: query, state: FROM_RECIPE_LINK }],
      source: editorSource([LOAF], { recipes: [DOUGH], history: { Loaf: [POINT] } }),
    });
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Margin history' }));
    expect(where(router)).toBe(`/food-cost/product/Loaf/history${query}`);
    expect(await screen.findByText('30%', undefined, LOAD)).toBeInTheDocument();

    await user.click(within(screen.getByRole('region', { name: 'Margin history' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe(`/food-cost/product/Loaf${query}`); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD)).toBeInTheDocument();
  });

  it('opened by its address, Back replaces it with the product, query and all', async () => {
    const { router, user } = renderFoodcost('/food-cost/product/Loaf/history?recipe=dough', {
      source: editorSource([LOAF], { recipes: [DOUGH], history: { Loaf: [POINT] } }),
    });
    await screen.findByText('30%', undefined, LOAD);
    await user.click(within(screen.getByRole('region', { name: 'Margin history' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('⚠️ a draft opened too early gives way to the real product', () => {
  // The draft is opened while the products answer «none»; then a product made with the recipe arrives (a slow first
  // load, another phone). Saving the draft would be a duplicate with a margin history of its own.
  const lateProduct = (fake: ReturnType<typeof editorSource>) => {
    fake.products.set('Loaf', { ...LOAF });
    act(() => { fake.push(); });
  };

  it('untouched: it hands over to the entry, which lands on the product — replacing, nothing saved', async () => {
    const fake = editorSource([TART], { recipes: [DOUGH] });
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);

    lateProduct(fake);
    expect(await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fake.saved).toHaveLength(0);
    // Back from it is still the recipe, with nothing extra in between.
    expect(await entriesBehind(router)).toBe(1);
  });

  it('untouched, and two products turn up: the list narrowed to them', async () => {
    const fake = editorSource([TART], { recipes: [DOUGH] });
    const { router } = renderFoodcost('/food-cost/new?recipe=dough', { source: fake });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);

    fake.products.set('Loaf', { ...LOAF });
    fake.products.set('Roll', { ...ROLL });
    act(() => { fake.push(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost?using=dough');
  });

  it('once something is typed it does NOT give way: what was typed is kept', async () => {
    const fake = editorSource([TART], { recipes: [DOUGH] });
    const { router, user } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    await user.type(screen.getByRole('combobox', { name: 'Name' }), '!');

    lateProduct(fake);
    await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 200); }); });
    expect(where(router)).toBe('/food-cost/new?recipe=dough');
    expect(screen.getByRole('combobox', { name: 'Name' })).toHaveValue('Dough!');
    expect(screen.getByRole('heading', { level: 2, name: 'New product' })).toBeInTheDocument();
  });

  it('a draft opened with nothing made yet stays a draft', async () => {
    const fake = editorSource([TART], { recipes: [DOUGH] });
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    act(() => { fake.push(); });
    await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 100); }); });
    expect(where(router)).toBe('/food-cost/new?recipe=dough');
  });
});
