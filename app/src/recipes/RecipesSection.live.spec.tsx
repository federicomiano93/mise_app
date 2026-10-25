import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith, split } from '../testing/renderRecipes';

// A recipe follows the live data: deleted or changed on another phone, an address whose recipe is not
// there yet, a stream that dies, and an address that means nothing.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const RECIPES = [recipe('f', { name: 'Focaccia' }), recipe('b', { name: 'Brioche' })];

const main = () => within(screen.getByRole('main'));
// The words land in the section's live region (the shell has a second one, for the connection).
const says = async (text: string | RegExp) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};
const table = () => main().getByRole('table', { name: 'Ingredients' });
const flourRow = () => within(table()).getByRole('row', { name: /Flour/ });
const rowOf = (name: string) => main().getByRole('button', { name });

describe('a recipe deleted on another phone', () => {
  it('goes back to the list with «Recipe deleted.» when it was opened from the list', async () => {
    const fake = sourceWith(RECIPES);
    const { router, user } = renderRecipes('/recipes', { source: fake });
    await user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
    await screen.findByRole('table', undefined, LOAD);

    fake.recipes.delete('f');
    act(() => { fake.push(); });

    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await says('Recipe deleted.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // One step back, not a pile of entries: the browser's Back leaves the catalogue.
    expect(router.state.historyAction).toBe('POP');
  });

  it('⚠️ hands the focus to the search box: the row it was owed no longer exists', async () => {
    const fake = sourceWith(RECIPES);
    const { router, user } = renderRecipes('/recipes', { source: fake });
    await user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
    await screen.findByRole('table', undefined, LOAD);

    fake.recipes.delete('f');
    act(() => { fake.push(); });

    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
  });

  it('replaces the address with the list when it was opened by its address', async () => {
    const fake = sourceWith(RECIPES);
    const { router } = renderRecipes('/recipes/f', { source: fake });
    await screen.findByRole('table', undefined, LOAD);

    fake.recipes.delete('f');
    act(() => { fake.push(); });

    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await says('Recipe deleted.');
  });

  it('closes the recipe beside the list on the split, and the prompt comes back', async () => {
    split();
    const fake = sourceWith(RECIPES);
    const { router, user } = renderRecipes('/recipes', { source: fake });
    await user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
    await screen.findByRole('table', undefined, LOAD);

    fake.recipes.delete('f');
    act(() => { fake.push(); });

    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(await screen.findByText('Choose a recipe')).toBeInTheDocument();
    await says('Recipe deleted.');
    expect(screen.queryByRole('button', { name: 'Focaccia' })).not.toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    const fake = sourceWith(RECIPES);
    renderRecipes('/recipes/f', { source: fake, lang: 'it', session: { language: 'it' } });
    await screen.findByRole('table', undefined, LOAD);
    fake.recipes.delete('f');
    act(() => { fake.push(); });
    await says('Ricetta eliminata.');
  });
});

describe('a recipe changed on another phone', () => {
  it('is redrawn in place, with the batch box, its text and its focus where they were', async () => {
    const fake = sourceWith(RECIPES);
    const { user } = renderRecipes('/recipes/f', { source: fake });
    await screen.findByRole('table', undefined, LOAD);
    const box = main().getByRole('spinbutton', { name: 'Total dough weight in grams' });
    await user.type(box, '25');
    expect(box).toHaveFocus();
    const area = screen.getByRole('main');
    Object.defineProperty(area, 'scrollTop', { value: 420, writable: true });

    fake.recipes.set('f', recipe('f', {
      name: 'Focaccia',
      ingredients: [{ label: 'Flour', grams: 1200, unit: 'g' }, { label: 'Water', grams: 700, unit: 'g' }],
    }));
    act(() => { fake.push(); });

    await waitFor(() => { expect(flourRow()).toHaveTextContent('1200'); });
    expect(within(table()).getAllByRole('row')).toHaveLength(3);
    expect(main().getByRole('spinbutton', { name: 'Total dough weight in grams' })).toBe(box);
    expect(box).toHaveValue(25);
    expect(box).toHaveFocus();
    expect(area.scrollTop).toBe(420);
  });

  it('is redrawn with the new name in the bar', async () => {
    const fake = sourceWith(RECIPES);
    renderRecipes('/recipes/f', { source: fake });
    await screen.findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD);
    fake.recipes.set('f', recipe('f', { name: 'Focaccia genovese' }));
    act(() => { fake.push(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Focaccia genovese' })).toBeInTheDocument();
  });

  it('re-scales an applied batch with the new amounts', async () => {
    window.localStorage.setItem('catalogue-scaled', JSON.stringify({ f: { target: 3440, ts: Date.now() } }));
    const fake = sourceWith(RECIPES);
    renderRecipes('/recipes/f', { source: fake });
    await screen.findByRole('table', undefined, LOAD);
    expect(flourRow()).toHaveTextContent('2000');
    fake.recipes.set('f', recipe('f', {
      name: 'Focaccia',
      ingredients: [{ label: 'Flour', grams: 100, unit: 'g' }, { label: 'Water', grams: 100, unit: 'g' }],
    }));
    act(() => { fake.push(); });
    await waitFor(() => { expect(flourRow()).toHaveTextContent('1720'); });
  });
});

describe('an address whose recipe is not among the recipes', () => {
  it('says «Loading…» until the server has answered, never «no longer exists» before', async () => {
    const fake = sourceWith(RECIPES);
    fake.hold();
    renderRecipes('/recipes/nope', { source: fake });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(screen.queryByText('This recipe no longer exists.')).not.toBeInTheDocument();

    act(() => { fake.release(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'This recipe no longer exists.' }, LOAD)).toBeInTheDocument();
  });

  it('steps back to the list from the not-found screen', async () => {
    const { router, user } = renderRecipes('/recipes/nope', { source: sourceWith(RECIPES) });
    await screen.findByRole('heading', { level: 2, name: 'This recipe no longer exists.' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/recipes');
  });

  it('stops waiting when the stream dies, since no answer will come', async () => {
    const fake = sourceWith(RECIPES);
    fake.refuse.recipes = true;
    renderRecipes('/recipes/nope', { source: fake });
    expect(await screen.findByRole('heading', { level: 2, name: 'This recipe no longer exists.' }, LOAD)).toBeInTheDocument();
  });

  it('opens a recipe found in the local copy at once, before the server has answered', async () => {
    window.localStorage.setItem('catalogue-recipes', JSON.stringify([recipe('f', { name: 'Focaccia' })]));
    const fake = sourceWith([]);
    fake.hold();
    renderRecipes('/recipes/f', { source: fake });
    expect(await screen.findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD)).toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    renderRecipes('/recipes/nope', { source: sourceWith(RECIPES), lang: 'it', session: { language: 'it' } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Questa ricetta non esiste più.' }, LOAD)).toBeInTheDocument();
  });

  it('opens the recipe whose id has a slash and a space in it', async () => {
    renderRecipes('/recipes/a%2Fb%20c', { source: sourceWith([recipe('a/b c', { name: 'Odd' })]) });
    expect(await screen.findByRole('heading', { level: 2, name: 'Odd' }, LOAD)).toBeInTheDocument();
  });

  it.each(['/recipes/f/editing', '/recipes/new/edit', '/recipes/a/b/c'])('sends %s back to the list', async path => {
    const { router } = renderRecipes(path, { source: sourceWith(RECIPES) });
    await screen.findByRole('button', { name: 'Focaccia' }, LOAD);
    expect(router.state.location.pathname).toBe('/recipes');
  });
});

describe('the stream of recipes dying', () => {
  it('says that what is shown may be old, and keeps what it has', async () => {
    const fake = sourceWith(RECIPES);
    renderRecipes('/recipes', { source: fake });
    await screen.findByRole('button', { name: 'Focaccia' }, LOAD);
    act(() => { fake.breakStream(); });
    await says('Live sync interrupted — recipes may be out of date.');
    expect(rowOf('Focaccia')).toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    const fake = sourceWith(RECIPES);
    renderRecipes('/recipes', { source: fake, lang: 'it', session: { language: 'it' } });
    await screen.findByRole('button', { name: 'Focaccia' }, LOAD);
    act(() => { fake.breakStream(); });
    await says('Sincronizzazione interrotta — le ricette potrebbero non essere aggiornate.');
  });

  it('does not stay on «Loading…» when the very first read is refused', async () => {
    const fake = sourceWith(RECIPES);
    fake.refuse.recipes = true;
    renderRecipes('/recipes', { source: fake });
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    await says(/Live sync interrupted/);
  });
});

describe('the page', () => {
  it.each(['/recipes', '/recipes/f'])('has one h1, «Recipes», at %s', async path => {
    renderRecipes(path, { source: sourceWith(RECIPES) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' }, LOAD)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('puts the focus on the recipe\'s title when it is opened from the list', async () => {
    const { user } = renderRecipes('/recipes', { source: sourceWith(RECIPES) });
    await user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Focaccia' })).toHaveFocus(); });
  });
});
