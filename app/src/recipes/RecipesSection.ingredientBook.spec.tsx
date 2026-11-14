import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import type { FakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes, split } from '../testing/renderRecipes';
import { forgetOpenIngredients } from './IngredientBook';
import css from './IngredientBook.module.css?raw';

// The ingredient book (part 2 of the owner's plan, 14 Nov 2026): where each ingredient is used, a door at the foot of the recipe
// list (the app's menu is full on the lab tablet), at /recipes/ingredients.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  forgetOpenIngredients();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const INGREDIENTS = [
  { id: 'butter', name: 'Burro Elle&Vire 82%', shortName: 'Butter' },
  { id: 'flour', name: 'Flour T45' },
  { id: 'sugar', name: 'Sugar' },
  { id: 'salt', name: 'Sea salt', active: false },
  { id: 'box', name: 'Cake box', kind: 'packaging' },
];
const RECIPES = [
  { id: 'brioche', name: 'Brioche', ingredients: [
    { label: 'Flour', grams: 2000, unit: 'g', kind: 'ingredient', refId: 'flour' },
    { label: 'Butter', grams: 800, unit: 'g', kind: 'ingredient', refId: 'butter' },
    { label: 'Sugar', grams: 0.8, unit: 'kg', kind: 'ingredient', refId: 'sugar' },
  ] },
  { id: 'cream', name: 'Cream', ingredients: [
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'butter' },
    { label: 'Butter (to finish)', grams: 20, unit: 'g', kind: 'ingredient', refId: 'butter' },
  ] },
  { id: 'old', name: 'Apple tart', archived: true, ingredients: [{ label: 'Butter', grams: 150, unit: 'g', kind: 'ingredient', refId: 'butter' }] },
  { id: 'typed', name: 'Shortbread', ingredients: [{ label: 'Butter', grams: 400, unit: 'g' }] },
];

const main = () => within(screen.getByRole('main'));
const book = () => main().getByRole('list', { name: /^(Ingredients in recipes|Ingredienti nelle ricette)$/ });
const head = (name: RegExp) => within(book()).getByRole('button', { name });

type Options = NonNullable<Parameters<typeof renderRecipes>[1]>;

async function openBook(options: Options & { path?: string } = {}) {
  const { path = '/recipes/ingredients', source = fakeRecipesSource({ recipes: RECIPES, ingredients: INGREDIENTS }), ...rest } = options;
  const view = renderRecipes(path, { source, ...rest });
  await waitFor(() => { expect(main().getByRole('list', { name: /^(Ingredients in recipes|Ingredienti nelle ricette)$/ })).toBeInTheDocument(); }, LOAD);
  return view as typeof view & { source: FakeRecipesSource };
}

describe('the ingredient book', () => {
  it('has a door at the foot of the recipe list, for an employee too, and the door opens it', async () => {
    const view = renderRecipes('/recipes', {
      source: fakeRecipesSource({ recipes: RECIPES, ingredients: INGREDIENTS }),
      session: { role: 'staff', canManage: false },
    });
    const door = await screen.findByRole('button', { name: 'Ingredients in recipes' }, LOAD);
    await view.user.click(door);
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/recipes/ingredients'); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Ingredients in recipes' }, LOAD)).toHaveFocus();
  });

  it('lists the ingredients used in a recipe, by name, each with how many recipes; packaging is left out', async () => {
    await openBook();
    expect(within(book()).getAllByRole('button', { expanded: false }).map(button => button.textContent))
      .toEqual(['Butter3 recipes', 'Flour T451 recipe', 'Sugar1 recipe']);
    expect(main().queryByText('Cake box')).not.toBeInTheDocument();
  });

  it('opens an ingredient onto its recipes and amounts, as written; archived last and marked; unlinked rows do not count', async () => {
    const { user } = await openBook();
    const button = head(/^Butter/);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const uses = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(within(uses).getAllByRole('button').map(b => b.textContent)).toEqual([
      'Brioche800 g',
      'Cream200 g + 20 g',
      'Apple tartarchived150 g',
    ]);
    expect(within(uses).queryByText('Shortbread')).not.toBeInTheDocument();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(uses).not.toBeVisible();
  });

  it('writes kilos with their decimals in the language’s own mark', async () => {
    const { user } = await openBook({ lang: 'it', session: { language: 'it' } });
    await user.click(head(/^Sugar/));
    expect(within(book()).getByRole('button', { name: /^Brioche/ })).toHaveTextContent('0,8 kg');
  });

  it('folds the ingredients no recipe uses into «Not in any recipe», marking one not in use', async () => {
    await openBook();
    expect(main().getByText('Not in any recipe (1)').closest('details')).not.toHaveAttribute('open');
    expect(main().getByText('Sea salt').closest('li')).toHaveTextContent('not in use');
  });

  it('finds an ingredient by any of its names; opens the fold when only it matches; says so when nothing matches', async () => {
    const { user } = await openBook();
    const box = main().getByRole('searchbox', { name: 'Search an ingredient' });
    await user.type(box, 'elle&vire');
    expect(within(book()).getAllByRole('button').map(b => b.textContent)).toEqual(['Butter3 recipes']);
    await user.clear(box);
    await user.type(box, 'sea');
    expect(main().getByText('Not in any recipe (1)').closest('details')).toHaveAttribute('open');
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(main().getByText('No ingredient matches “zzz”.')).toBeInTheDocument();
  });

  it('⚠️ a recipe opened from it comes back HERE on Back, the same ingredient open and the focus on that recipe', async () => {
    const { user, router } = await openBook();
    await user.click(head(/^Butter/));
    await user.click(within(book()).getByRole('button', { name: /^Cream/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/cream'); });
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/ingredients'); });
    await waitFor(() => { expect(within(book()).getByRole('button', { name: /^Cream/ })).toHaveFocus(); });
    expect(head(/^Butter/)).toHaveAttribute('aria-expanded', 'true');
  });

  it('the same on the tablet’s split, beside the list', async () => {
    split();
    const { user, router } = await openBook();
    await user.click(head(/^Flour/));
    await user.click(within(book()).getByRole('button', { name: /^Brioche/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/brioche'); });
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/ingredients'); });
    await waitFor(() => { expect(main().getByRole('button', { name: /^Brioche2000 g/ })).toHaveFocus(); });
  });

  it('Back from the book goes up to the recipe list, the focus on its door', async () => {
    const view = renderRecipes('/recipes', { source: fakeRecipesSource({ recipes: RECIPES, ingredients: INGREDIENTS }) });
    await view.user.click(await screen.findByRole('button', { name: 'Ingredients in recipes' }, LOAD));
    await screen.findByRole('heading', { level: 2, name: 'Ingredients in recipes' }, LOAD);
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/recipes'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Ingredients in recipes' })).toHaveFocus(); });
  });

  it('⚠️ Edit and Save of a recipe opened from it do not jump past the book (it is not the recipe list)', async () => {
    const { user, router } = await openBook();
    await user.click(head(/^Butter/));
    await user.click(within(book()).getByRole('button', { name: /^Cream/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/cream'); });
    const edit = await screen.findByRole('button', { name: 'Edit' }, LOAD);
    expect((router.state.location.state as Record<string, unknown>).fromIngredients).toBe(true);
    await user.click(edit);
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/cream/edit'); });
    expect((router.state.location.state as Record<string, unknown>).recipeFromList).toBe(false);
  });

  it('follows the recipes live: a recipe saved on another phone moves the amounts at once', async () => {
    const { user, source } = await openBook();
    await user.click(head(/^Flour/));
    act(() => {
      source.recipes.set('brioche', { ...RECIPES[0]!, ingredients: [{ label: 'Flour', grams: 2500, unit: 'g', kind: 'ingredient', refId: 'flour' }] });
      source.push();
    });
    await waitFor(() => { expect(within(book()).getByRole('button', { name: /^Brioche/ })).toHaveTextContent('2500 g'); });
  });

  it('says there is nothing yet for a venue with no ingredients', async () => {
    renderRecipes('/recipes/ingredients', { source: fakeRecipesSource({ recipes: [], ingredients: [] }) });
    expect(await screen.findByText('No ingredients yet. They are added in Suppliers.', undefined, LOAD)).toBeInTheDocument();
  });

  it('is in Italian', async () => {
    await openBook({ lang: 'it', session: { language: 'it' } });
    expect(head(/^Butter/)).toHaveTextContent('3 ricette');
    expect(head(/^Flour/)).toHaveTextContent('1 ricetta');
    expect(main().getByText('In nessuna ricetta (1)')).toBeInTheDocument();
    expect(main().getByRole('searchbox', { name: 'Cerca un ingrediente' })).toBeInTheDocument();
  });

  it('keeps every target at least 44px and draws only with tokens', () => {
    expect(css).toMatch(/\.head \{[^}]*min-height: var\(--hit-lg\)/);
    expect(css).toMatch(/\.use \{[^}]*min-height: var\(--hit\)/);
    expect(css).toMatch(/\.unusedRow \{[^}]*min-height: var\(--hit\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
