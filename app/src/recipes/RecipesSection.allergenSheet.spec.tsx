import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes, split } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';

// The Allergen sheet: the screen at the counter. ⚠️ Every row's state, every count and every work list is the shared
// model's; these specs check that the screen draws them faithfully and never invents a verdict of its own.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const STAMP = '2026-01-01';
const ingredient = (id: string, fields: Record<string, unknown> = {}): StoredDoc => ({ id, name: id, ...fields });
const declared = (id: string, allergens: string[]): StoredDoc => ingredient(id, { allergens, allergensCheckedAt: STAMP });

const FLOUR = declared('flour', ['gluten-wheat']);
const MILK = declared('milk', ['milk']);
const SALT = declared('salt', []);
const YEAST = ingredient('yeast', { allergens: [] });

const row = (label: string, refId?: string, grams = 100) => ({ label, grams, unit: 'g', ...(refId === undefined ? {} : { refId }) });
const recipeDoc = (id: string, name: string, ingredients: unknown[]): StoredDoc => ({ id, name, ingredients });

const APPLE = recipeDoc('apple', 'Apple', [row('Flour', 'flour')]);
const BREAD = recipeDoc('bread', 'Bread', [row('Flour', 'flour'), row('Mystery'), row('Yeast', 'yeast')]);
const CAKE = recipeDoc('cake', 'Cake', [row('Flour', 'flour'), row('Milk', 'milk')]);
const DOUGH = recipeDoc('dough', 'Dough', [row('Yeast', 'yeast')]);
const EMPTY = recipeDoc('empty', 'Empty', []);
const PLAIN = recipeDoc('plain', 'Plain', [row('Salt', 'salt')]);
const ALL = [APPLE, BREAD, CAKE, DOUGH, EMPTY, PLAIN];
const INGREDIENTS = [FLOUR, MILK, SALT, YEAST];

const GB = { country: 'GB' };
const IT = { country: 'IT' };

type Options = { location?: Record<string, unknown>; lang?: 'en' | 'it'; source?: ReturnType<typeof fakeRecipesSource> };

async function openSheet(recipes: StoredDoc[] = ALL, ingredients: StoredDoc[] = INGREDIENTS, options: Options = {}) {
  const source = options.source ?? fakeRecipesSource({ recipes, ingredients });
  const view = renderRecipes('/recipes/allergens', {
    source, lang: options.lang, session: { location: options.location ?? GB, language: options.lang ?? 'en' },
  });
  await screen.findByRole('region', { name: /^(Allergen sheet|Scheda allergeni)$/ }, LOAD);
  return { ...view, source };
}

const sheet = () => within(screen.getByRole('region', { name: /^(Allergen sheet|Scheda allergeni)$/ }));
// The rows of recipes: the only list whose items are buttons.
const rowsList = () => within(sheet().getAllByRole('list').find(list => list.querySelector('button')) as HTMLElement);
const rowNames = () => rowsList().getAllByRole('listitem').map(item => item.querySelector('button span span span')?.textContent ?? '');
const rowOf = (name: string) => rowsList().getByRole('button', { name: new RegExp(`^${name}\\b`) });
const searchBox = () => sheet().getByRole('searchbox');

describe('the door and the address', () => {
  it('is a button at the foot of the list, and opens the sheet one level down', async () => {
    const { router, user } = renderRecipes('/recipes', {
      source: fakeRecipesSource({ recipes: ALL, ingredients: INGREDIENTS }), session: { location: GB },
    });
    const door = await screen.findByRole('button', { name: 'Allergen sheet' }, LOAD);
    await user.click(door);
    expect(router.state.location.pathname).toBe('/recipes/allergens');
    expect(await screen.findByRole('heading', { level: 2, name: 'Allergen sheet' })).toBeInTheDocument();
  });

  it('is not there when the venue has switched allergens off', async () => {
    renderRecipes('/recipes', {
      source: fakeRecipesSource({ recipes: ALL }), session: { location: { country: 'GB', showAllergens: false } },
    });
    await screen.findByRole('button', { name: 'Apple' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Allergen sheet' })).not.toBeInTheDocument();
  });

  it('⚠️ re-checks its own gate: the address with allergens off goes to the list', async () => {
    const { router } = renderRecipes('/recipes/allergens', {
      source: fakeRecipesSource({ recipes: ALL }), session: { location: { country: 'GB', showAllergens: false } },
    });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(await screen.findByRole('button', { name: 'Apple' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Allergen sheet' })).not.toBeInTheDocument();
  });

  it('⚠️ leaves for the list when the venue switches allergens off while the sheet is open', async () => {
    const { router, store } = await openSheet();
    act(() => { store.set({ location: { country: 'GB', showAllergens: false } }); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(screen.queryByRole('region', { name: 'Allergen sheet' })).not.toBeInTheDocument();
  });

  it('steps back up to the list with Back and hands the focus to the door', async () => {
    const { router, user } = renderRecipes('/recipes', {
      source: fakeRecipesSource({ recipes: ALL, ingredients: INGREDIENTS }), session: { location: GB },
    });
    await user.click(await screen.findByRole('button', { name: 'Allergen sheet' }, LOAD));
    await screen.findByRole('region', { name: 'Allergen sheet' });
    await user.click(sheet().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Allergen sheet' })).toHaveFocus(); });
  });

  it('replaces itself with the list when it was opened by its address, with nothing behind it', async () => {
    const { router, user } = await openSheet();
    await user.click(sheet().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('the law card', () => {
  it('names the fourteen groups in the COUNTRY\'s words, and folds the specific cereals and nuts away', async () => {
    const { user } = await openSheet();
    const text = await sheet().findByText(/^Cereals containing gluten · Nuts · Celery/);
    expect(text).toBeVisible();
    expect(text.textContent?.split(' · ')).toHaveLength(14);
    expect(sheet().getByText('Wheat, Rye, Barley, Oats, Spelt, Kamut')).not.toBeVisible();
    expect(sheet().getByRole('heading', { level: 3, name: 'What the law requires here' })).toBeInTheDocument();

    await user.click(sheet().getByRole('button', { name: 'What the law requires here' }));
    expect(sheet().getByRole('button', { name: 'What the law requires here' })).toHaveAttribute('aria-expanded', 'true');
    expect(sheet().getByText('Wheat, Rye, Barley, Oats, Spelt, Kamut')).toBeVisible();
    expect(sheet().getByText('These are the words the law uses in the United Kingdom. They stay in that language whatever language the app is set to.')).toBeVisible();
  });

  it('⚠️ says there is no list when nobody has said which country, and never falls back to the UK', async () => {
    await openSheet(ALL, INGREDIENTS, { location: {} });
    expect(await sheet().findByText(/Nobody has said which country this business sells in/)).toBeVisible();
    expect(sheet().queryByText(/Cereals containing gluten/)).not.toBeInTheDocument();
    expect(sheet().queryByText(/Cereali contenenti glutine/)).not.toBeInTheDocument();
    expect(sheet().queryByRole('button', { name: 'What the law requires here' })).not.toBeInTheDocument();
  });

  it('keeps the fold open across a snapshot of the recipes', async () => {
    const { user, source } = await openSheet();
    await user.click(await sheet().findByRole('button', { name: 'What the law requires here' }));
    source.recipes.set('apple', recipeDoc('apple', 'Apple pie', [row('Flour', 'flour')]));
    act(() => { source.push(); });
    await sheet().findByText('Apple pie');
    expect(sheet().getByRole('button', { name: 'What the law requires here' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('where things stand', () => {
  it('counts the whole catalogue and says how many cannot be labelled yet', async () => {
    await openSheet();
    expect(await sheet().findByText('3 of 6 recipes fully declared')).toBeVisible();
    expect(sheet().getByText('3 cannot be labelled yet.')).toBeVisible();
  });

  it('says every recipe can be labelled when none is blocked', async () => {
    await openSheet([APPLE, CAKE]);
    expect(await sheet().findByText('2 of 2 recipes fully declared')).toBeVisible();
    expect(sheet().getByText('Every recipe can be labelled.')).toBeVisible();
  });

  it('does not claim every recipe can be labelled when there are none', async () => {
    await openSheet([], INGREDIENTS);
    expect(await sheet().findByText('0 of 0 recipes fully declared')).toBeVisible();
    expect(sheet().queryByText('Every recipe can be labelled.')).not.toBeInTheDocument();
    expect(sheet().getByText('No recipes yet.')).toBeVisible();
  });

  it('⚠️ never changes the counts when a search narrows the rows', async () => {
    const { user } = await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    await user.type(searchBox(), 'apple');
    expect(rowNames()).toEqual(['Apple']);
    expect(sheet().getByText('3 of 6 recipes fully declared')).toBeVisible();
    expect(sheet().getByText('3 cannot be labelled yet.')).toBeVisible();
  });
});

describe('the recipes', () => {
  it('⚠️ puts the blocked ones first, then the declared ones, each by name', async () => {
    await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    expect(rowNames()).toEqual(['Bread', 'Dough', 'Empty', 'Apple', 'Cake', 'Plain']);
  });

  it('says each state as a WORD, and what a declared recipe contains in the country\'s words', async () => {
    await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    expect(rowOf('Cake')).toHaveTextContent('fully declared');
    expect(rowOf('Cake')).toHaveTextContent('Wheat, Milk');
    expect(rowOf('Apple')).toHaveTextContent('Wheat');
    expect(rowOf('Plain')).toHaveTextContent('fully declared');
    expect(rowOf('Plain')).toHaveTextContent('None of the 14');
    expect(rowOf('Bread')).toHaveTextContent('not declared');
    expect(rowOf('Bread')).toHaveTextContent('2 ingredients are not declared — no label can be made');
    expect(rowOf('Dough')).toHaveTextContent('1 ingredient is not declared — no label can be made');
  });

  it('says «Nothing in it yet» for a recipe with no rows, never «0 ingredients»', async () => {
    await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    expect(rowOf('Empty')).toHaveTextContent('not declared');
    expect(rowOf('Empty')).toHaveTextContent('Nothing in it yet');
    expect(rowOf('Empty')).not.toHaveTextContent(/\b0\b/);
  });

  it('⚠️ a blocked row names NO allergen at all, even one it knows', async () => {
    // Bread has flour (wheat) declared, and two rows nobody has declared.
    await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    for (const name of ['Bread', 'Dough', 'Empty']) {
      expect(rowOf(name)).not.toHaveTextContent(/Wheat|Milk|Gluten|None of the 14/i);
    }
  });

  it('⚠️ an ingredient nobody has checked is never «None of the 14»', async () => {
    await openSheet([DOUGH]);
    await sheet().findByText('0 of 1 recipes fully declared');
    expect(rowOf('Dough')).not.toHaveTextContent('None of the 14');
    expect(rowOf('Dough')).toHaveTextContent('not declared');
  });

  it('opens a recipe on a tap, counts it as an open, and Back returns to the sheet with the focus on that row', async () => {
    const { router, user } = await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    await user.click(rowOf('Cake'));
    expect(router.state.location.pathname).toBe('/recipes/cake');
    expect(JSON.parse(window.localStorage.getItem('catalogue-usage') ?? '{}')).toEqual({ cake: 1 });
    await screen.findByRole('table', undefined, LOAD);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/allergens'); });
    await waitFor(() => { expect(rowOf('Cake')).toHaveFocus(); });
  });
});

describe('the search', () => {
  it('⚠️ is by recipe NAME only: «nuts» and «wheat» find no recipe by what it contains', async () => {
    const { user } = await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    await user.type(searchBox(), 'wheat');
    expect(sheet().getByText('No recipe matches your search.')).toBeVisible();
    await user.clear(searchBox());
    await user.type(searchBox(), 'nuts');
    expect(sheet().getByText('No recipe matches your search.')).toBeVisible();
    await user.clear(searchBox());
    await user.type(searchBox(), 'ca');
    expect(rowNames()).toEqual(['Cake']);
  });

  it('is its own box: what is typed in the list\'s search does not reach it, and the other way round', async () => {
    const { user } = await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    const listSearch = screen.getAllByRole('searchbox').find(box => !sheet().queryAllByRole('searchbox').includes(box));
    if (listSearch === undefined) throw new Error('no list search box');
    await user.type(listSearch, 'Bread');
    expect(searchBox()).toHaveValue('');
    expect(rowNames()).toHaveLength(6);
    await user.type(searchBox(), 'Cake');
    expect(listSearch).toHaveValue('Bread');
  });
});

describe('the work lists', () => {
  it('names the rows to link first, then the ingredients to declare, busiest first', async () => {
    await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    expect(sheet().getByText('Link these rows first')).toBeVisible();
    expect(sheet().getByText('Mystery')).toBeVisible();
    expect(sheet().getByText('1 row')).toBeVisible();
    expect(sheet().getByText('Then declare these')).toBeVisible();
    expect(sheet().getByText('yeast')).toBeVisible();
    expect(sheet().getByText('2 recipes')).toBeVisible();
    // Linking comes first on the page.
    const position = sheet().getByText('Link these rows first').compareDocumentPosition(sheet().getByText('Then declare these'));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('calls the second list «Declare these first» when there is nothing to link', async () => {
    await openSheet([DOUGH]);
    expect(await sheet().findByText('Declare these first')).toBeVisible();
    expect(sheet().queryByText('Link these rows first')).not.toBeInTheDocument();
  });

  it('⚠️ is capped at six, with «and N more», in both lists', async () => {
    const ingredients = Array.from({ length: 8 }, (_, index) => ingredient(`ing${index + 1}`, { allergens: [] }));
    const many = recipeDoc('many', 'Many', [
      ...Array.from({ length: 8 }, (_, index) => row(`Loose ${index + 1}`)),
      ...ingredients.map(doc => row(`Linked ${doc.id}`, doc.id)),
    ]);
    await openSheet([many], ingredients);
    expect(await sheet().findByText('Link these rows first')).toBeVisible();
    expect(sheet().getAllByText('…and 2 more')).toHaveLength(2);
    expect(sheet().getByText('Loose 6')).toBeVisible();
    expect(sheet().queryByText('Loose 7')).not.toBeInTheDocument();
    expect(sheet().getByText('ing6')).toBeVisible();
    expect(sheet().queryByText('ing7')).not.toBeInTheDocument();
  });

  it('steps aside while searching and comes back when the search is cleared', async () => {
    const { user } = await openSheet();
    await sheet().findByText('Link these rows first');
    await user.type(searchBox(), 'a');
    expect(sheet().queryByText('Link these rows first')).not.toBeInTheDocument();
    expect(sheet().queryByText('Then declare these')).not.toBeInTheDocument();
    await user.clear(searchBox());
    expect(await sheet().findByText('Link these rows first')).toBeVisible();
  });

  it('⚠️ does not make a job of an ingredient that was deleted, and the recipe is still blocked', async () => {
    const ghost = recipeDoc('ghost', 'Ghost', [row('Gone', 'gone')]);
    await openSheet([ghost], INGREDIENTS);
    await sheet().findByText('0 of 1 recipes fully declared');
    expect(sheet().queryByText('Then declare these')).not.toBeInTheDocument();
    expect(sheet().queryByText('Declare these first')).not.toBeInTheDocument();
    expect(sheet().queryByText('Unknown ingredient')).not.toBeInTheDocument();
    expect(rowOf('Ghost')).toHaveTextContent('not declared');
  });
});

describe('the language of the food and the language of the screen', () => {
  it('names the food in the COUNTRY\'s words on an English screen: an Italian venue', async () => {
    const { user } = await openSheet(ALL, INGREDIENTS, { location: IT, lang: 'en' });
    expect(await sheet().findByText(/^Cereali contenenti glutine · Frutta a guscio · Sedano/)).toBeVisible();
    expect(rowOf('Cake')).toHaveTextContent('Grano, Latte');
    expect(rowOf('Plain')).toHaveTextContent('None of the 14');
    // The screen's own words stay English.
    expect(sheet().getByText('3 of 6 recipes fully declared')).toBeVisible();
    expect(rowOf('Cake')).toHaveTextContent('fully declared');
    await user.click(sheet().getByRole('button', { name: 'What the law requires here' }));
    expect(sheet().getByText('Grano, Segale, Orzo, Avena, Farro, Kamut')).toBeVisible();
    expect(sheet().getByText('These are the words the law uses in Italy. They stay in that language whatever language the app is set to.')).toBeVisible();
  });

  it('keeps the food English on an Italian screen for a British venue, and the words around it Italian', async () => {
    const { user } = await openSheet(ALL, INGREDIENTS, { location: GB, lang: 'it' });
    expect(await sheet().findByText(/^Cereals containing gluten · Nuts · Celery/)).toBeVisible();
    expect(rowOf('Cake')).toHaveTextContent('Wheat, Milk');
    expect(rowOf('Cake')).toHaveTextContent('dichiarata');
    expect(rowOf('Bread')).toHaveTextContent('non dichiarata');
    expect(sheet().getByText('3 ricette su 6 completamente dichiarate')).toBeVisible();
    await user.click(sheet().getByRole('button', { name: 'Cosa richiede la legge qui' }));
    expect(sheet().getByText('Queste sono le parole che usa la legge nel Regno Unito. Restano in quella lingua qualunque sia la lingua dell’app.')).toBeVisible();
  });
});

describe('the wait for the ingredients', () => {
  it('⚠️ gives no count, no work list and no state until they have arrived, then draws them', async () => {
    window.localStorage.setItem('catalogue-recipes', JSON.stringify(ALL));
    const source = fakeRecipesSource({ recipes: ALL, ingredients: INGREDIENTS });
    source.hold();
    renderRecipes('/recipes/allergens', { source, session: { location: GB } });
    await screen.findByRole('region', { name: 'Allergen sheet' }, LOAD);

    expect(sheet().getAllByText('Checking the allergens…').length).toBeGreaterThan(1);
    expect(sheet().queryByText(/recipes fully declared/)).not.toBeInTheDocument();
    expect(sheet().queryByText(/cannot be labelled yet/)).not.toBeInTheDocument();
    expect(sheet().queryByText('Link these rows first')).not.toBeInTheDocument();
    expect(sheet().queryByText(/not declared|fully declared|None of the 14|Nothing in it yet/)).not.toBeInTheDocument();
    // By name, since nothing is blocked yet.
    expect(rowNames()).toEqual(['Apple', 'Bread', 'Cake', 'Dough', 'Empty', 'Plain']);

    act(() => { source.release(); });
    expect(await sheet().findByText('3 of 6 recipes fully declared')).toBeVisible();
    expect(rowNames()).toEqual(['Bread', 'Dough', 'Empty', 'Apple', 'Cake', 'Plain']);
  });
});

describe('the live data', () => {
  it('repaints the counts and the rows but keeps the search text and the focus', async () => {
    const { user, source } = await openSheet();
    await sheet().findByText('3 of 6 recipes fully declared');
    await user.click(searchBox());
    await user.type(searchBox(), 'do');
    expect(rowNames()).toEqual(['Dough']);

    // Yeast gets checked on another phone: Dough becomes declared and the counts move.
    source.ingredients.set('yeast', declared('yeast', ['sesame']));
    act(() => { source.push(); });

    await sheet().findByText('4 of 6 recipes fully declared');
    expect(searchBox()).toHaveValue('do');
    expect(searchBox()).toHaveFocus();
    expect(rowNames()).toEqual(['Dough']);
    expect(rowOf('Dough')).toHaveTextContent('fully declared');
    expect(rowOf('Dough')).toHaveTextContent('Sesame');
  });
});

describe('on the split', () => {
  it('opens beside the list, and a recipe tapped in the sheet comes back to the sheet', async () => {
    split();
    const { router, user } = renderRecipes('/recipes', {
      source: fakeRecipesSource({ recipes: ALL, ingredients: INGREDIENTS }), session: { location: GB },
    });
    await user.click(await screen.findByRole('button', { name: 'Allergen sheet' }, LOAD));
    await screen.findByRole('region', { name: 'Allergen sheet' });
    // The list is still there beside it, with its own search box.
    expect(screen.getAllByRole('searchbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Allergen sheet' })).toHaveAttribute('aria-current', 'true');

    await sheet().findByText('3 of 6 recipes fully declared');
    await user.click(rowOf('Cake'));
    expect(router.state.location.pathname).toBe('/recipes/cake');
    await screen.findByRole('table', undefined, LOAD);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/allergens'); });
    await waitFor(() => { expect(rowOf('Cake')).toHaveFocus(); });
  });
});
