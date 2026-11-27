import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// «Food cost card» at the foot of a NEW recipe: who is shown it, what it writes, and that a card that cannot be made never holds the
// recipe back. The pure document: recipeCard.spec.ts.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });

const FOCACCIA = recipe('r1', { name: 'Focaccia' });
const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };

async function open(path: string, options: Parameters<typeof renderRecipes>[1] = {}) {
  const foodcost = fakeFoodcostSource();
  const view = renderRecipes(path, { source: sourceWith([FOCACCIA]), data: { foodcost: () => foodcost }, ...options });
  const region = await screen.findByRole('region', { name: path.endsWith('/new') ? 'New recipe' : 'Edit recipe' }, LOAD);
  return { ...view, region, foodcost };
}

async function fillAndSave(region: HTMLElement, user: { type: (el: Element, text: string) => Promise<void>; click: (el: Element) => Promise<void> }) {
  await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), 'Pane');
  await user.type(within(region).getAllByRole('combobox', { name: 'Ingredient name' })[0]!, 'Farina');
  await user.type(within(region).getAllByRole('spinbutton', { name: 'Amount' })[0]!, '500');
  await user.click(within(region).getByRole('button', { name: 'Save' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

const choice = (region: HTMLElement, name: string) => within(region).getByRole('radio', { name });

describe('the «Food cost card» box', () => {
  it('is drawn on a new recipe for the owner, «Finished product» chosen, three answers and no description', async () => {
    const { region } = await open('/recipes/new');
    const group = within(region).getByRole('radiogroup', { name: 'Food cost card' });
    expect(within(group).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['Finished product', 'Semi-finished', 'No card']);
    expect(choice(region, 'Finished product')).toBeChecked();
  });

  it('says it in Italian', async () => {
    renderRecipes('/recipes/new', { source: sourceWith([FOCACCIA]), lang: 'it' });
    const region = await screen.findByRole('region', { name: 'Nuova ricetta' }, LOAD);
    const group = within(region).getByRole('radiogroup', { name: 'Scheda Food cost' });
    expect(within(group).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['Prodotto finito', 'Semilavorato', 'Nessuna scheda']);
  });

  it('is never drawn when an existing recipe is edited', async () => {
    const { region } = await open('/recipes/r1/edit');
    expect(within(region).queryByRole('radiogroup', { name: 'Food cost card' })).toBeNull();
  });

  it('is not drawn for an employee the venue does not show Food cost to, nor in a venue without Food cost', async () => {
    const first = await open('/recipes/new', { session: { ...EMPLOYEE, location: {} } });
    expect(within(first.region).queryByRole('radiogroup', { name: 'Food cost card' })).toBeNull();
  });

  it('is not drawn in a venue without Food cost', async () => {
    const { region } = await open('/recipes/new', { session: { location: { sections: { foodcost: false } } } });
    expect(within(region).queryByRole('radiogroup', { name: 'Food cost card' })).toBeNull();
  });

  it('is drawn for an employee the venue shows Food cost to', async () => {
    const { region } = await open('/recipes/new', { session: { ...EMPLOYEE, location: { staffShownCards: { foodcost: true } } } });
    expect(within(region).getByRole('radiogroup', { name: 'Food cost card' })).toBeInTheDocument();
  });
});

describe('Save with the box', () => {
  it('creates the card at products/recipe-<id> with only the name, and says so', async () => {
    const { region, user, source, foodcost } = await open('/recipes/new');
    await fillAndSave(region, user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    await waitFor(() => { expect(foodcost.createProductIfAbsent).toHaveBeenCalledTimes(1); });
    const [id, data] = vi.mocked(foodcost.createProductIfAbsent).mock.calls[0]!;
    expect(id).toBe(`recipe-${source.recipeWrites[0]!.id}`);
    expect(data).toMatchObject({ name: 'Pane', kind: 'finished', model: 4, components: [], packaging: [], sellingPrice: null });
    expect(await screen.findByText('Recipe added. Food cost card created.')).toBeInTheDocument();
  });

  it('makes a semi-finished card when «Semi-finished» is chosen', async () => {
    const { region, user, foodcost } = await open('/recipes/new');
    await user.click(choice(region, 'Semi-finished'));
    await fillAndSave(region, user);
    await waitFor(() => { expect(foodcost.createProductIfAbsent).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(foodcost.createProductIfAbsent).mock.calls[0]![1]).toMatchObject({ kind: 'semi' });
  });

  it('makes no card for «No card» and says only «Recipe added.»', async () => {
    const { region, user, source, foodcost } = await open('/recipes/new');
    await user.click(choice(region, 'No card'));
    await fillAndSave(region, user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(await screen.findByText('Recipe added.')).toBeInTheDocument();
    expect(foodcost.createProductIfAbsent).not.toHaveBeenCalled();
  });

  it('⚠️ a refused card still saves the recipe, goes back to the list and says «not created»', async () => {
    const foodcost = fakeFoodcostSource();
    foodcost.refuse.create = true;
    const { region, user, source, router } = await open('/recipes/new', { data: { foodcost: () => foodcost } });
    await fillAndSave(region, user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(await screen.findByText('Recipe added. Food cost card not created.')).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(foodcost.createProductIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('⚠️ saving an existing recipe never asks for a card', async () => {
    const { region, user, source, foodcost } = await open('/recipes/r1/edit');
    await user.click(within(region).getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(await screen.findByText('Recipe saved.')).toBeInTheDocument();
    expect(foodcost.createProductIfAbsent).not.toHaveBeenCalled();
  });
});
