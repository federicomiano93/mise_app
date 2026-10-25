import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith, split } from '../testing/renderRecipes';
import { RECIPES_KEY } from './recipesStore';

// Step 3d-6: where an existing recipe's editor leaves to (history), what it waits for before it opens, and what it does
// when the server's answer differs from the phone's copy it was opened from.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const FOCACCIA = recipe('r1', { name: 'Focaccia' });
const START = '/nowhere';

const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};

function countSaid(text: string) {
  let count = 0;
  const watcher = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.textContent === text) count += 1;
  });
  watcher.observe(document.body, { childList: true, subtree: true });
  return { count: () => count, stop: () => { watcher.disconnect(); } };
}

// A page before the catalogue, so there is an entry to land on when Back leaves it; then list → recipe → editor.
async function walkToEditor(): Promise<ReturnType<typeof renderRecipes> & { region: HTMLElement }> {
  const view = renderRecipes(START, { source: sourceWith([FOCACCIA]) });
  await screen.findByText('Page not found');
  await act(async () => { await view.router.navigate('/recipes'); });
  await view.user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
  await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
  await view.user.click(screen.getByRole('button', { name: 'Edit' }));
  const region = await screen.findByRole('region', { name: 'Edit recipe' });
  return { ...view, region };
}

describe.each([['a phone', false], ['the split', true]])('Back after leaving an existing recipe’s editor, on %s', (_where, onSplit) => {
  beforeEach(() => { if (onSplit) split(); });

  it('⚠️ after Save, leaves the catalogue (the list, not the recipe, is what was behind it)', async () => {
    const { region, user, router, source } = await walkToEditor();
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(within(region).getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    // The focus is owed to the saved recipe's row.
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Focaccia!' })).toHaveFocus(); });

    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(router.state.location.pathname).toBe(START); });
  });

  it('⚠️ after Delete, leaves the catalogue, says «Recipe deleted.» once and puts the focus on the search box', async () => {
    const { region, user, router, source } = await walkToEditor();
    const said = countSaid('Recipe deleted.');
    try {
      await user.click(within(region).getByRole('button', { name: 'Delete recipe' }));
      await user.click(within(await screen.findByRole('alertdialog', { name: 'Delete recipe?' })).getByRole('button', { name: 'Delete' }));
      await says('Recipe deleted.');
      await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
      await waitFor(() => { expect(source.recipeWrites).toEqual([{ id: 'r1', deleted: true }]); });
      await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
      await new Promise<void>(resolve => { setTimeout(resolve, 50); });
      expect(said.count()).toBe(1);

      await act(async () => { await router.navigate(-1); });
      await waitFor(() => { expect(router.state.location.pathname).toBe(START); });
      expect(screen.queryByText('This recipe no longer exists.')).not.toBeInTheDocument();
    } finally {
      said.stop();
    }
  });
});

describe('an editor opened by its address', () => {
  it('still replaces itself with the list after a Save (nothing behind it to step back over)', async () => {
    const { user, router } = renderRecipes('/recipes/r1/edit', { source: sourceWith([FOCACCIA]) });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(within(region).getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('the editor of a recipe held only in the phone’s copy', () => {
  const copy = (name: string) => window.localStorage.setItem(RECIPES_KEY, JSON.stringify([
    { id: 'r1', name, ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }], lossPct: 0 },
  ]));

  it('⚠️ waits for the server: «Loading…» first, and the editor only after 1.2 seconds', async () => {
    copy('Focaccia');
    const source = sourceWith([FOCACCIA]);
    source.hold();
    renderRecipes('/recipes/r1/edit', { source });
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Edit recipe' })).not.toBeInTheDocument();
    await new Promise<void>(resolve => { setTimeout(resolve, 900); });
    expect(screen.queryByRole('region', { name: 'Edit recipe' })).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Edit recipe' }, LOAD)).toBeInTheDocument();
  });

  it('opens at once when the phone is offline', async () => {
    copy('Focaccia');
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const source = sourceWith([FOCACCIA]);
    source.hold();
    renderRecipes('/recipes/r1/edit', { source });
    expect(await screen.findByRole('region', { name: 'Edit recipe' }, { timeout: 800 })).toBeInTheDocument();
  });

  it('opens when the server answers, before the 1.2 seconds are over', async () => {
    copy('Focaccia');
    const source = sourceWith([FOCACCIA]);
    source.hold();
    renderRecipes('/recipes/r1/edit', { source });
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    act(() => { source.release(); });
    expect(await screen.findByRole('region', { name: 'Edit recipe' }, { timeout: 800 })).toBeInTheDocument();
  });

  it('⚠️ takes the server’s newer version when nothing has been typed', async () => {
    copy('Focaccia');
    const source = sourceWith([recipe('r1', { name: 'Focaccia (server)' })]);
    source.hold();
    renderRecipes('/recipes/r1/edit', { source });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    expect(within(region).getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Focaccia');
    act(() => { source.release(); });
    await waitFor(() => { expect(within(screen.getByRole('region', { name: 'Edit recipe' })).getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Focaccia (server)'); });
  });

  it('⚠️ keeps what was typed when the server answers with something newer', async () => {
    copy('Focaccia');
    const source = sourceWith([recipe('r1', { name: 'Focaccia (server)' })]);
    source.hold();
    const { user } = renderRecipes('/recipes/r1/edit', { source });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), '!');
    act(() => { source.release(); });
    await new Promise<void>(resolve => { setTimeout(resolve, 100); });
    expect(within(screen.getByRole('region', { name: 'Edit recipe' })).getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Focaccia!');
  });
});

describe('«This recipe no longer exists.»', () => {
  it('⚠️ steps back to the list, not to the recipe’s own address', async () => {
    const { user, router } = renderRecipes('/recipes/nope/edit', { source: sourceWith([FOCACCIA]) });
    expect(await screen.findByRole('heading', { name: 'This recipe no longer exists.' }, LOAD)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
  });
});
