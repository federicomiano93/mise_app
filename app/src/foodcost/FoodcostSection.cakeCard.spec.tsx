import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { REFERENCE, cakeDoc, storedReference } from '../testing/renderCakes';
import { EMPLOYEE, LOAD, MANAGER, bareProduct, product, renderFoodcost, sourceWith } from '../testing/renderFoodcost';

// A cake's own card in Food cost (Cakes step 7): READ ONLY for everybody, with a band and a link to the cake in Cakes, a «Cake» tag on
// its row, and Back from the cake returning to the card. Cakes writes the card and the cake in one batch, so no edit door exists here.

beforeAll(async () => { await import('./FoodcostSection'); await import('../cakes/CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const CAKE_CARD = product('cake-c1', { name: 'Sacher', kind: 'finished', model: 4 });
const SACHER = cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE });
const cakes = () => fakeCakesSource({ cakes: [SACHER], reference: storedReference() });

const openCard = async (card = CAKE_CARD, options: Parameters<typeof renderFoodcost>[1] = {}) => {
  const view = renderFoodcost('/food-cost/product/cake-c1', { source: sourceWith([card]), data: { cakes: cakes }, ...options });
  await screen.findByRole('heading', { level: 2, name: 'Sacher' }, LOAD);
  return view;
};

describe('a cake\'s own card', () => {
  it('opens to READ with no pencil, no lab door and no delete; the margin history stays', async () => {
    await openCard(CAKE_CARD, { session: MANAGER });
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.queryByText('Produce in the lab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Margin history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'This card is a cake' })).toBeInTheDocument();
    expect(screen.getByText('Its parts, grams and measures are changed in Cakes. Here you see its cost and its margins.')).toBeInTheDocument();
  });

  it('stays READ even with nothing costed yet (it never opens straight in the form)', async () => {
    renderFoodcost('/food-cost/product/cake-c1', { source: sourceWith([bareProduct('cake-c1', { name: 'Sacher', kind: 'finished' })]), data: { cakes } });
    expect(await screen.findByRole('link', { name: 'Open in Cakes' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('an employee sees the same read-only card', async () => {
    await openCard(CAKE_CARD, { session: EMPLOYEE });
    expect(screen.getByRole('link', { name: 'Open in Cakes' })).toHaveAttribute('href', '/cakes/c1');
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
  });

  it('an ordinary card has neither the band nor the link, and keeps its pencil', async () => {
    renderFoodcost('/food-cost/product/Green', { source: sourceWith([product('Green')]), session: MANAGER });
    expect(await screen.findByRole('button', { name: 'Edit product' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open in Cakes' })).not.toBeInTheDocument();
  });

  it('«Open in Cakes» goes to the cake, and Back there returns to the card in Food cost', async () => {
    const { user, router } = await openCard(CAKE_CARD, { session: MANAGER });
    const link = screen.getByRole('link', { name: 'Open in Cakes' });
    expect(link).toHaveAttribute('href', '/cakes/c1');
    await user.click(link);
    expect(await screen.findByRole('textbox', { name: 'Name' }, LOAD)).toHaveValue('Sacher');
    expect(router.state.location.pathname).toBe('/cakes/c1');
    expect(router.state.location.state).toMatchObject({ fromFoodcost: true });
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Sacher' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('link', { name: 'Open in Cakes' }, LOAD)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost/product/cake-c1');
  });
});

describe('the list', () => {
  it('tags a cake\'s row «Cake», and no other row; the cake sits in the «Cakes» group, the other card apart', async () => {
    const { user } = renderFoodcost('/food-cost', { source: sourceWith([CAKE_CARD, product('Green')]) });
    // The groups start closed: «Cakes» holds the cake, «No category» the other card.
    await user.click(await screen.findByRole('button', { name: /^Cakes/ }, LOAD));
    await user.click(screen.getByRole('button', { name: /^No category/ }));
    const cakeRow = await screen.findByRole('button', { name: /Sacher/ }, LOAD);
    expect(within(cakeRow).getByText('Cake')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Green/ })).queryByText('Cake')).not.toBeInTheDocument();
  });
});
