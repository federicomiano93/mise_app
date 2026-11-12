import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// Item 37 of docs/mise2-port-owed.md (current app a221c160, 56864739, 97ac8fe3, e0b92090): «Add a recipe» offers the recipe
// book's recipes first, and a recipe chosen there is linked without ever writing back an older copy of it. The pure rules
// (catalogueChoices, rowsToStamp): shared/src/calculator-add-from-catalogue.spec.ts, run against the current app's own.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const LIST = '/calculator/settings/recipes';
const NEW = `${LIST}/new`;
const BLANK = '+ New recipe, written here';
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;

const row = (label: string, grams: number, rid?: string) => ({ label, grams, unit: 'g', ...(rid ? { rid } : {}) });
const BOOK = [
  { id: 'c-pane', name: 'Pane', ingredients: [row('Flour', 1000, 'a'), row('Water', 700, 'b')] },
  { id: 'c-brioche', name: 'brioche', ingredients: [row('Flour', 500), row('Butter', 250)] },
  { id: 'c-focaccia', name: 'Focaccia book', ingredients: [row('Flour', 1000, 'f1'), row('Water', 800, 'f2')] },
  { id: 'c-nameless', name: '', ingredients: [row('Flour', 1, 'n1')] },
  { id: 'c-old', name: 'Old one', archived: true, ingredients: [row('Flour', 1, 'o1')] },
];

async function open(path = NEW, { config = configOf(), lang = 'en' as 'en' | 'it', source = fakeCalculatorSource({ config, recipes: BOOK }) } = {}) {
  const view = renderCalculator(path, { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  await waitFor(() => { expect(main().queryByText(/^(Loading…|Caricamento…)$/)).toBeNull(); }, LOAD);
  return { ...view, source };
}

// The empty Calculator: no heading yet, so `open` (which waits for a screen's title) is not for it.
async function openEmpty() {
  const source = fakeCalculatorSource({ config: configOf({ recipes: [], clients: [] }), recipes: BOOK });
  const view = renderCalculator('/calculator', { source });
  await main().findByRole('button', { name: 'Add a recipe' }, LOAD);
  return view;
}

const choices = () => main().queryAllByRole('listitem').map(item => item.textContent);
const choice = (name: string | RegExp) => main().getByRole('button', { name });
const blank = () => main().getByRole('button', { name: BLANK });

describe('the choice', () => {
  it('offers the recipe book\'s recipes by name first (an unnamed one last), the archived ones not at all, and the new recipe written here last', async () => {
    await open();
    await main().findByRole('button', { name: /^Focaccia book/ }, LOAD);
    expect(choices()).toEqual(['brioche', 'Focaccia book', 'Pane', 'Unnamed recipe']);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(main().getByRole('heading', { level: 2, name: 'Add a recipe' })).toBeInTheDocument();
    expect(main().getByText('From the Recipe catalogue')).toBeInTheDocument();
    expect(main().getByText(/^Pick a recipe from the Recipe catalogue: its ingredients come from there\./)).toBeInTheDocument();
    // «Last» is in the page order too: the blank button comes after every recipe of the book.
    const all = main().getAllByRole('button').map(button => button.textContent ?? '');
    expect(all.at(-1)).toBe(BLANK);
    expect(all.indexOf(BLANK)).toBeGreaterThan(all.findIndex(text => text.startsWith('Pane')));
  });

  it('marks a recipe the calculator already has — linked, or imported as cat-<id> — and still offers it', async () => {
    const linked = { id: 'r1', name: 'Pane', logic: 'total', visible: true, order: 0, catalogueId: 'c-pane', ingredients: [] };
    const imported = { id: 'cat-c-brioche', name: 'Brioche', logic: 'total', visible: true, order: 1, ingredients: [{ key: 'flour', label: 'Flour', grams: 500 }] };
    await open(NEW, { config: configOf({ recipes: [linked, imported] }) });
    await main().findByRole('button', { name: /^Focaccia book/ }, LOAD);
    expect(choice(/^Pane/)).toHaveTextContent('Already in the calculator');
    expect(choice(/^brioche/)).toHaveTextContent('Already in the calculator');
    expect(choice(/^Focaccia book/)).not.toHaveTextContent('Already in the calculator');
  });

  it('says its words in Italian', async () => {
    await open(NEW, { lang: 'it' });
    expect(await main().findByRole('heading', { level: 2, name: 'Aggiungi una ricetta' }, LOAD)).toBeInTheDocument();
    expect(main().getByText('Dal Ricettario')).toBeInTheDocument();
    expect(main().getByRole('button', { name: '+ Ricetta nuova, scritta qui' })).toBeInTheDocument();
    expect(main().getByText(/^Scegli una ricetta del Ricettario/)).toBeInTheDocument();
  });

  it('says so when the book has no recipes, or every one is archived, and still offers the new recipe', async () => {
    await open(NEW, { source: fakeCalculatorSource({ config: configOf() }) });
    expect(await main().findByText('The Recipe catalogue has no recipes yet.', undefined, LOAD)).toBeInTheDocument();
    expect(blank()).toBeInTheDocument();
    cleanup();
    await open(NEW, { source: fakeCalculatorSource({ config: configOf(), recipes: [BOOK[4]!] }) });
    expect(await main().findByText(/^Every recipe is archived/, undefined, LOAD)).toBeInTheDocument();
  });

  it('a book that cannot be read says so; one the rules refuse offers only the new recipe, with no intro', async () => {
    const failing = fakeCalculatorSource({ config: configOf(), recipes: BOOK });
    failing.refuse.catalogue = true;
    await open(NEW, { source: failing });
    // The fake refuses with permission-denied, as the rules would: no «check the connection», no intro.
    await waitFor(() => { expect(main().queryByText('Loading the Recipe catalogue…')).not.toBeInTheDocument(); }, LOAD);
    expect(main().queryByText(/^Pick a recipe from the Recipe catalogue/)).not.toBeInTheDocument();
    expect(main().queryByText('The Recipe catalogue could not be loaded: check the connection.')).not.toBeInTheDocument();
    expect(blank()).toBeInTheDocument();
    cleanup();

    const offline = fakeCalculatorSource({ config: configOf(), recipes: BOOK });
    offline.listCatalogueRecipes = () => Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await open(NEW, { source: offline });
    expect(await main().findByText('The Recipe catalogue could not be loaded: check the connection.', undefined, LOAD)).toBeInTheDocument();
    expect(blank()).toBeInTheDocument();
  });
});

describe('choosing a recipe of the book', () => {
  it('adds a recipe named after it, linked, made «from a total», and shows it at its own address', async () => {
    const { user, source, ...view } = await open();
    await user.click(await main().findByRole('button', { name: /^Focaccia book/ }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    expect(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD)).toHaveValue('Focaccia book');
    expect(main().getByRole('combobox', { name: 'Where the ingredients come from' })).toHaveValue('catalogue');
    expect(await main().findByText('Linked to Focaccia book', undefined, LOAD)).toBeInTheDocument();
    // The recipe book's rows, read-only.
    expect(main().getByText('1000 g')).toBeInTheDocument();
    // Nothing is written to the database until Save, and the book's rows already carried their ids.
    expect(source.savedConfigs).toEqual([]);
    expect(source.stamps).toEqual([]);

    await user.click(main().getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save these changes?' }, LOAD)).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = (source.savedConfigs[0]?.recipes as { name: string; catalogueId?: string; logic: string; visible: boolean }[]).find(r => r.name === 'Focaccia book')!;
    expect(saved).toMatchObject({ catalogueId: 'c-focaccia', logic: 'total', visible: true });
  });

  it('⚠️ gives a row without an id its id, in the recipe as the SERVER holds it now — never a copy read earlier', async () => {
    const { user, source } = await open();
    await main().findByRole('button', { name: /^brioche/ }, LOAD);
    // Meanwhile (another phone) the book's recipe was corrected: the list on this screen is older than the recipe.
    source.recipes.set('c-brioche', { id: 'c-brioche', name: 'brioche', ingredients: [row('Flour', 520), row('Butter', 260), row('Eggs', 100)] });
    await user.click(choice(/^brioche/));
    await waitFor(() => { expect(source.stamps).toHaveLength(1); });
    // What was stamped is the corrected recipe (three rows, the new amounts), not the older list.
    expect(source.stamps[0]!.ingredients.map(r => (r as { label: string; grams: number }).grams)).toEqual([520, 260, 100]);
    expect(source.recipes.get('c-brioche')!.ingredients).toHaveLength(3);
    expect((source.recipes.get('c-brioche')!.ingredients as { rid?: string }[]).every(r => typeof r.rid === 'string')).toBe(true);
  });

  it('a recipe that is gone says so and adds nothing', async () => {
    const { user, source, ...view } = await open();
    await main().findByRole('button', { name: /^Pane/ }, LOAD);
    source.recipes.delete('c-pane');
    await user.click(choice(/^Pane/));
    const alert = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(alert).toHaveTextContent('This recipe cannot be read from the catalogue right now');
    await user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(pathOf(view)).toBe(NEW);
    expect(choice(/^Focaccia book/)).toBeInTheDocument();
  });

  it('a link the database refuses says so, adds nothing, and leaves the choice there (focus back on the recipe)', async () => {
    const { user, source, ...view } = await open();
    await main().findByRole('button', { name: /^brioche/ }, LOAD);
    source.refuse.stamp = true;
    await user.click(choice(/^brioche/));
    const alert = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(alert).toHaveTextContent('Could not link that recipe — check the connection and try again.');
    await user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(pathOf(view)).toBe(NEW);
    await waitFor(() => { expect(choice(/^brioche/)).toHaveFocus(); });
    // And nothing was added: Back shows the list as it was.
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(main().getAllByRole('button', { name: /ingredients\b/ })).toHaveLength(3); }, LOAD);
  });

  it('⚠️ waits for the database for at most 10 seconds, then says so (offline the link would wait for ever)', async () => {
    const { source, ...view } = await open();
    await main().findByRole('button', { name: /^Pane/ }, LOAD);
    source.holdStamps();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => { choice(/^Pane/).click(); });
    expect(main().getByText('Linking the recipe…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    vi.useRealTimers();
    const alert = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(alert).toHaveTextContent('Could not link that recipe — check the connection and try again.');
    expect(pathOf(view)).toBe(NEW);
    expect(main().queryByText('Linking the recipe…')).not.toBeInTheDocument();
    source.settleStamps();
  });

  it('⚠️ while one is linking the whole choice waits: a second tap does nothing, and a status line says so', async () => {
    const { user, source, ...view } = await open();
    await main().findByRole('button', { name: /^Pane/ }, LOAD);
    source.holdStamps();
    await user.click(choice(/^Pane/));
    expect(await main().findByText('Linking the recipe…')).toBeInTheDocument();
    expect(choice(/^brioche/)).toHaveAttribute('aria-disabled', 'true');
    expect(blank()).toBeDisabled();
    await user.click(choice(/^brioche/));
    await user.click(blank());
    expect(pathOf(view)).toBe(NEW);
    expect(source.stamps).toEqual([]);
    source.settleStamps();
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    // Exactly one recipe was added: the first.
    expect(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD)).toHaveValue('Pane');
  });

  it('⚠️ a pick left behind (Back before it answers) adds nothing, says nothing, and changes nothing', async () => {
    const { user, source, ...view } = await open(LIST);
    await user.click(await main().findByRole('button', { name: '+ Add recipe' }, LOAD));
    await main().findByRole('button', { name: /^Pane/ }, LOAD);
    source.holdStamps();
    await user.click(choice(/^Pane/));
    await main().findByText('Linking the recipe…');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    source.settleStamps();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(pathOf(view)).toBe(LIST);
    expect(main().getAllByRole('button', { name: /ingredients\b/ })).toHaveLength(3);
    expect(main().getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a failure of a pick left behind is not said over the screen that came next', async () => {
    const { user, source, ...view } = await open(LIST);
    await user.click(await main().findByRole('button', { name: '+ Add recipe' }, LOAD));
    await main().findByRole('button', { name: /^Pane/ }, LOAD);
    source.holdStamps();
    source.refuse.stamp = true;
    await user.click(choice(/^Pane/));
    await main().findByText('Linking the recipe…');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    source.settleStamps();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('«New recipe, written here»', () => {
  it('makes an empty recipe and shows it at its own address', async () => {
    const { user, ...view } = await open();
    await user.click(await main().findByRole('button', { name: BLANK }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    expect(await main().findByRole('textbox', { name: 'Recipe name' }, LOAD)).toHaveValue('');
  });

  it('is there at once, before the book has answered', async () => {
    const source = fakeCalculatorSource({ config: configOf(), recipes: BOOK });
    source.listCatalogueRecipes = () => new Promise(() => undefined);
    const { user, ...view } = await open(NEW, { source });
    expect(main().getByText('Loading the Recipe catalogue…')).toBeInTheDocument();
    await user.click(blank());
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
  });
});

describe('how the choice is reached and left', () => {
  it('«+ Add recipe» opens it after the limit question; Back is the list, with the focus on «+ Add recipe»', async () => {
    const { user, ...view } = await open(LIST);
    await user.click(await main().findByRole('button', { name: '+ Add recipe' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe(NEW); });
    expect(await main().findByRole('heading', { level: 2, name: 'Add a recipe' })).toHaveFocus();
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    await waitFor(() => { expect(main().getByRole('button', { name: '+ Add recipe' })).toHaveFocus(); });
  });

  it('with four shown the limit is asked BEFORE the choice, and the recipe it makes is created hidden', async () => {
    const shown = (n: number) => ({ id: `s${n}`, name: `Shown ${n}`, logic: 'total', visible: true, order: n, ingredients: [{ key: 'a', label: 'A', grams: 1 }] });
    const { user, ...view } = await open(LIST, { config: configOf({ recipes: [1, 2, 3, 4].map(shown) }) });
    await user.click(await main().findByRole('button', { name: '+ Add recipe' }, LOAD));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Create hidden' }));
    await user.click(await main().findByRole('button', { name: /^Pane/ }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    await waitFor(() => { expect(main().getByRole('heading', { level: 2, name: 'Edit recipe' })).toHaveFocus(); }); // on show: a press in the very same tick is lost
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(await main().findByRole('button', { name: /^Pane\b.*hidden/ }, LOAD)).toBeInTheDocument();
  });

  it('opened by the empty Calculator, Back returns there and nothing was added', async () => {
    const { user, ...view } = await openEmpty();
    await user.click(main().getByRole('button', { name: 'Add a recipe' }));
    await waitFor(() => { expect(pathOf(view)).toBe(NEW); });
    await user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a recipe chosen from the empty Calculator returns there on Back, the recipe kept in the working copy', async () => {
    const { user, ...view } = await openEmpty();
    await user.click(main().getByRole('button', { name: 'Add a recipe' }));
    await user.click(await main().findByRole('button', { name: /^Pane/ }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    await waitFor(() => { expect(main().getByRole('heading', { level: 2, name: 'Edit recipe' })).toHaveFocus(); }); // on show: a press in the very same tick is lost
    await user.click(main().getByRole('button', { name: 'Back' }));
    // Linked and named, so it is kept — leaving the editor asks about the unsaved recipe, as for any edit.
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(dialog).toHaveTextContent('You have unsaved changes.');
  });

  it('the browser\'s Back from the recipe it made returns to where the choice was opened from', async () => {
    const { user, ...view } = await open(LIST);
    await user.click(await main().findByRole('button', { name: '+ Add recipe' }, LOAD));
    await user.click(await main().findByRole('button', { name: /^Pane/ }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
    // The choice was replaced by the recipe: one step back is the list, not the choice again.
    act(() => { void view.router.navigate(-1); });
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
  });
});
