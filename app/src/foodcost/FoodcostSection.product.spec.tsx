import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { bareProduct, LOAD, product, renderFoodcost, sourceWith } from '../testing/renderFoodcost';

// The product's screen by its address: it opens, a product that is not there says so only once the
// server has answered, Back steps up, and the title takes the focus. What the editor does is in
// FoodcostSection.editor*.spec.tsx.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('a product by its address', () => {
  it('opens the product, named, with its answer at the top', async () => {
    renderFoodcost('/food-cost/product/Green', { source: sourceWith([product('Green', { name: 'Cornetto' })]) });
    expect(await screen.findByRole('heading', { level: 2, name: 'Cornetto' }, LOAD)).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Cornetto' });
    expect(within(region).getByRole('group', { name: 'Food cost' })).toHaveTextContent(/20%.*On target/);
  });

  it('says what is missing when the product cannot be costed', async () => {
    renderFoodcost('/food-cost/product/Bare', { source: sourceWith([bareProduct('Bare')]) });
    const region = await screen.findByRole('region', { name: 'Bare' }, LOAD);
    expect(within(region).getByRole('group', { name: 'Food cost' })).toHaveTextContent('Add at least one recipe or ingredient to this product');
  });

  it('calls a product with no name «Untitled product»', async () => {
    renderFoodcost('/food-cost/product/Bare', { source: sourceWith([bareProduct('Bare', { name: '' })]) });
    expect(await screen.findByRole('heading', { level: 2, name: 'Untitled product' }, LOAD)).toBeInTheDocument();
  });

  it('opens the product whose id has a slash and a space in it', async () => {
    renderFoodcost('/food-cost/product/a%2Fb%20c', { source: sourceWith([product('a/b c', { name: 'Odd' })]) });
    expect(await screen.findByRole('heading', { level: 2, name: 'Odd' }, LOAD)).toBeInTheDocument();
  });

  it('says «Loading…» until the server has answered, never «no longer exists» before', async () => {
    const fake = sourceWith([product('Green')]);
    fake.hold();
    renderFoodcost('/food-cost/product/Nope', { source: fake });
    const loading = await screen.findAllByText('Loading…', undefined, LOAD);
    expect(loading.length).toBeGreaterThan(0);
    expect(screen.queryByText('This product no longer exists.')).not.toBeInTheDocument();

    act(() => { fake.release(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'This product no longer exists.' }, LOAD)).toBeInTheDocument();
  });

  // Review finding: the form copies its product once and Save writes it whole, so a form opened from
  // a week-old local copy would write last week's price back over another phone's change.
  it('⚠️ a product found only in an old local copy waits for the server, then shows the server’s version', async () => {
    window.localStorage.setItem('foodcost-products', JSON.stringify([product('Green', { name: 'Cornetto', sellingPrice: 1.2 })]));
    const fake = sourceWith([product('Green', { name: 'Cornetto', sellingPrice: 2.4 })]);
    fake.hold();
    renderFoodcost('/food-cost/product/Green', { source: fake });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 2, name: 'Cornetto' })).not.toBeInTheDocument();

    act(() => { fake.release(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Cornetto' }, LOAD)).toBeInTheDocument();
    expect(screen.getByDisplayValue('2.4')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('1.2')).not.toBeInTheDocument();
  });

  it('with no signal, a product in the local copy opens from it — nothing better will come', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    window.localStorage.setItem('foodcost-products', JSON.stringify([product('Green', { name: 'Cornetto' })]));
    const fake = sourceWith([]);
    fake.hold();
    renderFoodcost('/food-cost/product/Green', { source: fake });
    expect(await screen.findByRole('heading', { level: 2, name: 'Cornetto' }, LOAD)).toBeInTheDocument();
  });

  it('says it no longer exists, with a Back, when the id is not among the products', async () => {
    const { router, user } = renderFoodcost('/food-cost/product/Nope', { source: sourceWith([product('Green')]) });
    await screen.findByRole('heading', { level: 2, name: 'This product no longer exists.' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('steps back to the list', async () => {
    const { router, user } = renderFoodcost('/food-cost/product/Green', { source: sourceWith([product('Green')]) });
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/food-cost');
  });

});

describe('a new product by its address', () => {
  it('opens a screen of its own, titled «New product»', async () => {
    renderFoodcost('/food-cost/new', { source: sourceWith([]) });
    expect(await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD)).toBeInTheDocument();
  });
});

describe('the page', () => {
  it.each([
    '/food-cost', '/food-cost/new', '/food-cost/product/Green', '/food-cost/product/Green/history', '/food-cost/settings',
  ])('has one h1, «Food cost», at %s', async path => {
    renderFoodcost(path, { source: sourceWith([product('Green')]) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Food cost' }, LOAD)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('gives the browser tab the section\'s name', async () => {
    renderFoodcost('/food-cost', { source: sourceWith([]) });
    await screen.findByRole('heading', { level: 1, name: 'Food cost' }, LOAD);
    expect(document.title).toMatch(/Food cost/);
  });
});

describe('a product in Italian', () => {
  it('says the product is gone in Italian', async () => {
    renderFoodcost('/food-cost/product/Nope', { source: sourceWith([product('Green')]), lang: 'it', session: { language: 'it' } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Questo prodotto non esiste più.' }, LOAD)).toBeInTheDocument();
  });
});
