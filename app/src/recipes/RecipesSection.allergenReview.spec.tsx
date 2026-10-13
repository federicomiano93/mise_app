import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';
import { STILL_WAITING_MS } from './useStillWaiting';

// The review fixes of step 3d-2, on the real screens: no declaration without a country, a recipe with nothing weighed,
// an ingredient list that could never be read, the wait that never ends offline, and a sheet that does not claim
// «every recipe can be labelled» from a partial first answer. ⚠️ Every verdict is still the shared model's: these specs
// check what the screens SAY around it, and that no button appears where no declaration may be made.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const STAMP = '2026-01-01';
const ingredient = (id: string, fields: Record<string, unknown> = {}): StoredDoc => ({ id, name: id, ...fields });
const declared = (id: string, allergens: string[]): StoredDoc => ingredient(id, { allergens, allergensCheckedAt: STAMP });
const FLOUR = declared('flour', ['gluten-wheat']);
const MILK = declared('milk', ['milk']);
const SALT = declared('salt', []);
const row = (label: string, refId?: string, grams = 100) => ({ label, grams, unit: 'g', ...(refId === undefined ? {} : { refId }) });
const recipeDoc = (id: string, name: string, ingredients: unknown[]): StoredDoc => ({ id, name, ingredients });

const CAKE = recipeDoc('cake', 'Cake', [row('Flour', 'flour', 500), row('Milk', 'milk', 300)]);
const APPLE = recipeDoc('apple', 'Apple', [row('Flour', 'flour')]);
const BREAD = recipeDoc('bread', 'Bread', [row('Flour', 'flour'), row('Mystery')]);

const NO_COUNTRY_EN = 'No label can be made yet: nobody has said which country this business sells in, and that decides the language the label must be printed in. The owner can set it when the business is created.';
const NO_COUNTRY_IT = 'Non si può ancora fare nessuna etichetta: nessuno ha detto in che paese vende questa attività, ed è quello a decidere in che lingua l’etichetta va stampata. Il titolare può impostarlo quando crea l’attività.';
const UNREADABLE = 'The ingredient list could not be read, so the allergens cannot be checked.';
const STILL_WAITING = 'Still waiting for the ingredient list — the allergens can’t be checked until it arrives. Are you offline?';

const main = () => within(screen.getByRole('main'));
const noButtons = () => expect(main().queryByRole('button', { name: /^(Copy|Send|Copia|Invia)$/ })).not.toBeInTheDocument();

async function open(
  recipes: StoredDoc[], ingredients: StoredDoc[], id: string,
  { location, lang = 'en', source }: { location?: Record<string, unknown> | null; lang?: 'en' | 'it'; source?: ReturnType<typeof fakeRecipesSource> } = {},
) {
  const src = source ?? fakeRecipesSource({ recipes, ingredients });
  const view = renderRecipes(`/recipes/${id}`, {
    source: src, lang, session: { location: location === undefined ? { country: 'GB' } : location, language: lang },
  });
  await screen.findByRole('table', undefined, LOAD);
  return { ...view, source: src };
}

describe('the declaration card without a country', () => {
  it.each([
    ['no country', {}],
    ['an unsupported country', { country: 'FR' }],
    ['a venue document that did not load', null],
  ])('⚠️ says ONE line and has no Copy and no Send for %s', async (_name, location) => {
    await open([CAKE], [FLOUR, MILK], 'cake', { location });
    expect(await screen.findByText(NO_COUNTRY_EN)).toBeVisible();
    expect(main().getByRole('heading', { level: 3, name: 'Ingredient declaration' })).toBeInTheDocument();
    noButtons();
    expect(main().queryByText(/^Contains/)).not.toBeInTheDocument();
    expect(main().queryByText(/A draft for you to check/)).not.toBeInTheDocument();
  });

  it('says it in Italian on an Italian screen', async () => {
    await open([CAKE], [FLOUR, MILK], 'cake', { location: {}, lang: 'it' });
    expect(await screen.findByText(NO_COUNTRY_IT)).toBeVisible();
    noButtons();
  });

  it('still shows the allergen card\'s names on screen, as the current app does', async () => {
    await open([CAKE], [FLOUR, MILK], 'cake', { location: {} });
    expect(await screen.findByText('Wheat, Milk')).toBeVisible();
  });
});

describe('a declared recipe with nothing weighed, and an empty one', () => {
  it('⚠️ gets its own sentence and no buttons', async () => {
    await open([recipeDoc('zero', 'Zero', [row('Salt', 'salt', 0)])], [SALT], 'zero');
    expect(await screen.findByText('This recipe has no ingredients with a weight.')).toBeVisible();
    expect(main().queryByText(/still to be declared/)).not.toBeInTheDocument();
    noButtons();
  });

  it('hides the declaration card for a recipe with no rows, as the allergen card is hidden', async () => {
    await open([recipeDoc('empty', 'Empty', [])], [FLOUR], 'empty');
    await screen.findByRole('table', undefined, LOAD);
    expect(main().queryByRole('heading', { level: 3, name: /^Allergens|Ingredient declaration/ })).not.toBeInTheDocument();
  });
});

describe('an ingredient list that could never be read', () => {
  const unreadable = () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: [FLOUR, MILK] });
    source.refuse.ingredients = true;
    return source;
  };

  it('⚠️ the allergen card says so in ONE line instead of the rows, and still says «not declared»', async () => {
    const { user } = await open([CAKE], [], 'cake', { source: unreadable() });
    await user.click(await screen.findByRole('button', { name: 'Allergens not declared' }));
    expect(screen.getByText(UNREADABLE)).toBeVisible();
    expect(screen.queryByText(/linked to an ingredient that no longer exists/)).not.toBeInTheDocument();
    expect(screen.queryByText('Wheat, Milk')).not.toBeInTheDocument();
  });

  it('keeps the declaration card on its blocked line, with no buttons', async () => {
    await open([CAKE], [], 'cake', { source: unreadable() });
    expect(await screen.findByText(/Not ready yet — some ingredients are still to be declared/)).toBeVisible();
    noButtons();
  });

  it('the sheet says it above the rows and hides the work lists', async () => {
    const source = fakeRecipesSource({ recipes: [BREAD, CAKE], ingredients: [FLOUR, MILK] });
    source.refuse.ingredients = true;
    renderRecipes('/recipes/allergens', { source, session: { location: { country: 'GB' } } });
    const sheet = within(await screen.findByRole('region', { name: 'Allergen sheet' }, LOAD));
    expect(await sheet.findByText(UNREADABLE)).toBeVisible();
    expect(sheet.queryByText('Link these rows first')).not.toBeInTheDocument();
    expect(sheet.queryByText('Declare these first')).not.toBeInTheDocument();
    expect(sheet.queryByText(/Then declare these/)).not.toBeInTheDocument();
    // The rows keep the model's verdicts: nothing is declared without its ingredients.
    expect(sheet.getAllByText('not declared').length).toBeGreaterThan(0);
  });

  it('says it in Italian', async () => {
    await open([CAKE], [], 'cake', { source: unreadable(), lang: 'it', location: { country: 'IT' } });
    await screen.findByRole('button', { name: /^Allergeni/ });
    (await screen.findByRole('button', { name: /^Allergeni/ })).click();
    expect(await screen.findByText('Non riesco a leggere l’elenco degli ingredienti, quindi non posso controllare gli allergeni.')).toBeVisible();
  });
});

describe('the wait that never ends offline', () => {
  // A cold phone: the recipe is stored, the ingredients are not, and the server never answers.
  const cold = () => {
    window.localStorage.setItem('catalogue-recipes', JSON.stringify([CAKE]));
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: [FLOUR, MILK] });
    source.hold();
    return source;
  };

  it('⚠️ adds a line after ten seconds in both cards, and still gives no verdict and no buttons', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderRecipes('/recipes/cake', { source: cold(), session: { location: { country: 'GB' } } });
    expect(await screen.findAllByText('Checking the allergens…', undefined, LOAD)).toHaveLength(2);
    expect(screen.queryByText(STILL_WAITING)).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(STILL_WAITING_MS - 1000); });
    expect(screen.queryByText(STILL_WAITING)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(await screen.findAllByText(STILL_WAITING)).toHaveLength(2);
    expect(main().queryByRole('button', { name: /^Allergens/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/not declared|fully declared/)).not.toBeInTheDocument();
    noButtons();
  });

  it('the sheet says it too, once, under the checking text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderRecipes('/recipes/allergens', { source: cold(), session: { location: { country: 'GB' } } });
    const sheet = within(await screen.findByRole('region', { name: 'Allergen sheet' }, LOAD));
    expect(sheet.queryByText(STILL_WAITING)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(STILL_WAITING_MS + 500); });
    expect(await sheet.findByText(STILL_WAITING)).toBeVisible();
    expect(sheet.queryByText(/recipes fully declared/)).not.toBeInTheDocument();
  });

  it('the line goes when the ingredients arrive', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const source = cold();
    renderRecipes('/recipes/cake', { source, session: { location: { country: 'GB' } } });
    await screen.findAllByText('Checking the allergens…', undefined, LOAD);
    act(() => { vi.advanceTimersByTime(STILL_WAITING_MS + 500); });
    await screen.findAllByText(STILL_WAITING);
    act(() => { source.release(); });
    expect(await screen.findByText('Wheat, Milk')).toBeVisible();
    expect(screen.queryByText(STILL_WAITING)).not.toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderRecipes('/recipes/cake', { source: cold(), lang: 'it', session: { location: { country: 'IT' }, language: 'it' } });
    await screen.findAllByText('Sto controllando gli allergeni…', undefined, LOAD);
    act(() => { vi.advanceTimersByTime(STILL_WAITING_MS + 500); });
    expect(await screen.findAllByText('Sto ancora aspettando l’elenco degli ingredienti: finché non arriva non posso controllare gli allergeni. Sei offline?')).toHaveLength(2);
  });
});

describe('the sheet and a partial first answer', () => {
  // A cold phone with only some recipes stored, and the server not yet heard from.
  const partial = () => {
    window.localStorage.setItem('catalogue-recipes', JSON.stringify([APPLE]));
    window.localStorage.setItem('catalogue-ingredients', JSON.stringify([FLOUR, MILK]));
    const source = fakeRecipesSource({ recipes: [APPLE, CAKE], ingredients: [FLOUR, MILK] });
    source.hold();
    return source;
  };

  it('⚠️ shows the count but not «Every recipe can be labelled.» until the server has answered, then says it', async () => {
    const source = partial();
    renderRecipes('/recipes/allergens', { source, session: { location: { country: 'GB' } } });
    const sheet = within(await screen.findByRole('region', { name: 'Allergen sheet' }, LOAD));
    expect(await sheet.findByText('1 of 1 recipes fully declared')).toBeVisible();
    expect(sheet.queryByText('Every recipe can be labelled.')).not.toBeInTheDocument();

    act(() => { source.release(); });
    expect(await sheet.findByText('2 of 2 recipes fully declared')).toBeVisible();
    expect(sheet.getByText('Every recipe can be labelled.')).toBeVisible();
  });

  it('says it once the live stream has broken, because no more is coming', async () => {
    const source = partial();
    renderRecipes('/recipes/allergens', { source, session: { location: { country: 'GB' } } });
    const sheet = within(await screen.findByRole('region', { name: 'Allergen sheet' }, LOAD));
    await sheet.findByText('1 of 1 recipes fully declared');
    expect(sheet.queryByText('Every recipe can be labelled.')).not.toBeInTheDocument();
    act(() => { source.breakStream(); });
    expect(await sheet.findByText('Every recipe can be labelled.')).toBeVisible();
  });
});
