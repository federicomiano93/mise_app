import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// The «with logo» label's two texts in the recipe editor (step 3e): the block is there for that model only, goes through
// the editor's own working copy (dirty, busy, leave guard) and an emptied box is a removal.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const LOGO_CONFIG = { template: 'logo' };

async function openEditor(fields: Record<string, unknown> = {}, labelConfig: Record<string, unknown> | null = LOGO_CONFIG) {
  const source = fakeRecipesSource({ recipes: [recipe('r1', { name: 'Focaccia', ...fields })], labelConfig });
  const view = renderRecipes('/recipes/r1/edit', { source });
  const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
  return { ...view, source, region };
}

const titleBox = (region: HTMLElement) => within(region).getByRole('textbox', { name: 'Title on the label' }) as HTMLInputElement;
const textBox = (region: HTMLElement) => within(region).getByRole('textbox', { name: 'Ingredients on the label' }) as HTMLTextAreaElement;

async function save(user: { click: (el: Element) => Promise<void> }, region: HTMLElement) {
  await user.click(within(region).getByRole('button', { name: 'Save' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

describe('the «Label with logo» block', () => {
  it('⚠️ is absent with the standard model (and with no profile at all)', async () => {
    const { region } = await openEditor({}, { template: 'standard' });
    expect(within(region).queryByRole('heading', { name: 'Label with logo' })).not.toBeInTheDocument();
    expect(within(region).queryByLabelText('Title on the label')).not.toBeInTheDocument();
    expect(within(region).queryByLabelText('Ingredients on the label')).not.toBeInTheDocument();
  });

  it('is absent when the venue has no label profile', async () => {
    const { region } = await openEditor({}, null);
    expect(within(region).queryByLabelText('Title on the label')).not.toBeInTheDocument();
  });

  it('is there with the logo model, under the exact heading the label screen names, with the stored texts', async () => {
    const { region } = await openEditor({ labelName: 'FOCACCIA|GENOVESE', labelIngredientsText: 'farina di GRANO tenero' });
    expect(await within(region).findByRole('heading', { level: 3, name: 'Label with logo' })).toBeInTheDocument();
    expect(titleBox(region).value).toBe('FOCACCIA|GENOVESE');
    expect(textBox(region).value).toBe('farina di GRANO tenero');
  });

  it('the title box shows the recipe’s name in capitals as its placeholder, following the name', async () => {
    const { region, user } = await openEditor();
    await within(region).findByLabelText('Title on the label');
    expect(titleBox(region)).toHaveAttribute('placeholder', 'FOCACCIA');
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), ' rossa');
    expect(titleBox(region)).toHaveAttribute('placeholder', 'FOCACCIA ROSSA');
  });

  it('limits the boxes to what the rules accept: 200 and 2000 characters', async () => {
    const { region } = await openEditor();
    await within(region).findByLabelText('Title on the label');
    expect(titleBox(region)).toHaveAttribute('maxlength', '200');
    expect(textBox(region)).toHaveAttribute('maxlength', '2000');
    expect(textBox(region)).toHaveAttribute('rows', '6');
  });

  it('links each hint to its box', async () => {
    const { region } = await openEditor();
    await within(region).findByLabelText('Title on the label');
    expect(titleBox(region)).toHaveAccessibleDescription(/Type \| to start a new line/);
    expect(textBox(region)).toHaveAccessibleDescription(/allergens in CAPITALS/);
  });

  it('⚠️ typing makes the editor dirty: busy, and Back asks before leaving', async () => {
    const { region, user, router } = await openEditor();
    await within(region).findByLabelText('Title on the label');
    expect(isBusy()).toBe(false);
    await user.type(textBox(region), 'BURRO');
    expect(isBusy()).toBe(true);
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(router.state.location.pathname).toBe('/recipes/r1/edit');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(textBox(region).value).toBe('BURRO');
  });

  it('saves the typed texts under their field names', async () => {
    const { region, user, source } = await openEditor();
    await within(region).findByLabelText('Title on the label');
    await user.type(titleBox(region), 'PANE');
    await user.type(textBox(region), 'farina di GRANO');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).toMatchObject({ labelName: 'PANE', labelIngredientsText: 'farina di GRANO' });
    expect(source.recipes.get('r1')).toMatchObject({ labelName: 'PANE', labelIngredientsText: 'farina di GRANO' });
  });

  it('⚠️ an emptied box is a removal, never an empty string', async () => {
    const { region, user, source } = await openEditor({ labelName: 'PANE', labelIngredientsText: 'farina di GRANO' });
    await within(region).findByLabelText('Title on the label');
    await user.clear(titleBox(region));
    await user.clear(textBox(region));
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).toMatchObject({ labelName: null, labelIngredientsText: null });
    expect(source.recipes.get('r1')).not.toHaveProperty('labelName');
    expect(source.recipes.get('r1')).not.toHaveProperty('labelIngredientsText');
  });

  it('leaves the stored texts alone when they were not touched', async () => {
    const { region, user, source } = await openEditor({ labelName: 'PANE', labelIngredientsText: 'farina di GRANO' });
    await within(region).findByLabelText('Title on the label');
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), '!');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipes.get('r1')).toMatchObject({ labelName: 'PANE', labelIngredientsText: 'farina di GRANO' });
  });

  it('says its words in Italian', async () => {
    const source = fakeRecipesSource({ recipes: [recipe('r1', { name: 'Focaccia' })], labelConfig: LOGO_CONFIG });
    renderRecipes('/recipes/r1/edit', { source, lang: 'it', session: { language: 'it' } });
    const region = await screen.findByRole('region', { name: 'Modifica ricetta' }, LOAD);
    expect(await within(region).findByRole('heading', { level: 3, name: 'Etichetta con logo' })).toBeInTheDocument();
    expect(within(region).getByRole('textbox', { name: 'Titolo sull’etichetta' })).toBeInTheDocument();
    expect(within(region).getByRole('textbox', { name: 'Ingredienti sull’etichetta' })).toBeInTheDocument();
  });
});
