import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { DataProvider } from '../data/DataContext';
import type { DataServices } from '../data/DataContext';
import { CakesProvider } from '../cakes/CakesContext';
import { FoodcostProvider } from '../foodcost/FoodcostContext';
import { StocktakeProvider } from '../stocktake/StocktakeContext';
import { renderWithSession } from '../testing/renderWithSession';
import { hasUnsavedWork, isBusy } from './busy';

// The offline «not sent yet» holds keep a self-started reload away (isBusy) but never make the browser ask «leave this page?»
// (hasUnsavedWork): Firestore's own offline cache keeps those writes across a closed window.

const stubStore = (snapshot: Record<string, unknown>) => {
  const state = Object.freeze(snapshot);
  return { start: () => undefined, stop: () => undefined, subscribe: () => () => undefined, getSnapshot: () => state };
};

vi.mock('../cakes/cakesStore', async original => ({
  ...(await original<typeof import('../cakes/cakesStore')>()),
  createCakesStore: () => stubStore({ unsent: true, cakes: [], cakesLoaded: true, standard: null }),
}));
vi.mock('../foodcost/foodcostStore', async original => ({
  ...(await original<typeof import('../foodcost/foodcostStore')>()),
  createFoodcostStore: () => stubStore({ unsent: true, products: [], productsFromServer: false }),
}));
vi.mock('../stocktake/stocktakeStore', async original => ({
  ...(await original<typeof import('../stocktake/stocktakeStore')>()),
  createStocktakeStore: () => stubStore({ unsent: true }),
}));

const services = { cakes: () => ({}), foodcost: () => ({}), stocktake: () => ({}) } as unknown as DataServices;

afterEach(() => { cleanup(); });

function drawn(ui: React.ReactElement) {
  renderWithSession(<DataProvider services={services}>{ui}</DataProvider>, { session: { locationId: 'bakery' } });
}

describe('the offline «not sent yet» holds', () => {
  it('Cakes: busy for a self-started reload, but not unsaved work for a closed window', () => {
    drawn(<CakesProvider><p>x</p></CakesProvider>);
    expect(isBusy()).toBe(true);
    expect(hasUnsavedWork()).toBe(false);
    cleanup();
    expect(isBusy()).toBe(false);
  });

  it('Food cost: busy, but not unsaved work', () => {
    drawn(<FoodcostProvider><p>x</p></FoodcostProvider>);
    expect(isBusy()).toBe(true);
    expect(hasUnsavedWork()).toBe(false);
  });

  it('Stocktake: busy, but not unsaved work', () => {
    drawn(<StocktakeProvider><p>x</p></StocktakeProvider>);
    expect(isBusy()).toBe(true);
    expect(hasUnsavedWork()).toBe(false);
  });
});
