import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { BRIOCHE, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The Recipes editor, the list: an accordion of rows, ONE working copy for the list and each recipe, and the way it
// saves — a required check, a question, then ONE write of the whole `recipes` array over the latest configuration.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const LEAVE = 'You have unsaved changes. Leave without saving? Your changes will be lost.';
const LIST = '/calculator/settings/recipes';

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

const head = (name: string) => main().getByRole('button', { name: new RegExp(`^${name}\\b`) });
const panel = (name: string) => within(main().getByRole('group', { name }));
const rowNames = () => [...document.querySelectorAll('main [aria-controls]')].map(node => node.querySelector('span > span')?.textContent);
const acknowledge = async (user: View['user'], message: string) => {
  await user.click(within(await question(message)).getByRole('button', { name: 'OK' }));
};

// Four recipes shown, a fifth hidden, and nobody ordering from them.
const FIVE = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ ...BRIOCHE, id, name: `${id.toUpperCase()} bread`, order: index + 1, visible: index < 4 }));

describe('the list', () => {
  it('has one row per recipe, each saying how it calculates, how many ingredients and whether it shows', async () => {
    await open(LIST);
    expect(main().getByRole('heading', { level: 2, name: 'Recipes' })).toBeInTheDocument();
    expect(rowNames()).toEqual(['Focaccia', 'Brioche', 'Sourdough']);
    expect(head('Focaccia')).toHaveTextContent(/From orders\s+·\s+4 ingredients\s+·\s+shown/);
    expect(head('Brioche')).toHaveTextContent(/From a total\s+·\s+3 ingredients\s+·\s+shown/);
    expect(head('Sourdough')).toHaveTextContent(/By the tray\s+·\s+2 ingredients\s+·\s+shown/);
    expect(main().getByText(/^Your recipes — the base of the calculator\. .* Up to 4 can show as calculator tabs\.$/)).toBeInTheDocument();
    expect(main().getByRole('button', { name: '+ Add recipe' })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    // One h1 for the whole screen: the section's name.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('a hidden recipe says so, and a recipe with one ingredient says «1 ingredient»', async () => {
    await open(LIST, { config: configOf({ recipes: [{ ...BRIOCHE, visible: false, ingredients: [BRIOCHE.ingredients[0]] }] }) });
    expect(head('Brioche')).toHaveTextContent(/From a total\s+·\s+1 ingredient\s+·\s+hidden/);
  });

  it('an empty list says so quietly and offers «Add recipe»', async () => {
    await open(LIST, { config: configOf({ recipes: [] }) });
    expect(rowNames()).toEqual([]);
    expect(main().getByRole('button', { name: '+ Add recipe' })).toBeInTheDocument();
  });

  it('says its words in Italian', async () => {
    await open(LIST, { lang: 'it' });
    expect(main().getByRole('heading', { level: 2, name: 'Ricette' })).toBeInTheDocument();
    expect(head('Focaccia')).toHaveTextContent(/Dagli ordini\s+·\s+4 ingredienti\s+·\s+mostrata/);
    expect(main().getByRole('button', { name: '+ Aggiungi ricetta' })).toBeInTheDocument();
  });
});

describe('the accordion', () => {
  it('opens one row at a time, in place, with aria-expanded and aria-controls', async () => {
    const { user } = await open(LIST);
    for (const name of ['Focaccia', 'Brioche', 'Sourdough']) expect(head(name)).toHaveAttribute('aria-expanded', 'false');
    expect(main().queryByRole('group')).not.toBeInTheDocument();

    await user.click(head('Focaccia'));
    expect(head('Focaccia')).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(head('Focaccia').getAttribute('aria-controls') ?? '')).toBe(main().getByRole('group', { name: 'Focaccia' }));

    await user.click(head('Brioche'));
    expect(head('Focaccia')).toHaveAttribute('aria-expanded', 'false');
    expect(head('Brioche')).toHaveAttribute('aria-expanded', 'true');
    expect(main().getAllByRole('group')).toHaveLength(1);
    // The focus stayed on the head that was tapped.
    expect(head('Brioche')).toHaveFocus();

    await user.click(head('Brioche'));
    expect(main().queryByRole('group')).not.toBeInTheDocument();
  });

  it('the open row holds the logic, the switch and «Edit recipe»; a small delete icon sits beside the head', async () => {
    const { user } = await open(LIST);
    await user.click(head('Focaccia'));
    const row = panel('Focaccia');
    expect(row.getByRole('combobox', { name: 'How it calculates' })).toHaveValue('orders');
    expect(row.getByRole('switch', { name: 'Show in the calculator' })).toBeChecked();
    expect(row.getByRole('button', { name: 'Edit recipe' })).toBeInTheDocument();
    expect(main().getAllByRole('button', { name: 'Delete recipe' })).toHaveLength(3);
    expect(main().getAllByRole('button', { name: 'Delete recipe' }).map(button => button.getAttribute('aria-describedby')).every(Boolean)).toBe(true);
  });
});

describe('how a recipe calculates', () => {
  it('offers the five logics, and the sentence under the select follows the CHOSEN one', async () => {
    const { user } = await open(LIST);
    await user.click(head('Focaccia'));
    const select = panel('Focaccia').getByRole('combobox', { name: 'How it calculates' });
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual([
      'From orders', 'From a total', 'Both (orders + total)', 'By the tray', 'Trays + total',
    ]);
    const hint = () => document.getElementById(select.getAttribute('aria-describedby') ?? '');
    expect(hint()).toHaveTextContent('The amount of dough is decided by what the clients ordered.');
    await user.selectOptions(select, 'both');
    expect(hint()).toHaveTextContent('What the clients ordered, plus an extra amount you type.');
    await user.selectOptions(select, 'traysTotal');
    expect(hint()).toHaveTextContent('Trays plus an amount typed by hand, added together.');
    // The row's head follows live, and Save wakes up.
    expect(head('Focaccia')).toHaveTextContent(/Trays \+ total/);
    expect(saveButton()).toBeEnabled();
  });

  it('the tray weight is asked only for the two tray logics, and kept when switching away and back', async () => {
    const { user } = await open(LIST);
    await user.click(head('Focaccia'));
    const select = () => panel('Focaccia').getByRole('combobox', { name: 'How it calculates' });
    const tray = () => panel('Focaccia').queryByRole('spinbutton', { name: 'Weight per tray (g)' });
    expect(tray()).not.toBeInTheDocument();

    await user.selectOptions(select(), 'trays');
    expect(tray()).toHaveValue(1000);
    await user.clear(tray() as HTMLElement);
    await user.type(tray() as HTMLElement, '1500');
    await user.selectOptions(select(), 'both');
    expect(tray()).not.toBeInTheDocument();
    await user.selectOptions(select(), 'traysTotal');
    expect(tray()).toHaveValue(1500);
  });

  it('a tray recipe shows its weight, and a refused one is kept apart from a recipe that does not use trays', async () => {
    const { user } = await open(LIST);
    await user.click(head('Sourdough'));
    expect(panel('Sourdough').getByRole('spinbutton', { name: 'Weight per tray (g)' })).toHaveValue(1200);
    await user.click(head('Brioche'));
    expect(panel('Brioche').queryByRole('spinbutton', { name: 'Weight per tray (g)' })).not.toBeInTheDocument();
  });
});

describe('at most four shown', () => {
  const fiveRecipes = () => ({ config: configOf({ recipes: FIVE, clients: [] }) });

  it('turning a fifth ON says so and the switch goes back OFF', async () => {
    const { user } = await open(LIST, fiveRecipes());
    await user.click(head('E bread'));
    const show = () => panel('E bread').getByRole('switch', { name: 'Show in the calculator' });
    expect(show()).not.toBeChecked();
    await user.click(show());
    await acknowledge(user, 'There are already 4 recipes in the calculator. To show this one, hide another first.');
    await waitFor(() => { expect(show()).not.toBeChecked(); });
    expect(head('E bread')).toHaveTextContent(/hidden/);
    expect(saveButton()).toBeDisabled();
  });

  it('hiding one first lets the fifth show', async () => {
    const { user } = await open(LIST, fiveRecipes());
    await user.click(head('A bread'));
    await user.click(panel('A bread').getByRole('switch', { name: 'Show in the calculator' }));
    expect(head('A bread')).toHaveTextContent(/hidden/);
    await user.click(head('E bread'));
    await user.click(panel('E bread').getByRole('switch', { name: 'Show in the calculator' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(head('E bread')).toHaveTextContent(/shown/);
    expect(saveButton()).toBeEnabled();
  });

  it('«Add recipe» with four shown asks first, and creates the new recipe hidden', async () => {
    const { user, ...view } = await open(LIST, fiveRecipes());
    await user.click(main().getByRole('button', { name: '+ Add recipe' }));
    const dialog = await question('There are already 4 recipes in the calculator: the new one will be created hidden.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(rowNames()).toHaveLength(5);

    await user.click(main().getByRole('button', { name: '+ Add recipe' }));
    await user.click(within(await question('There are already 4 recipes in the calculator: the new one will be created hidden.')).getByRole('button', { name: 'Create hidden' }));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    await user.type(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD), 'Fresh');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(head('Fresh')).toHaveTextContent(/hidden/);
  });

  it('«Add recipe» with room asks nothing and creates it shown', async () => {
    const { user, ...view } = await open(LIST);
    await user.click(main().getByRole('button', { name: '+ Add recipe' }));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.type(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD), 'Fresh');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(head('Fresh')).toHaveTextContent(/shown/);
  });
});

describe('deleting a recipe', () => {
  it('is refused while products use it, and says how many', async () => {
    const { user } = await open(LIST);
    const deleteOf = (name: string) => within(head(name).closest('div') as HTMLElement).getByRole('button', { name: 'Delete recipe' });
    await user.click(deleteOf('Focaccia'));
    await acknowledge(user, 'This recipe is used by 5 products. Reassign or delete them in Settings → Clients first.');
    await user.click(deleteOf('Brioche'));
    await acknowledge(user, 'This recipe is used by 1 product. Reassign or delete it in Settings → Clients first.');
    expect(rowNames()).toEqual(['Focaccia', 'Brioche', 'Sourdough']);
    expect(saveButton()).toBeDisabled();
  });

  it('is confirmed otherwise: Cancel keeps it, Delete removes it and hands the focus to «Add recipe»', async () => {
    const { user } = await open(LIST);
    const del = () => within(head('Sourdough').closest('div') as HTMLElement).getByRole('button', { name: 'Delete recipe' });
    await user.click(del());
    await user.click(within(await question('Delete the Sourdough recipe?')).getByRole('button', { name: 'Cancel' }));
    expect(rowNames()).toContain('Sourdough');
    expect(saveButton()).toBeDisabled();

    await user.click(del());
    await user.click(within(await question('Delete the Sourdough recipe?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(rowNames()).toEqual(['Focaccia', 'Brioche']); });
    expect(saveButton()).toBeEnabled();
    await waitFor(() => { expect(main().getByRole('button', { name: '+ Add recipe' })).toHaveFocus(); });
  });

  it('an unnamed recipe is asked about with the plain sentence', async () => {
    const { user } = await open(LIST, { config: configOf({ recipes: [], clients: [] }) });
    await user.click(main().getByRole('button', { name: '+ Add recipe' }));
    await user.click(await main().findByRole('button', { name: '+ Add ingredient' }, LOAD));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(head('Unnamed recipe').closest('div') as HTMLElement).getByRole('button', { name: 'Delete recipe' }));
    await user.click(within(await question('Delete this recipe?')).getByRole('button', { name: 'Cancel' }));
    expect(rowNames()).toEqual(['Unnamed recipe']);
  });
});

describe('the focus', () => {
  it('Back from a recipe lands on the row head that was left, still open', async () => {
    const { user, ...view } = await open(LIST);
    await user.click(head('Brioche'));
    await user.click(panel('Brioche').getByRole('button', { name: 'Edit recipe' }));
    await main().findByRole('textbox', { name: 'Recipe name' }, LOAD);
    expect(pathOf(view)).toBe(`${LIST}/brioche`);
    await waitFor(() => { expect(main().getByRole('heading', { level: 2, name: 'Edit recipe' })).toHaveFocus(); });
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(head('Brioche')).toHaveFocus(); });
    expect(head('Brioche')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the recipe is one working copy with the list', () => {
  it('keeps an edit when going from a recipe back to the list, and asks only when leaving altogether', async () => {
    const { user, source, ...view } = await open(LIST);
    await user.click(head('Brioche'));
    await user.click(panel('Brioche').getByRole('button', { name: 'Edit recipe' }));
    const name = await main().findByRole('textbox', { name: 'Recipe name' }, LOAD);
    await user.clear(name);
    await user.type(name, 'Sweet brioche');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Focaccia', 'Sweet brioche', 'Sourdough']);
    expect(saveButton()).toBeEnabled();
    expect(isBusy()).toBe(true);

    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(LIST);
    expect(rowNames()).toEqual(['Focaccia', 'Sweet brioche', 'Sourdough']);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toEqual([]);
  });

  it('the rail asks too, from a recipe: every way out goes through the router\'s blocker', async () => {
    const { user, ...view } = await open(`${LIST}/brioche`);
    await user.type(main().getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(`${LIST}/brioche`);
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/stocktake'); });
  });

  it('asks nothing when nothing was changed, or the change was put back; holds the busy marker while unsaved', async () => {
    const { user, ...view } = await open(`${LIST}/brioche`);
    const name = main().getByRole('textbox', { name: 'Recipe name' });
    expect(isBusy()).toBe(false);
    await user.type(name, 'x');
    expect(isBusy()).toBe(true);
    await user.type(name, '{Backspace}');
    expect(isBusy()).toBe(false);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a recipe the working copy does not have goes back to the list', async () => {
    const view = await open(`${LIST}/nonsense`);
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(await main().findByRole('button', { name: /^Focaccia/ }, LOAD)).toBeInTheDocument();
  });
});

describe('Save', () => {
  it('asks «Save these changes?», writes exactly the working recipes over the latest configuration, and returns to the list', async () => {
    const { user, source, ...view } = await open(LIST, { config: configOf({ askDoughDay: false, extraDough: { brioche: false } }) });
    await user.click(head('Brioche'));
    await user.click(panel('Brioche').getByRole('switch', { name: 'Show in the calculator' }));
    await user.selectOptions(panel('Brioche').getByRole('combobox', { name: 'How it calculates' }), 'both');
    // Another phone changes something else meanwhile.
    act(() => { source.config = configOf({ askDoughDay: true, configRev: 1 }); source.push(); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });

    const saved = source.savedConfigs[0] as Record<string, unknown>;
    const recipes = saved.recipes as { id: string; visible: boolean; logic: string }[];
    expect(recipes.map(recipe => recipe.id)).toEqual(['focaccia', 'brioche', 'sourdough']);
    expect(recipes[1]).toMatchObject({ visible: false, logic: 'both' });
    expect(recipes[0]).toMatchObject({ visible: true, logic: 'orders' });
    // Nothing else of the document moved: the latest configuration is what the recipes were written over.
    expect(saved).toMatchObject({ askDoughDay: true, configModel: 4 });
    expect(saved.clients).toHaveLength(2);

    expect(pathOf(view)).toBe(LIST);
    expect(saveButton()).toBeDisabled();
    expect(isBusy()).toBe(false);
  });

  it('writes nothing when the question is answered with Cancel', async () => {
    const { user, source } = await open(LIST);
    await user.click(head('Brioche'));
    await user.click(panel('Brioche').getByRole('switch', { name: 'Show in the calculator' }));
    await user.click(saveButton());
    await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Cancel' }));
    expect(source.savedConfigs).toEqual([]);
    expect(saveButton()).toBeEnabled();
  });

  it('a deleted recipe is gone from what is written, and the ingredient registry follows the recipes', async () => {
    const { user, source } = await open(LIST, { config: configOf({ ingredients: [{ id: 'ing-honey', name: 'Honey' }] }) });
    await user.click(within(head('Sourdough').closest('div') as HTMLElement).getByRole('button', { name: 'Delete recipe' }));
    await user.click(within(await question('Delete the Sourdough recipe?')).getByRole('button', { name: 'Delete' }));
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = source.savedConfigs[0] as { recipes: { id: string }[]; ingredients: { name: string }[] };
    expect(saved.recipes.map(recipe => recipe.id)).toEqual(['focaccia', 'brioche']);
    expect(saved.ingredients.map(ingredient => ingredient.name)).toEqual(expect.arrayContaining(['Honey', 'Flour', 'Butter']));
  });

  it('after a refused save keeps the screen dirty with its edits, says why, and gives Save back', async () => {
    const { user, source, ...view } = await open(LIST);
    source.refuse.configSave = true;
    await user.click(head('Brioche'));
    await user.click(panel('Brioche').getByRole('switch', { name: 'Show in the calculator' }));
    await saveAndConfirm(user);
    await acknowledge(user, 'Not saved: this app is out of date. Reload it and try again.');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(pathOf(view)).toBe(LIST);
    expect(head('Brioche')).toHaveTextContent(/hidden/);
    expect(saveButton()).toBeEnabled();
    expect(isBusy()).toBe(true);

    source.refuse.configSave = false;
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(2); });
  });

  it('ignores a second tap on Save while the write is in the air', async () => {
    const { user, source } = await open(LIST);
    source.holdConfigSaves();
    await user.click(head('Brioche'));
    await user.click(panel('Brioche').getByRole('switch', { name: 'Show in the calculator' }));
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    await user.click(saveButton());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.savedConfigs).toHaveLength(1);
    source.settleConfigSaves();
    await waitFor(() => { expect(saveButton()).toBeDisabled(); });
    expect(source.savedConfigs).toHaveLength(1);
  });

  it('saved from a recipe, it returns to the list and hands the focus to that recipe\'s row', async () => {
    const { user, source, ...view } = await open(`${LIST}/brioche`);
    // Opened by its address: the list is its fallback.
    await user.type(main().getByRole('textbox', { name: 'Recipe name' }), '!');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect((source.savedConfigs[0]?.recipes as { name: string }[])[1]?.name).toBe('Brioche!');
  });
});

describe('required fields', () => {
  it('a tray recipe without a weight is refused with no dialog: its row opens, the box is marked and focused', async () => {
    const { user, source } = await open(LIST);
    await user.click(head('Sourdough'));
    const tray = () => panel('Sourdough').getByRole('spinbutton', { name: 'Weight per tray (g)' });
    await user.clear(tray());
    await user.click(head('Focaccia'));
    expect(main().queryByRole('group', { name: 'Sourdough' })).not.toBeInTheDocument();

    await user.click(saveButton());
    await waitFor(() => { expect(tray()).toHaveFocus(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(tray()).toHaveAttribute('aria-invalid', 'true');
    expect(main().getByText('Type how much one tray weighs.')).toBeInTheDocument();
    expect(head('Sourdough')).toHaveAttribute('aria-expanded', 'true');

    // A weight that looks like kilos is a different mistake, and says so.
    await user.type(tray(), '2');
    expect(main().getByText('That is very light for a tray: write the weight in grams (e.g. 1000).')).toBeInTheDocument();
    await user.type(tray(), '000');
    expect(tray()).not.toHaveAttribute('aria-invalid');
    expect(source.savedConfigs).toEqual([]);
  });
});

describe('waiting for the configuration', () => {
  it('draws no row and sends nothing before the venue\'s configuration has answered', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator(LIST, { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: /^Focaccia/ })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(source.savedConfigs).toEqual([]);
    act(() => { source.release(); });
    expect(await main().findByRole('button', { name: /^Focaccia/ }, LOAD)).toBeInTheDocument();
  });
});
