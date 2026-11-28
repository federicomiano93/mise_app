import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// The Ricettario's «Categories» dialog (28 Nov 2026): the ONE place the categories are made, renamed and removed. Alphabetical, a
// count on each, rename / remove / add written at once. The pure rules: shared/recipe-shelf.spec.ts.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const GB = { country: 'GB' };
const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };

const RECIPES = [
  recipe('p', { name: 'Panettone', category: 'Christmas' }),
  recipe('b', { name: 'Brioche', category: 'Christmas' }),
  recipe('a', { name: 'Archived', category: 'Christmas', archived: true }),
  recipe('c', { name: 'Colomba', category: 'Easter' }),
  recipe('n', { name: 'Plain' }),
];

async function openDialog(categories: string[] | null = ['Easter', 'Christmas', 'Spring'], options: { lang?: 'en' | 'it'; data?: NonNullable<Parameters<typeof renderRecipes>[1]>['data'] } = {}) {
  const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: categories === null ? null : { recipeCategories: categories } });
  const view = renderRecipes('/recipes', { source, lang: options.lang, session: { location: GB, language: options.lang ?? 'en' }, data: options.data });
  await view.user.click(await screen.findByRole('button', { name: options.lang === 'it' ? 'Categorie' : 'Categories' }, LOAD));
  const dialog = await screen.findByRole('dialog', undefined, LOAD);
  return { ...view, source, dialog };
}

const rows = (dialog: HTMLElement) => within(dialog).getAllByRole('listitem').map(item => item.textContent);

describe('the door', () => {
  it('is a «Categories» button in the list\'s top bar for whoever runs the catalogue', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES });
    renderRecipes('/recipes', { source, session: { location: GB } });
    expect(await screen.findByRole('button', { name: 'Categories' }, LOAD)).toBeInTheDocument();
  });

  it('⚠️ is not drawn for an employee', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES });
    renderRecipes('/recipes', { source, session: { location: GB, ...EMPLOYEE } });
    await screen.findByRole('button', { name: 'Colomba' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Categories' })).not.toBeInTheDocument();
  });

  it('the Settings screen no longer holds the categories', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter'] } });
    renderRecipes('/recipes/settings', { source, session: { location: GB } });
    await screen.findByRole('region', { name: 'Settings' }, LOAD);
    expect(screen.queryByRole('region', { name: 'Recipe categories' })).not.toBeInTheDocument();
  });
});

describe('the list in the dialog', () => {
  it('shows every word alphabetically with its number of recipes (archived ones counted), and no way to move one', async () => {
    const { dialog } = await openDialog();
    expect(rows(dialog).map(text => text?.replace(/Rename.*|Remove.*/g, ''))).toEqual(['Christmas3 recipes', 'Easter1 recipe', 'Spring0 recipes']);
    expect(within(dialog).queryByRole('button', { name: /^(move|up|down)/i })).not.toBeInTheDocument();
  });

  it('says there are none yet', async () => {
    const { dialog } = await openDialog(null);
    expect(within(dialog).getByText('No categories yet.')).toBeInTheDocument();
  });

  it('speaks Italian', async () => {
    const { dialog } = await openDialog(['Natale'], { lang: 'it' });
    expect(within(dialog).getByRole('button', { name: '+ Nuova categoria' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Rinomina Natale' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Togli Natale' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Fatto' })).toBeInTheDocument();
    expect(within(dialog).getByText('0 ricette')).toBeInTheDocument();
  });
});

describe('adding', () => {
  it('writes ONE word at once, trimmed', async () => {
    const { user, dialog, source } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: '+ New category' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Category name' }), '  Summer   menu {Enter}');
    await waitFor(() => { expect(source.categoryWrites).toEqual([{ add: 'Summer menu' }]); });
    expect(rows(dialog).some(text => text?.startsWith('Summer menu'))).toBe(true);
  });

  it('⚠️ refuses an empty name and a name another word has (capitals not counting), and says why', async () => {
    const { user, dialog, source } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: '+ New category' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.type(box, '{Enter}');
    expect(within(dialog).getByText('Write a word first.')).toBeInTheDocument();
    await user.type(box, 'easter{Enter}');
    expect(within(dialog).getByText('“easter” is already on the list.')).toBeInTheDocument();
    expect(source.categoryWrites).toEqual([]);
  });

  it('a refused write puts the list back and says so', async () => {
    const { user, dialog, source } = await openDialog();
    source.refuse.labelSave = true;
    await user.click(within(dialog).getByRole('button', { name: '+ New category' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Category name' }), 'Summer{Enter}');
    expect(await within(dialog).findByText('Couldn’t save the categories — the change has been put back.')).toBeInTheDocument();
    expect(rows(dialog).some(text => text?.startsWith('Summer'))).toBe(false);
  });
});

describe('renaming', () => {
  it('⚠️ rewrites the category of EVERY recipe holding the word (archived too), then swaps the word on the list', async () => {
    const { user, dialog, source } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Rename Christmas' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'Festive{Enter}');
    await waitFor(() => { expect(source.categoryWrites).toEqual([{ add: 'Festive' }, { remove: ['Christmas'] }]); });
    const written = source.recipeWrites.filter(write => 'data' in write && (write.data as { category?: string }).category === 'Festive').map(write => write.id).sort();
    expect(written).toEqual(['a', 'b', 'p']);
    expect(source.recipeWrites).toHaveLength(3);
    expect(rows(dialog).map(text => text?.replace(/Rename.*|Remove.*/g, ''))).toEqual(['Easter1 recipe', 'Festive3 recipes', 'Spring0 recipes']);
  });

  it('refuses a name another word has, and writes nothing', async () => {
    const { user, dialog, source } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Rename Christmas' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'EASTER{Enter}');
    expect(within(dialog).getByText('“EASTER” is already on the list.')).toBeInTheDocument();
    expect(source.categoryWrites).toEqual([]);
    expect(source.recipeWrites).toEqual([]);
  });

  it('⚠️ renames the Food cost category with the same name too, keeping its rank, for somebody who may write Food cost', async () => {
    const foodcost = fakeFoodcostSource({ categories: [{ id: 'fc1', name: 'christmas', rank: 7 }, { id: 'fc2', name: 'Other', rank: 8 }] });
    const { user, dialog } = await openDialog(undefined, { data: { foodcost: () => foodcost } });
    await user.click(within(dialog).getByRole('button', { name: 'Rename Christmas' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'Festive{Enter}');
    await waitFor(() => { expect(foodcost.saved).toEqual([{ kind: 'category', id: 'fc1', data: { name: 'Festive', rank: 7 } }]); });
  });

  it('a Food cost that is not there does not stop the rename', async () => {
    const { user, dialog, source } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Rename Easter' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'Pasqua{Enter}');
    await waitFor(() => { expect(source.categoryWrites).toEqual([{ add: 'Pasqua' }, { remove: ['Easter'] }]); });
  });
});

describe('⚠️ a rename that is only partly accepted', () => {
  async function renameChristmas(user: Awaited<ReturnType<typeof openDialog>>['user'], dialog: HTMLElement) {
    await user.click(within(dialog).getByRole('button', { name: 'Rename Christmas' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'Festive{Enter}');
  }

  it('the new word refused: nothing else is sent, everything is put back, and the line says so', async () => {
    const { user, dialog, source } = await openDialog();
    source.refuse.labelSave = true;
    await renameChristmas(user, dialog);
    expect(await within(dialog).findByText('Couldn’t save the categories — the change has been put back.')).toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
    expect(source.categoryWrites).toEqual([]);
    expect(rows(dialog)).toEqual(['Christmas3 recipes', 'Easter1 recipe', 'Spring0 recipes']);
  });

  it('one recipe refused out of several: BOTH words stay, the others carry the new word, the line says it was not finished', async () => {
    const { user, dialog, source } = await openDialog();
    source.refuseRecipeIds = ['b'];
    await renameChristmas(user, dialog);
    expect(await within(dialog).findByText('Rename not finished.')).toBeInTheDocument();
    // The old word is never taken off the list: the refused recipe would otherwise land in «No category».
    expect(source.categoryWrites).toEqual([{ add: 'Festive' }]);
    expect(source.recipeWrites.map(write => write.id).sort()).toEqual(['a', 'p']);
    await waitFor(() => { expect(rows(dialog).map(text => text?.replace(/\d.*/, ''))).toEqual(['Christmas', 'Easter', 'Festive', 'Spring']); });
    expect(rows(dialog)).toContain('Christmas1 recipe');
    expect(rows(dialog)).toContain('Festive2 recipes');
  });

  it('the HACCP list\'s choice follows the word when it was that word', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter', 'Christmas'], haccpCategory: 'christmas' } });
    const view = renderRecipes('/recipes', { source, session: { location: GB } });
    await view.user.click(await screen.findByRole('button', { name: 'Categories' }, LOAD));
    await renameChristmas(view.user, await screen.findByRole('dialog', undefined, LOAD));
    await waitFor(() => { expect(source.labelSaves).toEqual([{ haccpCategory: 'Festive' }]); });
    expect(source.categoryWrites).toEqual([{ add: 'Festive' }, { remove: ['Christmas'] }]);
  });

  it('the HACCP choice is left alone when it is another word', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter', 'Christmas'], haccpCategory: 'Easter' } });
    const view = renderRecipes('/recipes', { source, session: { location: GB } });
    await view.user.click(await screen.findByRole('button', { name: 'Categories' }, LOAD));
    await renameChristmas(view.user, await screen.findByRole('dialog', undefined, LOAD));
    await waitFor(() => { expect(source.categoryWrites).toHaveLength(2); });
    expect(source.labelSaves).toEqual([]);
  });

  it('⚠️ the old word\'s removal refused (step 3): the old word comes back beside the new one and the line says so, in the page too', async () => {
    const { user, dialog, source } = await openDialog();
    vi.mocked(source.removeRecipeCategoryWords).mockImplementationOnce(async () => { throw new Error('permission-denied'); });
    await renameChristmas(user, dialog);
    expect(await within(dialog).findByText('Rename not finished.')).toBeInTheDocument();
    // «Rename not finished.» is also said in the page's own status line, so it is seen after «Done» too.
    expect(screen.getAllByText('Rename not finished.')).toHaveLength(2);
    await waitFor(() => { expect(rows(dialog)).toEqual(['Christmas0 recipes', 'Easter1 recipe', 'Festive3 recipes', 'Spring0 recipes']); });
    expect(source.categoryWrites).toEqual([{ add: 'Festive' }]);
  });

  it('⚠️ the HACCP write refused: the HACCP choice goes back, the old word stays, «Rename not finished.»', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter', 'Christmas'], haccpCategory: 'Christmas' } });
    vi.mocked(source.saveLabelConfig).mockImplementationOnce(async () => { throw new Error('permission-denied'); });
    const view = renderRecipes('/recipes', { source, session: { location: GB } });
    await view.user.click(await screen.findByRole('button', { name: 'Categories' }, LOAD));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    await renameChristmas(view.user, dialog);
    expect(await within(dialog).findByText('Rename not finished.')).toBeInTheDocument();
    expect(source.categoryWrites).toEqual([{ add: 'Festive' }]);
    expect(source.labelSaves).toEqual([]);
    expect(rows(dialog).some(text => text?.startsWith('Christmas'))).toBe(true);
  });

  it('Food cost not reached stays in the dialog with «Retry», which asks again for the same pair; the rename itself stands', async () => {
    const foodcost = fakeFoodcostSource({ categories: [{ id: 'fc1', name: 'Christmas', rank: 1 }] });
    const real = foodcost.watchCategories;
    let asked = 0;
    foodcost.watchCategories = (onChange, onError) => {
      asked += 1;
      if (asked > 1) return real(onChange, onError);
      queueMicrotask(() => { onError(new Error('offline')); });
      return () => undefined;
    };
    const { user, dialog, source } = await openDialog(undefined, { data: { foodcost: () => foodcost } });
    await renameChristmas(user, dialog);
    expect(await within(dialog).findByText('Food cost not updated.')).toBeInTheDocument();
    expect(source.categoryWrites).toEqual([{ add: 'Festive' }, { remove: ['Christmas'] }]);
    expect(foodcost.saved).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() => { expect(foodcost.saved).toEqual([{ kind: 'category', id: 'fc1', data: { name: 'Festive', rank: 1 } }]); });
    expect(within(dialog).queryByText('Food cost not updated.')).not.toBeInTheDocument();
  });
});

describe('⚠️ a rename while offline or slow', () => {
  it('is refused offline: «Needs a connection.», nothing is sent, and the box keeps what was typed', async () => {
    const { user, dialog, source } = await openDialog();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await user.click(within(dialog).getByRole('button', { name: 'Rename Christmas' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'Festive{Enter}');
    expect(await within(dialog).findByText('Needs a connection.')).toBeInTheDocument();
    expect(source.categoryWrites).toEqual([]);
    expect(source.recipeWrites).toEqual([]);
    expect(within(dialog).getByRole('textbox', { name: 'Category name' })).toHaveValue('Festive');
    expect(isBusy()).toBe(true); // the typed name only: nothing else holds the app
    vi.restoreAllMocks();
  });

  it('while the first write waits: shows the words as the rename leaves them, «Saving…», every action disabled, the app held, and no snapshot brings the old word back; released, it all completes', async () => {
    const { user, dialog, source } = await openDialog();
    const release = source.holdLabelSaves();
    await user.click(within(dialog).getByRole('button', { name: 'Rename Christmas' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'Festive{Enter}');
    expect(await within(dialog).findByText('Saving…')).toBeInTheDocument();
    expect(rows(dialog)).toEqual(['Easter1 recipe', 'Festive3 recipes', 'Spring0 recipes']);
    expect(within(dialog).getByRole('button', { name: 'Rename Easter' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Remove Easter' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '+ New category' })).toBeDisabled();
    expect(isBusy()).toBe(true);
    // The database tells again, still with the old word: the list must not take it.
    act(() => { source.push(); });
    expect(rows(dialog)).toEqual(['Easter1 recipe', 'Festive3 recipes', 'Spring0 recipes']);
    expect(source.categoryWrites).toEqual([]);
    expect(source.recipeWrites).toEqual([]);
    act(() => { release(); });
    await waitFor(() => { expect(source.categoryWrites).toEqual([{ add: 'Festive' }, { remove: ['Christmas'] }]); });
    expect(source.recipeWrites).toHaveLength(3);
    await waitFor(() => { expect(within(dialog).queryByText('Saving…')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
    expect(rows(dialog)).toEqual(['Easter1 recipe', 'Festive3 recipes', 'Spring0 recipes']);
    expect(within(dialog).getByRole('button', { name: 'Rename Easter' })).toBeEnabled();
  });
});

describe('the door waits for the label profile', () => {
  it('is disabled until the list of words has arrived, then works', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter'] } });
    source.holdLabelConfig();
    renderRecipes('/recipes', { source, session: { location: GB } });
    const door = await screen.findByRole('button', { name: 'Categories' }, LOAD);
    expect(door).toBeDisabled();
    act(() => { source.releaseLabelConfig(); });
    await waitFor(() => { expect(door).toBeEnabled(); });
  });
});

describe('removing', () => {
  it('⚠️ asks first, says how many recipes move to «No category»; Cancel keeps it', async () => {
    const { user, dialog, source } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Remove Christmas' }));
    const question = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(question).getByText('Remove “Christmas”? Its 3 recipes move to No category.')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(source.categoryWrites).toEqual([]);
    expect(rows(dialog).some(text => text?.startsWith('Christmas'))).toBe(true);
  });

  it('⚠️ takes the word off the list and rewrites no recipe', async () => {
    const { user, dialog, source } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Remove Christmas' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(source.categoryWrites).toEqual([{ remove: ['Christmas'] }]); });
    expect(source.recipeWrites).toEqual([]);
    expect(rows(dialog).some(text => text?.startsWith('Christmas'))).toBe(false);
  });
});
