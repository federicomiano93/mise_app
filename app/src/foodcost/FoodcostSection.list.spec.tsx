import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { bareProduct, LOAD, product, renderFoodcost, sourceWith, split } from '../testing/renderFoodcost';

// The list of products: worst food cost first, what each row says, the loading and empty states and
// the way into a product. Who sees Settings is in FoodcostSection.people.spec.tsx.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// A flour at £2.00 a kilo in a batch of ten: a piece costs £0.20, and the price decides the rest.
const PRODUCTS = [
  product('Green'),
  product('Red', { sellingPrice: 0.5, vatRate: 0 }),
  product('Amber', { sellingPrice: 0.77, vatRate: 0 }),
  product('NoTarget', { sellingPrice: 1, vatRate: 0, foodCostTarget: null }),
  bareProduct('Bare'),
  bareProduct('Nameless', { name: '' }),
];

const rows = () => within(screen.getByRole('main')).getAllByRole('listitem');
const rowOf = (name: RegExp) => screen.getByRole('button', { name });
const newButton = () => screen.getByRole('button', { name: 'New product' });

async function loaded(path = '/food-cost', fake = sourceWith(PRODUCTS), options = {}) {
  const view = renderFoodcost(path, { source: fake, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

describe('the list of products', () => {
  it('puts the worst food cost first, and what cannot be costed last, by name', async () => {
    await loaded();
    const names = rows().map(row => row.textContent?.match(/^(Green|Red|Amber|NoTarget|Bare|Untitled product)/)?.[1]);
    expect(names).toEqual(['Red', 'Amber', 'Green', 'NoTarget', 'Untitled product', 'Bare']);
  });

  it.each([
    [/^Red/, 'Over target  ·  £0.20 cost  ·  £0.30 margin', '40%'],
    [/^Amber/, 'Slightly over  ·  £0.20 cost  ·  £0.57 margin', '25.97%'],
    [/^Green/, 'On target  ·  £0.20 cost  ·  £0.80 margin', '20%'],
    [/^NoTarget/, 'No target set  ·  £0.20 cost  ·  £0.80 margin', '20%'],
  ])('says, for a product that can be costed, its status in words, its cost, its margin and its food cost', async (name, line, figure) => {
    await loaded();
    const row = rowOf(name);
    expect(row).toHaveTextContent(line.replace(/ {2}/g, ' '));
    expect(row).toHaveTextContent(figure);
  });

  // The traffic light is a dot AND a word: the dot is hidden from a screen reader, and the word is
  // in the row's name.
  it('draws the light as a dot that a screen reader skips, beside the word that says it', async () => {
    await loaded();
    const row = rowOf(/^Red/);
    expect(row.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(row).toHaveAccessibleName(/Over target/);
  });

  it('says what is missing, instead of a figure, for a product that cannot be costed', async () => {
    await loaded();
    const row = rowOf(/^Bare/);
    expect(row).toHaveTextContent('Add at least one recipe or ingredient to this product');
    expect(row).toHaveTextContent('—');
    expect(row).not.toHaveTextContent('%');
  });

  it('calls a product with no name «Untitled product»', async () => {
    await loaded();
    expect(rowOf(/^Untitled product/)).toBeInTheDocument();
  });

  it('shows «Loading…» until the products have answered, then the list', async () => {
    const fake = sourceWith(PRODUCTS);
    fake.hold();
    renderFoodcost('/food-cost', { source: fake });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
    fake.release();
    expect(await screen.findByRole('button', { name: /^Red/ }, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('marks the product that is open beside the list', async () => {
    split();
    const { user } = await loaded();
    await user.click(rowOf(/^Green/));
    await screen.findByRole('region', { name: 'Green' }, LOAD);
    expect(rowOf(/^Green/)).toHaveAttribute('aria-current', 'true');
    expect(rowOf(/^Red/)).not.toHaveAttribute('aria-current');
  });
});

describe('the way into a product', () => {
  it('opens a product from its row', async () => {
    const { router, user } = await loaded();
    await user.click(rowOf(/^Red/));
    expect(router.state.location.pathname).toBe('/food-cost/product/Red');
    expect(await screen.findByRole('heading', { level: 2, name: 'Red' }, LOAD)).toBeInTheDocument();
  });

  it('opens a new product from «New product»', async () => {
    const { router, user } = await loaded();
    await user.click(newButton());
    expect(router.state.location.pathname).toBe('/food-cost/new');
    expect(await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD)).toBeInTheDocument();
  });

  it('steps back to the list with the focus on the button that opened the screen', async () => {
    const { user } = await loaded();
    await user.click(newButton());
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(newButton()).toHaveFocus();
  });

  it('replaces what is open, instead of piling it up, when another product is picked beside the list', async () => {
    split();
    const { router, user } = await loaded();
    await user.click(rowOf(/^Red/));
    await user.click(rowOf(/^Green/));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(router.state.historyAction).toBe('REPLACE');
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('sends an address it does not know back to the list', async () => {
    const { router } = await loaded('/food-cost/nonsense/at/all');
    expect(router.state.location.pathname).toBe('/food-cost');
  });
});

describe('when there are no products', () => {
  it('says so, says what a product is, and offers to add one', async () => {
    const { router, user } = renderFoodcost('/food-cost', { source: sourceWith([]) });
    expect(await screen.findByText('No products yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Add one to see what it costs to make and what it earns.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add a product' }));
    expect(router.state.location.pathname).toBe('/food-cost/new');
  });

  it('puts the focus back on «New product» when Back leaves the new product opened from there', async () => {
    const { user } = renderFoodcost('/food-cost', { source: sourceWith([]) });
    await user.click(await screen.findByRole('button', { name: 'Add a product' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(newButton()).toHaveFocus();
  });
});

describe('the prompt beside the list', () => {
  it('invites a tap on a product while nothing is chosen', async () => {
    split();
    await loaded();
    expect(screen.getByText('Choose a product')).toBeInTheDocument();
    expect(screen.getByText(/^Tap a product on the left/)).toBeInTheDocument();
  });

  // A prompt to tap a product, beside a list that says there are none, would send somebody looking
  // for what is not there.
  it('is not drawn beside «No products yet»', async () => {
    split();
    renderFoodcost('/food-cost', { source: sourceWith([]) });
    await screen.findByText('No products yet', undefined, LOAD);
    expect(screen.queryByText('Choose a product')).not.toBeInTheDocument();
  });
});

describe('what the store says when the products\' stream breaks', () => {
  it('says it in a status region that was there before it spoke', async () => {
    const fake = sourceWith(PRODUCTS);
    fake.refuse.products = true;
    renderFoodcost('/food-cost', { source: fake });
    const message = await screen.findByText('Live sync interrupted — products may be out of date.', undefined, LOAD);
    expect(message.closest('[role="status"]')).not.toBeNull();
  });
});

describe('the list in Italian', () => {
  it('speaks Italian, and writes the money of the venue\'s country', async () => {
    const fake = sourceWith([product('Rosso', { sellingPrice: 0.5, vatRate: 0 }), bareProduct('Vuoto', { name: '' })]);
    renderFoodcost('/food-cost', { source: fake, lang: 'it', session: { language: 'it', location: { country: 'IT' } } });
    const row = await screen.findByRole('button', { name: /^Rosso/ }, LOAD);

    expect(row).toHaveTextContent('Sopra l’obiettivo');
    expect(row).toHaveTextContent(/0,20\s€ di costo/);
    expect(row).toHaveTextContent(/0,30\s€ di margine/);
    expect(row).toHaveTextContent('40%');
    expect(screen.getByRole('button', { name: /^Prodotto senza nome/ })).toHaveTextContent('Aggiungi almeno una ricetta o un ingrediente a questo prodotto');
    expect(screen.getByRole('button', { name: 'Nuovo prodotto' })).toBeInTheDocument();
  });

  it('writes the food cost with the comma Italian uses', async () => {
    const fake = sourceWith([product('Misto', { sellingPrice: 0.77, vatRate: 0 })]);
    renderFoodcost('/food-cost', { source: fake, lang: 'it', session: { language: 'it' } });
    expect(await screen.findByRole('button', { name: /^Misto/ }, LOAD)).toHaveTextContent('25,97%');
  });
});
