import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith, split } from '../testing/renderRecipes';

// The list of recipes: most opened first, the search box, the states, and the way into a recipe.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const RECIPES = [
  recipe('f', { name: 'Focaccia' }),
  recipe('b', { name: 'Brioche' }),
  recipe('c', { name: 'Ciabatta' }),
  recipe('p', { name: 'Pane' }),
];

const main = () => within(screen.getByRole('main'));
const names = () => main().getAllByRole('listitem').map(item => item.textContent);
const rowOf = (name: string) => main().getByRole('button', { name });
const search = () => screen.getByRole('searchbox', { name: 'Search a recipe by name' });
const usageOnDisk = () => JSON.parse(window.localStorage.getItem('catalogue-usage') ?? '{}') as Record<string, number>;

async function loaded(path = '/recipes', fake = sourceWith(RECIPES), options = {}) {
  const view = renderRecipes(path, { source: fake, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

describe('the list of recipes', () => {
  it('puts the most opened first, and ties by name', async () => {
    window.localStorage.setItem('catalogue-usage', JSON.stringify({ p: 5, f: 2 }));
    await loaded();
    expect(names()).toEqual(['Pane', 'Focaccia', 'Brioche', 'Ciabatta']);
  });

  it('shows the name only, in a button, with a recipe that has no name called «(no name)»', async () => {
    await loaded('/recipes', sourceWith([recipe('x', { name: '' }), recipe('y', { name: 'Pane' })]));
    expect(names()).toEqual(['(no name)', 'Pane']);
    expect(rowOf('Pane')).toBeInTheDocument();
  });

  it('is one h1, «Recipes», with the Allergen sheet at its foot and no Add or Settings yet (they arrive in later steps)', async () => {
    await loaded();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
    const door = main().getByRole('button', { name: 'Allergen sheet' });
    const lastRow = main().getAllByRole('listitem').at(-1) as HTMLElement;
    expect(lastRow.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of [/add/i, /settings/i, /new/i]) {
      expect(main().queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('says «Loading…» until the recipes have answered', async () => {
    const fake = sourceWith(RECIPES);
    fake.hold();
    renderRecipes('/recipes', { source: fake });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No recipes yet')).not.toBeInTheDocument();
    act(() => { fake.release(); });
    expect(await screen.findByRole('button', { name: 'Pane' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('says there are no recipes yet, without a button to add one', async () => {
    renderRecipes('/recipes', { source: sourceWith([]) });
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Add your first recipe: its ingredients and their amounts.')).toBeInTheDocument();
    // The only button is the door to the Allergen sheet.
    expect(main().getAllByRole('button').map(button => button.textContent)).toEqual(['Allergen sheet']);
  });

  it('says it in Italian', async () => {
    window.localStorage.setItem('catalogue-usage', JSON.stringify({ p: 1 }));
    renderRecipes('/recipes', { source: sourceWith(RECIPES), lang: 'it', session: { language: 'it' } });
    expect(await screen.findByRole('searchbox', { name: 'Cerca una ricetta per nome' }, LOAD)).toHaveAttribute('placeholder', 'Cerca una ricetta…');
    expect(screen.getByRole('heading', { level: 1, name: 'Ricette' })).toBeInTheDocument();
  });
});

describe('opening a recipe', () => {
  it('counts one more open when a person taps the row, and writes it where the current app does', async () => {
    const { router, user } = await loaded();
    await user.click(rowOf('Brioche'));
    expect(router.state.location.pathname).toBe('/recipes/b');
    expect(usageOnDisk()).toEqual({ b: 1 });
  });

  it('does not count an open that came from an address', async () => {
    renderRecipes('/recipes/b', { source: sourceWith(RECIPES) });
    await screen.findByRole('heading', { level: 2, name: 'Brioche' }, LOAD);
    expect(window.localStorage.getItem('catalogue-usage')).toBeNull();
  });

  it('steps back to the list keeping what was typed in the search box', async () => {
    const { router, user } = await loaded();
    await user.type(search(), 'ciab');
    await waitFor(() => { expect(names()).toEqual(['Ciabatta']); });
    await user.click(rowOf('Ciabatta'));
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/recipes');
    expect(search()).toHaveValue('ciab');
    expect(names()).toEqual(['Ciabatta']);
  });

  it('hands the focus back to the row that opened the recipe', async () => {
    const { user } = await loaded();
    await user.click(rowOf('Brioche'));
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(rowOf('Brioche')).toHaveFocus(); });
  });
});

describe('the search', () => {
  it('filters by name, ignoring case, after a short pause', async () => {
    const { user } = await loaded();
    await user.type(search(), 'CIAB');
    await waitFor(() => { expect(names()).toEqual(['Ciabatta']); });
    await user.clear(search());
    await waitFor(() => { expect(names()).toHaveLength(4); });
  });

  it('says so in a small line when nothing matches', async () => {
    const { user } = await loaded();
    await user.type(search(), 'zzz');
    expect(await screen.findByText('No recipe matches your search.')).toBeInTheDocument();
    expect(main().queryByText('No recipes yet')).not.toBeInTheDocument();
  });

  // ⚠️ A data snapshot landing mid-keystroke must never wipe the text or the keyboard.
  it('survives a live update: the same box, the same text, the keyboard still in it', async () => {
    const fake = sourceWith(RECIPES);
    const { user } = await loaded('/recipes', fake);
    const box = search();
    await user.type(box, 'bat');
    await waitFor(() => { expect(names()).toEqual(['Ciabatta']); });
    expect(box).toHaveFocus();

    fake.recipes.set('n', recipe('n', { name: 'Batard' }));
    act(() => { fake.push(); });

    await waitFor(() => { expect(names()).toEqual(['Batard', 'Ciabatta']); });
    expect(search()).toBe(box);
    expect(box).toHaveValue('bat');
    expect(box).toHaveFocus();
    await user.type(box, 't');
    expect(box).toHaveValue('batt');
  });
});

describe('on the tablet\'s split', () => {
  it('has the list on the left and a prompt on the right while nothing is open', async () => {
    split();
    await loaded();
    expect(screen.getByText('Choose a recipe')).toBeInTheDocument();
    expect(screen.getByText(/Tap a recipe on the left/)).toBeInTheDocument();
  });

  it('draws no prompt beside «No recipes yet»', async () => {
    split();
    renderRecipes('/recipes', { source: sourceWith([]) });
    await screen.findByText('No recipes yet', undefined, LOAD);
    expect(screen.queryByText('Choose a recipe')).not.toBeInTheDocument();
  });

  it('opens the recipe beside the list, marks only its row, and keeps the list mounted', async () => {
    split();
    const { user } = await loaded();
    const list = main().getAllByRole('listitem')[0]?.parentElement;
    await user.click(rowOf('Brioche'));
    expect(await screen.findByRole('region', { name: 'Brioche' }, LOAD)).toBeInTheDocument();
    expect(rowOf('Brioche')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('Pane')).not.toHaveAttribute('aria-current');

    await user.click(rowOf('Pane'));
    expect(await screen.findByRole('region', { name: 'Pane' }, LOAD)).toBeInTheDocument();
    expect(rowOf('Pane')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('Brioche')).not.toHaveAttribute('aria-current');
    expect(main().getAllByRole('listitem')[0]?.parentElement).toBe(list);
  });

  it('does nothing when the open recipe is tapped again', async () => {
    split();
    const { router, user } = await loaded();
    await user.click(rowOf('Brioche'));
    await screen.findByRole('region', { name: 'Brioche' }, LOAD);
    const entry = router.state.location.key;
    await user.click(rowOf('Brioche'));
    expect(usageOnDisk()).toEqual({ b: 1 });
    expect(router.state.location.pathname).toBe('/recipes/b');
    expect(router.state.location.key).toBe(entry);
  });

  // ⚠️ THE ORDER IS FROZEN WHILE A RECIPE IS OPEN BESIDE THE LIST: a bump never re-sorts rows under a
  // finger. The fresh counts apply when the list is shown alone again.
  it('does not re-sort the rows while a recipe is open, and does once it is closed', async () => {
    split();
    const { router, user } = await loaded('/recipes', sourceWith(RECIPES));
    expect(names()).toEqual(['Brioche', 'Ciabatta', 'Focaccia', 'Pane']);

    await user.click(rowOf('Pane'));
    await screen.findByRole('region', { name: 'Pane' }, LOAD);
    expect(usageOnDisk()).toEqual({ p: 1 });
    expect(names()).toEqual(['Brioche', 'Ciabatta', 'Focaccia', 'Pane']);

    await user.click(rowOf('Ciabatta'));
    await screen.findByRole('region', { name: 'Ciabatta' }, LOAD);
    expect(names()).toEqual(['Brioche', 'Ciabatta', 'Focaccia', 'Pane']);

    await act(async () => { await router.navigate('/recipes'); });
    await waitFor(() => { expect(names()).toEqual(['Ciabatta', 'Pane', 'Brioche', 'Focaccia']); });
  });

  it('freezes the order too for a recipe opened by its address', async () => {
    split();
    window.localStorage.setItem('catalogue-usage', JSON.stringify({ f: 1 }));
    const { user } = renderRecipes('/recipes/b', { source: sourceWith(RECIPES) });
    await screen.findByRole('region', { name: 'Brioche' }, LOAD);
    expect(names()).toEqual(['Focaccia', 'Brioche', 'Ciabatta', 'Pane']);
    // A tap on another row counts, and still moves nothing.
    await user.click(rowOf('Pane'));
    await screen.findByRole('region', { name: 'Pane' }, LOAD);
    expect(usageOnDisk()).toEqual({ f: 1, p: 1 });
    expect(names()).toEqual(['Focaccia', 'Brioche', 'Ciabatta', 'Pane']);
  });
});
