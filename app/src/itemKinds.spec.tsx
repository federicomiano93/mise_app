import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fakeRecipesSource } from './testing/fakeRecipesSource';
import { recipe as catalogueRecipe, renderRecipes } from './testing/renderRecipes';
import { editorSource, intoForm, recipe as foodcostRecipe } from './testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from './testing/renderFoodcost';
import { fakeSuppliersSource } from './testing/fakeSuppliersSource';
import { item, renderSuppliers, supplier } from './testing/renderSuppliers';

// Mise 2, 14 Nov 2026: the item kinds «Rivendita» (resale: sold as it arrives, e.g. water) and «Altro» (other: cleaning, tools).
// ONE item of each, followed across three sections: it is listed where purchasable items are listed (Ingredients & suppliers)
// and NEVER offered where food is chosen — Food cost's ingredient chooser and a recipe row's link suggestions. The models are
// pinned in shared/ (ingredient-kind, catalogue-model); this is the screens agreeing with them.

beforeAll(async () => {
  await Promise.all([import('./suppliers/SuppliersSection'), import('./foodcost/FoodcostSection'), import('./recipes/RecipesSection')]);
}, 120_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// Named alike on purpose, so a search for «Acqua» would find all three if anything let the two non-food items through.
const FOOD = { id: 'i-acqua-food', name: 'Acqua di cottura', active: true, unit: 'kg' };
const WATER = { id: 'i-acqua', name: 'Acqua naturale', kind: 'resale', active: true };
const SOAP = { id: 'i-soap', name: 'Acqua ragia', kind: 'other', active: true };

describe('a resale and an other item, across the sections', () => {
  it('Ingredients & suppliers lists them, each on its own tab, and the supplier’s screen tags them', async () => {
    const source = fakeSuppliersSource({
      suppliers: [supplier('s-1', { name: 'Cerere Srl' })],
      ingredients: [item(FOOD.id, { name: FOOD.name, supplierId: 's-1' }), item(WATER.id, { name: WATER.name, kind: 'resale', supplierId: 's-1' }),
        item(SOAP.id, { name: SOAP.name, kind: 'other', supplierId: 's-1' })],
    });
    renderSuppliers('/suppliers/resale', { source });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(within(screen.getByRole('main')).getAllByRole('listitem').map(row => row.textContent)).toEqual([expect.stringMatching(/^Acqua naturale/)]);
    cleanup();

    renderSuppliers('/suppliers/other', { source });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(within(screen.getByRole('main')).getAllByRole('listitem').map(row => row.textContent)).toEqual([expect.stringMatching(/^Acqua ragia/)]);
    cleanup();

    renderSuppliers('/suppliers/supplier/s-1', { source });
    const water = await screen.findByRole('button', { name: /Acqua naturale/ }, LOAD);
    expect(water).toHaveTextContent('Resale');
    expect(screen.getByRole('button', { name: /Acqua ragia/ })).toHaveTextContent('Other');
    expect(screen.getByRole('button', { name: /Acqua di cottura/ })).not.toHaveTextContent(/Resale|Other/);
  });

  it('Food cost’s ingredient chooser offers the food only', async () => {
    const fake = editorSource([product('Green')], { recipes: [foodcostRecipe('Dough')], ingredients: [FOOD, WATER, SOAP] });
    const view = renderFoodcost('/food-cost/product/Green', { source: fake });
    await intoForm(view.user);
    await view.user.click(within(screen.getByRole('region', { name: 'Made of' })).getByRole('button', { name: '+ Add recipe or ingredient' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    const offered = within(dialog).getAllByRole('listitem').map(row => row.textContent ?? '');
    expect(offered.some(text => text.startsWith('Acqua di cottura'))).toBe(true);
    expect(offered.some(text => /Acqua naturale|Acqua ragia/.test(text))).toBe(false);
  });

  it('a recipe row’s link suggestions offer the food only', async () => {
    const source = fakeRecipesSource({
      recipes: [catalogueRecipe('r1', { name: 'Pane', ingredients: [{ label: 'Farina', grams: 1000, unit: 'g' }] })],
      ingredients: [FOOD, WATER, SOAP],
    });
    const view = renderRecipes('/recipes/r1/edit', { source });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    const name = within(region).getAllByRole('combobox', { name: 'Ingredient name' })[0]!;
    await view.user.clear(name);
    await view.user.type(name, 'acqua');
    const list = screen.getByRole('listbox', { name: 'Catalogue ingredients to link' });
    const offered = within(list).getAllByRole('option').map(node => node.textContent ?? '');
    expect(offered.some(text => text.startsWith('Acqua di cottura'))).toBe(true);
    expect(offered.some(text => /Acqua naturale|Acqua ragia/.test(text))).toBe(false);
  });
});
