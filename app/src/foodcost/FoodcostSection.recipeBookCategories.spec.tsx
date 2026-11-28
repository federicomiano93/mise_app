import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { recipeProductId } from '@mise/shared/from-recipes';
import { editorSource, intoForm } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// Food cost follows the Ricettario's categories (28 Nov 2026): the list is grouped under the recipe book's words, a card made from a
// recipe sits in its recipe's category (read-only in its editor), any other card is matched by the name of its category document, and
// nothing in Food cost makes or removes a category. The pure rules: categoriesModel.spec.ts. Fake data only.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const WORDS = ['Pane', 'Dolci'];
const RECIPES = [
  { id: 'r1', name: 'Focaccia', category: 'Pane', ingredients: [] },
  { id: 'r2', name: 'Plain', ingredients: [] },
];
const FOCACCIA = product(recipeProductId('r1'), { name: 'Focaccia', model: 4, categoryId: 'c-dolci' });
const PLAIN_RECIPE_CARD = product(recipeProductId('r2'), { name: 'Plain', model: 4, categoryId: 'c-dolci' });
const BUN = product('bun', { name: 'Bun', model: 4, categoryId: 'c-dolci' });
const LOOSE = product('loose', { name: 'Loose', model: 4 });
const DOCS = [{ id: 'c-dolci', name: 'dolci', rank: 1 }];

function sourceOf(options: { words?: string[] | null; products?: ReturnType<typeof product>[] } = {}) {
  return editorSource(options.products ?? [FOCACCIA, PLAIN_RECIPE_CARD, BUN, LOOSE], {
    categories: DOCS,
    recipes: RECIPES,
    recipeCategories: options.words === undefined ? WORDS : options.words,
  });
}

const headers = () => screen.getAllByRole('button', { expanded: false }).map(button => button.textContent);

async function listed(fake = sourceOf(), firstGroup: RegExp = /^Dolci/) {
  const view = renderFoodcost('/food-cost', { source: fake });
  await screen.findByRole('button', { name: 'New product' }, LOAD);
  await screen.findByRole('button', { name: firstGroup }, LOAD);
  return { ...view, fake };
}

async function openCard(fake: ReturnType<typeof sourceOf>, id: string) {
  const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake });
  await intoForm(view.user);
  return { ...view, fake };
}

describe('the list', () => {
  it('has no «Categories» button: categories are made in the recipe book', async () => {
    await listed();
    expect(screen.queryByRole('button', { name: 'Categories' })).not.toBeInTheDocument();
  });

  it('groups under the recipe book\'s words, alphabetical: a recipe\'s card by its recipe, any other card by its category\'s name, the rest in «No category»', async () => {
    await listed();
    expect(headers().map(text => text?.replace(/\s+/g, ' '))).toEqual(['Dolci1 card', 'Pane1 card', 'No category2 cards']);
  });

  it('when the words cannot be read it falls back to the names of its own category documents', async () => {
    await listed(sourceOf({ words: null }), /^dolci/);
    expect(headers().map(text => text?.replace(/\s+/g, ' '))).toEqual(['dolci3 cards', 'No category1 card']);
  });
});

describe('the card\'s editor', () => {
  it('shows a recipe\'s card the recipe\'s category and offers no choice', async () => {
    await openCard(sourceOf(), recipeProductId('r1'));
    expect(screen.getByText('Pane · from the recipe book')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Category' })).not.toBeInTheDocument();
  });

  it('says «No category · from the recipe book» for a recipe with none', async () => {
    await openCard(sourceOf(), recipeProductId('r2'));
    expect(screen.getByText('No category · from the recipe book')).toBeInTheDocument();
  });

  it('offers any other card the recipe book\'s words, on its own word', async () => {
    await openCard(sourceOf(), 'bun');
    const picker = screen.getByRole('combobox', { name: 'Category' });
    expect(picker).toHaveValue('Dolci');
    expect(within(picker).getAllByRole('option').map(option => option.textContent)).toEqual(['No category', 'Dolci', 'Pane']);
  });

  async function pick(user: UserEvent, word: string) {
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), word);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Save' }));
  }

  it('a word that has a category document stores that document\'s id and creates nothing', async () => {
    const { user, fake } = await openCard(sourceOf({ products: [LOOSE, BUN] }), 'loose');
    await pick(user, 'Dolci');
    expect(fake.saved.find(entry => entry.kind === 'category')).toBeUndefined();
    expect(fake.saved.find(entry => entry.kind === 'product')?.data).toMatchObject({ categoryId: 'c-dolci' });
  });

  it('⚠️ a word with no document yet gets one, and the card stores its id', async () => {
    const { user, fake } = await openCard(sourceOf({ products: [LOOSE, BUN] }), 'loose');
    await pick(user, 'Pane');
    const made = fake.saved.find(entry => entry.kind === 'category');
    expect(made?.data).toMatchObject({ name: 'Pane' });
    expect(fake.saved.find(entry => entry.kind === 'product')?.data).toMatchObject({ categoryId: made?.id });
  });
});
