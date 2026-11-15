import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// An archived recipe is left out of the editor's choices for a NEW sub-recipe link (slice «recipe categories + archive»,
// docs/parity/catalogue.md, choice 7), while a row ALREADY linked to one keeps naming it and keeps its «Remove the link».

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const FOCACCIA = recipe('r1', { name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }] });
const FARINATA = recipe('r2', { name: 'Farinata' });
const FARRO = recipe('r3', { name: 'Farro loaf', archived: true });

const ingredientBoxes = (region: HTMLElement) => within(region).getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
const options = () => {
  const list = screen.queryByRole('listbox', { name: 'Catalogue ingredients to link' });
  return list ? within(list).getAllByRole('option') : [];
};

async function openEditor(seed: Parameters<typeof fakeRecipesSource>[0]) {
  const view = renderRecipes('/recipes/r1/edit', { source: fakeRecipesSource(seed) });
  const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
  return { ...view, region };
}

describe('the editor’s choices for a new link', () => {
  it('⚠️ leave an archived recipe out of the suggestions under a row’s name', async () => {
    const { region, user } = await openEditor({ recipes: [FOCACCIA, FARINATA, FARRO] });
    const name = ingredientBoxes(region)[0]!;
    await user.clear(name);
    await user.type(name, 'fa');
    expect(options().map(node => node.textContent)).toEqual(['Farinata Recipe', '+ Add «fa» as an ingredient']);
  });

  it('⚠️ leave an archived recipe out of the full chooser', async () => {
    const { region, user } = await openEditor({ recipes: [FOCACCIA, FARINATA, FARRO] });
    await user.click(within(region).getByRole('button', { name: '+ Link to an ingredient' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    expect(within(dialog).getByRole('button', { name: /^Farinata/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Farro loaf/ })).not.toBeInTheDocument();
  });

  it('⚠️ a row already linked to an archived recipe still reads «→ name · Recipe» and the chooser still offers «Remove the link»', async () => {
    const linked = recipe('r1', {
      name: 'Focaccia',
      ingredients: [{ label: 'Farro', grams: 100, unit: 'g', kind: 'recipe', refId: 'r3' }],
    });
    const { region, user } = await openEditor({ recipes: [linked, FARRO, FARINATA] });
    const line = within(region).getByRole('button', { name: /→ Farro loaf/ });
    expect(line).toHaveTextContent('Recipe');
    await user.click(line);
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    expect(within(dialog).getByRole('button', { name: 'Remove the link' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Farinata/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Farro loaf/ })).not.toBeInTheDocument();
  });
});
