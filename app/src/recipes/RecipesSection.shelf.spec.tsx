import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes, split } from '../testing/renderRecipes';

// The recipe list on the shelf (slice «recipe categories + archive», docs/parity/catalogue.md): the rows grouped under the
// venue's category words, and the archived recipes in a folded group at the foot. The pure rules: shared/recipe-shelf.spec.ts.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };

const RECIPES = [
  recipe('p', { name: 'Panettone', category: 'Christmas' }),
  recipe('c', { name: 'Colomba', category: 'Easter' }),
  recipe('f', { name: 'Focaccia' }),
  recipe('b', { name: 'Brioche', category: 'Christmas' }),
  recipe('o', { name: 'Old word', category: 'Gone' }),
  recipe('a', { name: 'Archived loaf', archived: true }),
  recipe('ac', { name: 'Archived cake', category: 'Easter', archived: true }),
];

const main = () => within(screen.getByRole('main'));
const search = () => screen.getByRole('searchbox', { name: 'Search a recipe by name' });
const rowOf = (name: string) => main().getByRole('button', { name });
// A group's header is a button inside the h2: its name is the first span, its count the second.
const headings = () => main().queryAllByRole('heading', { level: 2 }).map(heading => heading.querySelector('span')?.textContent);
const groupOf = (name: string) => main().getAllByRole('heading', { level: 2 }).find(found => found.querySelector('span')?.textContent === name)?.closest('section') as HTMLElement;
const headerOf = (name: string) => within(groupOf(name)).getByRole('button', { name: new RegExp(`^${name}`) });
// The rows of a group, shown or not: the groups start closed, and a closed group's rows are `hidden`.
const groupNames = (heading: string) => within(groupOf(heading).querySelector('ul') as HTMLElement).getAllByRole('listitem', { hidden: true }).map(item => item.textContent);
const fold = (n: number) => main().getByText(`Archived (${n})`).closest('details') as HTMLDetailsElement;

type Options = { recipes?: ReturnType<typeof recipe>[]; categories?: string[]; path?: string; session?: Record<string, unknown>; lang?: 'en' | 'it' };

async function loaded({ recipes = RECIPES, categories = ['Easter', 'Christmas'], path = '/recipes', session, lang }: Options = {}) {
  const source = fakeRecipesSource({ recipes, labelConfig: categories.length > 0 ? { recipeCategories: categories } : null });
  const view = renderRecipes(path, { source, session, lang });
  await screen.findAllByRole('listitem', { hidden: true }, LOAD);
  return { ...view, source };
}

describe('the list under the category headings', () => {
  it('groups the rows under the words in alphabetical order, with «No category» last, and keeps the most used first inside a group', async () => {
    window.localStorage.setItem('catalogue-usage', JSON.stringify({ p: 5 }));
    await loaded();
    await waitFor(() => { expect(headings()).toEqual(['Christmas', 'Easter', 'No category']); });
    expect(groupNames('Christmas')).toEqual(['Panettone', 'Brioche']);
    expect(groupNames('Easter')).toEqual(['Colomba']);
    // A recipe with no word, and one whose word has left the list, are in no category.
    expect(groupNames('No category')).toEqual(['Focaccia', 'Old word']);
  });

  it('orders the words by the interface language and says «Senza categoria» in Italian', async () => {
    await loaded({ categories: ['Zeta', 'Èlite', 'alfa'], recipes: [recipe('a', { name: 'A', category: 'Zeta' }), recipe('b', { name: 'B', category: 'alfa' }), recipe('c', { name: 'C', category: 'Èlite' }), recipe('d', { name: 'D' })], lang: 'it', session: { language: 'it' } });
    await waitFor(() => { expect(headings()).toEqual(['alfa', 'Èlite', 'Zeta', 'Senza categoria']); });
  });

  it('draws the list exactly as before, with no heading, while no category is in use', async () => {
    await loaded({ categories: [] });
    expect(headings()).toEqual([]);
    expect(main().getAllByRole('listitem').filter(item => !item.closest('details')).map(item => item.textContent)).toEqual(['Brioche', 'Colomba', 'Focaccia', 'Old word', 'Panettone']);
  });

  it('draws no heading either when the words on the list hold no recipe', async () => {
    await loaded({ categories: ['Spring'] });
    expect(headings()).toEqual([]);
  });

  it('puts the heading on a lone category group, and none on «No category» when it is the only group', async () => {
    await loaded({ recipes: [recipe('p', { name: 'Panettone', category: 'Christmas' })] });
    await waitFor(() => { expect(headings()).toEqual(['Christmas']); });
  });

  it('searches across every group: a heading with no match disappears', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(headings()).toHaveLength(3); });
    await user.type(search(), 'colo');
    await waitFor(() => { expect(headings()).toEqual(['Easter']); });
    expect(groupNames('Easter')).toEqual(['Colomba']);
  });

  it('says «No recipe matches» only when nothing at all matches, the fold included', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(headings()).toHaveLength(3); });
    // Only an archived recipe matches: the fold shows it, and the line stays away.
    await user.type(search(), 'archived loaf');
    await waitFor(() => { expect(headings()).toEqual([]); });
    expect(screen.queryByText('No recipe matches your search.')).not.toBeInTheDocument();
    expect(main().getByText('Archived (1)')).toBeInTheDocument();
    await user.clear(search());
    await user.type(search(), 'zzz');
    expect(await screen.findByText('No recipe matches your search.')).toBeInTheDocument();
    expect(main().queryByText(/^Archived \(/)).not.toBeInTheDocument();
  });

  it('keeps «No recipes yet» for a venue with no recipe', async () => {
    renderRecipes('/recipes', { source: fakeRecipesSource({ labelConfig: { recipeCategories: ['Easter'] } }) });
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('the groups open and close on a tap', () => {
  const expanded = (name: string) => headerOf(name).getAttribute('aria-expanded');

  it('starts with EVERY group closed, «No category» too, each header a button with the name and the number of recipes', async () => {
    await loaded();
    await waitFor(() => { expect(headings()).toEqual(['Christmas', 'Easter', 'No category']); });
    expect(['Christmas', 'Easter', 'No category'].map(expanded)).toEqual(['false', 'false', 'false']);
    expect(headerOf('Christmas')).toHaveTextContent('2 recipes');
    expect(headerOf('Easter')).toHaveTextContent('1 recipe');
    expect(screen.queryByRole('button', { name: 'Panettone' })).not.toBeInTheDocument();
  });

  it('a tap opens a group and a second tap closes it, the others untouched', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(headings()).toHaveLength(3); });
    await user.click(headerOf('Christmas'));
    expect(expanded('Christmas')).toBe('true');
    expect(rowOf('Panettone')).toBeVisible();
    expect(expanded('Easter')).toBe('false');
    await user.click(headerOf('Christmas'));
    expect(expanded('Christmas')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Panettone' })).not.toBeInTheDocument();
  });

  it('a search opens the groups that match, and clearing it returns to the closed groups', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(headings()).toHaveLength(3); });
    await user.type(search(), 'colo');
    await waitFor(() => { expect(headings()).toEqual(['Easter']); });
    expect(expanded('Easter')).toBe('true');
    expect(rowOf('Colomba')).toBeVisible();
    await user.clear(search());
    await waitFor(() => { expect(headings()).toHaveLength(3); });
    expect(expanded('Easter')).toBe('false');
  });

  it('⚠️ the group of the recipe that is open is open, and stays open after Back', async () => {
    const { user, router } = await loaded({ path: '/recipes/c' });
    await waitFor(() => { expect(expanded('Easter')).toBe('true'); });
    expect(expanded('Christmas')).toBe('false');
    await router.navigate('/recipes');
    expect(expanded('Easter')).toBe('true');
    expect(rowOf('Colomba')).toBeVisible();
    await user.click(headerOf('Easter'));
    expect(expanded('Easter')).toBe('false');
  });

  it('⚠️ Back from a recipe hands the focus to its row even when its group was closed meanwhile, opening the group first', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(headings()).toHaveLength(3); });
    await user.click(headerOf('Easter'));
    await user.click(rowOf('Colomba'));
    const back = await screen.findByRole('button', { name: 'Back' }, LOAD);
    // The list is hidden behind the recipe on a phone, still mounted: the group is shut by hand while the recipe is open.
    await user.click(headerOf('Easter'));
    expect(expanded('Easter')).toBe('false');
    await user.click(back);
    await waitFor(() => { expect(rowOf('Colomba')).toHaveFocus(); });
    expect(expanded('Easter')).toBe('true');
  });

  it('nothing of the open state is stored', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(headings()).toHaveLength(3); });
    await user.click(headerOf('Christmas'));
    expect(Object.keys(window.localStorage).filter(key => key !== 'catalogue-usage' && !key.startsWith('catalogue-') && !key.startsWith('foodcost-'))).toEqual([]);
  });
});

describe('the folded «Archived» group', () => {
  it('is closed, after the groups and before the Allergen sheet and Settings, with the count of archived recipes', async () => {
    await loaded();
    expect(fold(2).open).toBe(false);
    const rows = main().getAllByRole('listitem');
    const allergen = main().getByRole('button', { name: 'Allergen sheet' });
    expect(fold(2).compareDocumentPosition(allergen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows.at(-1)?.closest('details')).toBe(fold(2));
    expect(within(fold(2)).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Archived cake', 'Archived loaf']);
    // The archived recipes are NOT among the rows of the groups.
    expect(groupNames('Easter')).toEqual(['Colomba']);
  });

  it('is not drawn at all when nothing is archived', async () => {
    await loaded({ recipes: RECIPES.filter(item => item.archived !== true) });
    expect(main().queryByText(/^Archived \(/)).not.toBeInTheDocument();
  });

  it('is there for an employee too, who may open an archived recipe', async () => {
    const { user } = await loaded({ session: EMPLOYEE });
    await user.click(main().getByText('Archived (2)'));
    expect(fold(2).open).toBe(true);
    await user.click(rowOf('Archived loaf'));
    expect(await screen.findByRole('region', { name: 'Archived loaf' }, LOAD)).toBeInTheDocument();
  });

  it('opens by itself when a search finds an archived recipe, and counts only the ones the search finds', async () => {
    const { user } = await loaded();
    await user.type(search(), 'archived cake');
    await waitFor(() => { expect(fold(1).open).toBe(true); });
    expect(within(fold(1)).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Archived cake']);
  });

  it('stays as the person left it: closed by hand while the search still finds one', async () => {
    const { user } = await loaded();
    await user.type(search(), 'archived');
    await waitFor(() => { expect(fold(2).open).toBe(true); });
    await user.click(main().getByText('Archived (2)'));
    expect(fold(2).open).toBe(false);
    await user.type(search(), ' c');
    await waitFor(() => { expect(main().getByText('Archived (1)')).toBeInTheDocument(); });
    expect(fold(1).open).toBe(false);
  });

  it('opens by itself for an archived recipe open beside the list on the split, and marks its row', async () => {
    split();
    await loaded({ path: '/recipes/a' });
    await screen.findByRole('region', { name: 'Archived loaf' }, LOAD);
    await waitFor(() => { expect(fold(2).open).toBe(true); });
    expect(rowOf('Archived loaf')).toHaveAttribute('aria-current', 'true');
  });

  it('hands the focus back to the archived row inside the fold on a phone, opening the fold if it had closed', async () => {
    const { user } = await loaded();
    await user.click(main().getByText('Archived (2)'));
    await user.click(rowOf('Archived loaf'));
    const back = await screen.findByRole('button', { name: 'Back' }, LOAD);
    // The fold is shut while the recipe is open (the list is hidden behind it, still mounted): a row inside a closed <details>
    // cannot take the focus, so Back opens it first.
    act(() => { fold(2).open = false; });
    await waitFor(() => { expect(fold(2).open).toBe(false); });
    await user.click(back);
    await waitFor(() => { expect(rowOf('Archived loaf')).toHaveFocus(); });
    expect(fold(2).open).toBe(true);
  });

  it('opens a recipe of the fold with the row’s own button, like any other', async () => {
    const { router, user } = await loaded();
    await user.click(main().getByText('Archived (2)'));
    await user.click(rowOf('Archived cake'));
    expect(router.state.location.pathname).toBe('/recipes/ac');
  });
});
