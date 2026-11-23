import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD } from '../testing/renderFoodcost';
import { openMeasures } from '../testing/openMeasures';
import { resetParkedCakes } from './cakeParking';

// «Open in Recipes» on the dialog that says a recipe was just made: the unsaved cake is parked in memory (no question, nothing lost), the
// recipe's editor opens, and Back or Save there brings the person back to the SAME cake, typed and dirty as it was. Leaving the Recipes any
// other way leaves a line at the top of the cakes' list: Resume, or Discard (asked first).

beforeAll(async () => {
  await import('./CakesSection');
  await import('../recipes/RecipesSection');
}, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); resetParkedCakes(); });

const foodcost = () => fakeFoodcostSource({ products: [SPONGE], ingredients: [FLOUR], prices: FLOUR_PRICES });
const search = () => screen.getByRole('combobox', { name: 'Search a recipe for Base' });

// The recipe the dialog just made, as the Recipes' own source holds it (the two fakes are separate databases): given one ingredient so
// its editor can be saved.
function recipesWith(foodcostSource: ReturnType<typeof foodcost>, withIngredient = false) {
  const [recipeId, recipe] = foodcostSource.createRecipeWithCard.mock.calls[0]!;
  const recipes = fakeRecipesSource({ recipes: [] });
  recipes.recipes.set(recipeId, {
    id: recipeId, ...recipe,
    ingredients: withIngredient ? [{ label: 'Flour', grams: 1000, unit: 'g' }] : [],
  });
  return { recipes, recipeId };
}

// A NEW cake with a name typed and «Tiramisu» made for its base; the dialog is open.
async function newCakeWithDialog() {
  const source = foodcost();
  const recipes = fakeRecipesSource({ recipes: [] });
  const view = renderCakes('/cakes/new', {
    cakes: fakeCakesSource({ cakes: [], reference: storedReference() }),
    foodcost: source,
    data: { recipes: () => recipes },
  });
  await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
  await view.user.type(screen.getByRole('textbox', { name: 'Name' }), 'Torta di prova');
  await view.user.type(search(), 'Tiramisu');
  await view.user.click(await screen.findByRole('option', { name: /^\+ New recipe/ }));
  await screen.findByRole('alertdialog', { name: 'Recipe created' });
  // The Recipes' database holds the recipe the batch made.
  const made = recipesWith(source, true);
  recipes.recipes.set(made.recipeId, made.recipes.recipes.get(made.recipeId)!);
  return { ...view, source, recipes, recipeId: made.recipeId };
}

async function openInRecipes(user: { click: (el: Element) => Promise<void> }) {
  await user.click(screen.getByRole('button', { name: 'Open in Recipes' }));
}

describe('«Open in Recipes»', () => {
  it('opens the recipe’s editor WITHOUT asking about the unsaved cake', async () => {
    const { user, router, recipeId } = await newCakeWithDialog();
    await openInRecipes(user);
    await waitFor(() => { expect(router.state.location.pathname).toBe(`/recipes/${recipeId}/edit`); });
    expect(screen.queryByRole('alertdialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Edit recipe' }, LOAD)).toBeInTheDocument();
    // ⚠️ A parked copy deliberately holds NO busy mark (session/busy.ts): only the recipe editor's own dirty state would.
    expect(isBusy()).toBe(false);
  });

  it('Back from the editor brings the person to the SAME cake, as it was typed, and still unsaved', async () => {
    const { user, router } = await newCakeWithDialog();
    await openInRecipes(user);
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    expect(router.state.location.pathname).toBe('/cakes/new');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Torta di prova');
    expect(await screen.findByRole('textbox', { name: 'Tiramisu: grams' })).toBeInTheDocument();
    // Still dirty: leaving asks.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
    expect(isBusy()).toBe(true);
  });

  it('Save in the editor returns to the cake the same way', async () => {
    const { user, router, recipes } = await newCakeWithDialog();
    await openInRecipes(user);
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(within(region).getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(recipes.recipeWrites).toHaveLength(1); });
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    expect(router.state.location.pathname).toBe('/cakes/new');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Torta di prova');
    expect(screen.getByRole('textbox', { name: 'Tiramisu: grams' })).toBeInTheDocument();
  });

  it('a SAVED cake comes back at its own address', async () => {
    const source = foodcost();
    const recipes = fakeRecipesSource({ recipes: [] });
    const cake = cakeDoc('c1', 'Plain');
    const view = renderCakes('/cakes/c1', { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: source, data: { recipes: () => recipes } });
    await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
    await openMeasures(view.user);
    await view.user.type(screen.getByRole('textbox', { name: 'Name' }), ' two');
    await view.user.click(screen.getByRole('button', { name: /^Soak/ }));
    await view.user.type(screen.getByRole('combobox', { name: 'Search a recipe for Soak' }), 'Glaze');
    await view.user.click(await screen.findByRole('option', { name: /^\+ New recipe/ }));
    await screen.findByRole('alertdialog', { name: 'Recipe created' });
    const made = recipesWith(source, false);
    recipes.recipes.set(made.recipeId, made.recipes.recipes.get(made.recipeId)!);
    await openInRecipes(view.user);
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await view.user.click(within(region).getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/cakes/c1');
    await openMeasures(view.user);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Plain two');
    // The step that was open is open again, with the new card in it.
    expect(screen.getByRole('textbox', { name: 'Glaze: grams' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Soak/ })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('leaving the Recipes some other way', () => {
  async function leaveByTheRail() {
    const view = await newCakeWithDialog();
    await openInRecipes(view.user);
    await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await act(async () => { await view.router.navigate('/cakes'); });
    await screen.findByText('Unsaved cake: Torta di prova', undefined, LOAD);
    return view;
  }

  it('the list says so at the top, with «Resume» and a low-key «Discard»', async () => {
    await leaveByTheRail();
    const line = screen.getByRole('group', { name: 'Unsaved cake: Torta di prova' });
    expect(within(line).getAllByRole('button').map(button => button.textContent)).toEqual(['Resume', 'Discard']);
    // The buttons say which cake they are about.
    expect(within(line).getByRole('button', { name: 'Resume “Torta di prova”' })).toBeInTheDocument();
    expect(within(line).getByRole('button', { name: 'Discard “Torta di prova”' })).toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });

  it('«Resume» opens the cake with the copy back, and the line is gone', async () => {
    const { user, router } = await leaveByTheRail();
    await user.click(screen.getByRole('button', { name: 'Resume “Torta di prova”' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes/new'); });
    expect(await screen.findByRole('textbox', { name: 'Tiramisu: grams' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Torta di prova');
    expect(screen.queryByText('Unsaved cake: Torta di prova')).not.toBeInTheDocument();
  });

  it('«Discard» asks first; cancelling keeps the line, confirming drops it and lets the app reload again', async () => {
    const { user } = await leaveByTheRail();
    await user.click(screen.getByRole('button', { name: 'Discard “Torta di prova”' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard the unsaved cake?' });
    expect(question).toHaveTextContent('The changes to “Torta di prova” that were not saved will be lost.');
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Unsaved cake: Torta di prova')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard “Torta di prova”' }));
    const again = await screen.findByRole('alertdialog', { name: 'Discard the unsaved cake?' });
    await user.click(within(again).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByText('Unsaved cake: Torta di prova')).not.toBeInTheDocument(); });
  });
});
