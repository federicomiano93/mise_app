import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
