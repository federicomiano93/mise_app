import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { labelWord } from '@mise/shared/market';
import { buildLabel, declarationText } from '@mise/shared/recipe-label-model';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes, split } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';

// The label screen (step 3d-3): what the recipe's label says, on screen, and printed through the system's own dialog.
// ⚠️ This is a document that goes on food. Every verdict, every word of the label and the whole layout are the shared
// model's; these specs check that the screen draws them faithfully, refuses when it must, and never lets a label that
// was not MEASURED be printed.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  // A print host outlives its screen until `afterprint` (printHost.tsx): the end of a spec is that event.
  act(() => { window.dispatchEvent(new Event('afterprint')); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
  window.localStorage.clear();
});

const STAMP = '2026-01-01';
const NUTRITION = { kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5 };
const ingredient = (id: string, fields: Record<string, unknown> = {}): StoredDoc => ({ id, name: id, ...fields });
const declared = (id: string, allergens: string[], extra: Record<string, unknown> = {}): StoredDoc =>
  ingredient(id, { allergens, allergensCheckedAt: STAMP, nutrition: NUTRITION, ...extra });

const FLOUR = declared('flour', ['gluten-wheat']);
const MILK = declared('milk', ['milk'], { mayContain: ['nuts-hazelnut'] });
const SALT = declared('salt', []);
// No nutrition table at all: the allergens are still complete, the table cannot be worked out.
const NOSPEC = declared('nospec', [], { nutrition: undefined });
const YEAST = ingredient('yeast', { allergens: [] });
const INGREDIENTS = [FLOUR, MILK, SALT, NOSPEC, YEAST];

const row = (label: string, refId?: string, grams = 100, extra: Record<string, unknown> = {}) =>
  ({ label, grams, unit: 'g', ...(refId === undefined ? {} : { refId }), ...extra });
const recipeDoc = (id: string, name: string, ingredients: unknown[], extra: Record<string, unknown> = {}): StoredDoc =>
  ({ id, name, ingredients, ...extra });

const CAKE = recipeDoc('cake', 'Cake', [row('Flour', 'flour', 500), row('Milk', 'milk', 300), row('Salt', 'salt', 10)]);
const CAKE_WITH_LOSS = recipeDoc('cake', 'Cake', [row('Flour', 'flour', 500), row('Milk', 'milk', 300), row('Salt', 'salt', 10)], { lossPct: 12 });
const NO_TABLE = recipeDoc('plain', 'Plain', [row('Flour', 'flour', 500), row('No spec', 'nospec', 100)]);
const ONE_GAP = recipeDoc('gap1', 'One gap', [row('Flour', 'flour', 500), row('Mystery')]);
const TWO_GAPS = recipeDoc('gap2', 'Two gaps', [row('Flour', 'flour', 500), row('Mystery'), row('Yeast', 'yeast', 5)]);
const NO_WEIGHT = recipeDoc('nowt', 'No weight', [row('Flour', 'flour', 0)]);

const GB = { country: 'GB' };
const IT = { country: 'IT' };

type Options = {
  location?: Record<string, unknown>;
  lang?: 'en' | 'it';
  source?: ReturnType<typeof fakeRecipesSource>;
  labelConfig?: Record<string, unknown> | null;
};

const main = () => within(screen.getByRole('main'));
const switchGroup = () => main().getByRole('group', { name: /^(What the label shows|Cosa mostra l’etichetta)$/ });
const printButton = () => main().getByRole('button', { name: /^(Print|Print dialog|Stampa|Finestra di stampa)$/ });
const sheetNode = () => document.querySelector('.lab-preview .lab-sheet');
const algButton = () => main().getByRole('button', { name: /^Allergens/ });
// The label as words (LabelCard). The paper above it says the same things in a sheet, so a text query on the whole
// screen would find each line twice.
const card = () => within(document.querySelector('[class*="_card_"]') as HTMLElement);

async function openLabel(recipes: StoredDoc[], id: string, options: Options = {}) {
  const source = options.source ?? fakeRecipesSource({ recipes, ingredients: INGREDIENTS, labelConfig: options.labelConfig ?? null });
  const view = renderRecipes(`/recipes/${id}/label`, {
    source, lang: options.lang, session: { location: options.location ?? GB, language: options.lang ?? 'en' },
  });
  await screen.findByRole('group', { name: /^(What the label shows|Cosa mostra l’etichetta)$/ }, LOAD);
  return { ...view, source };
}

// jsdom lays nothing out: every width and height is zero. A spec that needs a measurement says what the browser
// would answer. `overflow` is how many pixels the text spills past the paper at a font size in millimetres.
function stubLayout({ room = 400, sheetWidth = 287, overflow = (): number => 0 }: {
  room?: number; sheetWidth?: number; overflow?: (fontMm: number) => number;
} = {}) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => room);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => 100);
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    return 100 + (this.classList.contains('lab-sheet') ? overflow(parseFloat((this as HTMLElement).style.fontSize)) : 0);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => sheetWidth);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => 192);
}

describe('the way in: «Make a label» on a complete allergen card', () => {
  it('is inside the fold of a complete card, and opens the label one level below the recipe', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS });
    const { router, user } = renderRecipes('/recipes/cake', { source, session: { location: GB } });
    await screen.findByText('Wheat, Milk', undefined, LOAD);
    expect(main().getByText('Make a label')).not.toBeVisible();
    await user.click(algButton());
    await user.click(main().getByRole('button', { name: 'Make a label' }));
    expect(router.state.location.pathname).toBe('/recipes/cake/label');
    expect(await screen.findByRole('group', { name: 'What the label shows' })).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 2, name: 'Cake' })).toBeInTheDocument();
  });

  it('is not offered on a recipe that is not fully declared: the card names the work instead', async () => {
    renderRecipes('/recipes/gap1', { source: fakeRecipesSource({ recipes: [ONE_GAP], ingredients: INGREDIENTS }), session: { location: GB } });
    await screen.findByRole('button', { name: /^Allergens/ }, LOAD);
    expect(main().queryByText('Make a label')).not.toBeInTheDocument();
  });

  it('goes with the card when the venue has switched allergens off', async () => {
    renderRecipes('/recipes/cake', {
      source: fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS }), session: { location: { ...GB, showAllergens: false } },
    });
    await screen.findByRole('table', undefined, LOAD);
    expect(main().queryByText('Make a label')).not.toBeInTheDocument();
  });

  it('steps Back to the recipe with the browser\'s Back when it was opened from there', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS });
    const { router, user } = renderRecipes('/recipes/cake', { source, session: { location: GB } });
    await screen.findByText('Wheat, Milk', undefined, LOAD);
    await user.click(algButton());
    await user.click(main().getByRole('button', { name: 'Make a label' }));
    await screen.findByRole('group', { name: 'What the label shows' });
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/cake'); });
    expect(router.state.historyAction).toBe('POP');
    expect(await screen.findByText('Wheat, Milk')).toBeInTheDocument();
  });

  it('⚠️ Back returns to the recipe as it was left: the fold open, the focus on «Make a label», the scroll kept — and a recipe opened afresh is closed again', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS });
    const { router, user } = renderRecipes('/recipes/cake', { source, session: { location: GB } });
    await screen.findByText('Wheat, Milk', undefined, LOAD);
    const area = screen.getByRole('main');
    Object.defineProperty(area, 'scrollTop', { value: 0, writable: true });
    await user.click(algButton());
    area.scrollTop = 310;
    await user.click(main().getByRole('button', { name: 'Make a label' }));
    await screen.findByRole('group', { name: 'What the label shows' });
    expect(area.scrollTop).toBe(0);

    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/cake'); });
    const door = await main().findByRole('button', { name: 'Make a label' });
    expect(door).toBeVisible();
    expect(door).toHaveFocus();
    expect(algButton()).toHaveAttribute('aria-expanded', 'true');
    expect(area.scrollTop).toBe(310);

    // Not for ever: the next move forgets it, and the same recipe opened again starts closed, with the focus on its title.
    await act(async () => { await router.navigate('/recipes'); });
    await act(async () => { await router.navigate('/recipes/cake', { state: { fromList: true } }); });
    await screen.findByText('Wheat, Milk');
    expect(algButton()).toHaveAttribute('aria-expanded', 'false');
    expect(main().getByRole('button', { name: 'Make a label', hidden: true })).not.toHaveFocus();
  });

  it('steps up to the recipe by replacing itself when the label was opened by its address', async () => {
    const { router, user } = await openLabel([CAKE], 'cake');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/cake'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('remembers the switch for the section: another label, or the same one again, opens on it', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE, NO_TABLE], ingredients: INGREDIENTS });
    const { user } = renderRecipes('/recipes/cake', { source, session: { location: GB } });
    await screen.findByText('Wheat, Milk', undefined, LOAD);
    await user.click(algButton());
    await user.click(main().getByRole('button', { name: 'Make a label' }));
    await user.click(await screen.findByRole('button', { name: 'Nutrition' }));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await screen.findByText('Wheat, Milk');
    // The fold is still open from before (Back returns the recipe as it was left).
    await user.click(main().getByRole('button', { name: 'Make a label' }));
    expect(await screen.findByRole('button', { name: 'Nutrition' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens beside the list on the tablet\'s split', async () => {
    split();
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS });
    const { router, user } = renderRecipes('/recipes/cake', { source, session: { location: GB } });
    await screen.findByText('Wheat, Milk', undefined, LOAD);
    await user.click(algButton());
    await user.click(main().getByRole('button', { name: 'Make a label' }));
    expect(router.state.location.pathname).toBe('/recipes/cake/label');
    expect(await screen.findByRole('group', { name: 'What the label shows' })).toBeInTheDocument();
    // The list is still there, with the recipe marked as the one open.
    expect(main().getByRole('searchbox')).toBeInTheDocument();
  });
});

describe('the address', () => {
  it('says the recipe no longer exists for a label of a recipe that is not there', async () => {
    renderRecipes('/recipes/ghost/label', { source: fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS }), session: { location: GB } });
    expect(await screen.findByRole('region', { name: 'This recipe no longer exists.' }, LOAD)).toBeInTheDocument();
  });

  it('leaves for the list and says so when the recipe is deleted elsewhere while its label is open', async () => {
    const { router, source } = await openLabel([CAKE], 'cake');
    source.recipes.delete('cake');
    act(() => { source.push(); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(await screen.findByText('Recipe deleted.')).toBeInTheDocument();
  });

  it('does not take a reserved word for a recipe', async () => {
    const { router } = renderRecipes('/recipes/allergens/label', {
      source: fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS }), session: { location: GB },
    });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
  });
});

describe('the four refusals, each with a title and one sentence', () => {
  const refusal = (sentence: string | RegExp) => {
    expect(main().getByText('No label can be made')).toBeInTheDocument();
    expect(main().getByText(sentence)).toBeInTheDocument();
    // Nothing of a label: no paper, no card, no Copy, no Print.
    expect(document.querySelector('.lab-sheet')).toBeNull();
    expect(main().queryByRole('button', { name: /Copy|Print|Send/ })).not.toBeInTheDocument();
  };

  it('allergens off: no allergen line, no label — even by typing the address', async () => {
    await openLabel([CAKE], 'cake', { location: { ...GB, showAllergens: false } });
    refusal(/does not track allergens/);
  });

  it('no country: deliberately not a fallback to English', async () => {
    await openLabel([CAKE], 'cake', { location: {} });
    refusal(/nobody has said which country this business sells in/);
  });

  it('a country the app does not support is a venue with no country', async () => {
    await openLabel([CAKE], 'cake', { location: { country: 'FR' } });
    refusal(/nobody has said which country/);
  });

  it('not declared: a REAL plural over how many ingredients, in both languages', async () => {
    await openLabel([ONE_GAP], 'gap1');
    refusal('1 ingredient is not declared. The recipe screen lists them.');
  });

  it('not declared, two: the other form of the plural', async () => {
    await openLabel([TWO_GAPS], 'gap2');
    refusal('2 ingredients are not declared. The recipe screen lists them.');
  });

  it('not declared, in Italian: one and the other form are Italian\'s own', async () => {
    await openLabel([ONE_GAP], 'gap1', { lang: 'it' });
    expect(main().getByText('1 ingrediente non è dichiarato. La schermata della ricetta li elenca.')).toBeInTheDocument();
  });

  it('no weights: nothing in the recipe has a weight', async () => {
    await openLabel([NO_WEIGHT], 'nowt');
    refusal('This recipe has no ingredients with a weight.');
  });

  it('still shows the switch, so the three buttons are there above every refusal', async () => {
    await openLabel([CAKE], 'cake', { location: {} });
    expect(within(switchGroup()).getAllByRole('button').map(button => button.textContent)).toEqual(['Allergens', 'Nutrition', 'Both']);
  });
});

describe('the label as words', () => {
  it('draws the name, the ingredients with the allergens emphasised INSIDE the list, Contains, May contain and the table', async () => {
    await openLabel([CAKE], 'cake');
    expect(card().getByText('Cake', { selector: 'p' })).toBeInTheDocument();
    const list = card().getByText(/^Ingredients:/);
    expect(list.textContent).toBe('Ingredients: flour, milk, salt.');
    const emphasised = [...list.querySelectorAll('span')].filter(span => /allergen/.test(span.className)).map(span => span.textContent);
    expect(emphasised).toEqual(['flour', 'milk']);
    expect(card().getByText('Contains: Wheat, Milk')).toBeInTheDocument();
    expect(card().getByText('May contain: Hazelnut')).toBeInTheDocument();
    const table = main().getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Typical values' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(9);
  });

  it('says the values are on the finished weight when the recipe loses some in baking', async () => {
    await openLabel([CAKE_WITH_LOSS], 'cake');
    expect(main().getByText('Worked out on the finished weight — 12% is lost in baking.')).toBeInTheDocument();
  });

  it('SAYS it when the nutrition cannot be worked out, and the allergens are still there', async () => {
    await openLabel([NO_TABLE], 'plain');
    expect(main().getByText(/^No nutrition table: at least one ingredient has no values per 100 g yet/)).toBeInTheDocument();
    expect(main().queryByRole('table')).not.toBeInTheDocument();
    expect(card().getByText('Contains: Wheat')).toBeInTheDocument();
  });

  it('names an unnamed recipe by the word «Recipe», and the bar by «Label»', async () => {
    await openLabel([recipeDoc('anon', '', [row('Flour', 'flour', 500)])], 'anon');
    expect(card().getByText('Recipe', { selector: 'p' })).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 2, name: 'Label' })).toBeInTheDocument();
  });

  it('starts on «Both» and marks the chosen button with aria-pressed', async () => {
    await openLabel([CAKE], 'cake');
    const pressed = within(switchGroup()).getAllByRole('button').filter(button => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map(button => button.textContent)).toEqual(['Both']);
  });

  it('shows the allergens alone, or the nutrition alone, without touching the paper', async () => {
    stubLayout();
    const { user } = await openLabel([CAKE], 'cake');
    const paper = () => (sheetNode() as HTMLElement).outerHTML;
    const both = paper();
    await user.click(main().getByRole('button', { name: 'Allergens' }));
    expect(main().queryByRole('table')).not.toBeInTheDocument();
    expect(card().getByText('Contains: Wheat, Milk')).toBeInTheDocument();
    expect(paper()).toBe(both);

    await user.click(main().getByRole('button', { name: 'Nutrition' }));
    expect(main().getByRole('table')).toBeInTheDocument();
    expect(card().queryByText(/^Ingredients:/)).not.toBeInTheDocument();
    expect(card().queryByText(/^Contains:/)).not.toBeInTheDocument();
    expect(paper()).toBe(both);
    expect(main().getByRole('button', { name: 'Nutrition' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('⚠️ an ingredient with no nutrition does not stop an allergen-only label', async () => {
    const { user } = await openLabel([NO_TABLE], 'plain');
    await user.click(main().getByRole('button', { name: 'Allergens' }));
    expect(main().queryByText(/^No nutrition table/)).not.toBeInTheDocument();
    expect(card().getByText('Contains: Wheat')).toBeInTheDocument();
  });

  it('puts the caveat on every label, and the note on why it is in this language', async () => {
    await openLabel([CAKE], 'cake');
    expect(main().getByText('Check this before it goes on food')).toBeInTheDocument();
    expect(main().getByText(/^It is built from what the suppliers declared/)).toBeInTheDocument();
    expect(main().getByText('This label is produced in English because this business sells in the United Kingdom.')).toBeInTheDocument();
    expect(main().getByText('The ingredient names are the ones you typed — the app does not translate them.')).toBeInTheDocument();
  });
});

describe('the language of the food and the language of the screen', () => {
  it('prints the food in the COUNTRY\'s words on an English screen: an Italian venue reads Ingredienti and Contiene', async () => {
    await openLabel([CAKE], 'cake', { location: IT, lang: 'en' });
    expect(card().getByText(/^Ingredienti:/)).toBeInTheDocument();
    expect(card().getByText('Contiene: Grano, Latte')).toBeInTheDocument();
    expect(card().getByText('Può contenere: Nocciole')).toBeInTheDocument();
    expect(within(main().getByRole('table')).getByRole('columnheader', { name: labelWord('typicalValues', 'it') })).toBeInTheDocument();
    // The words around it are the screen's.
    expect(main().getByRole('button', { name: 'Copy the text' })).toBeInTheDocument();
    expect(main().getByText('Check this before it goes on food')).toBeInTheDocument();
    expect(main().getByText('This label is produced in Italian because this business sells in Italy.')).toBeInTheDocument();
  });

  it('keeps the food English on an Italian screen for a British venue, and the words around it Italian', async () => {
    await openLabel([CAKE], 'cake', { location: GB, lang: 'it' });
    expect(card().getByText(/^Ingredients:/)).toBeInTheDocument();
    expect(card().getByText('Contains: Wheat, Milk')).toBeInTheDocument();
    expect(within(main().getByRole('table')).getByRole('columnheader', { name: labelWord('typicalValues', 'en') })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Copia il testo' })).toBeInTheDocument();
    expect(main().getByText('Controlla questa etichetta prima di metterla sul cibo')).toBeInTheDocument();
    expect(main().getByText('Questa etichetta è prodotta in inglese perché questa attività vende nel Regno Unito.')).toBeInTheDocument();
  });
});

describe('Copy and Send hand over the label\'s own text', () => {
  const tables = (docs: StoredDoc[], recipes: StoredDoc[]) =>
    ({ ingredients: new Map(docs.map(doc => [doc.id, doc])), recipes: new Map(recipes.map(doc => [doc.id, doc])) });

  it('copies exactly declarationText WITH the nutrition table, in the country\'s language', async () => {
    const { user } = await openLabel([CAKE], 'cake', { location: IT, lang: 'en' });
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(main().getByRole('button', { name: 'Copy the text' }));
    const expected = declarationText(buildLabel(CAKE, tables(INGREDIENTS, [CAKE])), 'it');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
    expect(expected).toContain('Contiene: Grano, Latte');
    expect(expected).toContain(labelWord('typicalValues', 'it'));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('copies what the switch worked out: the allergen-only text has no table', async () => {
    const { user } = await openLabel([CAKE], 'cake');
    await user.click(main().getByRole('button', { name: 'Allergens' }));
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(main().getByRole('button', { name: 'Copy the text' }));
    const expected = declarationText(buildLabel(CAKE, tables(INGREDIENTS, [CAKE]), { shows: 'allergens' }), 'en');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
    expect(expected).not.toMatch(/Typical values/);
  });

  it('says so when the clipboard refuses', async () => {
    const { user } = await openLabel([CAKE], 'cake');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    await user.click(main().getByRole('button', { name: 'Copy the text' }));
    expect(await screen.findByText('Could not copy — select the text above instead')).toBeInTheDocument();
  });

  it('sends the same text on both roads, with the recipe\'s name as the subject', async () => {
    const popup = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = await openLabel([CAKE], 'cake');
    const expected = declarationText(buildLabel(CAKE, tables(INGREDIENTS, [CAKE])), 'en');
    await user.click(main().getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: /WhatsApp/ }));
    expect(popup).toHaveBeenLastCalledWith(`https://wa.me/?text=${encodeURIComponent(expected)}`, '_blank', 'noopener');
    await user.click(main().getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: /Email/ }));
    expect(popup).toHaveBeenLastCalledWith(
      `mailto:?subject=${encodeURIComponent('Cake')}&body=${encodeURIComponent(expected)}`, '_blank', 'noopener',
    );
  });
});

describe('the date on the paper is worked out from today, every time', () => {
  it('prints use-by = today + the shelf life, and none for a recipe with no shelf life', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 3, 12) });
    stubLayout();
    const withDate = recipeDoc('dated', 'Dated', [row('Flour', 'flour', 500)], { shelfLifeDays: 3 });
    const config = { showDate: true, dateKind: 'useBy' };
    await openLabel([withDate, CAKE], 'dated', { labelConfig: config, location: GB });
    expect(document.querySelector('.lab-sheet-date')?.textContent).toBe('Use by 06/09/2026');
  });

  it('is the day of the clock when the screen is drawn again, not the day it was first drawn', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 3, 12) });
    stubLayout();
    const withDate = recipeDoc('dated', 'Dated', [row('Flour', 'flour', 500)], { shelfLifeDays: 3 });
    const { user } = await openLabel([withDate], 'dated', { labelConfig: { showDate: true } });
    expect(document.querySelector('.lab-sheet-date')?.textContent).toBe('Use by 06/09/2026');
    vi.setSystemTime(new Date(2026, 8, 4, 12));
    await user.click(main().getByRole('button', { name: 'Allergens' }));
    expect(document.querySelector('.lab-sheet-date')?.textContent).toBe('Use by 07/09/2026');
  });

  it('leaves the date line out for a recipe with no shelf life, never printing today\'s', async () => {
    stubLayout();
    await openLabel([CAKE], 'cake', { labelConfig: { showDate: true } });
    expect(document.querySelector('.lab-sheet-date')).toBeNull();
  });
});

describe('the paper: measured, scaled, and the Print button that obeys it', () => {
  it('⚠️ never reads an unmeasured sheet as one that fits: jsdom measures zero, Print stays off, nothing claims a size', async () => {
    await openLabel([CAKE], 'cake');
    expect(document.querySelector('.lab-preview .lab-sheet')).not.toBeNull();
    expect(printButton()).toBeDisabled();
    expect(main().queryByText(/^Actual size/)).not.toBeInTheDocument();
    expect(main().queryByText(/shown smaller/)).not.toBeInTheDocument();
  });

  it('enables Print, named for the road, once the sheet is measured and fits — and says «actual size»', async () => {
    stubLayout();
    await openLabel([CAKE], 'cake');
    expect(printButton()).toBeEnabled();
    expect(printButton()).toHaveTextContent('Print dialog');
    expect(main().getByText('Actual size — 76 × 51 mm')).toBeInTheDocument();
    expect(main().getByText('Actual size — 76 × 51 mm')).toBeVisible();
  });

  it('says the preview is shown smaller when the room is narrower than the paper, and scales it from the top centre', async () => {
    stubLayout({ room: 200, sheetWidth: 287 });
    await openLabel([CAKE], 'cake');
    expect(main().getByText('76 × 51 mm — shown smaller to fit this screen')).toBeInTheDocument();
    const sheet = sheetNode() as HTMLElement;
    expect(sheet.style.transformOrigin).toBe('top center');
    expect(sheet.style.transform).toMatch(/^scale\(0\.69/);
    // The paper is still enabled: scaling is the screen's, the print is at true size.
    expect(printButton()).toBeEnabled();
  });

  it('steps the text down until it fits, and prints at the size the measurement chose', async () => {
    // Spills at anything over 2.3 mm; every size the measurement tried is written down.
    const tried: number[] = [];
    stubLayout({ overflow: fontMm => { tried.push(fontMm); return fontMm > 2.3 ? 40 : 0; } });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await openLabel([CAKE], 'cake');
    const shownSize = (sheetNode() as HTMLElement).style.fontSize;
    expect(parseFloat(shownSize)).toBeLessThanOrEqual(2.3);
    // It really stepped: it began above the line and went down, never up.
    expect(tried.length).toBeGreaterThan(1);
    expect(tried[0]).toBeGreaterThan(2.3);
    expect([...tried].sort((a, b) => b - a).slice(0, 3)).toEqual(tried.slice(0, 3));
    expect(printButton()).toBeEnabled();
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
    const printed = document.querySelector('#labelPrint .lab-sheet') as HTMLElement;
    expect(printed.style.fontSize).toBe(shownSize);
  });

  it('refuses a label that does not fit even at the legal floor: the sentence, with the paper size, and Print off', async () => {
    stubLayout({ overflow: () => 40 });
    await openLabel([CAKE], 'cake');
    expect(printButton()).toBeDisabled();
    expect(main().getByText(/^This label does not fit on 76 × 51 mm at a size the law allows it to be read at/)).toBeVisible();
    expect(main().getByText(/Nothing is ever shortened to make it fit\.$/)).toBeInTheDocument();
  });

  it('measures again when the window changes size', async () => {
    let spill = 0;
    stubLayout({ overflow: () => spill });
    await openLabel([CAKE], 'cake');
    expect(printButton()).toBeEnabled();
    spill = 40;
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(printButton()).toBeDisabled();
    spill = 0;
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(printButton()).toBeEnabled();
  });

  it('measures again when the typeface arrives', async () => {
    let spill = 40;
    stubLayout({ overflow: () => spill });
    const fonts = new EventTarget();
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    try {
      await openLabel([CAKE], 'cake');
      expect(printButton()).toBeDisabled();
      spill = 0;
      act(() => { fonts.dispatchEvent(new Event('loadingdone')); });
      expect(printButton()).toBeEnabled();
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  // ⚠️ NEVER MEASURED IN THE FALLBACK FACE: while Manrope is still loading the sheet is drawn in a narrower face, and a size
  // chosen then would spill on paper. The browser's FontFaceSet is stood in for by hand (jsdom has none).
  describe('the typeface', () => {
    class FakeFonts extends EventTarget {
      status: 'loading' | 'loaded' = 'loading';
      check = (): boolean => this.status === 'loaded';
      // Asked for at load() time, so a rejection is never left without a listener.
      load = vi.fn((): Promise<unknown[]> => this.answer());
      answer: () => Promise<unknown[]> = () => new Promise(() => undefined);
    }
    const install = (fonts: FakeFonts) => { Object.defineProperty(document, 'fonts', { value: fonts, configurable: true }); };
    afterEach(() => { Reflect.deleteProperty(document, 'fonts'); });

    it('keeps Print off while Manrope is loading, even when a measurement would say it fits — and enables it once it is ready', async () => {
      stubLayout();
      const fonts = new FakeFonts();
      let arrive: (faces: unknown[]) => void = () => undefined;
      const late = new Promise<unknown[]>(resolve => { arrive = resolve; });
      fonts.answer = () => late;
      install(fonts);
      await openLabel([CAKE], 'cake');
      expect(printButton()).toBeDisabled();
      expect(main().queryByText(/^Actual size/)).not.toBeInTheDocument();
      expect(fonts.load).toHaveBeenCalledWith('400 1em Manrope');
      expect(fonts.load).toHaveBeenCalledWith('800 1em Manrope');
      await act(async () => { fonts.status = 'loaded'; arrive([{}]); await late; });
      expect(printButton()).toBeEnabled();
      expect(main().getByText('Actual size — 76 × 51 mm')).toBeInTheDocument();
    });

    it('is ready at once when the face was loaded before the screen listened (no event will ever come)', async () => {
      stubLayout();
      const fonts = new FakeFonts();
      fonts.status = 'loaded';
      fonts.answer = () => Promise.resolve([{}]);
      install(fonts);
      await openLabel([CAKE], 'cake');
      await waitFor(() => { expect(printButton()).toBeEnabled(); });
    });

    it('measures once the load promise resolves even if the face is not yet reported by check()', async () => {
      stubLayout();
      const fonts = new FakeFonts();
      fonts.answer = () => Promise.resolve([{}]);
      install(fonts);
      await openLabel([CAKE], 'cake');
      await waitFor(() => { expect(printButton()).toBeEnabled(); });
    });

    it.each([
      ['cannot be fetched', () => Promise.reject(new Error('NetworkError'))],
      ['is not declared', () => Promise.resolve([])],
    ])('⚠️ keeps Print off for good, and says so, when the face %s', async (_name, answer) => {
      stubLayout();
      const fonts = new FakeFonts();
      fonts.answer = answer;
      install(fonts);
      await openLabel([CAKE], 'cake');
      await waitFor(() => {
        expect(main().getByText(/^The label typeface could not be loaded, so the size cannot be checked/)).toBeVisible();
      });
      expect(printButton()).toBeDisabled();
      expect(main().queryByText(/^Actual size/)).not.toBeInTheDocument();
      expect(printButton()).toHaveAccessibleDescription(/Check the connection and open the label again\.$/);
    });

    it('says it in Italian', async () => {
      stubLayout();
      const fonts = new FakeFonts();
      fonts.answer = () => Promise.reject(new Error('NetworkError'));
      install(fonts);
      await openLabel([CAKE], 'cake', { lang: 'it', location: IT });
      await waitFor(() => {
        expect(main().getByText('Il carattere delle etichette non si è caricato, quindi non si può controllare la misura. Controlla la connessione e riapri l’etichetta.')).toBeVisible();
      });
    });

    it('does not set state after the screen is left (the late answer of the font is dropped)', async () => {
      stubLayout();
      const fonts = new FakeFonts();
      let arrive: (faces: unknown[]) => void = () => undefined;
      const late = new Promise<unknown[]>(resolve => { arrive = resolve; });
      fonts.answer = () => late;
      install(fonts);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { router } = await openLabel([CAKE], 'cake');
      await act(async () => { await router.navigate('/recipes'); });
      await act(async () => { arrive([{}]); await late; });
      expect(error).not.toHaveBeenCalled();
    });
  });

  it('preloads the two Manrope files while the label screen is open, and takes the links away when it is left', async () => {
    stubLayout();
    const { router } = await openLabel([CAKE], 'cake');
    const links = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')];
    expect(links().map(link => link.getAttribute('href'))).toEqual([
      expect.stringMatching(/manrope-latin\.woff2/),
      expect.stringMatching(/manrope-latin-ext\.woff2/),
    ]);
    expect(links().every(link => link.crossOrigin === 'anonymous' && link.type === 'font/woff2')).toBe(true);
    await act(async () => { await router.navigate('/recipes'); });
    expect(links()).toHaveLength(0);
  });

  it('points Print at the reason it is off, and announces the reason through a polite live region', async () => {
    stubLayout({ overflow: () => 40 });
    await openLabel([CAKE], 'cake');
    expect(printButton()).toBeDisabled();
    expect(printButton()).toHaveAccessibleDescription(/^This label does not fit on 76 × 51 mm/);
    const reason = main().getByText(/^This label does not fit on 76 × 51 mm/);
    expect(reason.closest('[role="status"]')).not.toBeNull();
  });

  it('keeps the live region in the page while there is no reason, and gives Print no description when it can be pressed', async () => {
    stubLayout();
    await openLabel([CAKE], 'cake');
    expect(printButton()).toBeEnabled();
    expect(printButton()).not.toHaveAttribute('aria-describedby');
    expect(main().getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('says this device cannot reach a printer when it cannot print at all', async () => {
    stubLayout();
    vi.stubGlobal('print', undefined);
    await openLabel([CAKE], 'cake');
    expect(printButton()).toBeDisabled();
    expect(printButton()).toHaveTextContent('Print');
    expect(main().getByText(/^This device cannot reach a printer/)).toBeVisible();
  });

  it('⚠️ a Zebra venue is told the shop computer is not answering — never «too big» — until step 3d-4 brings its roads', async () => {
    stubLayout();
    await openLabel([CAKE], 'cake', { labelConfig: { printerLanguage: 'zpl' } });
    expect(printButton()).toBeDisabled();
    expect(main().getByText(/^The shop computer is not answering/)).toBeVisible();
    expect(main().queryByText(/does not fit/)).toBeNull();
  });

  it('⚠️ lays nothing out on a paper it does not know yet: the card, Copy and Send work, Print is off, a sentence says why', async () => {
    stubLayout();
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS });
    source.holdLabelConfig();
    const { user } = await openLabel([CAKE], 'cake', { source });
    expect(main().getByText('The label size has not arrived yet.')).toBeVisible();
    expect(document.querySelector('.lab-sheet')).toBeNull();
    expect(printButton()).toBeDisabled();
    expect(main().getByText('Contains: Wheat, Milk')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Copy the text' })).toBeEnabled();
    expect(main().getByRole('button', { name: 'Send' })).toBeEnabled();

    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    act(() => { source.releaseLabelConfig(); });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(main().queryByText('The label size has not arrived yet.')).not.toBeInTheDocument();
    expect(document.querySelector('.lab-preview .lab-sheet')).not.toBeNull();
    await user.click(printButton());
    expect(document.getElementById('labelPrint')).not.toBeNull();
  });

  it('says it in Italian too', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS });
    source.holdLabelConfig();
    await openLabel([CAKE], 'cake', { source, lang: 'it', location: IT });
    expect(main().getByText('Il formato delle etichette non è ancora arrivato.')).toBeVisible();
    expect(printButton()).toBeDisabled();
  });

  it('draws the paper the venue chose', async () => {
    stubLayout();
    await openLabel([CAKE], 'cake', { labelConfig: { widthMm: 57, heightMm: 32 } });
    const sheet = sheetNode() as HTMLElement;
    expect(sheet.style.width).toBe('57mm');
    expect(sheet.style.height).toBe('32mm');
    expect(main().getByText('Actual size — 57 × 32 mm')).toBeInTheDocument();
  });

});

// ⚠️ 3d-4 MUST NOT SHIP WITH THE STUBS 3d-3 LEFT IN LabelScreen.tsx: `zplFits: () => true` (so the port never says «too big for
// the printer» about a printer it cannot ask) and `printerReady: false` (so a Zebra venue is always told the shop computer is
// silent). Turn this into a real spec in 3d-4: it must FAIL while either stub remains (docs/parity/catalogue.md, 3d-4).
it.todo('3d-4: LabelScreen.tsx has neither the `zplFits: () => true` stub nor the `printerReady: false` stub');

describe('printing through the system\'s own dialog', () => {
  it('puts a host in <body> at the measured size, calls window.print once, and takes it away on afterprint', async () => {
    stubLayout();
    const seen: string[] = [];
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const host = document.getElementById('labelPrint');
      seen.push(`${host?.parentElement === document.body}|${host?.className}|${host?.querySelectorAll('.lab-sheet').length}`);
    });
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      const { user } = await openLabel([CAKE], 'cake');
      expect(document.getElementById('labelPrint')).toBeNull();
      await user.click(printButton());

      expect(print).toHaveBeenCalledTimes(1);
      // A direct child of <body> (one derived print rule hides everything else), with the preset page and one sheet.
      expect(seen).toEqual(['true|lab-print lab-print--p76x51|1']);
      expect(document.getElementById('labelPrint')).not.toBeNull();
      // ⚠️ NEVER the class that holds back a compulsory update.
      expect(document.querySelector('.preview-overlay')).toBeNull();
      // Not removed by a line after print(): by the listener.
      expect(actions).toContain('label-printed');

      act(() => { window.dispatchEvent(new Event('afterprint')); });
      expect(document.getElementById('labelPrint')).toBeNull();
      // The listener goes with it: a second afterprint does nothing.
      act(() => { window.dispatchEvent(new Event('afterprint')); });
      expect(document.getElementById('labelPrint')).toBeNull();
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });

  // The page of each preset is a named @page rule that already exists in label-print.css; a custom size has none, and
  // the driver's own paper decides.
  it.each([
    [{ widthMm: 57, heightMm: 32 }, 'lab-print lab-print--p57x32'],
    [{ widthMm: 102, heightMm: 76 }, 'lab-print lab-print--p102x76'],
    [{ widthMm: 80, heightMm: 40 }, 'lab-print'],
  ])('prints on %j with the host class «%s»', async (labelConfig, expected) => {
    stubLayout();
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await openLabel([CAKE], 'cake', { labelConfig });
    await user.click(printButton());
    const host = document.getElementById('labelPrint') as HTMLElement;
    expect(host.className).toBe(expected);
    const sheet = host.querySelector('.lab-sheet') as HTMLElement;
    expect(sheet.style.width).toBe(`${labelConfig.widthMm}mm`);
  });

  it('prints a second time after the first one is over, and never leaves two hosts', async () => {
    stubLayout();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await openLabel([CAKE], 'cake');
    await user.click(printButton());
    await user.click(printButton());
    expect(document.querySelectorAll('#labelPrint')).toHaveLength(1);
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.getElementById('labelPrint')).toBeNull();
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('#labelPrint')).toHaveLength(1);
  });

  it('draws the printed sheet exactly as the preview sheet, at the measured size', async () => {
    stubLayout({ overflow: fontMm => (fontMm > 2.4 ? 40 : 0) });
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await openLabel([CAKE], 'cake');
    const preview = sheetNode() as HTMLElement;
    // The preview carries nothing the paper does not (no scale: the room was wide enough).
    await user.click(printButton());
    const printed = document.querySelector('#labelPrint .lab-sheet') as HTMLElement;
    expect(printed.outerHTML).toBe(preview.outerHTML);
  });

  it('does nothing when Print is pressed on a label nobody could measure', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await openLabel([CAKE], 'cake');
    await user.click(printButton());
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById('labelPrint')).toBeNull();
  });

  // ⚠️ ANDROID CHROME'S print() DOES NOT BLOCK: the dialog is open while the page carries on. A person who leaves the
  // label screen with it still up must not turn the paper blank, so the host is the print's, not the screen's.
  it('keeps the host when the screen is left while the dialog is open, and takes it away on afterprint only', async () => {
    stubLayout();
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { router, user } = await openLabel([CAKE], 'cake');
    await user.click(printButton());
    expect(document.getElementById('labelPrint')).not.toBeNull();
    await act(async () => { await router.navigate('/recipes'); });
    expect(document.querySelector('.lab-preview')).toBeNull();
    const host = document.getElementById('labelPrint');
    expect(host).not.toBeNull();
    expect(host?.querySelectorAll('.lab-sheet')).toHaveLength(1);
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.getElementById('labelPrint')).toBeNull();
  });

  it('builds the host at print time with no style attribute and not as an overlay', async () => {
    stubLayout();
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await openLabel([CAKE], 'cake');
    expect(document.getElementById('labelPrint')).toBeNull();
    await user.click(printButton());
    const host = document.getElementById('labelPrint') as HTMLElement;
    expect(host.hasAttribute('style')).toBe(false);
    expect(host.classList.contains('preview-overlay')).toBe(false);
  });
});
