import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { FROM_RECIPE_LINK } from '@mise/shared/recipe-link';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';
import { entriesBehind, madeWith } from '../testing/recipeLinkHelpers';

// Step 3d-7, slice B: Food cost opened from a recipe — the ENTRY (`/food-cost?recipe=<id>`) that decides, once, where
// the recipe goes: its only product, the list narrowed to its products, a new product drafted from it, or the plain
// list. Back to the recipe is in FoodcostSection.recipeBack.spec.tsx.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const DOUGH = recipe('dough', { name: 'Dough' });
const LOAF = product('Loaf', { name: 'Loaf', components: madeWith('dough') });
const ROLL = product('Roll', { name: 'Roll', components: madeWith('dough') });
const TART = product('Tart', { name: 'Tart' });

// The history the recipe's button leaves behind: the recipe, then the entry carrying the marker.
const fromRecipe = (id = 'dough') => [
  '/recipes/' + id,
  { pathname: '/food-cost', search: `?recipe=${id}`, state: FROM_RECIPE_LINK },
];

const where = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

describe('the entry: one product is made with the recipe', () => {
  it('lands on that product, REPLACING the entry — Back from it will be the recipe, not this address', async () => {
    const { router } = renderFoodcost('/food-cost', {
      entries: fromRecipe(),
      source: editorSource([LOAF, TART], { recipes: [DOUGH] }),
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.state).toMatchObject({ fromRecipeLink: true });
    // The recipe, and this product: the entry address is not left between them.
    expect(await entriesBehind(router)).toBe(1);
  });

  it('puts the focus on the product’s title', async () => {
    renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([LOAF, TART], { recipes: [DOUGH] }) });
    const title = await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await vi.waitFor(() => { expect(title).toHaveFocus(); });
  });

  it('draws only «Loading…» while it decides', async () => {
    const fake = editorSource([LOAF], { recipes: [DOUGH] });
    fake.hold();
    renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    const loading = await screen.findAllByText('Loading…', undefined, LOAD);
    expect(loading.length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });
});

describe('the entry: several products are made with the recipe', () => {
  const open = (options: Parameters<typeof renderFoodcost>[1] = {}) => renderFoodcost('/food-cost', {
    entries: fromRecipe(), source: editorSource([LOAF, ROLL, TART], { recipes: [DOUGH] }), ...options,
  });

  it('lands on the list narrowed to them, named after the recipe', async () => {
    const { router } = open();
    expect(await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost?using=dough');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await entriesBehind(router)).toBe(1);
  });

  it('lists only those products, and takes the focus on the narrowed title', async () => {
    open();
    const title = await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    expect(await screen.findByRole('button', { name: /^Loaf/ }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Roll/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tart/ })).not.toBeInTheDocument();
    await vi.waitFor(() => { expect(title).toHaveFocus(); });
  });

  it('«Show all» REPLACES the narrowed list with the plain one, and every product is listed', async () => {
    const { router, user } = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(where(router)).toBe('/food-cost');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('heading', { level: 2, name: /^Products with/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Tart/ }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Loaf/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Roll/ })).toBeInTheDocument();
    // Still one entry behind it: the recipe.
    expect(await entriesBehind(router)).toBe(1);
  });

  it('says «Products with this recipe» when the recipe has no name', async () => {
    renderFoodcost('/food-cost', {
      entries: fromRecipe(),
      source: editorSource([LOAF, ROLL], { recipes: [recipe('dough', { name: '' })] }),
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Products with this recipe' }, LOAD)).toBeInTheDocument();
  });

  it('speaks Italian: «Prodotti con «Dough»», «Mostra tutti»', async () => {
    renderFoodcost('/food-cost', {
      entries: fromRecipe(),
      source: editorSource([LOAF, ROLL], { recipes: [DOUGH] }),
      lang: 'it',
      session: { language: 'it' },
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Prodotti con «Dough»' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostra tutti' })).toBeInTheDocument();
  });
});

describe('the entry: no product is made with the recipe', () => {
  it('lands on a new product drafted from the recipe: its name and its line, no number invented', async () => {
    const { router } = renderFoodcost('/food-cost', {
      entries: fromRecipe(),
      source: editorSource([TART], { recipes: [DOUGH] }),
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost/new?recipe=dough');
    expect(router.state.historyAction).toBe('REPLACE');

    expect(screen.getByRole('combobox', { name: 'Name' })).toHaveValue('Dough');
    expect(await screen.findByRole('button', { name: 'Change: Dough' }, LOAD)).toBeInTheDocument();
    // draftFromRecipe says the recipe on the first line and NOTHING else: no way of selling, price or VAT.
    expect(screen.getByRole('textbox', { name: 'Selling price, including VAT (£)' })).toHaveValue('');
    expect(screen.queryByRole('textbox', { name: /^How many pieces come out of one batch/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Margin history' })).not.toBeInTheDocument();
    // Asked last: it walks the history back to its first entry.
    expect(await entriesBehind(router)).toBe(1);
  });

  it('puts the focus on the new product’s title', async () => {
    renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([TART], { recipes: [DOUGH] }) });
    const title = await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    await vi.waitFor(() => { expect(title).toHaveFocus(); });
  });

  it('writes nothing until Save: the entry only opens a draft', async () => {
    const fake = editorSource([TART], { recipes: [DOUGH] });
    renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    expect(fake.saved).toHaveLength(0);
  });
});

describe('the entry: a recipe that is not there', () => {
  it('lands on the plain list once the recipes have answered', async () => {
    const { router } = renderFoodcost('/food-cost', {
      entries: fromRecipe('ghost'),
      source: editorSource([LOAF, TART], { recipes: [DOUGH] }),
    });
    expect(await screen.findByRole('button', { name: /^Tart/ }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('heading', { level: 2, name: /^Products with/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'New product' })).not.toBeInTheDocument();
  });
});

describe('⚠️ the entry waits for the server', () => {
  const cached = () => {
    window.localStorage.setItem('foodcost-products', JSON.stringify([LOAF]));
  };

  it('keeps «Loading…» and does not move while the products are only the phone’s copy; moves when the server answers', async () => {
    cached();
    const fake = editorSource([LOAF, ROLL], { recipes: [DOUGH] });
    fake.hold();
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    // The copy alone would send this person to the only product it holds; the server knows of two.
    await act(async () => { await wait(200); });
    expect(where(router)).toBe('/food-cost?recipe=dough');
    expect(router.state.historyAction).toBe('POP');

    act(() => { fake.release(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost?using=dough');
  });

  it('does not offer a draft for a product that exists but has not been heard yet', async () => {
    const fake = editorSource([LOAF], { recipes: [DOUGH] });
    fake.hold();
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    await screen.findAllByText('Loading…', undefined, LOAD);
    await act(async () => { await wait(200); });
    expect(where(router)).toBe('/food-cost?recipe=dough');
    act(() => { fake.release(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');
  });

  it('decides after COPY_WAIT_MS with what the phone has when the server never answers', async () => {
    cached();
    const fake = editorSource([], { recipes: [DOUGH] });
    fake.hold();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    // React holds a revealed section back for a few hundred ms of its own: let the entry mount first.
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    expect(where(router)).toBe('/food-cost?recipe=dough');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(where(router)).toBe('/food-cost?recipe=dough');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('decides at once, with no waiting, when there is no signal', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    cached();
    const fake = editorSource([], { recipes: [DOUGH] });
    fake.hold();
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    expect(await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost/product/Loaf?recipe=dough');
  });

  it('waits for the recipes too when the recipe is not known yet, then decides', async () => {
    const fake = editorSource([TART], { recipes: [DOUGH] });
    let deliver: () => void = () => undefined;
    vi.mocked(fake.watchRecipes).mockImplementation(onChange => {
      deliver = () => { onChange([...fake.recipes.values()], { fromServer: true }); };
      return () => undefined;
    });
    const { router } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: fake });
    await screen.findAllByText('Loading…', undefined, LOAD);
    await act(async () => { await wait(200); });
    expect(where(router)).toBe('/food-cost?recipe=dough');
    act(() => { deliver(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD)).toBeInTheDocument();
  });
});

describe('a product opened from the entry, in the list beside it', () => {
  it('is not a second screen: the list of all the products is not narrowed by the recipe', async () => {
    renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([LOAF, TART], { recipes: [DOUGH] }) });
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    const list = screen.getByRole('button', { name: /^Tart/ });
    expect(within(list.closest('ul')!).getAllByRole('button')).toHaveLength(2);
  });
});
