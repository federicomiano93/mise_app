import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// The HACCP label’s storage text in the recipe editor (image labels step 2): the box is there only when the venue prints that
// field, goes through the editor’s own working copy, and an emptied box is a removal.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const PRINTED = { haccpFields: { storage: 'print' } };

async function openEditor(fields: Record<string, unknown> = {}, labelConfig: Record<string, unknown> | null = PRINTED) {
  const source = fakeRecipesSource({ recipes: [recipe('r1', { name: 'Crema', ...fields })], labelConfig });
  const view = renderRecipes('/recipes/r1/edit', { source });
  const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
  return { ...view, source, region };
}

const box = (region: HTMLElement) => within(region).getByRole('textbox', { name: 'Storage (HACCP label)' }) as HTMLInputElement;

async function save(user: { click: (el: Element) => Promise<void> }, region: HTMLElement) {
  await user.click(within(region).getByRole('button', { name: 'Save' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

describe('the «Storage (HACCP label)» box', () => {
  it.each([
    ['off', { haccpFields: { storage: 'off' } }],
    ['by hand', { haccpFields: { storage: 'blank' } }],
    ['never configured', null],
  ])('⚠️ is absent when the venue’s storage field is %s', async (_name, config) => {
    const { region } = await openEditor({}, config);
    await within(region).findByRole('textbox', { name: 'Recipe name' });
    expect(within(region).queryByLabelText('Storage (HACCP label)')).not.toBeInTheDocument();
  });

  it('is there when the field is printed, one line, bound by the rules, with its example', async () => {
    const { region } = await openEditor({ haccpStorage: 'In the fridge at +4 °C' });
    expect(box(region).value).toBe('In the fridge at +4 °C');
    expect(box(region)).toHaveAttribute('maxlength', '200');
    expect(box(region)).toHaveAccessibleDescription('Printed on the HACCP label, e.g. In the fridge at +4 °C');
  });

  it('⚠️ typing makes the editor dirty: busy, and Back asks before leaving', async () => {
    const { region, user } = await openEditor();
    expect(isBusy()).toBe(false);
    await user.type(box(region), 'Freezer');
    expect(isBusy()).toBe(true);
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
  });

  it('saves the typed text under haccpStorage', async () => {
    const { region, user, source } = await openEditor();
    await user.type(box(region), 'Fridge +4');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).toMatchObject({ haccpStorage: 'Fridge +4' });
    expect(source.recipes.get('r1')).toMatchObject({ haccpStorage: 'Fridge +4' });
  });

  it('⚠️ an emptied box is a removal, never an empty string', async () => {
    const { region, user, source } = await openEditor({ haccpStorage: 'Fridge +4' });
    await user.clear(box(region));
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).toMatchObject({ haccpStorage: null });
    expect(source.recipes.get('r1')).not.toHaveProperty('haccpStorage');
  });

  it('leaves the stored text alone when the box was not touched', async () => {
    const { region, user, source } = await openEditor({ haccpStorage: 'Fridge +4' });
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), '!');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipes.get('r1')).toMatchObject({ haccpStorage: 'Fridge +4' });
  });

  it('⚠️ keeps the stored text through a save when the venue no longer prints the field (the box is not drawn)', async () => {
    const { region, user, source } = await openEditor({ haccpStorage: 'Fridge +4' }, null);
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), '!');
    await save(user, region);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipes.get('r1')).toMatchObject({ haccpStorage: 'Fridge +4' });
  });

  it('says its words in Italian', async () => {
    const source = fakeRecipesSource({ recipes: [recipe('r1', { name: 'Crema' })], labelConfig: PRINTED });
    renderRecipes('/recipes/r1/edit', { source, lang: 'it', session: { language: 'it' } });
    const region = await screen.findByRole('region', { name: 'Modifica ricetta' }, LOAD);
    expect(await within(region).findByRole('textbox', { name: 'Conservazione (etichetta HACCP)' })).toHaveAccessibleDescription('Stampata sull’etichetta HACCP, es. In frigorifero a +4 °C');
  });
});
