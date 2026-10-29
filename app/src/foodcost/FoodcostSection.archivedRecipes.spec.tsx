import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// An archived recipe (slice «recipe categories + archive», docs/parity/catalogue.md, choice 7) is left out of what Food cost
// OFFERS for a new line, and still costs and names a line that already points at it.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const nameBox = () => screen.getByRole('combobox', { name: 'Name' });
const madeOf = () => screen.getByRole('region', { name: 'Made of' });
const optionNames = (dialog: HTMLElement) => within(dialog).getAllByRole('listitem').map(item => item.textContent);

const RECIPES = [recipe('Dough'), recipe('Donut', { archived: true })];

async function open(path: string, fake: ReturnType<typeof editorSource>) {
  const view = renderFoodcost(path, { source: fake });
  await screen.findByRole('combobox', { name: 'Name' }, LOAD);
  return { ...view, fake };
}

describe('the recipes Food cost offers', () => {
  it('⚠️ leave an archived recipe out of the chooser', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { recipes: RECIPES }));
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe' }));
    expect(optionNames(await screen.findByRole('dialog', undefined, LOAD))).toEqual(['Dough']);
  });

  it('⚠️ when every recipe is archived the chooser says so, not «no recipes yet»', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { recipes: [recipe('Donut', { archived: true })] }));
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe' }));
    const dialog = within(await screen.findByRole('dialog', undefined, LOAD));
    expect(dialog.getByText('Every recipe is archived — restore one in the Recipe catalogue to choose it.')).toBeInTheDocument();
    expect(dialog.queryByText(/No recipes yet/)).not.toBeInTheDocument();
  });

  it('⚠️ leave an archived recipe out of the name’s suggestions', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { recipes: RECIPES }));
    await user.type(nameBox(), 'do');
    const listed = within(screen.getByRole('listbox', { name: 'Recipes to base this product on' })).getAllByRole('option');
    expect(listed.map(option => option.textContent)).toEqual(['Dough']);
  });

  it('⚠️ a line already made of an archived recipe keeps naming it and costing it', async () => {
    const { user } = await open(
      '/food-cost/product/Loaf',
      editorSource([product('Loaf', { components: [{ recipeId: 'Donut', qtyKg: 1 }] })], { recipes: RECIPES }),
    );
    expect(within(madeOf()).getByRole('button', { name: 'Change: Donut' })).toBeInTheDocument();
    expect(madeOf()).not.toHaveTextContent(/priced|exist/i);
    // Changing the line still offers only the live recipes.
    await user.click(within(madeOf()).getByRole('button', { name: 'Change: Donut' }));
    expect(optionNames(await screen.findByRole('dialog', undefined, LOAD)).join(' ')).not.toContain('Donut');
  });
});
