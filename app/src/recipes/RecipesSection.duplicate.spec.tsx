import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';
import { forgetHandover, hasHandover } from './photoCarry';
import { NAME_MAX_LENGTH } from './editorModel';

// «Duplicate» on the recipe page (owner's decision, 18 Oct 2026): a new recipe filled in from this one, opened in the ordinary
// new-recipe editor, DIRTY, saved by nobody until Save. ⚠️ The original is never touched.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); forgetHandover(); });
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };

const ORIGINAL = recipe('orig', {
  name: 'Focaccia',
  lossPct: 12,
  rawGrams: 1000,
  cookedGrams: 880,
  netWeightG: 250,
  shelfLifeDays: 3,
  endNote: 'Let it rest',
  steps: [
    { text: 'Mix the flour', rows: ['rflour001'], seconds: 120, speed: '1' },
    { text: 'Add the salt', rows: ['rsalt0001'], seconds: 0, speed: '' },
  ],
  ingredients: [
    { label: 'Flour', grams: 1000, unit: 'g', rid: 'rflour001', kind: 'ingredient', refId: 'ING1' },
    { label: 'Water', grams: 700, unit: 'g', rid: 'rwater001' },
    { label: 'Salt', grams: 20, unit: 'g', rid: 'rsalt0001' },
  ],
});

const main = () => within(screen.getByRole('main'));
const duplicateButton = () => main().getByRole('button', { name: 'Duplicate' });

async function open(options: Parameters<typeof renderRecipes>[1] = {}) {
  const source = options.source ?? sourceWith([ORIGINAL]);
  const view = renderRecipes('/recipes/orig', { ...options, source });
  await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
  return { ...view, source };
}

const editorRegion = async () => within(await screen.findByRole('region', { name: 'New recipe' }));

describe('where «Duplicate» sits, and for whom', () => {
  it('⚠️ comes after Export and Import, with its hint, and before the Delete icon, which stays the very last', async () => {
    await open();
    const followed = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const exportButton = main().getByRole('button', { name: 'Export' });
    const importButton = main().getByRole('button', { name: 'Import into Calculator' });
    const hint = main().getByText('Opens a new recipe filled in from this one; nothing is saved until you tap Save.');
    const trash = main().getByRole('button', { name: 'Delete recipe' });
    expect(followed(exportButton, importButton)).toBe(true);
    expect(followed(importButton, duplicateButton())).toBe(true);
    expect(duplicateButton().nextElementSibling).toBe(hint);
    expect(followed(hint, trash)).toBe(true);
  });

  it('is there without Import when the venue does not use the Calculator', async () => {
    await open({ session: { location: { sections: { calculator: false } } } });
    expect(main().queryByRole('button', { name: 'Import into Calculator' })).not.toBeInTheDocument();
    expect(duplicateButton()).toBeInTheDocument();
  });

  it('⚠️ is absent — not disabled — for an employee, hint included', async () => {
    await open({ session: { ...EMPLOYEE, location: {} } });
    expect(main().queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(main().queryByText(/nothing is saved until you tap Save/)).not.toBeInTheDocument();
  });

  it('speaks Italian', async () => {
    renderRecipes('/recipes/orig', { source: sourceWith([ORIGINAL]), lang: 'it', session: { language: 'it' } });
    await screen.findByRole('heading', { level: 3, name: 'Ingredienti' }, LOAD);
    expect(main().getByRole('button', { name: 'Duplica' })).toBeInTheDocument();
    expect(main().getByText('Apre una nuova ricetta già compilata con questa; niente è salvato finché non premi Salva.')).toBeInTheDocument();
  });
});

describe('tapping it', () => {
  it('⚠️ opens the NEW-recipe editor filled in from the recipe, and saves nothing', async () => {
    const { user, router, source } = await open();
    await user.click(duplicateButton());
    const editor = await editorRegion();
    expect(router.state.location.pathname).toBe('/recipes/new');
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Focaccia (copy)');
    const names = editor.getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
    expect(names.map(box => box.value)).toEqual(['Flour', 'Water', 'Salt']);
    expect((editor.getAllByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement[]).map(box => box.value)).toEqual(['1000', '700', '20']);
    expect(source.recipeWrites).toEqual([]);
    expect(hasHandover()).toBe(false);
  });

  it('puts the focus on the editor’s title, as after a photo read', async () => {
    const { user } = await open();
    await user.click(duplicateButton());
    const editor = await editorRegion();
    await waitFor(() => { expect(editor.getByRole('heading', { level: 2 })).toHaveFocus(); });
  });

  it('says nothing about a photo: the editor is the ordinary new-recipe one', async () => {
    const { user } = await open();
    await user.click(duplicateButton());
    const editor = await editorRegion();
    expect(editor.queryByText(/photo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/read from/i)).not.toBeInTheDocument();
  });

  it('⚠️ STARTS DIRTY: the app is busy, and Back asks before discarding', async () => {
    const { user, router } = await open();
    await user.click(duplicateButton());
    const editor = await editorRegion();
    await waitFor(() => { expect(isBusy()).toBe(true); });
    await user.click(editor.getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    // Cancel stays on the copy.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/recipes/new');
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Focaccia (copy)');
  });

  it('⚠️ discarding it leaves the original and the database as they were', async () => {
    const { user, router, source } = await open();
    await user.click(duplicateButton());
    const editor = await editorRegion();
    await user.click(editor.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).not.toBe('/recipes/new'); });
    expect(source.recipeWrites).toEqual([]);
  });

  it('⚠️ the name fits the name box when the original’s is at its longest', async () => {
    const long = recipe('long', { name: 'B'.repeat(NAME_MAX_LENGTH) });
    const view = renderRecipes('/recipes/long', { source: sourceWith([long]) });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await view.user.click(duplicateButton());
    const name = (await editorRegion()).getByRole('textbox', { name: 'Recipe name' }) as HTMLInputElement;
    expect(name.value).toHaveLength(NAME_MAX_LENGTH);
    expect(name.value.endsWith(' (copy)')).toBe(true);
  });
});

describe('saving the copy', () => {
  async function saveCopy(typed?: string) {
    const opened = await open();
    await opened.user.click(duplicateButton());
    const editor = await editorRegion();
    if (typed !== undefined) {
      const name = editor.getByRole('textbox', { name: 'Recipe name' });
      await opened.user.clear(name);
      await opened.user.type(name, typed);
    }
    await opened.user.click(editor.getByRole('button', { name: 'Save' }));
    await opened.user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(opened.source.recipeWrites).toHaveLength(1); });
    return opened;
  }

  it('⚠️⚠️ creates a NEW recipe under a new id — the original is never written to', async () => {
    const { source } = await saveCopy('Focaccia alta');
    const [write] = source.recipeWrites;
    expect(write!.id).not.toBe('orig');
    expect(write!.id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(write!.data).toMatchObject({ name: 'Focaccia alta' });
    expect(source.recipeWrites.some(w => w.id === 'orig')).toBe(false);
  });

  it('carries the procedure (steps and closing message), the pack weight and the shelf life, and every row with its row id and link', async () => {
    const { source } = await saveCopy();
    const data = source.recipeWrites[0]!.data!;
    expect(data.name).toBe('Focaccia (copy)');
    expect(data.endNote).toBe('Let it rest');
    expect(data.steps).toEqual([
      { text: 'Mix the flour', rows: ['rflour001'], seconds: 120, speed: '1' },
      { text: 'Add the salt', rows: ['rsalt0001'], seconds: 0, speed: '' },
    ]);
    expect(data.netWeightG).toBe(250);
    expect(data.shelfLifeDays).toBe(3);
    expect(data.ingredients).toEqual([
      { label: 'Flour', grams: 1000, unit: 'g', rid: 'rflour001', kind: 'ingredient', refId: 'ING1' },
      { label: 'Water', grams: 700, unit: 'g', rid: 'rwater001' },
      { label: 'Salt', grams: 20, unit: 'g', rid: 'rsalt0001' },
    ]);
  });

  it('⚠️ leaves out the original’s oven loss, its weighings and its id', async () => {
    const { source } = await saveCopy();
    const data = source.recipeWrites[0]!.data!;
    for (const key of ['id', 'lossPct', 'rawGrams', 'cookedGrams', 'bakery']) expect(data, key).not.toHaveProperty(key);
  });

  it('after the save the editor does what it does for any new recipe: it leaves for the list, and the copy is in it', async () => {
    const { router, source } = await saveCopy();
    await waitFor(() => { expect(router.state.location.pathname).not.toBe('/recipes/new'); });
    expect(source.recipeWrites.map(w => w.id)).not.toContain('orig');
  });
});
