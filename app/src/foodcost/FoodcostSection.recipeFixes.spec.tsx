import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { FROM_RECIPE_LINK } from '@mise/shared/recipe-link';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost, split } from '../testing/renderFoodcost';
import { entriesBehind, madeWith } from '../testing/recipeLinkHelpers';

// Step 3d-7, slice B: the fixes of the review — where the focus goes after «Show all», the narrowed list's Back after a
// rotation, and a dirty product beside the narrowed list.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const DOUGH = recipe('dough', { name: 'Dough' });
const LOAF = product('Loaf', { name: 'Loaf', components: madeWith('dough') });
const ROLL = product('Roll', { name: 'Roll', components: madeWith('dough') });
const TART = product('Tart', { name: 'Tart' });

const fromRecipe = () => [
  '/recipes/dough',
  { pathname: '/food-cost', search: '?recipe=dough', state: FROM_RECIPE_LINK },
];

const where = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

// A screen that can be turned: the split query answers by hand and tells its listeners when it changes.
function rotatable() {
  let wide = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return wide && query === '(min-width: 1000px)'; },
    media: query,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
  }));
  return () => { wide = true; listeners.forEach(listener => { listener(); }); };
}

const open = () => renderFoodcost('/food-cost', {
  entries: fromRecipe(), source: editorSource([LOAF, ROLL, TART], { recipes: [DOUGH] }),
});

describe('⚠️ «Show all» keeps the focus on the page', () => {
  it('on a phone: the focus goes to the page heading, not to <body>', async () => {
    const { user } = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('heading', { level: 1, name: 'Food cost' })).toHaveFocus(); });
  });

  it('on the split with a product open beside it: the heading as well, and the product stays', async () => {
    split();
    const { user } = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Loaf/ }));
    await screen.findByRole('heading', { level: 2, name: 'Loaf' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => { expect(screen.getByRole('heading', { level: 1, name: 'Food cost' })).toHaveFocus(); });
    expect(screen.getByRole('heading', { level: 2, name: 'Loaf' })).toBeInTheDocument();
  });
});

describe('⚠️ a rotation from the phone to the split keeps «came from the recipe»', () => {
  it('the product and history Back replace with ?using=, and the narrowed list’s Back still reaches the recipe with no second entry', async () => {
    const turn = rotatable();
    const { router, user } = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Loaf/ }));
    await user.click(within(await screen.findByRole('region', { name: 'Loaf' }, LOAD)).getByRole('button', { name: 'Margin history' }));
    await screen.findByRole('region', { name: 'Margin history' }, LOAD);
    expect(where(router)).toBe('/food-cost/product/Loaf/history?using=dough');

    // The tablet is turned: the split. The history's Back replaces itself with the product.
    await act(async () => { turn(); });
    await user.click(within(screen.getByRole('region', { name: 'Margin history' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost/product/Loaf?using=dough'); });

    // The product’s own Back goes to the narrowed list: the entry two behind it, not a new one.
    await user.click(within(await screen.findByRole('region', { name: 'Loaf' }, LOAD)).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/food-cost?using=dough'); });
    expect(router.state.historyAction).toBe('POP');

    await user.click(within(screen.getByRole('main')).getAllByRole('button', { name: 'Back' })[0]!);
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });
});

describe('⚠️ a dirty product beside the narrowed list, on the split', () => {
  const dirty = async () => {
    split();
    const trip = open();
    await screen.findByRole('heading', { level: 2, name: 'Products with “Dough”' }, LOAD);
    await trip.user.click(screen.getByRole('button', { name: /^Loaf/ }));
    await screen.findByRole('region', { name: 'Loaf' }, LOAD);
    await trip.user.type(screen.getByRole('combobox', { name: 'Name' }), '!');
    await trip.user.click(within(screen.getByRole('main')).getAllByRole('button', { name: 'Back' })[0]!);
    return trip;
  };

  it('the list’s Back asks first; Cancel keeps the product and the typing', async () => {
    const { router, user } = await dirty();
    const question = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(question).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(where(router)).toBe('/food-cost/product/Loaf?using=dough');
    expect(screen.getByRole('combobox', { name: 'Name' })).toHaveValue('Loaf!');
  });

  it('Discard lands on the recipe with no second entry', async () => {
    const { router, user } = await dirty();
    const question = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(question).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });
});
