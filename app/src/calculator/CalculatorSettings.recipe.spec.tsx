import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { FOCACCIA, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The Recipes editor, one recipe: its name, its ingredients, the leavening box, the way a new one is made and
// discarded, and the required checks.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const LIST = '/calculator/settings/recipes';
const DISCARD = 'Discard this new recipe? You have not added anything to it.';

async function open(path: string, { config = configOf(), lang = 'en' as 'en' | 'it', source = fakeCalculatorSource({ config }) } = {}) {
  const view = renderCalculator(path, { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  return { ...view, source };
}

type View = Awaited<ReturnType<typeof open>>;

async function saveAndConfirm(user: View['user']) {
  await user.click(saveButton());
  await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
}

const nameBox = () => main().getByRole('textbox', { name: 'Recipe name' });
// A box with a list of suggestions is a combobox to assistive technology.
const ingredientBox = (n: number) => main().getByRole('combobox', { name: `Ingredient ${n}` });
const gramsBox = (n: number) => main().getByRole('spinbutton', { name: `Ingredient ${n}, weight in grams` });
const leavening = () => main().getByRole('combobox', { name: 'Leavening' });
const optionTexts = (select: HTMLElement) => within(select).getAllByRole('option').map(option => option.textContent);

describe('the recipe screen', () => {
  it('shows the name, the source, every ingredient and the leavening box, under one title', async () => {
    await open(`${LIST}/focaccia`);
    expect(main().getByRole('heading', { level: 2, name: 'Edit recipe' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(nameBox()).toHaveValue('Focaccia');
    expect(main().getByRole('combobox', { name: 'Where the ingredients come from' })).toHaveValue('own');
    expect([1, 2, 3, 4].map(n => (ingredientBox(n) as HTMLInputElement).value)).toEqual(['Flour', 'Water', 'Salt', 'Yeast']);
    expect([1, 2, 3, 4].map(n => (gramsBox(n) as HTMLInputElement).value)).toEqual(['1000', '700', '20', '5']);
    expect(main().getByRole('button', { name: '+ Add ingredient' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Delete recipe' })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('says its words in Italian', async () => {
    await open(`${LIST}/focaccia`, { lang: 'it' });
    expect(main().getByRole('textbox', { name: 'Nome della ricetta' })).toHaveValue('Focaccia');
    expect(main().getByRole('button', { name: '+ Aggiungi ingrediente' })).toBeInTheDocument();
    expect(main().getByRole('combobox', { name: 'Lievito' })).toBeInTheDocument();
    expect(main().getByRole('combobox', { name: 'Ingrediente 1' })).toBeInTheDocument();
  });

  it('suggests the names of the ingredient registry while an ingredient is typed', async () => {
    await open(`${LIST}/focaccia`, { config: configOf({ ingredients: [{ id: 'ing-honey', name: 'Honey' }] }) });
    const list = ingredientBox(1).getAttribute('list');
    const options = [...(document.getElementById(list ?? '')?.querySelectorAll('option') ?? [])].map(option => option.value);
    expect(options).toEqual(expect.arrayContaining(['Honey', 'Flour', 'Yeast']));
  });

  it('adds an ingredient empty, with the focus in its name, and removes one', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    expect(ingredientBox(5)).toHaveValue('');
    expect(ingredientBox(5)).toHaveAttribute('placeholder', 'Ingredient');
    expect(ingredientBox(5)).toHaveFocus();
    expect(gramsBox(5)).toHaveValue(0);
    expect(saveButton()).toBeEnabled();

    await user.click(main().getByRole('button', { name: 'Remove ingredient 3' }));
    expect([1, 2, 3, 4].map(n => (ingredientBox(n) as HTMLInputElement).value)).toEqual(['Flour', 'Water', 'Yeast', '']);
  });

  it('takes grams with one decimal and writes them as typed', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    await user.clear(gramsBox(3));
    await user.type(gramsBox(3), '12.5');
    expect(gramsBox(3)).toHaveValue(12.5);
    expect(gramsBox(3)).toHaveAttribute('step', '0.1');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = (source.savedConfigs[0]?.recipes as { ingredients: { label: string; grams: number }[] }[])[0];
    expect(saved?.ingredients.find(row => row.label === 'Salt')?.grams).toBe(12.5);
  });

  it('writes the typed ingredient names into the registry', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    await user.type(ingredientBox(5), 'Honey');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.ingredients as { name: string }[]).map(row => row.name)).toContain('Honey');
  });
});

describe('the leavening box', () => {
  it('has «nothing rises» first, every ingredient after it, and the chosen one selected', async () => {
    await open(`${LIST}/focaccia`);
    expect(optionTexts(leavening())).toEqual(['Nothing rises in this recipe', 'Flour', 'Water', 'Salt', 'Yeast']);
    expect(leavening()).toHaveValue('yeast');
    expect(main().getByRole('spinbutton', { name: 'Start at' })).toHaveValue(0.5);
    expect(main().getByRole('switch', { name: 'Show the adjust knob in the tab' })).toBeChecked();
  });

  it('«nothing rises» is an answer: it hides the percentage and the knob, and is written', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    await user.selectOptions(leavening(), '');
    expect(main().queryByRole('spinbutton', { name: 'Start at' })).not.toBeInTheDocument();
    expect(main().queryByRole('switch', { name: 'Show the adjust knob in the tab' })).not.toBeInTheDocument();
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.recipes as { leaveningKey: string | null }[])[0]?.leaveningKey).toBeNull();
  });

  it('is there only for the logics that take orders', async () => {
    await open(`${LIST}/brioche`);
    expect(main().queryByRole('combobox', { name: 'Leavening' })).not.toBeInTheDocument();
  });

  it('renaming an ingredient updates its option while the input KEEPS THE FOCUS', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await user.click(ingredientBox(1));
    await user.type(ingredientBox(1), '!');
    expect(ingredientBox(1)).toHaveFocus();
    expect(optionTexts(leavening())).toEqual(['Nothing rises in this recipe', 'Flour!', 'Water', 'Salt', 'Yeast']);
    await user.type(ingredientBox(1), '?');
    expect(ingredientBox(1)).toHaveFocus();
    expect(optionTexts(leavening())[1]).toBe('Flour!?');
  });

  it('a row with no name yet is «Unnamed ingredient», and takes its name live', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    expect(optionTexts(leavening())[5]).toBe('Unnamed ingredient');
    await user.type(ingredientBox(5), 'Starter');
    expect(optionTexts(leavening())[5]).toBe('Starter');
  });

  it('choosing a row that has no key yet gives it one, and a recipe with no percentage a starting 1%', async () => {
    const config = configOf({ recipes: [{ ...FOCACCIA, leaveningKey: null, leaveningDefaultPct: 0, baselinePct: null }] });
    const { user, source } = await open(`${LIST}/focaccia`, { config });
    expect(leavening()).toHaveValue('');
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    await user.type(ingredientBox(5), 'Starter');
    await user.type(gramsBox(5), '50');
    await user.selectOptions(leavening(), 'Starter');
    expect(main().getByRole('spinbutton', { name: 'Start at' })).toHaveValue(1);
    expect(main().getByText('This is the leavening (yeast/starter)')).toBeInTheDocument();
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = (source.savedConfigs[0]?.recipes as { leaveningKey: string; leaveningDefaultPct: number; baselinePct: number; ingredients: { key: string; label: string }[] }[])[0];
    expect(saved?.leaveningKey).toBe('starter-4');
    expect(saved?.ingredients[4]).toMatchObject({ key: 'starter-4', label: 'Starter', grams: 50 });
    expect(saved).toMatchObject({ leaveningDefaultPct: 1, baselinePct: 1 });
  });

  it('the percentage and the knob are written, and the hint follows the knob', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    expect(main().getByText('The percentage every phone starts from. Each phone can then move its own knob without changing this.')).toBeInTheDocument();
    await user.click(main().getByRole('switch', { name: 'Show the adjust knob in the tab' }));
    expect(main().getByText('The percentage this recipe always uses. With the knob hidden, this is the only place it can be set.')).toBeInTheDocument();
    const pct = main().getByRole('spinbutton', { name: 'Start at' });
    await user.clear(pct);
    await user.type(pct, '0.75');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.recipes as object[])[0]).toMatchObject({ showLeavening: false, leaveningDefaultPct: 0.75 });
  });

  it('removing the ingredient that is the leavening leaves the recipe with none', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await user.click(main().getByRole('button', { name: 'Remove ingredient 4' }));
    expect(leavening()).toHaveValue('');
    expect(optionTexts(leavening())).toEqual(['Nothing rises in this recipe', 'Flour', 'Water', 'Salt']);
  });
});

describe('a new recipe', () => {
  it('/recipes/new makes an empty one and shows it at its own address, with placeholders', async () => {
    const view = await open(`${LIST}/new`);
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    expect(nameBox()).toHaveValue('');
    expect(nameBox()).toHaveAttribute('placeholder', 'Recipe name');
    expect(main().queryByRole('combobox', { name: 'Ingredient 1' })).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('left untouched it asks to be discarded; Cancel keeps it, Discard drops it', async () => {
    const { user, ...view } = await open(`${LIST}/new`);
    await waitFor(() => { expect(pathOf(view)).toMatch(/r-[0-9a-z]+$/); });
    const here = pathOf(view);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(DISCARD)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(here);

    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(DISCARD)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(await main().findAllByRole('button', { name: /ingredients\b/ }, LOAD)).toHaveLength(3);
    expect(saveButton()).toBeDisabled();
    expect(isBusy()).toBe(false);
  });

  it('the browser\'s Back asks the same', async () => {
    const { user, ...view } = await open(LIST);
    await user.click(main().getByRole('button', { name: '+ Add recipe' }));
    await main().findByRole('textbox', { name: 'Recipe name' }, LOAD);
    act(() => { void view.router.navigate(-1); });
    await user.click(within(await question(DISCARD)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(await main().findAllByRole('button', { name: /ingredients\b/ }, LOAD)).toHaveLength(3);
  });

  it('from the work view\'s «Add a recipe», discarding returns there and asks nothing more; keeping it asks about the unsaved recipe', async () => {
    const source = fakeCalculatorSource({ config: configOf({ recipes: [], clients: [] }) });
    const view = renderCalculator('/calculator', { source });
    const add = async () => {
      await view.user.click(await main().findByRole('button', { name: 'Add a recipe' }, LOAD));
      await main().findByRole('textbox', { name: 'Recipe name' }, LOAD);
    };
    const LEAVE = 'You have unsaved changes. Leave without saving? Your changes will be lost.';
    await add();
    expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/);
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await view.user.click(within(await question(DISCARD)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await add();
    await view.user.type(nameBox(), 'Pizza');
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await view.user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(nameBox()).toHaveValue('Pizza');
    // Back works again after the question was refused.
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await question(LEAVE);
  });

  it('with a name and an ingredient it is kept: Save writes it with the current app\'s defaults and returns to the list', async () => {
    const { user, source, ...view } = await open(`${LIST}/new`);
    await user.type(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD), 'Pizza');
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    await user.type(ingredientBox(1), 'Flour');
    await user.type(gramsBox(1), '500');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    const recipes = source.savedConfigs[0]?.recipes as Record<string, unknown>[];
    expect(recipes).toHaveLength(4);
    expect(recipes[3]).toMatchObject({
      id: expect.stringMatching(/^r-/), name: 'Pizza', logic: 'orders', trayWeight: 1000, visible: true, order: 3,
      leaveningKey: null, leaveningDefaultPct: 0, showLeavening: true, baselinePct: null,
      ingredients: [{ label: 'Flour', grams: 500 }],
    });
    expect(recipes[3]).not.toHaveProperty('catalogueId');
  });
});

describe('required fields', () => {
  it('a recipe with no name is refused: the sentence, the field marked and focused', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    await user.clear(nameBox());
    await user.click(saveButton());
    const dialog = await question('Please give every recipe a name and at least one named ingredient before saving.');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(nameBox()).toHaveFocus(); });
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(source.savedConfigs).toEqual([]);
    await user.type(nameBox(), 'Pizza');
    expect(nameBox()).not.toHaveAttribute('aria-invalid');
  });

  it('opens the first incomplete recipe from the list, marks its blank ingredient and focuses it', async () => {
    const { user, source, ...view } = await open(LIST);
    await user.click(main().getByRole('button', { name: /^Brioche\b/ }));
    await user.click(within(main().getByRole('group', { name: 'Brioche' })).getByRole('button', { name: 'Edit recipe' }));
    await main().findByRole('textbox', { name: 'Recipe name' }, LOAD);
    await user.clear(ingredientBox(2));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });

    await user.click(saveButton());
    await user.click(within(await question('Please give every recipe a name and at least one named ingredient before saving.')).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(pathOf(view)).toBe(`${LIST}/brioche`); });
    await waitFor(() => { expect(ingredientBox(2)).toHaveFocus(); });
    expect(ingredientBox(2)).toHaveAttribute('aria-invalid', 'true');
    expect(ingredientBox(1)).not.toHaveAttribute('aria-invalid');
    expect(source.savedConfigs).toEqual([]);
  });

  it('a recipe with no ingredient at all is refused too', async () => {
    const { user } = await open(`${LIST}/new`);
    await user.type(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD), 'Pizza');
    await user.click(saveButton());
    await question('Please give every recipe a name and at least one named ingredient before saving.');
  });

  it('a new recipe left without a name is incomplete, and Save opening another recipe does not ask to discard it', async () => {
    const { user, source, ...view } = await open(LIST);
    await user.click(main().getByRole('button', { name: /^Focaccia\b/ }));
    await user.click(within(main().getByRole('group', { name: 'Focaccia' })).getByRole('button', { name: 'Edit recipe' }));
    await user.clear(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(main().getByRole('button', { name: '+ Add recipe' }));
    await main().findByRole('textbox', { name: 'Recipe name' }, LOAD);
    await user.click(saveButton());
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(pathOf(view)).toBe(`${LIST}/focaccia`); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.savedConfigs).toEqual([]);
  });
});

describe('deleting from the recipe screen', () => {
  it('asks first, then returns to the list without the recipe', async () => {
    const { user, ...view } = await open(`${LIST}/sourdough`);
    await user.click(main().getByRole('button', { name: 'Delete recipe' }));
    await user.click(within(await question('Delete the Sourdough recipe?')).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(`${LIST}/sourdough`);
    await user.click(main().getByRole('button', { name: 'Delete recipe' }));
    await user.click(within(await question('Delete the Sourdough recipe?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    await main().findByRole('button', { name: /^Brioche\b/ }, LOAD);
    expect(main().queryByRole('button', { name: /^Sourdough\b/ })).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('is refused while products use the recipe', async () => {
    const { user, ...view } = await open(`${LIST}/brioche`);
    await user.click(main().getByRole('button', { name: 'Delete recipe' }));
    await user.click(within(await question('This recipe is used by 1 product. Reassign or delete it in Settings → Clients first.')).getByRole('button', { name: 'OK' }));
    expect(pathOf(view)).toBe(`${LIST}/brioche`);
    expect(nameBox()).toBeInTheDocument();
  });
});
