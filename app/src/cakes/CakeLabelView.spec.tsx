import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ingredientCardPath } from '@mise/shared/cake-label-model';
import type { StoredDoc } from '../foodcost/foodcostSource';
import { ingredientPath } from '../suppliers/suppliersPath';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { REFERENCE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD, product } from '../testing/renderFoodcost';
import { closePrintHost } from '../recipes/printHost';
import { act } from '@testing-library/react';
import { resetParkedCakes } from './cakeParking';

// The whole cake's label (Torte step 2b): the row under «Cost and price», the full-screen view inside the editor, the refusal that names the
// card in the way, and the doors to the ingredient and to the Recipes. Fake data only (P15).

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); resetParkedCakes(); });
afterEach(() => {
  act(() => { closePrintHost(); });
  vi.unstubAllGlobals();
  window.localStorage.clear();
  resetParkedCakes();
});

const STAMP = '2026-01-01';
const NUTRITION = { kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5 };
const declared = (id: string, allergens: string[], extra: Record<string, unknown> = {}): StoredDoc =>
  ({ id, name: id, allergens, allergensCheckedAt: STAMP, nutrition: NUTRITION, ...extra });

const FLOUR = declared('flour', ['gluten-wheat']);
const MILK = declared('milk', ['milk'], { mayContain: ['nuts-hazelnut'] });
const SUGAR = declared('sugar', []);
// Nobody has said what is in the rum.
const RUM: StoredDoc = { id: 'rum', name: 'Rum', allergens: [] };

const card = (id: string, name: string, components: unknown[], extra: Record<string, unknown> = {}): StoredDoc =>
  product(id, { name, kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null, components, ...extra });
const grams = (ingredientId: string, qty: number) => ({ kind: 'ingredient', ingredientId, qty, unit: 'g' });

const SPONGE = card('sponge', 'Sponge', [grams('flour', 600), grams('sugar', 400)]);
const CREAM = card('cream', 'Cream', [grams('milk', 500), grams('sugar', 500)]);
const SOAK = card('soak', 'Rum soak', [grams('rum', 100), grams('sugar', 400)]);
const FRUIT = card('fruit', 'Fruit filling', [{ recipeId: 'fruit-recipe', qtyKg: 1 }]);

const FRUIT_RECIPE: StoredDoc = { id: 'fruit-recipe', name: 'Fruit', ingredients: [] };

const line = (tier: number, part: string, productId: string, g: number) => ({ tier, part, productId, grams: g });

const GB = { country: 'GB' };
const IT = { country: 'IT' };

type Seed = { cards?: StoredDoc[]; lines?: unknown[]; cake?: Record<string, unknown> };

async function open(seed: Seed = {}, options: { location?: Record<string, unknown>; lang?: 'en' | 'it'; path?: string; refuse?: 'ingredients' | 'recipes' } = {}) {
  const lines = seed.lines ?? [line(0, 'base', 'sponge', 900), line(0, 'filling', 'cream', 500)];
  const cake = cakeDoc('c1', 'Foresta Nera', { diameterCm: 24, tiers: 2, discs: 3, ref: REFERENCE, lines, ...seed.cake });
  const foodcost = fakeFoodcostSource({
    products: seed.cards ?? [SPONGE, CREAM],
    recipes: [FRUIT_RECIPE],
    ingredients: [FLOUR, MILK, SUGAR, RUM],
  });
  if (options.refuse) foodcost.refuse[options.refuse] = true;
  const view = renderCakes(options.path ?? '/cakes/c1', {
    cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }),
    foodcost,
    lang: options.lang,
    session: { location: options.location ?? GB, language: options.lang ?? 'en' },
  });
  await screen.findByRole('heading', { level: 2, name: options.path === '/cakes/new' ? 'New cake' : 'Foresta Nera' }, LOAD);
  return view;
}

// The open view (the editor behind it is only hidden, so a text query on the whole page would find its words too).
const view = () => within(screen.getByRole('heading', { level: 2, name: 'Foresta Nera' }).closest('section') as HTMLElement);
const rowButton = () => screen.getByRole('button', { name: /^Cake label/ });
const switchGroup = () => screen.findByRole('group', { name: 'What the label shows' }, LOAD);

describe('the row under «Cost and price»', () => {
  it('says «Contains …» once every card is declared, in the venue country\'s words', async () => {
    await open();
    await waitFor(() => { expect(rowButton()).toHaveTextContent('Contains: Wheat, Milk · ready to print'); }, LOAD);
  });

  it('says what is missing while a card is not declared', async () => {
    await open({ cards: [SPONGE, SOAK], lines: [line(0, 'base', 'sponge', 900), line(0, 'soak', 'soak', 300)] });
    await waitFor(() => { expect(rowButton()).toHaveTextContent('Not yet: 1 card to fix'); }, LOAD);
  });

  it('says «put the cake together» while the cake has no card with grams', async () => {
    await open({ lines: [] });
    await waitFor(() => { expect(rowButton()).toHaveTextContent('Not yet: put the cake together'); }, LOAD);
  });

  it('keeps the interface in its own language and the allergens in the venue\'s: an Italian venue, an English screen', async () => {
    await open({}, { location: IT, lang: 'en' });
    await waitFor(() => { expect(rowButton()).toHaveTextContent(/Contiene: .*· ready to print/); }, LOAD);
    expect(rowButton()).not.toHaveTextContent('Contains');
  });

  it('follows the interface for the words that tell somebody what to do', async () => {
    await open({ cards: [SPONGE, SOAK], lines: [line(0, 'base', 'sponge', 900), line(0, 'soak', 'soak', 300)] }, { location: IT, lang: 'it' });
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Etichetta della torta/ })).toHaveTextContent('Non ancora: 1 scheda da sistemare'); }, LOAD);
  });
});

describe('the full-screen view', () => {
  it('opens inside the editor, shows the label and its switch, and Back closes it with the focus on the row', async () => {
    const { user, router } = await open();
    await user.click(rowButton());
    await switchGroup();
    // Not a route: the address is still the cake's, and the editor is out of the way (hidden, not gone).
    expect(router.state.location.pathname).toBe('/cakes/c1');
    expect(screen.queryByRole('button', { name: 'Save to the price list' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Foresta Nera' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Save to the price list' })).toBeVisible();
    expect(rowButton()).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'What the label shows' })).not.toBeInTheDocument();
  });

  it('closes on Escape too', async () => {
    const { user } = await open();
    await user.click(rowButton());
    await switchGroup();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Save to the price list' })).toBeVisible();
    expect(rowButton()).toHaveFocus();
  });

  it('says what the whole cake is made of and lists the cards under the label', async () => {
    const { user } = await open();
    await user.click(rowButton());
    await switchGroup();
    expect(screen.getByText(/2 tiers \(Ø 24 \/ 18 cm\), 2 cards, 1\.4 kg/)).toBeInTheDocument();
    const table = within(await screen.findByRole('region', { name: 'From which cards' }));
    expect(table.getByRole('row', { name: /Sponge.*Base \(bottom\).*900 g/ })).toBeInTheDocument();
    expect(table.getByRole('row', { name: /Cream.*Filling \(bottom\).*500 g/ })).toBeInTheDocument();
    expect(table.getByRole('row', { name: /Total.*1,?400 g/ })).toBeInTheDocument();
  });

  it('draws the label card with the allergens kept apart, and offers the print road', async () => {
    const { user } = await open();
    await user.click(rowButton());
    await switchGroup();
    expect((await screen.findAllByText('Contains: Wheat, Milk')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('May contain: Hazelnut').length).toBeGreaterThan(0);
    expect(screen.getByText('Check this before it goes on food')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Print|Print dialog)$/ })).toBeInTheDocument();
  });

  it('the switch works the same as on a recipe\'s label', async () => {
    const { user } = await open();
    await user.click(rowButton());
    const group = within(await switchGroup());
    await user.click(group.getByRole('button', { name: 'Allergens' }));
    expect(group.getByRole('button', { name: 'Allergens' })).toHaveAttribute('aria-pressed', 'true');
    expect(group.getByRole('button', { name: 'Both' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Per 100 g')).not.toBeInTheDocument();
  });

  it('works on a cake that is not saved yet, and the form behind it keeps what was typed', async () => {
    const { user } = await open({}, { path: '/cakes/new' });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Torta di prova');
    await user.click(rowButton());
    await switchGroup();
    expect(screen.getByRole('heading', { level: 2, name: 'Torta di prova' })).toBeInTheDocument();
    expect(screen.getByText('There is nothing to label yet: add at least one card, with its grams, to the cake.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Torta di prova');
  });
});

describe('what stops the label', () => {
  const blockedSeed = (): Seed => ({ cards: [SPONGE, SOAK, FRUIT], lines: [line(0, 'base', 'sponge', 900), line(0, 'soak', 'soak', 300), line(0, 'filling', 'fruit', 400)] });

  it('names every card in the way with its reason, and no label is drawn', async () => {
    const { user } = await open(blockedSeed());
    await user.click(await screen.findByRole('button', { name: /^Cake label.*Not yet: 2 cards to fix/ }, LOAD));
    expect(await screen.findByText('The label cannot be made yet')).toBeInTheDocument();
    expect(screen.getByText(/2 cards are in the way:/)).toBeInTheDocument();
    expect(view().getByText('Rum soak')).toBeInTheDocument();
    expect(screen.getByText('The ingredient “Rum” does not have its allergens verified yet.')).toBeInTheDocument();
    expect(view().getByText('Fruit filling')).toBeInTheDocument();
    expect(screen.getByText('The recipe “Fruit” is incomplete: an ingredient has no allergens verified, or it is still empty.')).toBeInTheDocument();
    // No paper, no card, no Copy: nothing that looks like a finished label.
    expect(screen.queryByText('Check this before it goes on food')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy the text' })).not.toBeInTheDocument();
    expect(document.querySelector('.lab-sheet')).toBeNull();
  });

  it('«Open the ingredient» goes to the ingredient\'s card and the cake is set aside, to come back whole', async () => {
    const { user, router } = await open(blockedSeed());
    await user.click(await screen.findByRole('button', { name: /^Cake label.*Not yet/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Open the ingredient' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/ingredient/rum'); });
    expect(router.state.location.state).toMatchObject({ fromList: true });
    // Back is the browser's Back: it lands on the cake's own entry, marked with the copy's key.
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes/c1'); });
    expect(router.state.location.state).toMatchObject({ parkedCake: 'c1' });
  });

  it('«Open in Recipes» goes to the recipe through the same set-aside', async () => {
    const { user, router } = await open(blockedSeed());
    await user.click(await screen.findByRole('button', { name: /^Cake label.*Not yet/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Open in Recipes' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/fruit-recipe/edit'); });
    expect(router.state.location.state).toMatchObject({ fromCake: true });
  });

  it('a card that is no longer in Food cost blocks the label and has no door', async () => {
    const { user } = await open({ cards: [SPONGE], lines: [line(0, 'base', 'sponge', 900), line(0, 'filling', 'ghost', 500)] });
    await user.click(await screen.findByRole('button', { name: /^Cake label.*Not yet: 1 card to fix/ }, LOAD));
    expect(await screen.findByText('This card is no longer in Food cost.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the ingredient' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open in Recipes' })).not.toBeInTheDocument();
  });
});

describe('who can read what (P17)', () => {
  it('a person whose account cannot read the ingredients gets a sentence, never a half label', async () => {
    const { user } = await open({}, { refuse: 'ingredients' });
    await waitFor(() => { expect(rowButton()).toHaveTextContent('Not available: the recipes or ingredients cannot be read'); }, LOAD);
    await user.click(rowButton());
    expect(await screen.findByText(/Your account cannot read the recipes or the ingredients/)).toBeInTheDocument();
    expect(screen.queryByText('Check this before it goes on food')).not.toBeInTheDocument();
  });

  it('the same when the recipes are refused', async () => {
    const { user } = await open({}, { refuse: 'recipes' });
    await waitFor(() => { expect(rowButton()).toHaveTextContent('Not available'); }, LOAD);
    await user.click(rowButton());
    expect(await screen.findByText(/Your account cannot read the recipes or the ingredients/)).toBeInTheDocument();
  });

  it('a venue with no country has no label, as on a recipe: not a fallback to English', async () => {
    const { user } = await open({}, { location: {} });
    await waitFor(() => { expect(rowButton()).toHaveTextContent('Not available for this business'); }, LOAD);
    await user.click(rowButton());
    expect(await screen.findByText(/nobody has said which country this business sells in/)).toBeInTheDocument();
  });
});

describe('the address of an ingredient\'s card', () => {
  it('is the one Ingredients & suppliers builds itself', () => {
    for (const id of ['rum', 'a b%c', 'xX9_-']) expect(ingredientCardPath(id)).toBe(ingredientPath(id));
    expect(ingredientCardPath('')).toBeNull();
    expect(ingredientCardPath('a/b')).toBeNull();
  });
});
