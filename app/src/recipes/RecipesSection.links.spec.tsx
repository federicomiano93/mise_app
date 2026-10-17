import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';
import { USAGE_KEY } from './recipesStore';

// Step 3d-7, slice A: the recipe screen's two links to other sections — the «Food cost» card (a door: only for whoever
// Food cost lets in) and «Import into Calculator» (a write: only where the venue uses the Calculator).

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };
const FOCACCIA = recipe('r1', { name: 'Focaccia' });
// Flour in kilos can be imported; the eggs and the pinch of salt cannot.
const MIXED = recipe('mix', {
  name: 'Impasto misto',
  ingredients: [
    { label: 'Flour', grams: 1, unit: 'kg' },
    { label: 'Eggs', grams: 3, unit: 'pcs' },
    { label: 'Salt', grams: 0, unit: 'to taste' },
  ],
});
const ONE_PIECE = recipe('one', {
  name: 'Solo uova',
  ingredients: [{ label: 'Eggs', grams: 3, unit: 'pcs' }, { label: 'Vanilla', grams: 0, unit: 'to taste' }],
});

const main = () => within(screen.getByRole('main'));
const importButton = () => main().getByRole('button', { name: 'Import into Calculator' });

async function open(id = 'r1', options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes(`/recipes/${encodeURIComponent(id)}`, { source: sourceWith([FOCACCIA, MIXED, ONE_PIECE, recipe('a b')]), ...options });
  await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
  return view;
}

// The words land in the section's live region (the shell has a second one, for the connection).
const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};

const flush = () => new Promise<void>(resolve => { setTimeout(resolve, 50); });

describe('the Food cost card', () => {
  it('is a card like the others, with a note and one button, for the owner', async () => {
    await open();
    const heading = main().getByRole('heading', { level: 3, name: 'Food cost' });
    const card = heading.closest('section')!;
    expect(within(card).getByText(/worked out in Food cost/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Open in Food cost' })).toBeInTheDocument();
  });

  it('⚠️ is absent — not disabled — for an employee where the card is hidden from staff', async () => {
    await open('r1', { session: { ...EMPLOYEE, location: {} } });
    expect(main().queryByRole('heading', { name: 'Food cost' })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Open in Food cost' })).not.toBeInTheDocument();
  });

  it('is there for an employee in a venue that shows them Food cost', async () => {
    await open('r1', { session: { ...EMPLOYEE, location: { staffShownCards: { foodcost: true } } } });
    expect(main().getByRole('button', { name: 'Open in Food cost' })).toBeInTheDocument();
  });

  it('⚠️ is absent for everybody when the venue does not use Food cost', async () => {
    await open('r1', { session: { location: { sections: { foodcost: false } } } });
    expect(main().queryByRole('button', { name: 'Open in Food cost' })).not.toBeInTheDocument();
  });

  it('⚠️ is absent while the venue has no document (no venue, no door)', async () => {
    await open('r1', { session: { location: null } });
    expect(main().queryByRole('button', { name: 'Open in Food cost' })).not.toBeInTheDocument();
  });

  it('opens Food cost on this recipe, with the id encoded, and says in the state that the recipe is the entry behind', async () => {
    const { user, router } = await open('a b');
    await user.click(main().getByRole('button', { name: 'Open in Food cost' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
    expect(router.state.location.search).toBe('?recipe=a%20b');
    expect(router.state.location.state).toEqual({ fromRecipeLink: true });
  });

  it('speaks Italian with the current app’s words', async () => {
    renderRecipes('/recipes/r1', { source: sourceWith([FOCACCIA]), lang: 'it', session: { language: 'it' } });
    await screen.findByRole('heading', { level: 3, name: 'Ingredienti' }, LOAD);
    expect(main().getByRole('button', { name: 'Apri nel Food cost' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Importa nel Calcolatore' })).toBeInTheDocument();
  });
});

describe('the order of the page', () => {
  it('⚠️ puts the Food cost card before the allergens, and Export → Import → its hint → Delete at the end', async () => {
    await open();
    const food = main().getByRole('heading', { level: 3, name: 'Food cost' });
    const allergens = main().getByRole('heading', { level: 3, name: /^Allergens/ });
    expect(food.compareDocumentPosition(allergens) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    const exportButton = main().getByRole('button', { name: 'Export' });
    const hint = main().getByText(/Makes a copy you can tweak/);
    const trash = main().getByRole('button', { name: 'Delete recipe' });
    const followed = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(followed(allergens, exportButton)).toBe(true);
    expect(followed(exportButton, importButton())).toBe(true);
    expect(followed(importButton(), hint)).toBe(true);
    expect(followed(hint, trash)).toBe(true);
    // Nothing a person can press sits between the button and its hint.
    expect(importButton().nextElementSibling).toBe(hint);
  });
});

describe('who has Import into Calculator', () => {
  it('⚠️ is there, with its hint, for anyone whose venue uses the Calculator — the Calculator card being hidden from staff does not matter', async () => {
    await open('r1', { session: { ...EMPLOYEE, location: { staffHiddenCards: { calculator: true } } } });
    expect(importButton()).toBeInTheDocument();
    expect(main().getByText(/Makes a copy you can tweak/)).toBeInTheDocument();
  });

  it('⚠️ is absent, button and hint together, where the venue does not use the Calculator', async () => {
    await open('r1', { session: { location: { sections: { calculator: false } } } });
    expect(main().queryByRole('button', { name: 'Import into Calculator' })).not.toBeInTheDocument();
    expect(main().queryByText(/Makes a copy you can tweak/)).not.toBeInTheDocument();
  });
});

describe('importing', () => {
  it('says there is nothing to import for a recipe with no weight, asks nothing and writes nothing', async () => {
    const source = sourceWith([ONE_PIECE]);
    const { user } = await open('one', { source });
    await user.click(importButton());
    await says('This recipe has no weight-based ingredients, so there’s nothing to import.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.importIntoCalculator).not.toHaveBeenCalled();
  });

  it('asks first, by name, and writes nothing when the answer is no', async () => {
    const source = sourceWith([FOCACCIA]);
    const { user } = await open('r1', { source });
    await user.click(importButton());
    const dialog = await screen.findByRole('alertdialog', { name: 'Import into Calculator?' });
    expect(within(dialog).getByText(/Copy “Focaccia” into the Calculator\?/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Note:/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(source.importIntoCalculator).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('⚠️ names the rows that cannot come (a plural note for several, a singular for one) in the question', async () => {
    const { user } = await open('mix');
    await user.click(importButton());
    const dialog = await screen.findByRole('alertdialog', { name: 'Import into Calculator?' });
    expect(within(dialog).getByText(/Note: Eggs, Salt use a unit the Calculator can’t scale/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('uses the singular form for one row left out', async () => {
    const half = recipe('half', { name: 'Metà', ingredients: [{ label: 'Flour', grams: 100, unit: 'g' }, { label: 'Eggs', grams: 3, unit: 'pcs' }] });
    const { user } = await open('half', { source: sourceWith([half]) });
    await user.click(importButton());
    const dialog = await screen.findByRole('alertdialog', { name: 'Import into Calculator?' });
    expect(within(dialog).getByText(/Note: Eggs uses a unit the Calculator can’t scale/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('adds the recipe, hands the source the recipe and the translated market-order word, and says so', async () => {
    const source = sourceWith([FOCACCIA]);
    const { user } = await open('r1', { source });
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await says('“Focaccia” added to the Calculator.');
    expect(source.imports).toHaveLength(1);
    expect(source.imports[0]!.recipe.id).toBe('r1');
    expect(source.imports[0]!.recipe.name).toBe('Focaccia');
    expect(source.imports[0]!.marketOrderTitle).toBe('Market order');
  });

  it('says «updated» when the copy was already there', async () => {
    const source = sourceWith([FOCACCIA]);
    source.importResult = 'updated';
    const { user } = await open('r1', { source });
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await says('“Focaccia” updated in the Calculator.');
  });

  it('⚠️ a refused import says «out of date», any other failure says «check your connection» — and logs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = sourceWith([FOCACCIA]);
    const { user } = await open('r1', { source });

    source.refuseImport = Object.assign(new Error('no'), { code: 'permission-denied' });
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await says('Not saved: this app is out of date. Reload it and try again.');
    expect(error).toHaveBeenCalledWith('Import into Calculator failed:', source.refuseImport);

    source.refuseImport = Object.assign(new Error('offline'), { code: 'unavailable' });
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await says('Import failed — check your connection and try again.');
    expect(source.imports).toHaveLength(0);
  });

  it('⚠️ a second tap while the write is in the air is ignored, and the app is busy until it is over', async () => {
    const source = sourceWith([FOCACCIA]);
    const release = source.holdImport();
    const { user } = await open('r1', { source });
    expect(isBusy()).toBe(false);
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await waitFor(() => { expect(isBusy()).toBe(true); });
    await user.click(importButton());
    await flush();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    release();
    await says('“Focaccia” added to the Calculator.');
    expect(source.imports).toHaveLength(1);
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('⚠️ the button says it is busy while the write is in the air, and is calm again afterwards', async () => {
    const source = sourceWith([FOCACCIA]);
    const release = source.holdImport();
    const { user } = await open('r1', { source });
    expect(importButton()).not.toHaveAttribute('aria-busy');
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await waitFor(() => { expect(importButton()).toHaveAttribute('aria-busy', 'true'); });
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');
    release();
    await says('“Focaccia” added to the Calculator.');
    expect(importButton()).not.toHaveAttribute('aria-busy');
    expect(importButton()).not.toHaveAttribute('aria-disabled');
  });

  it('⚠️ leaving the recipe mid-write keeps the app busy until the write has settled, and saying so afterwards does not throw', async () => {
    const source = sourceWith([FOCACCIA]);
    const release = source.holdImport();
    const { router, user } = await open('r1', { source });
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await waitFor(() => { expect(isBusy()).toBe(true); });

    await act(async () => { await router.navigate('/recipes'); });
    await waitFor(() => { expect(screen.queryByRole('heading', { level: 3, name: 'Ingredients' })).not.toBeInTheDocument(); });
    expect(isBusy()).toBe(true);

    await act(async () => { release(); await flush(); });
    expect(source.imports).toHaveLength(1);
    expect(isBusy()).toBe(false);
  });

  it('counts the recipe as used when the import worked, and not when it failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const usage = () => (JSON.parse(window.localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>).r1 ?? 0;
    const source = sourceWith([FOCACCIA]);
    const { user } = await open('r1', { source });
    const before = usage();

    source.refuseImport = new Error('offline');
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await says('Import failed — check your connection and try again.');
    expect(usage()).toBe(before);

    source.refuseImport = null;
    await user.click(importButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Import into Calculator?' })).getByRole('button', { name: 'Import' }));
    await says('“Focaccia” added to the Calculator.');
    expect(usage()).toBe(before + 1);
  });
});
