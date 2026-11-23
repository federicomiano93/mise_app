import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { renderApp } from '../testing/renderApp';
import { entriesBehind } from '../testing/recipeLinkHelpers';
import { LOAD, split } from '../testing/renderRecipes';
import { carriedGaps } from './recipeReturn';
import type { StoredDoc } from './recipesSource';

// The detours a gap of the allergen card can make, and what must hold on the way back: the card open, the focus on the row that was
// tapped, ONE history step, and no stale place left behind to fire on a later, unrelated open.

beforeAll(async () => {
  await import('./RecipesSection');
  await import('../suppliers/SuppliersSection');
}, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

const row = (label: string, extra: Record<string, unknown> = {}) => ({ label, grams: 100, unit: 'g', ...extra });
// «Tart» holds a sub-recipe («Custard») that is itself incomplete in two ways: a row nobody linked, and a nested sub-recipe.
const TART: StoredDoc = { id: 'tart', name: 'Tart', ingredients: [row('Filling', { kind: 'recipe', refId: 'custard' }), row('Yeast', { refId: 'yeast' })] };
const CUSTARD: StoredDoc = { id: 'custard', name: 'Custard', ingredients: [row('Mystery'), row('Sauce', { kind: 'recipe', refId: 'sauce' })] };
const SAUCE: StoredDoc = { id: 'sauce', name: 'Sauce', ingredients: [row('Unknown')] };
const OTHER: StoredDoc = { id: 'other', name: 'Other', ingredients: [row('Salt', { refId: 'salt' })] };
const YEAST: StoredDoc = { id: 'yeast', name: 'Yeast', allergens: [] };
const SALT: StoredDoc = { id: 'salt', name: 'Salt', allergens: [], allergensCheckedAt: '2026-01-01' };
const FILLING = 'Filling the linked recipe is not fully declared';
const MYSTERY = 'Mystery not linked to an ingredient';

async function open(path: string, recipes: StoredDoc[] = [TART, CUSTARD, SAUCE, OTHER]) {
  const ingredients = [YEAST, SALT];
  const recipeSource = fakeRecipesSource({ recipes, ingredients });
  const supplierSource = fakeSuppliersSource({ ingredients });
  const view = renderApp(path, { data: { recipes: () => recipeSource, suppliers: () => supplierSource } });
  await screen.findByRole('table', undefined, LOAD);
  return { ...view, recipeSource, supplierSource };
}

const toggle = () => within(screen.getByRole('main')).getByRole('button', { name: /^Allergens/ });
const gap = (name: string) => within(screen.getByRole('main')).getAllByRole('list').flatMap(list => within(list).queryAllByRole('button', { name })).at(-1)!;
const where = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname;
const answer = async (user: { click: (el: Element) => Promise<void> }, dialogName: string, button: string) => {
  await user.click(within(await screen.findByRole('alertdialog', { name: dialogName })).getByRole('button', { name: button }));
};
const backFromHere = (user: { click: (el: Element) => Promise<void> }) => user.click(screen.getByRole('button', { name: 'Back' }));

describe('a detour made from a sub-recipe opened from a gap', () => {
  it('A: sub-recipe → its Edit → Back → Back: the parent is open again, the focus on the row, one history step', async () => {
    const { user, router } = await open('/recipes/tart');
    await user.click(toggle());
    await user.click(gap(FILLING));
    expect(where(router)).toBe('/recipes/custard');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(where(router)).toBe('/recipes/custard/edit');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(where(router)).toBe('/recipes/custard');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await screen.findByRole('table', undefined, LOAD);
    expect(where(router)).toBe('/recipes/tart');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => { expect(gap(FILLING)).toHaveFocus(); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('B: a gap of the sub-recipe itself, then Back and Back: the parent’s row is focused, and the sub-recipe opens closed afresh later', async () => {
    const { user, router } = await open('/recipes/tart');
    await user.click(toggle());
    await user.click(gap(FILLING));
    await user.click(toggle());
    await user.click(gap(MYSTERY));
    expect(where(router)).toBe('/recipes/custard/edit');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    // Back on the sub-recipe: its own card is open on its own row.
    await waitFor(() => { expect(gap(MYSTERY)).toHaveFocus(); });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('table', undefined, LOAD);
    expect(where(router)).toBe('/recipes/tart');
    await waitFor(() => { expect(gap(FILLING)).toHaveFocus(); });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    // ⚠️ Nothing stale: the sub-recipe opened afresh (list, then its address) has its card closed and takes no focus.
    await act(async () => { await router.navigate('/recipes'); });
    await act(async () => { await router.navigate('/recipes/custard'); });
    await waitFor(() => { expect(toggle()).toHaveAttribute('aria-expanded', 'false'); });
    expect(toggle()).not.toHaveFocus();
  });

  it('4: Save in the sub-recipe’s editor steps back to the sub-recipe only, and Delete to the recipe whose gap it was', async () => {
    const { user, router } = await open('/recipes/tart');
    await user.click(toggle());
    await user.click(gap(FILLING));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = within(await screen.findByRole('region', { name: 'Edit recipe' }));
    const name = region.getByRole('textbox', { name: 'Recipe name' });
    await user.clear(name);
    await user.type(name, 'Custard 2');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await answer(user, 'Save recipe?', 'Save');
    await waitFor(() => { expect(where(router)).toBe('/recipes/custard'); });
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'Edit recipe' })).not.toBeInTheDocument(); });
    // Not the list, and no list row owed the focus: one more Back reaches the parent.
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(where(router)).toBe('/recipes/tart');
    expect(await entriesBehind(router)).toBe(0);
  });

  it('4: a Delete in that editor lands on the parent', async () => {
    const { user, router } = await open('/recipes/tart', [TART, CUSTARD, SAUCE, OTHER]);
    await user.click(toggle());
    await user.click(gap(FILLING));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = within(await screen.findByRole('region', { name: 'Edit recipe' }));
    await user.click(region.getByRole('button', { name: 'Delete recipe' }));
    await answer(user, 'Delete recipe?', 'Delete');
    await waitFor(() => { expect(where(router)).toBe('/recipes/tart'); });
    expect(await entriesBehind(router)).toBe(0);
  });
});

describe('what is carried to another section', () => {
  it('2: only a trip to Suppliers is carried; a sub-recipe or the editor stays inside Recipes', async () => {
    const { user } = await open('/recipes/tart');
    await user.click(toggle());
    await user.click(gap(FILLING));
    expect(carriedGaps()).toEqual([]);
    await backFromHere(user);
    await user.click(within(screen.getByRole('list', { name: /^Ingredients? with no allergen information/ })).getByRole('button', { name: 'Yeast' }));
    expect(carriedGaps()).toHaveLength(1);
  });

  it('2: a trip that stayed inside Recipes does not reopen the card when the recipe is opened later by Back from elsewhere', async () => {
    const { user, router } = await open('/recipes/tart');
    await user.click(toggle());
    await user.click(gap(FILLING));
    await backFromHere(user);
    await act(async () => { await router.navigate('/recipes'); });
    await act(async () => { await router.navigate('/orders'); });
    await act(async () => { await router.navigate(-1); });
    await act(async () => { await router.navigate('/recipes/tart'); });
    await waitFor(() => { expect(toggle()).toHaveAttribute('aria-expanded', 'false'); });
  });
});

describe('the tablet’s split', () => {
  it('3: picking another recipe beside a sub-recipe opened from a gap replaces it, and one Back reaches the parent', async () => {
    split();
    const { user, router } = await open('/recipes/tart');
    await user.click(toggle());
    await user.click(gap(FILLING));
    expect(where(router)).toBe('/recipes/custard');
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Other' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/other'); });
    await act(async () => { await router.navigate(-1); });
    expect(where(router)).toBe('/recipes/tart');
  });
});

describe('coming back from the ingredient card', () => {
  const openIngredient = async () => {
    const view = await open('/recipes/tart');
    await view.user.click(toggle());
    await view.user.click(gap('Yeast'));
    const card = within(await screen.findByRole('region', { name: 'Edit ingredient' }, LOAD));
    return { ...view, card };
  };

  it('the browser’s own Back lands on the recipe the same way', async () => {
    const { router } = await openIngredient();
    expect(where(router)).toBe('/suppliers/ingredient/yeast');
    await act(async () => { await router.navigate(-1); });
    await screen.findByRole('table', undefined, LOAD);
    expect(where(router)).toBe('/recipes/tart');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => { expect(gap('Yeast')).toHaveFocus(); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('the card’s Delete returns to the recipe, one history step, the card open', async () => {
    const { user, router, card } = await openIngredient();
    await user.click(card.getByRole('button', { name: 'Delete ingredient' }));
    await answer(user, 'Delete “Yeast”?', 'Delete');
    await waitFor(() => { expect(where(router)).toBe('/recipes/tart'); });
    await screen.findByRole('table', undefined, LOAD);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(await entriesBehind(router)).toBe(0);
  });

  it('8: brings the focused row into view when it is outside the visible area', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000, bottom: 5050, left: 0, right: 100, width: 100, height: 50, x: 0, y: 5000, toJSON: () => ({}) });
    try {
      const { user, card } = await openIngredient();
      await user.click(card.getByRole('button', { name: 'Back' }));
      await screen.findByRole('table', undefined, LOAD);
      await waitFor(() => { expect(gap('Yeast')).toHaveFocus(); });
      await waitFor(() => { expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' }); });
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});
