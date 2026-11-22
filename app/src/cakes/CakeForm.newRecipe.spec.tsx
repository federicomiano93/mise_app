import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import type { FakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { SPONGE, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD } from '../testing/renderFoodcost';
import { resetParkedCakes } from './cakeParking';

// «+ New recipe “…”» in a step's search box: the last option of the list, for a name no card has, for someone who may use the Recipes. It
// makes the recipe (a name and nothing else) and its semi-finished card in ONE batch, puts the card on the step, and says so in a dialog.
// What the option writes is pinned against firestore.rules in recipes/recipeDocument.spec.ts; the trip to the Recipes is in
// CakeForm.parked.spec.tsx.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); resetParkedCakes(); });

const CREAM = { ...SPONGE, id: 'CREAM', name: 'Crème brûlée' };
const foodcost = (): FakeFoodcostSource => fakeFoodcostSource({ products: [SPONGE, CREAM], ingredients: [FLOUR], prices: FLOUR_PRICES });

async function openNew(options: Omit<NonNullable<Parameters<typeof renderCakes>[1]>, 'cakes' | 'foodcost'> = {}, source = foodcost()) {
  const view = renderCakes('/cakes/new', { cakes: fakeCakesSource({ cakes: [], reference: storedReference() }), foodcost: source, ...options });
  await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
  return { ...view, source };
}
const search = () => screen.getByRole('combobox', { name: 'Search a recipe for Base' });
const newOption = () => screen.queryByRole('option', { name: /^\+ New recipe/ });

describe('the «+ New recipe» option', () => {
  it('ends the list for a typed name no card has, and says the name as typed', async () => {
    const { user } = await openNew();
    await user.type(search(), 'Tiramisu');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('+ New recipe “Tiramisu”');
  });

  it('comes after the cards that match, never before them', async () => {
    const { user } = await openNew();
    await user.type(search(), 'Cr');
    const options = await screen.findAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual([expect.stringContaining('Crème brûlée'), '+ New recipe “Cr”']);
  });

  it.each([['Sponge'], ['sponge'], ['  SPONGE '], ['creme brulee'], ['CRÈME BRÛLÉE']])('is not offered for “%s”: a card has that name already (capitals and accents ignored)', async typed => {
    const { user } = await openNew();
    await user.type(search(), typed);
    await screen.findAllByRole('option');
    expect(newOption()).not.toBeInTheDocument();
  });

  it('is not offered for nothing, or for blanks', async () => {
    const { user } = await openNew();
    await user.click(search());
    await screen.findAllByRole('option');
    expect(newOption()).not.toBeInTheDocument();
    await user.type(search(), '   ');
    expect(newOption()).not.toBeInTheDocument();
  });

  it('is not offered to someone who cannot use the Recipes (the venue does not have them)', async () => {
    const { user } = await openNew({ session: { location: { sections: { catalogue: false } } } });
    await user.type(search(), 'Tiramisu');
    expect(await screen.findByText('No recipe matches.')).toBeInTheDocument();
    expect(newOption()).not.toBeInTheDocument();
  });
});

describe('choosing it', () => {
  async function choose(name = 'Tiramisu') {
    const view = await openNew();
    await view.user.type(search(), name);
    await view.user.click(await screen.findByRole('option', { name: new RegExp(`^\\+ New recipe “${name}”$`) }));
    await screen.findByRole('alertdialog', { name: 'Recipe created' });
    return view;
  }

  it('writes ONE batch: the recipe with only its name, and its semi-finished card recipe-<id>', async () => {
    const { source } = await choose();
    expect(source.createRecipeWithCard).toHaveBeenCalledTimes(1);
    expect(source.saved.filter(write => write.kind === 'new-recipe')).toHaveLength(1);
    const [recipeId, recipe, productId, card] = source.createRecipeWithCard.mock.calls[0]!;
    expect(recipe).toEqual({ name: 'Tiramisu', ingredients: [] });
    expect(productId).toBe(`recipe-${recipeId}`);
    expect(card).toMatchObject({ name: 'Tiramisu', kind: 'semi', model: 4, components: [{ recipeId, qtyKg: 1 }] });
    // Both are in the database's copy now, and nothing else was written.
    expect(source.recipes.get(recipeId)).toMatchObject({ name: 'Tiramisu' });
    expect(source.products.get(productId)).toMatchObject({ name: 'Tiramisu' });
    expect(source.saved).toHaveLength(1);
  });

  it('puts the card on the step, the way picking a card does, and empties the box', async () => {
    const { user } = await choose();
    await user.click(screen.getByRole('button', { name: 'Continue the cake' }));
    expect(await screen.findByRole('textbox', { name: 'Tiramisu: grams' })).toBeInTheDocument();
    expect(search()).toHaveValue('');
  });

  it('says so in a dialog with two buttons: «Continue the cake» is the one with the focus, and puts the cursor back in the step’s search box', async () => {
    const { user } = await choose();
    const dialog = screen.getByRole('alertdialog', { name: 'Recipe created' });
    expect(dialog).toHaveTextContent('“Tiramisu” is in the Recipes and in Food cost, but it is still empty: add its ingredients in the Recipes. Until then the cake’s cost is incomplete.');
    expect(within(dialog).getAllByRole('button').map(button => button.textContent)).toEqual(['Continue the cake', 'Open in Recipes']);
    expect(within(dialog).getByRole('button', { name: 'Continue the cake' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Continue the cake' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(search()).toHaveFocus(); }, LOAD);
  });

  it('Escape means «Continue the cake»', async () => {
    const { user } = await choose();
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); }, LOAD);
    expect(await screen.findByRole('textbox', { name: 'Tiramisu: grams' })).toBeInTheDocument();
    await waitFor(() => { expect(search()).toHaveFocus(); }, LOAD);
  });

  it('the cake’s cost says «incomplete» for it, in the cost step (the callout is in CakeForm.newRecipeCallout.spec.tsx)', async () => {
    const { user } = await choose();
    await user.click(screen.getByRole('button', { name: 'Continue the cake' }));
    await screen.findByRole('textbox', { name: 'Tiramisu: grams' });
    await user.click(screen.getByRole('button', { name: /^Cost and price/ }));
    expect(await screen.findByText('Cost incomplete: Tiramisu has no price yet on its Food cost card. The real cost is higher.', undefined, LOAD)).toBeInTheDocument();
  });

  it('a name past the rules’ bound is cut, never refused', async () => {
    const { user, source } = await openNew();
    await user.type(search(), 'x'.repeat(230));
    await user.click(await screen.findByRole('option', { name: /^\+ New recipe/ }));
    await screen.findByRole('alertdialog', { name: 'Recipe created' });
    expect((source.createRecipeWithCard.mock.calls[0]![1] as { name: string }).name).toHaveLength(199);
  });
});

describe('a refusal', () => {
  it('takes the recipe, its card AND the cake’s line off again, and says so', async () => {
    const source = foodcost();
    source.refuse.newRecipe = true;
    const { user } = await openNew({}, source);
    await user.type(search(), 'Tiramisu');
    await user.click(await screen.findByRole('option', { name: /^\+ New recipe/ }));
    await user.click(await screen.findByRole('button', { name: 'Continue the cake' }));
    expect(await screen.findByText(/The recipe “Tiramisu” was not created — nothing was saved, and it has been taken off the cake\./)).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole('textbox', { name: 'Tiramisu: grams' })).not.toBeInTheDocument(); });
    expect([...source.recipes.keys()]).toEqual([]);
    expect([...source.products.keys()].sort()).toEqual(['CREAM', 'SPONGE']);
    expect(source.saved).toEqual([]);
  });
});
