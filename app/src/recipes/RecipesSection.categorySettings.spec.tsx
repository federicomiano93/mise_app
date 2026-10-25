import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// The card «Recipe categories» in the Catalogue Settings (slice «recipe categories + archive»): the venue's words, a bin on each
// that asks first, and a box that adds one with its refusals. The pure rules: shared/recipe-shelf.spec.ts.

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
];

async function openSettings(categories: string[] | null = ['Easter', 'Christmas', 'Spring'], options: { lang?: 'en' | 'it' } = {}) {
  const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: categories === null ? null : { recipeCategories: categories } });
  const view = renderRecipes('/recipes/settings', { source, lang: options.lang, session: { location: GB, language: options.lang ?? 'en' } });
  await screen.findByRole('region', { name: options.lang === 'it' ? 'Impostazioni' : 'Settings' }, LOAD);
  return { ...view, source };
}

const card = (title = 'Recipe categories') => within(screen.getByRole('region', { name: title }));
const words = () => card().queryAllByRole('listitem').map(item => item.textContent);
const box = () => card().getByRole('textbox', { name: 'New category' }) as HTMLInputElement;
const add = () => card().getByRole('button', { name: 'Add' });
const bin = (name: string) => card().getByRole('button', { name: `Delete the category “${name}”` });
const saved = (source: ReturnType<typeof fakeRecipesSource>) => source.labelSaves.map(patch => patch.recipeCategories);

describe('the card', () => {
  it('is the second card, right after the photo card and before the model card, with its note', async () => {
    await openSettings();
    const cards = within(screen.getByRole('region', { name: 'Settings' })).getAllByRole('region');
    expect(cards.map(region => region.querySelector('h3')?.textContent).slice(0, 3)).toEqual(['Photos', 'Recipe categories', 'Which label to print']);
    expect(card().getByText(/One category per recipe, chosen when you edit the recipe/)).toBeInTheDocument();
  });

  it('lists the words alphabetically, each with a bin', async () => {
    await openSettings();
    expect(words()).toEqual(['Christmas', 'Easter', 'Spring']);
    expect(bin('Easter')).toHaveAttribute('title', 'Delete the category “Easter”');
  });

  it('says there are none yet', async () => {
    await openSettings(null);
    expect(card().getByText('No categories yet.')).toBeInTheDocument();
    expect(words()).toEqual([]);
  });

  it('speaks Italian', async () => {
    await openSettings(['Natale'], { lang: 'it' });
    const italian = within(screen.getByRole('region', { name: 'Categorie delle ricette' }));
    expect(italian.getByRole('textbox', { name: 'Nuova categoria' })).toHaveAttribute('placeholder', 'es. Natale');
    expect(italian.getByRole('button', { name: 'Aggiungi' })).toBeInTheDocument();
    expect(italian.getByRole('button', { name: 'Elimina la categoria “Natale”' })).toBeInTheDocument();
  });

  it('⚠️ waits for the label profile: nothing is drawn, so nothing can be written over a list not yet seen', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter'] } });
    source.holdLabelConfig();
    renderRecipes('/recipes/settings', { source, session: { location: GB } });
    await screen.findByRole('region', { name: 'Settings' }, LOAD);
    expect(screen.queryByRole('region', { name: 'Recipe categories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    act(() => { source.releaseLabelConfig(); });
    expect(await screen.findByRole('region', { name: 'Recipe categories' })).toBeInTheDocument();
    expect(source.labelSaves).toEqual([]);
  });

  it('⚠️ is not reachable for an employee: no door and no card', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter'] } });
    renderRecipes('/recipes', { source, session: { location: GB, ...EMPLOYEE } });
    await screen.findByRole('button', { name: 'Colomba' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recipe categories' })).not.toBeInTheDocument();
  });
});

describe('adding a word', () => {
  it('adds it with the button: saved whole through the label profile, the box emptied and the focus kept in it', async () => {
    const { user, source } = await openSettings();
    await user.type(box(), '  Summer   menu ');
    await user.click(add());
    await waitFor(() => { expect(saved(source)).toEqual([['Easter', 'Christmas', 'Spring', 'Summer menu']]); });
    expect(words()).toEqual(['Christmas', 'Easter', 'Spring', 'Summer menu']);
    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
  });

  it('adds it with Enter too', async () => {
    const { user, source } = await openSettings([]);
    await user.type(box(), 'Autumn{Enter}');
    await waitFor(() => { expect(saved(source)).toEqual([['Autumn']]); });
    expect(words()).toEqual(['Autumn']);
  });

  it('stops the box at 40 characters', async () => {
    const { user } = await openSettings();
    expect(box()).toHaveAttribute('maxlength', '40');
    await user.type(box(), 'x'.repeat(50));
    expect(box().value).toHaveLength(40);
  });

  it.each([
    ['an empty box', '', 'Write a word first.'],
    ['a box of spaces', '   ', 'Write a word first.'],
    ['a word already there, whatever the case', 'EASTER', '“EASTER” is already on the list.'],
  ])('refuses %s with the sentence under the box, the box marked invalid, the focus kept and nothing written', async (_what, typed, sentence) => {
    const { user, source } = await openSettings();
    if (typed) await user.type(box(), typed);
    await user.click(add());
    const said = await card().findByText(sentence);
    expect(said.closest('[role="status"]')).not.toBeNull();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box().getAttribute('aria-describedby')).toBe(said.id);
    expect(box()).toHaveFocus();
    expect(source.labelSaves).toEqual([]);
  });

  it('refuses a word over 40 characters (the box itself stops typing there, so the text is set the way a stored longer word would be)', async () => {
    const { user, source } = await openSettings();
    fireEvent.change(box(), { target: { value: 'y'.repeat(41) } });
    await user.click(add());
    expect(await card().findByText('At most 40 characters.')).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(source.labelSaves).toEqual([]);
  });

  it('refuses a word when the list is full', async () => {
    const full = Array.from({ length: 100 }, (_item, index) => `Word ${String(index).padStart(3, '0')}`);
    const { user, source } = await openSettings(full);
    await user.type(box(), 'One more');
    await user.click(add());
    expect(await card().findByText('The list is full (100 categories).')).toBeInTheDocument();
    expect(source.labelSaves).toEqual([]);
  });

  it('forgets the sentence as soon as the person types again', async () => {
    const { user } = await openSettings();
    await user.click(add());
    await card().findByText('Write a word first.');
    await user.type(box(), 'S');
    expect(card().queryByText('Write a word first.')).not.toBeInTheDocument();
    expect(box()).not.toHaveAttribute('aria-invalid');
  });

  it('⚠️ a refused save says so in the page’s status line and the list comes back', async () => {
    const source = fakeRecipesSource({ recipes: RECIPES, labelConfig: { recipeCategories: ['Easter'] } });
    source.refuse.labelSave = true;
    const view = renderRecipes('/recipes/settings', { source, session: { location: GB } });
    await screen.findByRole('region', { name: 'Settings' }, LOAD);
    await within(screen.getByRole('region', { name: 'Recipe categories' })).findByRole('textbox', { name: 'New category' });
    await view.user.type(box(), 'Spring');
    await view.user.click(add());
    expect(await screen.findByText('Couldn’t save the categories — the change has been put back.')).toBeInTheDocument();
    await waitFor(() => { expect(words()).toEqual(['Easter']); });
  });
});

describe('deleting a word', () => {
  async function ask(name: string) {
    const view = await openSettings();
    await view.user.click(bin(name));
    return { ...view, dialog: await screen.findByRole('alertdialog') };
  }

  it('asks first and says no recipe is filed under it', async () => {
    const { dialog, source } = await ask('Spring');
    expect(within(dialog).getByText('Delete “Spring”?')).toBeInTheDocument();
    expect(within(dialog).getByText('No recipe is filed under it.')).toBeInTheDocument();
    expect(source.labelSaves).toEqual([]);
  });

  it('says how many recipes go back to «No category» — the archived ones count — and that they come back with the word', async () => {
    const { dialog } = await ask('Christmas');
    expect(within(dialog).getByText('3 recipes go back to “No category”. If you add the word again, they come back.')).toBeInTheDocument();
  });

  it('says it in the singular for one recipe', async () => {
    const { dialog } = await ask('Easter');
    expect(within(dialog).getByText('1 recipe goes back to “No category”. If you add the word again, it comes back.')).toBeInTheDocument();
  });

  it('writes only the list when confirmed — no recipe is rewritten — and the focus goes to the next bin', async () => {
    const { dialog, user, source } = await ask('Christmas');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(saved(source)).toEqual([['Easter', 'Spring']]); });
    expect(source.recipeWrites).toEqual([]);
    expect(words()).toEqual(['Easter', 'Spring']);
    await waitFor(() => { expect(bin('Easter')).toHaveFocus(); });
  });

  it('writes nothing when cancelled', async () => {
    const { dialog, user, source } = await ask('Christmas');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.labelSaves).toEqual([]);
    expect(words()).toEqual(['Christmas', 'Easter', 'Spring']);
  });

  it('⚠️ a refused delete is taken back and said', async () => {
    const { dialog, user, source } = await ask('Spring');
    source.refuse.labelSave = true;
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Couldn’t save the categories — the change has been put back.')).toBeInTheDocument();
    await waitFor(() => { expect(words()).toEqual(['Christmas', 'Easter', 'Spring']); });
  });
});
