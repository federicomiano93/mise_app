import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import type { FakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { FOCACCIA, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// Linking a recipe to the Catalogue: the picker reads the Catalogue only when it opens, choosing stamps the rows
// FIRST and then links, a failed stamp links nothing, a linked recipe's ingredients are read-only, and its leavening
// is chosen among the Catalogue's rows by their own id.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const LIST = '/calculator/settings/recipes';
const PICKER = 'Choose a catalogue recipe';

// Catalogue recipes as the Catalogue stores them: rows with a name and grams, and no row id yet.
const CAT_1 = { id: 'cat-1', name: 'Catalogue focaccia', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Starter', grams: 100, unit: 'g' }] };
const CAT_2 = { id: 'cat-2', name: 'Another loaf', ingredients: [{ label: 'Rye', grams: 800, unit: 'g' }] };
// The same, once linked: every row carries its own id.
const STAMPED = { ...CAT_1, ingredients: [{ rid: 'rflour000', label: 'Flour', grams: 1000, unit: 'g' }, { rid: 'rstarter0', label: 'Starter', grams: 100, unit: 'g' }] };

const LINKED = { ...FOCACCIA, catalogueId: 'cat-1', leaveningRid: 'rstarter0' };

async function open(path: string, { config = configOf(), recipes = [CAT_1, CAT_2] as Record<string, unknown>[], lang = 'en' as 'en' | 'it' } = {}) {
  const source = fakeCalculatorSource({ config, recipes: recipes as never });
  const view = renderCalculator(path, { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  return { ...view, source };
}

type View = Awaited<ReturnType<typeof open>>;

async function saveAndConfirm(user: View['user']) {
  await user.click(saveButton());
  await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
}

const sourceSelect = () => main().getByRole('combobox', { name: 'Where the ingredients come from' });
const leavening = () => main().getByRole('combobox', { name: 'Leavening' });
const picker = () => screen.findByRole('dialog', { name: PICKER }, LOAD);
const optionTexts = (select: HTMLElement) => within(select).getAllByRole('option').map(option => option.textContent);

async function openPicker(user: View['user']) {
  await user.selectOptions(sourceSelect(), 'catalogue');
  return within(await picker());
}

async function link(user: View['user'], name: string) {
  const dialog = await openPicker(user);
  await user.click(await dialog.findByRole('button', { name }, LOAD));
  await main().findByText(/^Linked to /, undefined, LOAD);
}

describe('the picker', () => {
  it('reads the Catalogue only when it opens, and once', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    expect(source.catalogueReads()).toBe(0);
    const dialog = await openPicker(user);
    expect(await dialog.findByRole('button', { name: 'Catalogue focaccia' }, LOAD)).toBeInTheDocument();
    expect(source.catalogueReads()).toBe(1);
    // The select shows what is saved on the recipe: a picker that was backed out of changes nothing.
    await user.click(dialog.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(sourceSelect()).toHaveValue('own');
    expect(saveButton()).toBeDisabled();
    await openPicker(user);
    expect(source.catalogueReads()).toBe(1);
  });

  it('opening the list, the recipe or the Settings never reads the Catalogue', async () => {
    const { user, source } = await open(LIST);
    await user.click(main().getByRole('button', { name: /^Focaccia\b/ }));
    await user.click(within(main().getByRole('group', { name: 'Focaccia' })).getByRole('button', { name: 'Edit recipe' }));
    await main().findByRole('combobox', { name: 'Where the ingredients come from' }, LOAD);
    expect(source.catalogueReads()).toBe(0);
  });

  it('lists the recipes by name and narrows them as the search is typed', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    const dialog = await openPicker(user);
    await dialog.findByRole('button', { name: 'Another loaf' }, LOAD);
    expect(dialog.getAllByRole('button').map(button => button.textContent)).toEqual(['Another loaf', 'Catalogue focaccia', 'Back']);
    await user.type(dialog.getByRole('searchbox', { name: 'Search the Recipe catalogue' }), 'FOCAC');
    expect(dialog.queryByRole('button', { name: 'Another loaf' })).not.toBeInTheDocument();
    await user.clear(dialog.getByRole('searchbox'));
    await user.type(dialog.getByRole('searchbox'), 'zzz');
    expect(dialog.getByText('Nothing matches.')).toBeInTheDocument();
  });

  it('a Catalogue with no recipe says so', async () => {
    const { user } = await open(`${LIST}/focaccia`, { recipes: [] });
    const dialog = await openPicker(user);
    expect(await dialog.findByText('The Recipe catalogue has no recipes yet.', undefined, LOAD)).toBeInTheDocument();
  });

  it('a read that fails says so in the picker and links nothing; the next opening tries again', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    source.refuse.catalogue = true;
    const dialog = await openPicker(user);
    expect(await dialog.findByText('The Recipe catalogue could not be read. Check the connection and try again.', undefined, LOAD)).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Catalogue focaccia' })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(sourceSelect()).toHaveValue('own');
    expect(saveButton()).toBeDisabled();

    source.refuse.catalogue = false;
    const again = await openPicker(user);
    expect(await again.findByRole('button', { name: 'Catalogue focaccia' }, LOAD)).toBeInTheDocument();
    expect(source.catalogueReads()).toBe(2);
  });

  it('says its words in Italian', async () => {
    const { user } = await open(`${LIST}/focaccia`, { lang: 'it' });
    await user.selectOptions(main().getByRole('combobox', { name: 'Da dove vengono gli ingredienti' }), 'catalogue');
    const dialog = within(await screen.findByRole('dialog', { name: 'Scegli una ricetta del Ricettario' }, LOAD));
    expect(dialog.getByRole('searchbox', { name: 'Cerca nel Ricettario' })).toBeInTheDocument();
    expect(await dialog.findByRole('button', { name: 'Catalogue focaccia' }, LOAD)).toBeInTheDocument();
  });
});

describe('choosing a Catalogue recipe', () => {
  it('stamps a row id on every row FIRST, then links, and the ingredients become read-only', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    // At the moment of the stamp nothing is linked yet.
    const seen: boolean[] = [];
    const stamp = source.stampRowIds.bind(source);
    source.stampRowIds = id => {
      seen.push(screen.queryByText(/^Linked to /) !== null);
      return stamp(id);
    };
    await link(user, 'Catalogue focaccia');

    expect(seen).toEqual([false]);
    expect(source.stamps).toHaveLength(1);
    expect(source.stamps[0]?.id).toBe('cat-1');
    const rows = source.stamps[0]?.ingredients as { rid: string; label: string; grams: number }[];
    expect(rows.map(row => row.label)).toEqual(['Flour', 'Starter']);
    expect(rows.every(row => /^r[a-z0-9]{8}$/.test(row.rid))).toBe(true);

    expect(sourceSelect()).toHaveValue('catalogue');
    expect(main().getByText('Linked to Catalogue focaccia')).toBeInTheDocument();
    expect(main().getByText('The ingredients come from the Recipe catalogue. Correct them there and every tab using this recipe is corrected too.')).toBeInTheDocument();
    // Read-only: the Catalogue's rows, no box to type in, and no «add».
    expect(main().queryByRole('combobox', { name: 'Ingredient 1' })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: '+ Add ingredient' })).not.toBeInTheDocument();
    expect(main().getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour1000 g', 'Starter100 g']);
    expect(main().getByText('Edited in the Recipe catalogue, not here — so there is only ever one version.')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('a recipe that already has row ids is linked without a write (idempotent)', async () => {
    const { user, source } = await open(`${LIST}/focaccia`, { recipes: [STAMPED] });
    await link(user, 'Catalogue focaccia');
    expect(source.stamps).toEqual([]);
    expect(main().getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour1000 g', 'Starter100 g']);
  });

  it('links the rows the Catalogue holds NOW, not the older list the picker showed', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    const dialog = await openPicker(user);
    const row = await dialog.findByRole('button', { name: 'Catalogue focaccia' }, LOAD);
    // Somebody edits the recipe in the Catalogue after the picker listed it.
    source.recipes.set('cat-1', { ...CAT_1, ingredients: [...CAT_1.ingredients, { label: 'Salt', grams: 20, unit: 'g' }] });
    await user.click(row);
    await main().findByText(/^Linked to /, undefined, LOAD);
    expect(main().getAllByRole('listitem').map(item => item.textContent)).toEqual(['Flour1000 g', 'Starter100 g', 'Salt20 g']);
    expect((source.stamps[0]?.ingredients as { label: string }[]).map(item => item.label)).toEqual(['Flour', 'Starter', 'Salt']);
  });

  it('shows it is working while the stamp is in the air, and a rejection ends it', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    let fail: (error: Error) => void = () => undefined;
    source.stampRowIds = () => new Promise<unknown[]>((_resolve, reject) => { fail = reject; });
    const dialog = await openPicker(user);
    await user.click(await dialog.findByRole('button', { name: 'Catalogue focaccia' }, LOAD));
    expect(await dialog.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Another loaf' })).toBeDisabled();
    act(() => { fail(new Error('offline')); });
    await user.click(within(await question('Could not link that recipe — check the connection and try again.')).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(main().queryByText(/^Linked to /)).not.toBeInTheDocument();
  });

  it('a stamp that is refused says so, links nothing, and leaves the recipe as it was', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    source.refuse.stamp = true;
    const dialog = await openPicker(user);
    await user.click(await dialog.findByRole('button', { name: 'Catalogue focaccia' }, LOAD));
    await user.click(within(await question('Could not link that recipe — check the connection and try again.')).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(sourceSelect()).toHaveValue('own');
    expect(main().queryByText(/^Linked to /)).not.toBeInTheDocument();
    expect(main().getByRole('combobox', { name: 'Ingredient 1' })).toHaveValue('Flour');
    expect(saveButton()).toBeDisabled();
    expect(source.stamps).toEqual([]);
  });

  it('clears the leavening row: it must be chosen again, from the new recipe\'s rows', async () => {
    const { user, source } = await open(`${LIST}/focaccia`, { config: configOf({ recipes: [LINKED] }), recipes: [STAMPED, CAT_2] });
    expect(leavening()).toHaveValue('rstarter0');
    await user.click(within(main().getByText(/^Linked to /).parentElement as HTMLElement).getByRole('button', { name: 'Choose another' }));
    const dialog = within(await picker());
    await user.click(await dialog.findByRole('button', { name: 'Another loaf' }, LOAD));
    await main().findByText('Linked to Another loaf', undefined, LOAD);
    expect(leavening()).toHaveValue('');
    expect(optionTexts(leavening())).toEqual(['Nothing rises in this recipe', 'Rye']);

    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = (source.savedConfigs[0]?.recipes as Record<string, unknown>[])[0];
    expect(saved).toMatchObject({ catalogueId: 'cat-2', leaveningRid: null });
  });

  it('the leavening of a linked recipe is chosen among the Catalogue\'s rows by their id, and survives the save', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    await link(user, 'Catalogue focaccia');
    expect(optionTexts(leavening())).toEqual(['Nothing rises in this recipe', 'Flour', 'Starter']);
    expect(leavening()).toHaveValue('');
    const rid = (source.stamps[0]?.ingredients as { rid: string }[])[1]?.rid;
    await user.selectOptions(leavening(), 'Starter');
    expect(leavening()).toHaveValue(rid);
    expect(main().getByRole('spinbutton', { name: 'Start at' })).toBeInTheDocument();

    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.recipes as Record<string, unknown>[])[0]).toMatchObject({ catalogueId: 'cat-1', leaveningRid: rid });
    // The store now watches the saved link: the recipe still reads from the Catalogue.
    await waitFor(() => { expect(source.watchedRecipes()).toEqual(['cat-1']); });
  });

  it('a linked recipe needs no ingredient of its own to be saved', async () => {
    const { user, source } = await open(`${LIST}/focaccia`, { config: configOf({ recipes: [{ ...FOCACCIA, ingredients: [], leaveningKey: null }] }) });
    await link(user, 'Catalogue focaccia');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('a recipe that is already linked', () => {
  it('shows the Catalogue\'s rows from the watched recipe, without ever reading the Catalogue', async () => {
    const { source } = await open(`${LIST}/focaccia`, { config: configOf({ recipes: [LINKED] }), recipes: [STAMPED] });
    expect(await main().findByText('Linked to Catalogue focaccia', undefined, LOAD)).toBeInTheDocument();
    expect(main().getByText('1000 g')).toBeInTheDocument();
    expect(leavening()).toHaveValue('rstarter0');
    expect(source.catalogueReads()).toBe(0);
    expect(main().queryByRole('combobox', { name: 'Ingredient 1' })).not.toBeInTheDocument();
  });

  it('keeps catalogueId and leaveningRid through a save of something else (parity 17)', async () => {
    const { user, source } = await open(`${LIST}/focaccia`, { config: configOf({ recipes: [LINKED] }), recipes: [STAMPED] });
    await main().findByText('Linked to Catalogue focaccia', undefined, LOAD);
    await user.type(main().getByRole('textbox', { name: 'Recipe name' }), '!');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.recipes as Record<string, unknown>[])[0]).toMatchObject({
      name: 'Focaccia!', catalogueId: 'cat-1', leaveningRid: 'rstarter0',
    });
  });

  it('unlinking deletes both keys and leaves no trace of the link in what is written', async () => {
    const { user, source } = await open(`${LIST}/focaccia`, { config: configOf({ recipes: [LINKED] }), recipes: [STAMPED] });
    await main().findByText('Linked to Catalogue focaccia', undefined, LOAD);
    await user.selectOptions(sourceSelect(), 'own');
    expect(main().queryByText(/^Linked to /)).not.toBeInTheDocument();
    expect(sourceSelect()).toHaveValue('own');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = (source.savedConfigs[0]?.recipes as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('catalogueId');
    expect(saved).not.toHaveProperty('leaveningRid');
    expect(source.catalogueReads()).toBe(0);
  });

  it('says why a recipe that was deleted from the Catalogue cannot be read', async () => {
    await open(`${LIST}/focaccia`, { config: configOf({ recipes: [{ ...FOCACCIA, catalogueId: 'cat-gone' }] }), recipes: [] });
    expect(await main().findByText('This recipe cannot be read from the catalogue right now, so nothing can be calculated. Check it still exists.', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('combobox', { name: 'Ingredient 1' })).not.toBeInTheDocument();
  });

  it('says why a Catalogue recipe with no rows, or with a row that has no weight, cannot be used', async () => {
    const { source } = await open(`${LIST}/focaccia`, { config: configOf({ recipes: [{ ...FOCACCIA, catalogueId: 'cat-1' }] }), recipes: [{ ...CAT_1, ingredients: [] }] });
    expect(await main().findByText('That catalogue recipe has no ingredients yet.', undefined, LOAD)).toBeInTheDocument();
    act(() => {
      source.recipes.set('cat-1', { ...CAT_1, ingredients: [{ label: 'Eggs', grams: 2, unit: 'pcs' }] } as never);
      source.push();
    });
    expect(await main().findByText(/“Eggs” has no weight/, undefined, LOAD)).toBeInTheDocument();
  });
});

describe('the recipe is saved with its link', () => {
  it('does not need the Catalogue to be read again on the list, and the list shows the recipe as it is', async () => {
    const { user, source } = await open(LIST, { config: configOf({ recipes: [LINKED] }), recipes: [STAMPED] });
    expect(await main().findByRole('button', { name: /^Focaccia\b/ }, LOAD)).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: /^Focaccia\b/ }));
    expect(saveButton()).toBeDisabled();
    expect(source.catalogueReads()).toBe(0);
  });
});
