import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { StoredDoc } from '../foodcost/foodcostSource';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import type { FakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { SPONGE, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD, product } from '../testing/renderFoodcost';
import { resetParkedCakes } from './cakeParking';

// A typed name that is already a RECIPE of the Recipes must never make a second recipe: with no Food cost card for it the last option
// becomes «+ “…” from Recipes» (the card only, the recipe's real weight); with a card it offers nothing.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); resetParkedCakes(); });

const TIRAMISU = { id: 'r7', name: 'Tiramisu', ingredients: [{ kind: 'ingredient', refId: 'flour', unit: 'g', grams: 1000, label: 'Flour' }] };

async function openNew(source: FakeFoodcostSource) {
  const view = renderCakes('/cakes/new', { cakes: fakeCakesSource({ cakes: [], reference: storedReference() }), foodcost: source });
  await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
  return { ...view, source };
}
const search = () => screen.getByRole('combobox', { name: 'Search a recipe for Base' });
const withRecipe = (extra: StoredDoc[] = []) => fakeFoodcostSource({
  products: [SPONGE, ...extra], recipes: [TIRAMISU], ingredients: [FLOUR], prices: FLOUR_PRICES,
});

describe('a typed name that is a recipe with no card', () => {
  it('offers «+ “…” from Recipes» and never «+ New recipe»', async () => {
    const { user } = await openNew(withRecipe());
    await user.type(search(), 'tiramisu');
    const options = await screen.findAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual(['+ “tiramisu” from Recipes']);
  });

  it('creates ONLY the card recipe-<id> (semi, the recipe’s real weight), puts it on the step, and shows no «Recipe created» alert', async () => {
    const { user, source } = await openNew(withRecipe());
    await user.type(search(), 'Tiramisu');
    await user.click(await screen.findByRole('option', { name: '+ “Tiramisu” from Recipes' }));
    expect(await screen.findByRole('textbox', { name: 'Tiramisu: grams' }, LOAD)).toBeInTheDocument();
    expect(source.createRecipeWithCard).not.toHaveBeenCalled();
    expect(source.saved.map(write => write.kind)).toEqual(['create']);
    expect(source.saved[0]).toMatchObject({ id: 'recipe-r7', data: { name: 'Tiramisu', kind: 'semi', components: [{ recipeId: 'r7', qtyKg: 1 }] } });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(search()).toHaveValue('');
  });

  it('is not offered to someone who cannot use the Recipes (the venue does not have them)', async () => {
    const view = renderCakes('/cakes/new', {
      cakes: fakeCakesSource({ cakes: [], reference: storedReference() }), foodcost: withRecipe(), session: { location: { sections: { catalogue: false } } },
    });
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    await view.user.type(search(), 'Tiramisu');
    await screen.findByText('No recipe matches.');
    expect(screen.queryByRole('option', { name: /^[+]/ })).not.toBeInTheDocument();
  });

  it('a refused card says so and puts nothing on the step', async () => {
    const source = withRecipe();
    source.refuse.create = true;
    const { user } = await openNew(source);
    await user.type(search(), 'Tiramisu');
    await user.click(await screen.findByRole('option', { name: '+ “Tiramisu” from Recipes' }));
    expect(await screen.findByText('The card for “Tiramisu” was not created, so it was not added to the cake. Check the connection and try again.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Tiramisu: grams' })).not.toBeInTheDocument();
  });
});

describe('a typed name that is a recipe whose card already exists', () => {
  it('offers no «+» option at all, whatever kind the card is', async () => {
    const finished = product('recipe-r7', { name: 'Tiramisu', kind: 'finished', model: 4 });
    const { user } = await openNew(withRecipe([finished]));
    await user.type(search(), 'Tiramisu');
    await screen.findByText('No recipe matches.');
    expect(screen.queryByRole('option', { name: /^[+]/ })).not.toBeInTheDocument();
  });

  it('a semi card of that name is listed as usual, with no «+» after it', async () => {
    const semi = product('recipe-r7', { name: 'Tiramisu', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null });
    const { user } = await openNew(withRecipe([semi]));
    await user.type(search(), 'Tiramisu');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).not.toHaveTextContent('+');
    await waitFor(() => { expect(options[0]).toHaveTextContent('Tiramisu'); });
  });
});
