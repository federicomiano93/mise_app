import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { buildLabel, declarationText } from '@mise/shared/recipe-label-model';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';

// The recipe screen's two allergen cards: the allergen card and the ingredient declaration.
// ⚠️ This is the part of the app that can send somebody to hospital: every verdict below is the shared
// model's, and the screens are only checked for drawing it faithfully.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  window.localStorage.clear();
});

const STAMP = '2026-01-01';
const ingredient = (id: string, fields: Record<string, unknown> = {}): StoredDoc => ({ id, name: id, ...fields });
const declared = (id: string, allergens: string[], extra: Record<string, unknown> = {}): StoredDoc =>
  ingredient(id, { allergens, allergensCheckedAt: STAMP, ...extra });

const FLOUR = declared('flour', ['gluten-wheat']);
const MILK = declared('milk', ['milk'], { mayContain: ['nuts-hazelnut'] });
const SALT = declared('salt', []);
// Nobody has said anything about it: no stamp, whatever the list holds.
const YEAST = ingredient('yeast', { allergens: [] });

const row = (label: string, refId?: string, grams = 100, extra: Record<string, unknown> = {}) =>
  ({ label, grams, unit: 'g', ...(refId === undefined ? {} : { refId }), ...extra });
const recipeDoc = (id: string, name: string, ingredients: unknown[]): StoredDoc => ({ id, name, ingredients });

const CAKE = recipeDoc('cake', 'Cake', [row('Flour', 'flour', 500), row('Milk', 'milk', 300), row('Salt', 'salt', 10)]);
const PLAIN = recipeDoc('plain', 'Plain', [row('Salt', 'salt', 10)]);

const GB = { country: 'GB' };
const IT = { country: 'IT' };

const main = () => within(screen.getByRole('main'));
const algButton = () => main().getByRole('button', { name: /^(Allergens|Allergeni)/ });
const algCard = () => within(algButton().closest('section') as HTMLElement);
const declHeading = () => main().getByRole('heading', { level: 3, name: /^(Ingredient declaration|Dichiarazione ingredienti)$/ });

async function open(
  recipes: StoredDoc[],
  ingredients: StoredDoc[],
  id: string,
  { location = GB, ...options }: { location?: Record<string, unknown>; lang?: 'en' | 'it'; source?: ReturnType<typeof fakeRecipesSource> } = {},
) {
  const source = options.source ?? fakeRecipesSource({ recipes, ingredients });
  const view = renderRecipes(`/recipes/${id}`, { ...options, source, session: { location, language: options.lang ?? 'en' } });
  await screen.findByRole('table', undefined, LOAD);
  return { ...view, source };
}

describe('the allergen card of a complete recipe', () => {
  it('names what it contains OUTSIDE the fold, and folds the traces and the caveat away', async () => {
    await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    expect(await screen.findByText('Wheat, Milk')).toBeVisible();
    expect(algButton()).toHaveAccessibleName('Allergens fully declared');
    expect(algButton()).toHaveAttribute('aria-expanded', 'false');
    // The job folds away, the answer does not.
    expect(algCard().getByText('May contain: Hazelnut')).not.toBeVisible();
    expect(algCard().getByText('From the suppliers’ specifications. It does not cover what your own kitchen may add.')).not.toBeVisible();
  });

  it('is a real heading with the disclosure button inside it, and opens CLOSED', async () => {
    const { user } = await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    await screen.findByText('Wheat, Milk');
    expect(main().getByRole('heading', { level: 3, name: /Allergens/ })).toContainElement(algButton());
    await user.click(algButton());
    expect(algButton()).toHaveAttribute('aria-expanded', 'true');
    expect(algCard().getByText('May contain: Hazelnut')).toBeVisible();
    expect(algCard().getByText(/From the suppliers’ specifications/)).toBeVisible();
    await user.click(algButton());
    expect(algCard().getByText('May contain: Hazelnut')).not.toBeVisible();
  });

  it('offers «Make a label» inside the fold, with the rest of the job (the label screen has its own spec)', async () => {
    const { user } = await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    await screen.findByText('Wheat, Milk');
    expect(main().getByText('Make a label')).not.toBeVisible();
    await user.click(algButton());
    expect(main().getByRole('button', { name: 'Make a label' })).toBeVisible();
  });

  it('says «None of the 14» only for a recipe whose every ingredient has been checked and contains none', async () => {
    await open([PLAIN], [SALT], 'plain');
    expect(await screen.findByText('None of the 14')).toBeVisible();
    expect(algButton()).toHaveAccessibleName('Allergens fully declared');
  });
});

describe('the allergen card of an incomplete recipe', () => {
  const unlinked = Array.from({ length: 10 }, (_, index) => row(`Thing ${index + 1}`));
  const MANY = recipeDoc('many', 'Many', [row('Flour', 'flour', 500), ...unlinked]);

  it('says «not declared» in the head as a WORD, with the answer nowhere on the screen', async () => {
    await open([MANY], [FLOUR], 'many');
    expect(await screen.findByRole('button', { name: 'Allergens not declared' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('None of the 14')).not.toBeInTheDocument();
    // What is known so far is behind the fold, marked as NOT an answer.
    expect(screen.getByText(/This is NOT the full list/)).not.toBeVisible();
  });

  it('opens on the sentence, the first eight rows with their reason, «and N more», and what is known so far', async () => {
    const { user } = await open([MANY], [FLOUR], 'many');
    await user.click(await screen.findByRole('button', { name: 'Allergens not declared' }));
    expect(screen.getByText('10 ingredients are not declared — no label can be made')).toBeVisible();
    for (let n = 1; n <= 8; n += 1) {
      expect(screen.getByText(`Thing ${n} — not linked to an ingredient`)).toBeVisible();
    }
    expect(algCard().queryByText(/Thing 9/)).not.toBeInTheDocument();
    expect(screen.getByText('…and 2 more')).toBeVisible();
    expect(screen.getByText('So far, from the rows that are declared: Wheat. This is NOT the full list.')).toBeVisible();
  });

  it('says one ingredient in the singular', async () => {
    const { user } = await open([recipeDoc('one', 'One', [row('Flour', 'flour'), row('Mystery')])], [FLOUR], 'one');
    await user.click(await screen.findByRole('button', { name: 'Allergens not declared' }));
    expect(screen.getByText('1 ingredient is not declared — no label can be made')).toBeVisible();
    expect(screen.queryByText(/and \d+ more/)).not.toBeInTheDocument();
  });

  it('⚠️ an ingredient nobody has checked is NEVER «None of the 14»', async () => {
    const { user } = await open([recipeDoc('y', 'Y', [row('Yeast', 'yeast', 10), row('Salt', 'salt', 10)])], [YEAST, SALT], 'y');
    await user.click(await screen.findByRole('button', { name: 'Allergens not declared' }));
    expect(screen.getByText('Yeast — the linked ingredient has no allergen information yet')).toBeVisible();
    expect(screen.queryByText('None of the 14')).not.toBeInTheDocument();
  });

  it('names a link to a deleted ingredient and a sub-recipe that is not fully declared', async () => {
    const SUB = recipeDoc('sub', 'Sub', [row('Mystery')]);
    const TOP = recipeDoc('top', 'Top', [
      row('Gone', 'gone'),
      row('Filling', 'sub', 100, { kind: 'recipe' }),
      row('Salt', 'salt'),
    ]);
    const { user } = await open([TOP, SUB], [SALT], 'top');
    await user.click(await screen.findByRole('button', { name: 'Allergens not declared' }));
    expect(screen.getByText('Gone — linked to an ingredient that no longer exists')).toBeVisible();
    expect(screen.getByText('Filling — the linked recipe is not fully declared')).toBeVisible();
  });

  it('reads a sub-recipe that is fully declared into the recipe above it', async () => {
    const SUB = recipeDoc('sub', 'Sub', [row('Milk', 'milk', 100)]);
    const TOP = recipeDoc('top', 'Top', [row('Filling', 'sub', 100, { kind: 'recipe' }), row('Flour', 'flour', 200)]);
    await open([TOP, SUB], [FLOUR, MILK], 'top');
    expect(await screen.findByText('Wheat, Milk')).toBeVisible();
  });

  it('keeps both cards silent for a recipe with no rows', async () => {
    await open([recipeDoc('empty', 'Empty', [])], [FLOUR], 'empty');
    expect(main().queryByRole('heading', { level: 3, name: 'Ingredient declaration' })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: /^Allergens/ })).not.toBeInTheDocument();
    expect(main().queryByRole('heading', { level: 3, name: /^Allergens/ })).not.toBeInTheDocument();
  });
});

describe('the venue switch, and the wait for the ingredients', () => {
  it('draws neither card when the venue has switched allergens off', async () => {
    await open([CAKE], [FLOUR, MILK, SALT], 'cake', { location: { country: 'GB', showAllergens: false } });
    expect(main().queryByRole('heading', { level: 3, name: /Allergens|Ingredient declaration/ })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: /Copy|Send/ })).not.toBeInTheDocument();
  });

  it('⚠️ gives NO verdict and no buttons until the ingredients have arrived, then draws it', async () => {
    // The recipe is on the phone already (its own copy), the ingredients are not: a cold start.
    window.localStorage.setItem('catalogue-recipes', JSON.stringify([CAKE]));
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: [FLOUR, MILK, SALT] });
    source.hold();
    renderRecipes('/recipes/cake', { source, session: { location: GB } });
    await screen.findByRole('table', undefined, LOAD);

    expect(await screen.findAllByText('Checking the allergens…')).toHaveLength(2);
    expect(main().queryByRole('button', { name: /^Allergens/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/not declared/)).not.toBeInTheDocument();
    expect(screen.queryByText('None of the 14')).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: /Copy|Send/ })).not.toBeInTheDocument();
    // The cards are there, with their headings, so the screen does not jump when the answer comes.
    expect(main().getByRole('heading', { level: 3, name: 'Allergens' })).toBeInTheDocument();

    act(() => { source.release(); });
    expect(await screen.findByText('Wheat, Milk')).toBeVisible();
    expect(screen.queryByText('Checking the allergens…')).not.toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('says «Checking the allergens…» in Italian on an Italian screen', async () => {
    window.localStorage.setItem('catalogue-recipes', JSON.stringify([CAKE]));
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: [FLOUR] });
    source.hold();
    renderRecipes('/recipes/cake', { source, lang: 'it', session: { location: IT, language: 'it' } });
    expect(await screen.findAllByText('Sto controllando gli allergeni…', undefined, LOAD)).toHaveLength(2);
  });

  it('⚠️ reads a refused ingredients stream with nothing stored as «not declared», with no buttons', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: [FLOUR, MILK, SALT] });
    source.refuse.ingredients = true;
    const { user } = await open([CAKE], [], 'cake', { source });
    await user.click(await screen.findByRole('button', { name: 'Allergens not declared' }));
    // Nothing was ever held, so the per-row reasons would all be untrue: one line says it (see the review spec).
    expect(screen.getByText('The ingredient list could not be read, so the allergens cannot be checked.')).toBeVisible();
    expect(screen.getByText('Not ready yet — some ingredients are still to be declared. The allergen card above says which.')).toBeVisible();
    expect(main().queryByRole('button', { name: /Copy|Send/ })).not.toBeInTheDocument();
  });
});

describe('the declaration card', () => {
  it('lists the ingredients heaviest first with the allergen rows emphasised INSIDE the list', async () => {
    await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    await screen.findByText('Wheat, Milk');
    const card = declHeading().closest('section');
    if (card === null) throw new Error('no declaration card');
    const list = card.querySelector('p');
    expect(list?.textContent).toBe('flour, milk, salt.');
    expect(within(card).getByText('flour').closest('strong')).not.toBeNull();
    expect(within(card).getByText('milk').closest('strong')).not.toBeNull();
    expect(within(card).getByText('salt').closest('strong')).toBeNull();
    expect(within(card).getByText('Contains: Wheat, Milk')).toBeVisible();
    expect(within(card).getByText('May contain: Hazelnut')).toBeVisible();
    expect(within(card).getByText(/A draft for you to check/)).toBeVisible();
  });

  it('⚠️ is ONE line and NO Copy and NO Send when the recipe cannot be declared', async () => {
    await open([recipeDoc('half', 'Half', [row('Flour', 'flour'), row('Mystery')])], [FLOUR], 'half');
    expect(await screen.findByText('Not ready yet — some ingredients are still to be declared. The allergen card above says which.')).toBeVisible();
    expect(main().queryByRole('button', { name: /Copy|Send/ })).not.toBeInTheDocument();
    expect(main().queryByText(/^Contains/)).not.toBeInTheDocument();
  });

  it('copies exactly the declaration text without the nutrition table', async () => {
    const nutrition = { kj: 1, kcal: 1, fat: 1, saturates: 1, carbs: 1, sugars: 1, protein: 1, salt: 1 };
    const flour = declared('flour', ['gluten-wheat'], { nutrition });
    const milk = declared('milk', ['milk'], { mayContain: ['nuts-hazelnut'], nutrition });
    const salt = declared('salt', [], { nutrition });
    const { user } = await open([CAKE], [flour, milk, salt], 'cake');
    await screen.findByText('Wheat, Milk');
    // After the render: user-event installs its own clipboard when it is set up.
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await user.click(main().getByRole('button', { name: 'Copy' }));

    const tables = { ingredients: new Map([flour, milk, salt].map(doc => [doc.id, doc])), recipes: new Map([[CAKE.id, CAKE]]) };
    const label = buildLabel(CAKE, tables);
    const expected = declarationText(label, 'en', { withNutrition: false });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
    expect(expected).toContain('Contains: Wheat, Milk');
    // The same label WITH its table is longer: the message leaves it out.
    expect(declarationText(label, 'en')).not.toBe(expected);
    expect(writeText.mock.calls[0]?.[0]).not.toMatch(/Typical values|per 100 g|Energy/);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('says so when the clipboard refuses', async () => {
    const { user } = await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    await screen.findByText('Wheat, Milk');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    await user.click(main().getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Could not copy — select the text above instead')).toBeInTheDocument();
  });

  it('hands the same text to the send sheet, on both roads, and names no WhatsApp or Email button of its own', async () => {
    const popup = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    await screen.findByText('Wheat, Milk');
    expect(main().queryByRole('button', { name: /whatsapp|email/i })).not.toBeInTheDocument();

    const tables = { ingredients: new Map([FLOUR, MILK, SALT].map(doc => [doc.id, doc])), recipes: new Map([[CAKE.id, CAKE]]) };
    const expected = declarationText(buildLabel(CAKE, tables), 'en', { withNutrition: false });

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

describe('the language of the food and the language of the screen', () => {
  it('names the food in the COUNTRY\'s words on an English screen: an Italian venue reads «Grano, Latte»', async () => {
    const { user } = await open([CAKE], [FLOUR, MILK, SALT], 'cake', { location: IT, lang: 'en' });
    expect(await screen.findByText('Grano, Latte')).toBeVisible();
    // The words around the food are the screen's.
    expect(algButton()).toHaveAccessibleName('Allergens fully declared');
    await user.click(algButton());
    expect(screen.getByText('May contain: Nocciole')).toBeVisible();
    expect(screen.getByText('Contiene: Grano, Latte')).toBeVisible();
    expect(screen.getByText(/^A draft for you to check/)).toBeVisible();
  });

  it('keeps the food English on an Italian screen for a British venue, and the words around it Italian', async () => {
    const { user } = await open([CAKE], [FLOUR, MILK, SALT], 'cake', { location: GB, lang: 'it' });
    expect(await screen.findByText('Wheat, Milk')).toBeVisible();
    expect(algButton()).toHaveAccessibleName('Allergeni dichiarati');
    await user.click(algButton());
    // The words around the food are the screen's; the label's own words («Contains») are the country's.
    expect(screen.getByText('Può contenere: Hazelnut')).toBeVisible();
    expect(screen.getByText('May contain: Hazelnut')).toBeVisible();
    expect(screen.getByText('Contains: Wheat, Milk')).toBeVisible();
    expect(screen.getByText(/^Una bozza da controllare/)).toBeVisible();
  });

  it('sends the declaration in the COUNTRY\'s language, whatever the screen says', async () => {
    const popup = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = await open([CAKE], [FLOUR, MILK, SALT], 'cake', { location: IT, lang: 'en' });
    await screen.findByText('Grano, Latte');
    await user.click(main().getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: /WhatsApp/ }));
    const url = String(popup.mock.calls.at(-1)?.[0]);
    const text = decodeURIComponent(url.slice('https://wa.me/?text='.length));
    expect(text).toContain('Ingredienti:');
    expect(text).toContain('Contiene: Grano, Latte');
    expect(text).not.toContain('Ingredients:');
  });
});

describe('no money on the cards', () => {
  it('shows no price even when the ingredient documents carry one', async () => {
    const priced = (doc: StoredDoc) => ({ ...doc, price: 9.99, pricePerKg: 4.5, packPrice: 12.34, vatRate: 20 });
    await open([CAKE], [FLOUR, MILK, SALT].map(priced), 'cake');
    await screen.findByText('Wheat, Milk');
    const cards = [algButton().closest('section'), declHeading().closest('section')];
    const text = cards.map(card => card?.textContent ?? '').join(' ');
    expect(text).toContain('Wheat, Milk');
    expect(text).not.toMatch(/[£€$]|9\.99|4\.5|12\.34|20 ?%/);
  });
});

describe('the cards follow the live data', () => {
  it('redraws the verdict when an ingredient is declared on another phone, and keeps the focus and the fold', async () => {
    const CAKE_YEAST = recipeDoc('cake', 'Cake', [row('Flour', 'flour', 500), row('Yeast', 'yeast', 10)]);
    const source = fakeRecipesSource({ recipes: [CAKE_YEAST], ingredients: [FLOUR, YEAST] });
    const { user } = await open([], [], 'cake', { source });
    await user.click(await screen.findByRole('button', { name: 'Allergens not declared' }));
    expect(algButton()).toHaveFocus();
    expect(screen.getByText('Yeast — the linked ingredient has no allergen information yet')).toBeVisible();

    source.ingredients.set('yeast', declared('yeast', ['sesame']));
    act(() => { source.push(); });

    expect(await screen.findByText('Wheat, Sesame')).toBeVisible();
    expect(algButton()).toHaveAccessibleName('Allergens fully declared');
    expect(algButton()).toHaveAttribute('aria-expanded', 'true');
    expect(algButton()).toHaveFocus();
    expect(screen.queryByText(/not declared/)).not.toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('turns a declared recipe back into «not declared» when an ingredient loses its stamp', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: [FLOUR, MILK, SALT] });
    await open([CAKE], [], 'cake', { source });
    await screen.findByText('Wheat, Milk');

    source.ingredients.set('milk', ingredient('milk', { allergens: [] }));
    act(() => { source.push(); });

    await waitFor(() => { expect(screen.queryByText('Wheat, Milk')).not.toBeInTheDocument(); });
    expect(algButton()).toHaveAccessibleName('Allergens not declared');
    expect(main().queryByRole('button', { name: /Copy|Send/ })).not.toBeInTheDocument();
  });

  it('opens CLOSED for another recipe, and for the same recipe opened again', async () => {
    const OTHER = recipeDoc('other', 'Other', [row('Flour', 'flour', 500)]);
    const { user, router } = await open([CAKE, OTHER], [FLOUR, MILK, SALT], 'cake');
    await user.click(await screen.findByRole('button', { name: /^Allergens/ }));
    expect(algButton()).toHaveAttribute('aria-expanded', 'true');

    await act(async () => { await router.navigate('/recipes/other'); });
    await screen.findByRole('heading', { level: 2, name: 'Other' });
    expect(algButton()).toHaveAttribute('aria-expanded', 'false');

    await act(async () => { await router.navigate('/recipes/cake'); });
    await screen.findByRole('heading', { level: 2, name: 'Cake' });
    expect(algButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('stops drawing the cards when the venue switches allergens off while the recipe is open', async () => {
    const { store } = await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    await screen.findByText('Wheat, Milk');
    act(() => { store.set({ location: { country: 'GB', showAllergens: false } }); });
    await waitFor(() => { expect(main().queryByRole('heading', { level: 3, name: /Allergens/ })).not.toBeInTheDocument(); });
    expect(main().queryByRole('heading', { level: 3, name: 'Ingredient declaration' })).not.toBeInTheDocument();
  });
});

describe('the order of the cards', () => {
  it('is the current app\'s plus the Food cost card (3d-7): ingredients, batch, food cost, allergens, declaration', async () => {
    await open([CAKE], [FLOUR, MILK, SALT], 'cake');
    await screen.findByText('Wheat, Milk');
    const heads = main().getAllByRole('heading', { level: 3 }).map(node => node.textContent ?? '');
    expect(heads).toHaveLength(5);
    expect(heads[0]).toBe('Ingredients');
    expect(heads[1]).toBe('Batch weight');
    expect(heads[2]).toBe('Food cost');
    expect(heads[3]).toMatch(/^Allergens/);
    expect(heads[4]).toBe('Ingredient declaration');
  });
});
