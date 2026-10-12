import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { bareProduct, LOAD, product, renderFoodcost, sourceWith, split } from '../testing/renderFoodcost';

// Where the page is scrolled to when Food cost moves between its list and a screen opened from it.
// The shell has ONE scroll area (the main landmark) and resets it at every address; Food cost owns it
// for the moves inside itself (shell/scrollArea.tsx), so these specs pin what it does with each
// move. jsdom does not lay out or scroll: the position is planted.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const source = () => sourceWith([product('Green'), product('Red', { sellingPrice: 0.5, vatRate: 0 }), bareProduct('Bare')]);

const rowOf = (name: RegExp) => screen.getByRole('button', { name });
const tabs = () => within(screen.getByRole('navigation', { name: 'Main sections' }));

async function loaded(path = '/food-cost') {
  const view = renderFoodcost(path, { source: source() });
  await screen.findByRole('button', { name: /^Green/ }, LOAD);
  return view;
}

// The shell's scroll area, scrolled to `top`.
function scrolledTo(top: number): HTMLElement {
  const main = screen.getByRole('main');
  Object.defineProperty(main, 'scrollTop', { value: top, writable: true });
  return main;
}

describe('the scroll on the tablet\'s split', () => {
  it('keeps the place in the list when a product is opened, and when another one is', async () => {
    split();
    const { user } = await loaded();
    const main = scrolledTo(900);

    await user.click(rowOf(/^Red/));
    await screen.findByRole('region', { name: 'Red' }, LOAD);
    expect(main.scrollTop).toBe(900);

    await user.click(rowOf(/^Green/));
    await screen.findByRole('region', { name: 'Green' }, LOAD);
    expect(main.scrollTop).toBe(900);
  });

  // The right-hand side scrolls on its own on the split and stays mounted from one screen to the
  // next. jsdom does not scroll, so the position is planted.
  it('starts the next screen at the top of the right-hand side, not where the last was left', async () => {
    split();
    const { user } = await loaded();
    await user.click(rowOf(/^Red/));
    const detail = screen.getByRole('region', { name: 'Red' }).closest('[data-view] > *') as HTMLElement;
    Object.defineProperty(detail, 'scrollTop', { value: 300, writable: true });

    await user.click(rowOf(/^Green/));
    await screen.findByRole('region', { name: 'Green' }, LOAD);
    expect(detail.scrollTop).toBe(0);
  });
});

describe('the scroll on a phone', () => {
  it('opens a product at the top, and Back brings the list to the place it was left at, with the focus on its row', async () => {
    const { user } = await loaded();
    const main = scrolledTo(700);

    await user.click(rowOf(/^Red/));
    await screen.findByRole('region', { name: 'Red' }, LOAD);
    expect(main.scrollTop).toBe(0);

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(main.scrollTop).toBe(700);
    expect(rowOf(/^Red/)).toHaveFocus();
  });

  it.each([
    ['New product', 'New product'],
    ['Settings', 'Food cost settings'],
  ])('opens «%s» at the top, and Back brings the list to the place it was left at', async (button, title) => {
    const { user } = await loaded();
    const main = scrolledTo(700);

    await user.click(screen.getByRole('button', { name: button }));
    await screen.findByRole('heading', { level: 2, name: title }, LOAD);
    expect(main.scrollTop).toBe(0);

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(main.scrollTop).toBe(700);
    expect(screen.getByRole('button', { name: button })).toHaveFocus();
  });

  it('shows the list at the top when Back leaves a product that was opened by its address', async () => {
    const { user } = await loaded('/food-cost/product/Red');
    const main = scrolledTo(400);

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));

    expect(await screen.findByRole('button', { name: /^Green/ })).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });

  // Owning the scroll is for the moves INSIDE the section: leaving for another section is reset by the
  // shell as ever.
  it('starts the next section at the top when Food cost is left for another one', async () => {
    const { user } = await loaded();
    const main = scrolledTo(400);

    await user.click(tabs().getByRole('link', { name: 'Stocktake' }));
    await screen.findByRole('heading', { level: 1, name: 'Stocktake' }, LOAD);
    expect(main.scrollTop).toBe(0);
  });
});

// The phone's own back gesture is the browser's Back: it runs no code of the screen it leaves, so
// the button that opened it is owed the focus from the moment it opened.
describe('the focus when Food cost comes back to its list', () => {
  it('goes back to the row when the phone\'s own Back leaves a product', async () => {
    const { router, user } = await loaded();
    await user.click(rowOf(/^Red/));
    await screen.findByRole('region', { name: 'Red' }, LOAD);

    await act(async () => { await router.navigate(-1); });

    expect(router.state.location.pathname).toBe('/food-cost');
    await waitFor(() => { expect(rowOf(/^Red/)).toHaveFocus(); });
  });

  it('goes back to Settings when the phone\'s own Back leaves it', async () => {
    const { router, user } = await loaded();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { level: 2, name: 'Food cost settings' }, LOAD);

    await act(async () => { await router.navigate(-1); });

    await waitFor(() => { expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus(); });
  });
});
