import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';
import { forgetHandover } from './photoCarry';

// The category menu of the recipe editor (slice «recipe categories + archive»): drawn only when the venue has a category, and
// ⚠️ SENT ONLY WHEN THE PERSON MOVED THE CHOICE, so a recipe whose word has left the list is not stripped of it by an unrelated
// save. The pure rules: editorModel.spec.ts.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); forgetHandover(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const LIST = ['Easter', 'Christmas'];
const LABELS = { recipeCategories: LIST };

const menu = (region: HTMLElement) => within(region).queryByRole('combobox', { name: 'Category' }) as HTMLSelectElement | null;

async function openEditor(path: string, recipes = [recipe('r1', { name: 'Focaccia', category: 'Easter' })], labelConfig: Record<string, unknown> | null = LABELS) {
  const source = fakeRecipesSource({ recipes, labelConfig });
  const view = renderRecipes(path, { source });
  const region = await screen.findByRole('region', { name: path.endsWith('/new') ? 'New recipe' : 'Edit recipe' }, LOAD);
  // The label profile lands a moment after the recipes: the menu is drawn once the list is known.
  return { ...view, source, region };
}

async function save(user: { click: (el: Element) => Promise<void> }, region: HTMLElement) {
  await user.click(within(region).getByRole('button', { name: 'Save' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

describe('the menu', () => {
  it('sits right under the name, with «No category» first and the words alphabetical', async () => {
    const { region } = await openEditor('/recipes/r1/edit');
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    const select = menu(region) as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.textContent)).toEqual(['No category', 'Christmas', 'Easter']);
    expect(select.value).toBe('Easter');
    const name = within(region).getByRole('textbox', { name: 'Recipe name' });
    expect(name.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(region).getByRole('heading', { level: 3, name: 'Ingredients' }).compareDocumentPosition(select) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('is absent while the venue has no category', async () => {
    const { region } = await openEditor('/recipes/r1/edit', undefined, null);
    await within(region).findByRole('textbox', { name: 'Recipe name' });
    expect(menu(region)).toBeNull();
  });

  it('is there for an employee, who may choose', async () => {
    const source = fakeRecipesSource({ recipes: [recipe('r1', { name: 'Focaccia' })], labelConfig: LABELS });
    renderRecipes('/recipes/r1/edit', { source, session: { role: 'staff', canManage: false, isOwner: false } });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
  });

  it('shows «No category» for a recipe whose word has left the list, and says it in Italian', async () => {
    const source = fakeRecipesSource({ recipes: [recipe('r1', { name: 'Focaccia', category: 'Gone' })], labelConfig: LABELS });
    renderRecipes('/recipes/r1/edit', { source, lang: 'it', session: { language: 'it' } });
    const region = await screen.findByRole('region', { name: 'Modifica ricetta' }, LOAD);
    await waitFor(() => { expect(within(region).queryByRole('combobox', { name: 'Categoria' })).not.toBeNull(); });
    const select = within(region).getByRole('combobox', { name: 'Categoria' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0]?.textContent).toBe('Nessuna categoria');
  });
});

describe('saving an existing recipe', () => {
  it('⚠️ sends NO category when the menu was not touched, even for a recipe whose word has left the list', async () => {
    const { user, region, source } = await openEditor('/recipes/r1/edit', [recipe('r1', { name: 'Focaccia', category: 'Gone' })]);
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), ' bis');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).not.toHaveProperty('category');
    expect(source.recipes.get('r1')?.category).toBe('Gone');
  });

  it('sends the new word when the choice moved, and the dirty editor asks before it is left', async () => {
    const { user, region, source, router } = await openEditor('/recipes/r1/edit');
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    await user.selectOptions(menu(region) as HTMLElement, 'Christmas');
    await waitFor(() => { expect(isBusy()).toBe(true); });
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.category).toBe('Christmas');
    expect(source.recipes.get('r1')?.category).toBe('Christmas');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
  });

  it('sends the empty choice as a removal of the category', async () => {
    const { user, region, source } = await openEditor('/recipes/r1/edit');
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    await user.selectOptions(menu(region) as HTMLElement, 'No category');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.category).toBeNull();
    expect(source.recipes.get('r1')).not.toHaveProperty('category');
  });

  it('turns the editor dirty: Back asks whether to discard, and Discard writes nothing', async () => {
    const { user, region, source, router } = await openEditor('/recipes/r1/edit');
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    await user.selectOptions(menu(region) as HTMLElement, 'Christmas');
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).not.toBe('/recipes/r1/edit'); });
    expect(source.recipeWrites).toEqual([]);
  });

  it('⚠️ never sends the archive flag, and an archived recipe stays archived after a save', async () => {
    const { user, region, source } = await openEditor('/recipes/r1/edit', [recipe('r1', { name: 'Focaccia', category: 'Easter', archived: true })]);
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    await user.selectOptions(menu(region) as HTMLElement, 'Christmas');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).not.toHaveProperty('archived');
    expect(source.recipes.get('r1')?.archived).toBe(true);
  });
});

describe('a new recipe', () => {
  async function fill(user: { type: (el: Element, text: string) => Promise<void> }, region: HTMLElement) {
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), 'Pane');
    await user.type(within(region).getAllByRole('combobox', { name: 'Ingredient name' })[0] as HTMLElement, 'Farina');
    await user.type(within(region).getAllByRole('spinbutton', { name: 'Amount' })[0] as HTMLElement, '500');
  }

  it('starts with no category and sends the word that was chosen', async () => {
    const { user, region, source } = await openEditor('/recipes/new');
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    expect(menu(region)?.value).toBe('');
    await fill(user, region);
    await user.selectOptions(menu(region) as HTMLElement, 'Easter');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.category).toBe('Easter');
  });

  it('sends no category when none was chosen', async () => {
    const { user, region, source } = await openEditor('/recipes/new');
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    await fill(user, region);
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).not.toHaveProperty('category');
  });
});

describe('«Duplicate»', () => {
  const ORIGINAL = recipe('orig', { name: 'Focaccia', category: 'Easter', archived: true });

  it('⚠️ copies the category, as the choice to save, and NEVER the archive', async () => {
    const source = fakeRecipesSource({ recipes: [ORIGINAL], labelConfig: LABELS });
    const { user } = renderRecipes('/recipes/orig', { source });
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }, LOAD));
    const region = await screen.findByRole('region', { name: 'New recipe' });
    await waitFor(() => { expect(menu(region)).not.toBeNull(); });
    expect(menu(region)?.value).toBe('Easter');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    const write = source.recipeWrites[0]!;
    expect(write.id).not.toBe('orig');
    expect(write.data?.category).toBe('Easter');
    expect(write.data).not.toHaveProperty('archived');
    expect(source.recipes.get(write.id)).not.toHaveProperty('archived');
  });
});
