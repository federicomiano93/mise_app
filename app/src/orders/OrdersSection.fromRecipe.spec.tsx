import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ordersForIngredientPath } from '@mise/shared/recipe-link';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { renderApp } from '../testing/renderApp';
import { entriesBehind } from '../testing/recipeLinkHelpers';
import { LOAD, ingredient, supplier } from '../testing/renderOrders';
import { recipe } from '../testing/renderRecipes';
import { carriedPlace, carryPlace } from '../recipes/recipeReturn';
import { parseOrdersPath, supplierPath } from './ordersPath';
import { recipeOriginOf } from './recipeOrigin';

// Item 32 (the current app's 70325def, 8ed7a0ad, f0803349; 7 Nov 2026): a recipe row's «Order» opens Orders on that ingredient's supplier
// with its quantity box focused, and Back returns to the recipe — the history as it was, the recipe as it was left.

beforeAll(async () => {
  await import('./OrdersSection');
  await import('../recipes/RecipesSection');
}, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const FOCACCIA = recipe('r1', {
  name: 'Focaccia',
  ingredients: [
    { label: 'Flour', grams: 1250, unit: 'g', kind: 'ingredient', refId: 'i-flour' },
    { label: 'Rye', grams: 400, unit: 'g', kind: 'ingredient', refId: 'i-rye' },
  ],
});
const CATALOGUE_INGREDIENTS = [
  { id: 'i-flour', name: 'Flour', supplierId: 's-alp' },
  { id: 'i-rye', name: 'Rye', supplierId: 's-alp' },
];
const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills' })];
const ORDER_ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
];

function seeds() {
  return {
    recipes: fakeRecipesSource({ recipes: [FOCACCIA], ingredients: CATALOGUE_INGREDIENTS, suppliers: SUPPLIERS }),
    orders: fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ORDER_ITEMS }),
  };
}

type Opened = ReturnType<typeof renderApp> & ReturnType<typeof seeds>;

function show(path: string, options: Parameters<typeof renderApp>[1] = {}): Opened {
  const sources = seeds();
  const view = renderApp(path, { ...options, data: { recipes: () => sources.recipes, orders: () => sources.orders } });
  return { ...view, ...sources };
}

const where = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
const table = () => within(screen.getByRole('main')).getByRole('table', { name: 'Ingredients' });
const rowButton = (name: string) => within(table()).getByRole('button', { name });

// The recipe, then «Order» on its Flour row.
async function orderFlour(view: Opened) {
  await screen.findByRole('table', undefined, LOAD);
  await waitFor(() => { expect(view.recipes.suppliers.size).toBeGreaterThan(0); });
  await view.user.click(rowButton('Flour'));
  await view.user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Order' }));
}

const quantityBox = (name = 'Flour') => screen.findByLabelText(`${name} quantity to order`, undefined, LOAD);
const backButton = () => within(screen.getByRole('region', { name: 'Alpine Mills' })).getByRole('button', { name: 'Back' });

describe('«Order» on a recipe row', () => {
  it('opens that ingredient’s supplier, with the recipe in the address and the quantity box focused', async () => {
    const view = show('/recipes/r1');
    await orderFlour(view);
    const box = await quantityBox();
    expect(where(view.router)).toBe('/orders/supplier/s-alp?recipe=r1&ingredient=i-flour');
    expect(view.router.state.location.state).toMatchObject({ fromRecipeLink: true });
    await waitFor(() => { expect(box).toHaveFocus(); });
    // Nothing is prefilled, and the other lines are untouched.
    expect(box).toHaveValue(null);
    expect(await quantityBox('Rye')).toHaveValue(null);
  });

  it('Back returns to the recipe — no second entry for it — with the same row focused', async () => {
    const view = show('/recipes/r1');
    await orderFlour(view);
    await quantityBox();
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
    await screen.findByRole('table', undefined, LOAD);
    await waitFor(() => { expect(rowButton('Flour')).toHaveFocus(); });
    expect(await entriesBehind(view.router)).toBe(0);
  });

  it('⚠️ the row that opened the menu was deleted on another phone: Back leaves the focus on the recipe’s title, not on the body', async () => {
    // Opened from the list, as a person does: that is what makes the recipe's title the fallback for the focus.
    const view = show('/recipes');
    await view.user.click(await screen.findByRole('button', { name: /Focaccia/ }, LOAD));
    await orderFlour(view);
    await quantityBox();
    // The row's key is no longer in the recipe (what a deletion on another phone during the trip leaves).
    const place = carriedPlace();
    expect(place?.trip).toBeDefined();
    carryPlace({ ...(place as NonNullable<typeof place>), trip: { row: 'ingredient:i-ghost#1', split: [] } });
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
    await screen.findByRole('table', undefined, LOAD);
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Focaccia' })).toHaveFocus(); });
  });

  it('Back brings the recipe as it was left: the rows split in two are still split', async () => {
    const view = show('/recipes/r1');
    await screen.findByRole('table', undefined, LOAD);
    await view.user.click(rowButton('Rye'));
    await view.user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Split into 2 parts' }));
    expect(within(table()).getByText('→ 200 g + 200')).toBeInTheDocument();
    await orderFlour(view);
    await quantityBox();
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
    expect(await within(await screen.findByRole('table', undefined, LOAD)).findByText('→ 200 g + 200')).toBeInTheDocument();
    await waitFor(() => { expect(rowButton('Flour')).toHaveFocus(); });
  });

  it('⚠️ NEVER STRANDS A QUANTITY: typed and left at once, it is already on its way to the draft, and Orders shows it again', async () => {
    const view = show('/recipes/r1');
    await orderFlour(view);
    const box = await quantityBox();
    await waitFor(() => { expect(box).toHaveFocus(); });
    await view.user.keyboard('7');
    expect(view.orders.writes).toHaveLength(0);
    // Back at once, inside the 0.8 s pause of the autosave: leaving Orders sends what waits (the store's stop()).
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
    // No waiting for the pause: the write left with the screen.
    expect(view.orders.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 7 });
    expect(view.orders.draft).toMatchObject({ entries: { 'i-flour': { qty: 7 } } });
    // And the next time Orders opens, the number is there.
    await view.router.navigate('/orders/supplier/s-alp');
    expect(await quantityBox()).toHaveValue(7);
  });

  it('⚠️ REFUSED BY THE SERVER AFTER BACK: the next Orders says «Quantity not saved» once, then shows the 7 as not saved', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = show('/recipes/r1');
    await orderFlour(view);
    const box = await quantityBox();
    await waitFor(() => { expect(box).toHaveFocus(); });
    await view.user.keyboard('7');
    // The person no longer has the right to write the order (access taken away while it was on its way).
    view.orders.refuseWrites = true;
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
    await waitFor(() => { expect(view.orders.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 7 }); });
    // Refused after the screen had gone: nothing on screen could say it.
    await waitFor(() => { expect(view.orders.draft?.entries).toBeUndefined(); });
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // Orders again, by any door: said as it opens.
    await view.router.navigate('/orders');
    const notice = await screen.findByRole('alertdialog', { name: 'Quantity not saved' }, LOAD);
    expect(notice).toHaveTextContent('The quantity you typed could not be saved in Orders before you left. Check the order before you send it.');
    await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).toBeNull(); });
    // Then exactly as a refusal on screen: the 7 is back on its line, and the page says the order is not saved.
    await view.router.navigate('/orders/supplier/s-alp');
    expect(await quantityBox()).toHaveValue(7);
    expect(await screen.findByText('Could not save the order — check your network. Keep this page open.')).toBeInTheDocument();

    // Said once: another trip to Orders does not say it again.
    await view.router.navigate('/recipes/r1');
    await screen.findByRole('table', undefined, LOAD);
    await view.router.navigate('/orders');
    expect(await screen.findAllByRole('button', { name: /Alpine Mills/ }, LOAD)).not.toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    errors.mockRestore();
  });

  it('says «Quantità non salvata» in Italian', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = show('/orders/supplier/s-alp', { lang: 'it', session: { language: 'it' } });
    const box = await screen.findByLabelText('Quantità da ordinare di Flour', undefined, LOAD);
    await view.user.click(box);
    await view.user.keyboard('4');
    view.orders.refuseWrites = true;
    await view.router.navigate('/recipes/r1');
    await waitFor(() => { expect(view.orders.writes.at(-1)?.entries?.['i-flour']).toMatchObject({ qty: 4 }); });
    await waitFor(() => { expect(view.orders.draft?.entries).toBeUndefined(); });
    await view.router.navigate('/orders');
    const notice = await screen.findByRole('alertdialog', { name: 'Quantità non salvata' }, LOAD);
    expect(notice).toHaveTextContent('Non sono riuscito a salvare in Ordini la quantità che hai scritto prima di uscire. Controlla l’ordine prima di inviarlo.');
    errors.mockRestore();
  });

  it('opened by its address alone (a reload), Back replaces it with the recipe', async () => {
    const view = show('/orders/supplier/s-alp?recipe=r1&ingredient=i-flour');
    const box = await quantityBox();
    await waitFor(() => { expect(box).toHaveFocus(); });
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
    expect(await entriesBehind(view.router)).toBe(0);
  });

  it('says so when the ingredient is not on that supplier’s screen, and leaves the screen usable', async () => {
    const view = show('/orders/supplier/s-alp?recipe=r1&ingredient=i-ghost');
    await quantityBox();
    expect(await screen.findByText('This ingredient is not in any order list')).toBeInTheDocument();
    // The focus is on the screen's title, not left on the body: the sentence and the title are announced.
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toHaveFocus(); });
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
  });

  it('⚠️ coming back from «Summary» or «What they sell», the focus returns to that button, not to the quantity box again', async () => {
    const view = show('/recipes/r1');
    await orderFlour(view);
    const box = await quantityBox();
    await waitFor(() => { expect(box).toHaveFocus(); });
    for (const name of [/^Summary/, 'What they sell']) {
      await view.user.click(screen.getByRole('button', { name }));
      await waitFor(() => { expect(where(view.router)).not.toContain('/orders/supplier/s-alp?'); });
      await view.user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Back' }));
      await waitFor(() => { expect(where(view.router)).toBe('/orders/supplier/s-alp?recipe=r1&ingredient=i-flour'); });
      const door = await screen.findByRole('button', { name });
      await waitFor(() => { expect(door).toHaveFocus(); });
      expect(await quantityBox()).not.toHaveFocus();
    }
    // No extra history entry: Back still returns to the recipe, with nothing left behind it.
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/recipes/r1'); });
    expect(await entriesBehind(view.router)).toBe(0);
  });

  it('⚠️ a recipe that cannot be one is no recipe: an ordinary supplier screen, Back goes to the list', async () => {
    const view = show('/orders/supplier/s-alp?recipe=a%2Fb&ingredient=i-flour');
    await quantityBox();
    expect(screen.queryByText('This ingredient is not in any order list')).not.toBeInTheDocument();
    await view.user.click(backButton());
    await waitFor(() => { expect(where(view.router)).toBe('/orders'); });
  });

  it('speaks Italian with the current app’s words', async () => {
    const view = show('/orders/supplier/s-alp?recipe=r1&ingredient=i-ghost', { lang: 'it', session: { language: 'it' } });
    expect(await screen.findByText('Questo ingrediente non è in nessun elenco d’ordine', undefined, LOAD)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
  });
});

describe('the address', () => {
  it('names the very screen Orders draws for that supplier, whatever the id holds', () => {
    for (const id of ['s-alp', 'a b', 'crème#1', '100%', 'x&y=z', '?q']) {
      const path = ordersForIngredientPath(id, 'r1', 'i1') as string;
      expect(path.split('?')[0], id).toBe(supplierPath(id));
      expect(parseOrdersPath((path.split('?')[0] as string).slice('/orders'.length)), id).toStrictEqual({ kind: 'supplier', id });
    }
  });

  it('is read back as strictly as it is written', () => {
    expect(recipeOriginOf('?recipe=r1&ingredient=i1')).toStrictEqual({ recipeId: 'r1', ingredientId: 'i1' });
    expect(recipeOriginOf('?recipe=r1')).toStrictEqual({ recipeId: 'r1', ingredientId: null });
    expect(recipeOriginOf('?recipe=r1&ingredient=a%2Fb')).toStrictEqual({ recipeId: 'r1', ingredientId: null });
    expect(recipeOriginOf('?ingredient=i1')).toBe(null);
    expect(recipeOriginOf('?recipe=a%2Fb&ingredient=i1')).toBe(null);
    expect(recipeOriginOf('')).toBe(null);
  });
});
