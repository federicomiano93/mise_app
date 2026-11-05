import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';
import { RECIPES_KEY } from './recipesStore';

// Step 3d-6, slice A1: deleting a recipe, from the recipe page (a small icon at the very end) and from the editor (a low-key
// button at the bottom) — the same question, the same Calculator warning, and «Recipe deleted.» exactly once.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };
const MANAGER = { role: 'manager' as const, canManage: true, isOwner: false };
const FOCACCIA = recipe('r1', { name: 'Focaccia' });

// The words land in the section's live region (the shell has a second one, for the connection).
const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};

// How many times a sentence was put on the screen: the status message is a new node every time it is said, even if the
// words are the same, so two messages for one delete are two additions.
function countSaid(text: string) {
  let count = 0;
  const watcher = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.textContent === text) count += 1;
  });
  watcher.observe(document.body, { childList: true, subtree: true });
  return { count: () => count, stop: () => { watcher.disconnect(); } };
}

const trash = () => screen.getByRole('button', { name: 'Delete recipe' });
const flush = () => new Promise<void>(resolve => { setTimeout(resolve, 50); });

async function openPageFromList(options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes('/recipes', { source: sourceWith([FOCACCIA]), ...options });
  await view.user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
  await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
  return view;
}

async function answerDelete(user: { click: (el: Element) => Promise<void> }) {
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete recipe?' });
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

describe('who has the delete', () => {
  it('⚠️ is absent — not disabled — on the recipe page and in the editor for an employee', async () => {
    const { user } = await openPageFromList({ session: EMPLOYEE });
    expect(screen.queryByRole('button', { name: 'Delete recipe' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('region', { name: 'Edit recipe' });
    expect(screen.queryByRole('button', { name: 'Delete recipe' })).not.toBeInTheDocument();
  });

  it('is an icon with a name and a title at the end of the page, and a labelled button at the bottom of the editor, for a manager', async () => {
    const { user } = await openPageFromList({ session: MANAGER });
    expect(trash()).toHaveAttribute('title', 'Delete recipe');
    expect(trash().textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = await screen.findByRole('region', { name: 'Edit recipe' });
    expect(within(region).getByRole('button', { name: 'Delete recipe' })).toHaveTextContent('Delete recipe');
  });

  it('is absent on a new recipe, whoever it is', async () => {
    renderRecipes('/recipes/new', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('region', { name: 'New recipe' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Delete recipe' })).not.toBeInTheDocument();
  });
});

describe('deleting from the recipe page', () => {
  it('asks by name, deletes, says «Recipe deleted.» ONCE and goes back to the list, the focus on the search box', async () => {
    const { user, router, source } = await openPageFromList();
    const said = countSaid('Recipe deleted.');
    try {
      await user.click(trash());
      const dialog = await screen.findByRole('alertdialog', { name: 'Delete recipe?' });
      expect(dialog).toHaveTextContent('Delete “Focaccia”? This cannot be undone.');
      expect(dialog).not.toHaveTextContent('imported into the Calculator');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await says('Recipe deleted.');
      await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
      await waitFor(() => { expect(source.recipeWrites).toEqual([{ id: 'r1', deleted: true }]); });
      await flush();
      expect(said.count()).toBe(1);
      // One step back, not two.
      expect(router.state.historyAction).toBe('POP');
      expect(screen.queryByRole('button', { name: 'Focaccia' })).not.toBeInTheDocument();
      await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
    } finally {
      said.stop();
    }
  });

  it('changes nothing when the question is cancelled', async () => {
    const { user, router, source } = await openPageFromList();
    await user.click(trash());
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete recipe?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.recipeWrites).toEqual([]);
    expect(router.state.location.pathname).toBe('/recipes/r1');
  });

  it('⚠️ says «Recipe deleted.» once also when the server has not answered yet (an offline cold start)', async () => {
    window.localStorage.setItem(RECIPES_KEY, JSON.stringify([
      { id: 'r1', name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }], lossPct: 0 },
    ]));
    const source = sourceWith([FOCACCIA]);
    source.hold();
    const { user, router } = renderRecipes('/recipes/r1', { source });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    const said = countSaid('Recipe deleted.');
    try {
      await user.click(trash());
      await answerDelete(user);
      await says('Recipe deleted.');
      await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
      await flush();
      expect(said.count()).toBe(1);
      // No «Loading…» left behind where the recipe was.
      expect(screen.queryByRole('heading', { level: 3, name: 'Ingredients' })).not.toBeInTheDocument();
    } finally {
      said.stop();
    }
  });

  it('⚠️ still says it when ANOTHER phone deletes the open recipe (the delete made here must not have silenced that)', async () => {
    const { source } = await openPageFromList();
    source.recipes.delete('r1');
    source.push();
    await says('Recipe deleted.');
  });

  it('puts a recipe back and says so when the database refuses the delete', async () => {
    const { user, source } = await openPageFromList();
    source.refuseRecipeWrites.remove = true;
    await user.click(trash());
    await answerDelete(user);
    await says('Couldn’t delete the recipe — check your connection.');
    expect(await screen.findByRole('button', { name: 'Focaccia' })).toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
  });
});

describe('the Calculator warning', () => {
  it('names the copy that stays when the recipe was imported into the Calculator', async () => {
    const source = sourceWith([FOCACCIA]);
    source.calculatorConfig = { recipes: [{ id: 'cat-r1' }] };
    const { user } = await openPageFromList({ source });
    await user.click(trash());
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete recipe?' });
    expect(dialog).toHaveTextContent('Delete “Focaccia”? This cannot be undone. It was imported into the Calculator — that copy will stay');
  });

  it('does not warn about another recipe’s import', async () => {
    const source = sourceWith([FOCACCIA]);
    source.calculatorConfig = { recipes: [{ id: 'cat-other' }] };
    const { user } = await openPageFromList({ source });
    await user.click(trash());
    expect(await screen.findByRole('alertdialog', { name: 'Delete recipe?' })).not.toHaveTextContent('imported');
  });

  it('⚠️ never waits more than 2.5 seconds for the Calculator: a hung read asks the question without the warning', async () => {
    const source = sourceWith([FOCACCIA]);
    source.calculatorConfig = { recipes: [{ id: 'cat-r1' }] };
    source.holdCalculatorRead();
    const { user } = await openPageFromList({ source });
    await user.click(trash());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete recipe?' }, { timeout: 5000 });
    expect(dialog).not.toHaveTextContent('imported');
  }, 15_000);
});

describe('deleting from the editor', () => {
  it('⚠️ asks the same question, says «Recipe deleted.» ONCE, goes back to the list and never asks about the unsaved typing', async () => {
    const source = sourceWith([FOCACCIA]);
    source.calculatorConfig = { recipes: [{ id: 'cat-r1' }] };
    const { user, router } = renderRecipes('/recipes/r1', { source });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = await screen.findByRole('region', { name: 'Edit recipe' });
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), ' integrale');
    const said = countSaid('Recipe deleted.');
    try {
      await user.click(within(region).getByRole('button', { name: 'Delete recipe' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Delete recipe?' });
      // The name it was stored under, not what was typed since; and the Calculator warning.
      expect(dialog).toHaveTextContent('Delete “Focaccia”? This cannot be undone. It was imported into the Calculator');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await says('Recipe deleted.');
      await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
      await waitFor(() => { expect(source.recipeWrites).toEqual([{ id: 'r1', deleted: true }]); });
      await flush();
      expect(said.count()).toBe(1);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(router.state.historyAction).toBe('REPLACE');
      await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
    } finally {
      said.stop();
    }
  });

  it('stays in the editor, typing intact, when the question is cancelled', async () => {
    const { user, router, source } = renderRecipes('/recipes/r1/edit', { source: sourceWith([FOCACCIA]) });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await user.type(within(region).getByRole('textbox', { name: 'Recipe name' }), 'X');
    await user.click(within(region).getByRole('button', { name: 'Delete recipe' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Delete recipe?' })).getByRole('button', { name: 'Cancel' }));
    expect(source.recipeWrites).toEqual([]);
    expect(router.state.location.pathname).toBe('/recipes/r1/edit');
    expect(within(region).getByRole('textbox', { name: 'Recipe name' })).toHaveValue('FocacciaX');
  });

  it('calls a recipe with no name «this recipe»', async () => {
    const { user } = renderRecipes('/recipes/r1/edit', { source: sourceWith([recipe('r1', { name: '' })]) });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await user.click(within(region).getByRole('button', { name: 'Delete recipe' }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete recipe?' })).toHaveTextContent('Delete “this recipe”?');
  });
});
