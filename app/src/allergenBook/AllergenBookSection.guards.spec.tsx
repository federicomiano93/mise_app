import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD } from '../testing/renderRecipes';
import { closeBookHost } from './bookPrintHost';
import { open } from './allergenBookRender';
import { RECIPES } from './allergenBookFixtures';

// What the pencil screen and the title band do when the data misbehaves: a recipe whose completeness check throws, and ticks for
// recipes that disappeared while the screen was open.
const broken = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock('./bookEntry', async importOriginal => {
  const original = await importOriginal<typeof import('./bookEntry')>();
  return {
    ...original,
    isBookComplete: (recipe: { id?: string }, tables: Parameters<typeof original.isBookComplete>[1]) => {
      if (recipe.id !== undefined && broken.ids.has(recipe.id)) throw new Error('a malformed recipe');
      return original.isBookComplete(recipe, tables);
    },
  };
});

beforeAll(async () => {
  await import('./AllergenBookSection');
}, 60_000);
beforeEach(() => { window.localStorage.clear(); broken.ids.clear(); });
afterEach(() => {
  act(() => { closeBookHost(); });
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const CHOOSE_PATH = '/allergen-book/choose';

describe('a recipe whose check throws', () => {
  it('is shown as incomplete on the pencil screen, can still be unticked, and is reported once', async () => {
    broken.ids.add('pane');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = open({ path: CHOOSE_PATH });
    const pane = await screen.findByRole('checkbox', { name: 'Pane prova' }, LOAD);
    expect(pane).toHaveAccessibleDescription('allergeni incompleti');
    expect(pane).toBeChecked();
    await user.click(pane);
    expect(pane).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Torta fuori dal libro' })).toBeInTheDocument();
    const ours = report.mock.calls.filter(call => String(call[0]).startsWith('Could not check whether a recipe is complete'));
    expect(ours).toHaveLength(1);
  });

  it('hides the title band’s buttons until the recipes change, then brings them back', async () => {
    broken.ids.add('pane');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { source } = open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Libro allergeni' }, LOAD)).toBeInTheDocument();
    await screen.findByText('Questa parte non si è caricata.');
    expect(screen.queryByRole('button', { name: 'Scegli i prodotti' })).not.toBeInTheDocument();
    broken.ids.clear();
    act(() => { source.pushRecipes(true, [...RECIPES]); });
    expect(await screen.findByRole('button', { name: 'Scegli i prodotti' })).toBeInTheDocument();
  });
});

describe('the count in the question', () => {
  it('counts only the ticked products still on offer', async () => {
    const { user, source } = open({ path: CHOOSE_PATH });
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }, LOAD));
    expect(screen.getByText(/ scelt[io]$/)).toHaveTextContent('5 scelti');
    // A colleague deletes a ticked product and archives another while the screen is open.
    act(() => {
      source.pushRecipes(true, RECIPES.filter(recipe => recipe.id !== 'biscotto').map(recipe => (recipe.id === 'pane' ? { ...recipe, archived: true } : recipe)));
    });
    await waitFor(() => { expect(screen.getByText(/ scelt[io]$/)).toHaveTextContent('3 scelti'); });
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    const question = await screen.findByRole('alertdialog', { name: 'Salvare i prodotti del libro?' });
    expect(question).toHaveTextContent('Il libro avrà 3 prodotti.');
    await user.click(within(question).getByRole('button', { name: 'Annulla' }));
  });
});
