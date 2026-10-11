import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import { freezeClock, ingredient, monthDoc, renderStocktake } from '../testing/renderStocktake';

// Where the page is scrolled to when the Stocktake moves between its list and a product. The shell
// has ONE scroll area (the main landmark) and resets it at every address; the Stocktake owns it for
// the moves inside itself (shell/scrollArea.tsx), so these specs pin what it does with each move.
// jsdom does not lay out or scroll: the position is planted, the way the list spec plants the
// right-hand side's.

beforeAll(async () => { await import('./StocktakeSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };

function source() {
  return fakeStocktakeSource({
    months: [monthDoc('2026-10')],
    ingredients: [
      ingredient('flour', { name: 'Farina 00', category: 'Dispensa' }),
      ingredient('butter', { name: 'Burro', category: 'Frigo' }),
      ingredient('yeast', { name: 'Lievito', category: 'Frigo' }),
    ],
  });
}

const openButton = (name: string) => screen.getByRole('button', { name: `Open ${name}` });
const tabs = () => within(screen.getByRole('navigation', { name: 'Main sections' }));

async function loaded(path = '/stocktake/2026-10') {
  const view = renderStocktake(path, { source: source() });
  await screen.findAllByRole('heading', { level: 3 }, LOAD);
  return view;
}

// The shell's scroll area, scrolled to `top`.
function scrolledTo(top: number): HTMLElement {
  const main = screen.getByRole('main');
  Object.defineProperty(main, 'scrollTop', { value: top, writable: true });
  return main;
}

function split() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1000px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('the Stocktake\'s scroll on the tablet\'s split', () => {
  it('keeps the place in the list when a product is opened, and when another one is', async () => {
    split();
    const { user } = await loaded();
    const main = scrolledTo(900);

    await user.click(openButton('Burro'));
    await screen.findByRole('region', { name: 'Burro' }, LOAD);
    expect(main.scrollTop).toBe(900);

    await user.click(openButton('Lievito'));
    await screen.findByRole('region', { name: 'Lievito' }, LOAD);
    expect(main.scrollTop).toBe(900);
  });
});

describe('the Stocktake\'s scroll on a phone', () => {
  it('opens a product at the top, and Back brings the list to the place it was left at, with the focus on its row', async () => {
    const { user } = await loaded();
    const main = scrolledTo(700);

    await user.click(openButton('Burro'));
    await screen.findByRole('region', { name: 'Burro' }, LOAD);
    expect(main.scrollTop).toBe(0);

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(main.scrollTop).toBe(700);
    expect(openButton('Burro')).toHaveFocus();
  });

  it('opens «What it cost» at the top, and Back brings the list to the place it was left at', async () => {
    const { user } = await loaded();
    const main = scrolledTo(700);

    await user.click(screen.getByRole('button', { name: 'What it cost' }));
    await screen.findByRole('region', { name: 'What the month cost' }, LOAD);
    expect(main.scrollTop).toBe(0);

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(main.scrollTop).toBe(700);
  });

  it('starts another month at the top', async () => {
    const { user } = await loaded();
    const main = scrolledTo(500);

    await user.click(screen.getByRole('button', { name: 'The month before' }));
    await screen.findByRole('heading', { level: 2, name: 'September 2026' }, LOAD);

    expect(main.scrollTop).toBe(0);
  });

  it('shows the list at the top when Back leaves a product that was opened by its address', async () => {
    const { user } = await loaded('/stocktake/2026-10/product/butter');
    const main = scrolledTo(400);

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));

    expect(await screen.findByRole('heading', { level: 3, name: 'Frigo' })).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });

  // The tab bar sends /stocktake, which the section replaces with the month's list: nothing owns the
  // scroll while that redirect is drawn, so the shell puts the area back at the top.
  it('starts at the top when the Stocktake is opened again from the tab bar', async () => {
    const { user } = await loaded('/stocktake/2026-10/product/butter');
    const main = scrolledTo(400);

    await user.click(tabs().getByRole('link', { name: 'Stocktake' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Frigo' }, LOAD)).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });
});
