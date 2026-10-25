import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith, split } from '../testing/renderRecipes';

// Archiving and restoring a recipe from its page (slice «recipe categories + archive», docs/parity/catalogue.md, choices 5-6):
// «Archive» asks, writes the flag alone and the page stays open with the banner; «Restore» does not ask. The pickers that leave
// an archived recipe out are in RecipesSection.archivePickers.spec.tsx, the list's «Archived» fold in RecipesSection.shelf.spec.tsx.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };
const MANAGER = { role: 'manager' as const, canManage: true, isOwner: false };
const FOCACCIA = recipe('r1', { name: 'Focaccia' });
const OLD = recipe('r1', { name: 'Focaccia', archived: true });

const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};
const archiveButton = () => screen.queryByRole('button', { name: 'Archive' });
const restoreButton = () => screen.queryByRole('button', { name: 'Restore' });
const importButton = () => screen.queryByRole('button', { name: 'Import into Calculator' });

async function openPage(seed = FOCACCIA, options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes('/recipes/r1', { source: sourceWith([seed]), ...options });
  await screen.findByRole('heading', { level: 3, name: options.lang === 'it' ? 'Ingredienti' : 'Ingredients' }, LOAD);
  return view;
}

describe('archiving from the recipe page', () => {
  it('asks first, then writes the flag alone, keeps the page open with the banner, says so and puts the focus on «Restore»', async () => {
    const { user, source, router } = await openPage(FOCACCIA, { session: MANAGER });
    expect(screen.queryByRole('region', { name: 'Archived' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Archive “Focaccia”?' });
    expect(dialog).toHaveTextContent('It goes into “Archived” at the foot of the list. Nothing is deleted.');
    expect(source.recipeWrites).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await says('Recipe archived.');
    await waitFor(() => { expect(source.recipeWrites).toEqual([{ id: 'r1', data: { archived: true } }]); });
    expect(router.state.location.pathname).toBe('/recipes/r1');
    const banner = await screen.findByRole('region', { name: 'Archived' });
    expect(banner).toHaveTextContent('Not in the list nor in the choices for new links.');
    expect(archiveButton()).not.toBeInTheDocument();
    await waitFor(() => { expect(restoreButton()).toHaveFocus(); });
    // The page is still the whole recipe.
    expect(screen.getByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
  });

  it('writes nothing when the question is cancelled', async () => {
    const { user, source } = await openPage(FOCACCIA, { session: MANAGER });
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive “Focaccia”?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.recipeWrites).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Archived' })).not.toBeInTheDocument();
    expect(archiveButton()).toBeInTheDocument();
  });

  it('has a hint under the button that describes it, placed after Duplicate and before the Delete icon', async () => {
    await openPage(FOCACCIA, { session: MANAGER });
    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button).toHaveAccessibleDescription(/Takes it out of the list and of the choices for new links/);
    const order = [...document.querySelectorAll('button')].map(node => node.getAttribute('aria-label') ?? node.textContent);
    expect(order.indexOf('Duplicate')).toBeLessThan(order.indexOf('Archive'));
    expect(order.indexOf('Archive')).toBeLessThan(order.indexOf('Delete recipe'));
  });

  it('⚠️ is absent — not disabled — for an employee', async () => {
    await openPage(FOCACCIA, { session: EMPLOYEE });
    expect(archiveButton()).not.toBeInTheDocument();
  });

  it('puts the recipe back and says so when the database refuses the archive', async () => {
    const { user, source } = await openPage(FOCACCIA, { session: MANAGER });
    source.refuseRecipeWrites.save = true;
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Archive “Focaccia”?' })).getByRole('button', { name: 'Archive' }));
    await says('Couldn’t archive “Focaccia” — check your connection.');
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'Archived' })).not.toBeInTheDocument(); });
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
  });
});

describe('the archived recipe’s page', () => {
  it('starts with the banner and a «Restore» that does not ask, writes the removal, says so and puts the focus on the title', async () => {
    const { user, source } = await openPage(OLD, { session: MANAGER });
    const banner = screen.getByRole('region', { name: 'Archived' });
    expect(within(banner).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    // First thing on the page, before the ingredients.
    expect(banner.compareDocumentPosition(screen.getByRole('heading', { level: 3, name: 'Ingredients' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(within(banner).getByRole('button', { name: 'Restore' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await says('Recipe restored.');
    await waitFor(() => { expect(source.recipeWrites).toEqual([{ id: 'r1', data: { archived: null } }]); });
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'Archived' })).not.toBeInTheDocument(); });
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Focaccia' })).toHaveFocus(); });
  });

  it('⚠️ shows an employee the banner without the button, and no Archive either', async () => {
    await openPage(OLD, { session: EMPLOYEE });
    expect(screen.getByRole('region', { name: 'Archived' })).toBeInTheDocument();
    expect(restoreButton()).not.toBeInTheDocument();
    expect(archiveButton()).not.toBeInTheDocument();
  });

  it('hides «Import into Calculator» (it makes a NEW link) and brings it back after a restore; everything else stays', async () => {
    const { user } = await openPage(OLD, { session: MANAGER });
    expect(importButton()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete recipe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => { expect(importButton()).toBeInTheDocument(); });
  });

  it('says it in Italian too', async () => {
    await openPage(OLD, { session: MANAGER, lang: 'it' });
    const banner = screen.getByRole('region', { name: 'Archiviata' });
    expect(banner).toHaveTextContent('Non è nella lista né tra le scelte per nuovi collegamenti.');
    expect(within(banner).getByRole('button', { name: 'Ripristina' })).toBeInTheDocument();
  });
});

describe('the list beside the page', () => {
  it('⚠️ moves the recipe into the «Archived» fold on archive and out of it on restore, the page staying open (tablet split)', async () => {
    split();
    const source = sourceWith([FOCACCIA, recipe('r2', { name: 'Brioche' })]);
    const { user } = renderRecipes('/recipes/r1', { source, session: MANAGER });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(screen.queryByText('Archived (1)')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Archive “Focaccia”?' })).getByRole('button', { name: 'Archive' }));
    const fold = (await screen.findByText('Archived (1)')).closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(true);
    expect(within(fold).getByRole('button', { name: 'Focaccia' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archived' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => { expect(screen.queryByText('Archived (1)')).not.toBeInTheDocument(); });
    expect(screen.getByRole('button', { name: 'Focaccia' })).toBeInTheDocument();
  });
});
