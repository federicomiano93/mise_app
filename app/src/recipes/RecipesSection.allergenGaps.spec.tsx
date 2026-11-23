import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { renderApp } from '../testing/renderApp';
import { entriesBehind } from '../testing/recipeLinkHelpers';
import { LOAD } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';

// The allergen card names EVERY gap in two groups, and each is a door to where it is put right (23 Nov 2026): an undeclared ingredient
// opens its card in Suppliers, a row to fix opens the recipe's editor, an incomplete sub-recipe opens that recipe. Back, Save and
// Delete come back with ONE history step, the card open and the focus on the row that was tapped.

beforeAll(async () => {
  await import('./RecipesSection');
  await import('../suppliers/SuppliersSection');
}, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

const plain = (id: string): StoredDoc => ({ id, name: `Ingredient ${id}`, allergens: [] });
const row = (label: string, extra: Record<string, unknown> = {}) => ({ label, grams: 100, unit: 'g', ...extra });
const linked = (n: number) => row(`Thing ${n}`, { refId: `i${n}` });

// Nine linked ingredients nobody declared, and one row nobody linked.
const NINE = Array.from({ length: 9 }, (_, index) => index + 1);
const BIG: StoredDoc = { id: 'big', name: 'Big', ingredients: [...NINE.map(linked), row('Free text')] };
const BIG_INGREDIENTS = NINE.map(n => plain(`i${n}`));

type Seeds = { recipes: StoredDoc[]; ingredients: StoredDoc[] };

async function open(path: string, { recipes, ingredients }: Seeds, options: Parameters<typeof renderApp>[1] = {}) {
  const recipeSource = fakeRecipesSource({ recipes, ingredients });
  const supplierSource = fakeSuppliersSource({ ingredients });
  const view = renderApp(path, { ...options, data: { recipes: () => recipeSource, suppliers: () => supplierSource, ...options.data } });
  await screen.findByRole('table', undefined, LOAD);
  return { ...view, recipeSource, supplierSource };
}

const main = () => within(screen.getByRole('main'));
const toggle = () => main().getByRole('button', { name: /^(Allergens|Allergeni)/ });
// The recipe's own ingredient table has buttons with the same names, so a gap row is always looked up in its group's list.
const ingredientGap = (name: string) => within(screen.getByRole('list', { name: /^Ingredients? with no allergen information/ })).getByRole('button', { name });
const ingredientGapNames = () => within(screen.getByRole('list', { name: /^Ingredients? with no allergen information/ })).getAllByRole('button').map(button => button.textContent);
const where = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname;

describe('every gap, in two groups', () => {
  it('shows all ten, with a count on each title, the hint, and no «and N more»', async () => {
    const { user } = await open('/recipes/big', { recipes: [BIG], ingredients: BIG_INGREDIENTS });
    await user.click(toggle());
    expect(screen.getByRole('heading', { level: 4, name: 'Ingredients with no allergen information · 9' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 4, name: 'Row to fix in the recipe · 1' })).toBeVisible();
    expect(screen.getByText('Tap a name to open the ingredient in Suppliers; Back brings you back to this recipe.')).toBeVisible();
    const first = within(screen.getByRole('list', { name: 'Ingredients with no allergen information · 9' }));
    for (const n of NINE) expect(first.getByRole('button', { name: `Thing ${n}` })).toBeVisible();
    const second = within(screen.getByRole('list', { name: 'Row to fix in the recipe · 1' }));
    expect(second.getByRole('button', { name: 'Free text not linked to an ingredient' })).toBeVisible();
    expect(screen.queryByText(/and \d+ more/)).not.toBeInTheDocument();
    expect(screen.getByText('10 ingredients are not declared — no label can be made')).toBeVisible();
  });

  it('omits a group with no rows, and says it in the singular for one', async () => {
    const { user } = await open('/recipes/one', { recipes: [{ id: 'one', name: 'One', ingredients: [linked(1)] }], ingredients: [plain('i1')] });
    await user.click(toggle());
    expect(screen.getByRole('heading', { level: 4, name: 'Ingredient with no allergen information · 1' })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 4, name: /Rows? to fix/ })).not.toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    const { user } = await open('/recipes/big', { recipes: [BIG], ingredients: BIG_INGREDIENTS }, { lang: 'it', session: { language: 'it' } });
    await user.click(toggle());
    expect(screen.getByRole('heading', { level: 4, name: 'Ingredienti senza allergeni dichiarati · 9' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 4, name: 'Riga da sistemare nella ricetta · 1' })).toBeVisible();
    expect(screen.getByText('Tocca un nome: si apre l’ingrediente in Fornitori; Indietro ti riporta a questa ricetta.')).toBeVisible();
  });
});

describe('a name opens the ingredient in Suppliers, and Back comes back', () => {
  it('lands on the ingredient’s card, and its Back returns to the recipe with the card open and the focus on that row — one history step', async () => {
    const { user, router } = await open('/recipes/big', { recipes: [BIG], ingredients: BIG_INGREDIENTS });
    await user.click(toggle());
    await user.click(ingredientGap('Thing 4'));
    const card = within(await screen.findByRole('region', { name: 'Edit ingredient' }, LOAD));
    expect(where(router)).toBe('/suppliers/ingredient/i4');

    await user.click(card.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('table', undefined, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/recipes/big');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => { expect(ingredientGap('Thing 4')).toHaveFocus(); });
    // The recipe is the entry that was behind the card: nothing else was stacked on the way.
    expect(await entriesBehind(router)).toBe(0);
  });

  it('Save on the card returns to the recipe the same way', async () => {
    const { user, router, supplierSource } = await open('/recipes/big', { recipes: [BIG], ingredients: BIG_INGREDIENTS });
    await user.click(toggle());
    await user.click(ingredientGap('Thing 2'));
    const card = within(await screen.findByRole('region', { name: 'Edit ingredient' }, LOAD));
    const name = card.getByRole('textbox', { name: 'Name in the message' });
    await user.clear(name);
    await user.type(name, 'Thing 2 renamed');
    await user.click(card.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save ingredient?' })).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(where(router)).toBe('/recipes/big'); });
    await screen.findByRole('table', undefined, LOAD);
    expect(supplierSource.writes.length).toBeGreaterThan(0);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => { expect(ingredientGap('Thing 2')).toHaveFocus(); });
    expect(await entriesBehind(router)).toBe(0);
  });

  it('puts the focus on the card’s toggle when the row is gone (the ingredient was declared meanwhile)', async () => {
    const { user, router, recipeSource } = await open('/recipes/big', { recipes: [BIG], ingredients: BIG_INGREDIENTS });
    await user.click(toggle());
    await user.click(ingredientGap('Thing 3'));
    const card = within(await screen.findByRole('region', { name: 'Edit ingredient' }, LOAD));
    recipeSource.ingredients.set('i3', { id: 'i3', name: 'Ingredient i3', allergens: [], allergensCheckedAt: '2026-01-01' });
    recipeSource.push();
    await user.click(card.getByRole('button', { name: 'Back' }));
    await screen.findByRole('table', undefined, LOAD);
    expect(where(router)).toBe('/recipes/big');
    await waitFor(() => { expect(toggle()).toHaveFocus(); });
    expect(ingredientGapNames()).not.toContain('Thing 3');
  });
});

describe('who may tap', () => {
  it('shows the ingredients as plain names, with no button and no hint, when the venue has no Suppliers', async () => {
    const { user } = await open('/recipes/big', { recipes: [BIG], ingredients: BIG_INGREDIENTS }, { session: { location: { country: 'GB', sections: { orders: false } } } });
    await user.click(toggle());
    const first = within(screen.getByRole('list', { name: 'Ingredients with no allergen information · 9' }));
    expect(first.getAllByRole('listitem')).toHaveLength(9);
    expect(first.queryByRole('button')).not.toBeInTheDocument();
    expect(first.getByText('Thing 5')).toBeVisible();
    expect(screen.queryByText(/Tap a name to open/)).not.toBeInTheDocument();
    // The editor rows stay doors: whoever sees the recipes can edit them.
    expect(within(screen.getByRole('list', { name: 'Row to fix in the recipe · 1' })).getByRole('button')).toBeVisible();
  });
});

describe('a row to fix opens where it is put right', () => {
  it('a row nobody linked opens this recipe’s editor, and Back returns to the recipe with the focus on that row', async () => {
    const { user, router } = await open('/recipes/big', { recipes: [BIG], ingredients: BIG_INGREDIENTS });
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'Free text not linked to an ingredient' }));
    expect(where(router)).toBe('/recipes/big/edit');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await screen.findByRole('table', undefined, LOAD);
    expect(where(router)).toBe('/recipes/big');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Free text not linked to an ingredient' })).toHaveFocus(); });
  });

  it('an incomplete sub-recipe opens that recipe’s own screen, and Back returns to the parent with the focus on the row', async () => {
    const SUB: StoredDoc = { id: 'sub', name: 'Custard', ingredients: [row('Mystery')] };
    const TOP: StoredDoc = { id: 'top', name: 'Tart', ingredients: [row('Filling', { kind: 'recipe', refId: 'sub' })] };
    const { user, router } = await open('/recipes/top', { recipes: [TOP, SUB], ingredients: [] });
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'Filling the linked recipe is not fully declared' }));
    expect(where(router)).toBe('/recipes/sub');
    expect(await screen.findByRole('heading', { name: 'Custard' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(where(router)).toBe('/recipes/top');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Filling the linked recipe is not fully declared' })).toHaveFocus(); });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(await entriesBehind(router)).toBe(0);
  });
});
