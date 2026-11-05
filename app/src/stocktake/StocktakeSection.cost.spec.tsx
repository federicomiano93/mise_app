import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { it as italian } from '../i18n/it';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import {
  closedMonthDoc, freezeClock, ingredient, monthDoc, renderStocktake,
} from '../testing/renderStocktake';

// «What the month cost»: the total, what it rests on, the rows most expensive first with the ones
// that could not be valued last and why, the caveat, and who may see it. Money follows the venue's
// country; quantities follow the interface language.

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

const EMPLOYEE = {
  canManage: false,
  isOwner: false,
  role: 'staff' as const,
  location: { country: 'GB', staffShownCards: { inventory: true } },
};
const MANAGER = { canManage: true, isOwner: false, role: 'manager' as const };
const IT_VENUE = { location: { country: 'IT' } };

const INGREDIENTS = [
  // A sack of 25 kg at 0.80 a kilo is worth 20.
  ingredient('flour', { name: 'Farina 00', shortName: 'Farina', weight: '25kg', unit: 'sacco', category: 'Dispensa' }),
  // A kilo at 8.
  ingredient('butter', { name: 'Burro', weight: '1kg', unit: 'pz', category: 'Frigo' }),
  // No price at all, and no unit.
  ingredient('sugar', { name: 'Zucchero', weight: '1kg', unit: '', category: 'Dispensa' }),
  // A price per kilo, but nothing says what a pack weighs.
  ingredient('cocoa', { name: 'Cacao', weight: 'sacco', unit: 'sacco', category: 'Dispensa' }),
  // Never counted.
  ingredient('salt', { name: 'Sale', weight: '1kg', unit: 'kg', category: 'Dispensa' }),
];

const PRICES = {
  flour: { priceUnit: 'kg', pricePerUnit: 0.8 },
  butter: { priceUnit: 'kg', pricePerUnit: 8 },
  cocoa: { priceUnit: 'kg', pricePerUnit: 5 },
  salt: { priceUnit: 'kg', pricePerUnit: 1 },
};

// Flour 22 sacks (440), butter 4 (32), sugar 3 (no price), cocoa 2 (no pack weight).
const COUNTED = {
  opening: { flour: 30, butter: 10, sugar: 5, cocoa: 4 },
  closing: { flour: 8, butter: 6, sugar: 2, cocoa: 2 },
};

function source(months = [monthDoc('2026-10', COUNTED)], ingredients = INGREDIENTS) {
  return fakeStocktakeSource({ months, ingredients, prices: PRICES });
}

type Options = Parameters<typeof renderStocktake>[1];

const cost = () => screen.findByRole('region', { name: 'What the month cost' }, LOAD);
const inCost = () => within(screen.getByRole('region', { name: 'What the month cost' }));
const rowNames = () => inCost().getAllByRole('listitem').map(row => row.querySelector('span')?.textContent);

async function open(fake = source(), options: Options = {}, month = '2026-10') {
  const view = renderStocktake(`/stocktake/${month}/cost`, { source: fake, ...options });
  await cost();
  return { ...view, fake };
}

describe('what the month cost: the total', () => {
  it('adds up the rows that have a value, in the venue\'s money', async () => {
    await open(source(), { session: { location: { country: 'GB' } } });
    expect(inCost().getByText('Cost of what was used')).toBeInTheDocument();
    expect(inCost().getByText('£472.00')).toBeInTheDocument();
  });

  it('writes it in euros, in the Italian layout, for an Italian venue — whatever the language', async () => {
    await open(source(), { session: IT_VENUE, lang: 'en' });
    expect(inCost().getByText('472,00 €')).toBeInTheDocument();
    expect(inCost().getByText('440,00 €')).toBeInTheDocument();
  });

  it('writes it in pounds for a British venue even in Italian, and the quantities with a comma', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 30 }, closing: { flour: 2.5 } })]);
    renderStocktake('/stocktake/2026-10/cost', { source: fake, session: { location: { country: 'GB' } }, lang: 'it' });
    const region = within(await screen.findByRole('region', { name: italian['stock.costTitle'] }, LOAD));
    // The total, and the only row.
    expect(region.getAllByText('£550.00')).toHaveLength(2);
    expect(region.getByText('27,5 sacco')).toBeInTheDocument();
  });

  it('says how many products it rests on, and how many have no value yet', async () => {
    await open();
    expect(inCost().getByText('Worked out from 4 counted, of which 2 have no value yet.')).toBeInTheDocument();
  });

  it('says it with the singular when one product has no value', async () => {
    const fake = source([monthDoc('2026-10', {
      opening: { flour: 30, sugar: 5 }, closing: { flour: 8, sugar: 2 },
    })]);
    await open(fake);
    expect(inCost().getByText('Worked out from 2 counted, of which 1 has no value yet.')).toBeInTheDocument();
  });

  it('says the plain sentence when every row has a value, agreeing with the number counted', async () => {
    const fake = source([monthDoc('2026-10', {
      opening: { flour: 30, butter: 10 }, closing: { flour: 8, butter: 6 },
    })]);
    await open(fake);
    expect(inCost().getByText('Worked out from 2 products you counted.')).toBeInTheDocument();
  });

  it('says «1 product you counted» for a single row', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 30 }, closing: { flour: 8 } })]);
    await open(fake);
    expect(inCost().getByText('Worked out from 1 product you counted.')).toBeInTheDocument();
  });
});

describe('what the month cost: the rows', () => {
  it('puts the most expensive first and the rows with no value last', async () => {
    await open();
    expect(rowNames()).toEqual(['Farina 25kg', 'Burro 1kg', 'Cacao sacco', 'Zucchero 1kg']);
  });

  it('gives each row its money on the right, and the quantity under the name', async () => {
    await open();
    const rows = inCost().getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('22 sacco')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('£440.00')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('4 pz')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('£32.00')).toBeInTheDocument();
  });

  // ⚠️ IT NEVER HIDES THE ROWS IT COULD NOT VALUE: a total that silently leaves things out is a
  // total somebody will believe.
  it('keeps the rows it could not value, with the quantity counted and the reason', async () => {
    await open();
    const rows = inCost().getAllByRole('listitem');
    const cocoa = rows[2] as HTMLElement;
    expect(within(cocoa).getByText('2 sacco · pack weight unknown')).toBeInTheDocument();
    expect(within(cocoa).getByText('—')).toBeInTheDocument();
    expect(cocoa).toHaveAttribute('data-unvalued', 'true');
    const sugar = rows[3] as HTMLElement;
    expect(within(sugar).getByText('3 packs · no price entered')).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('data-unvalued', 'false');
  });

  it('leaves out a product nobody counted', async () => {
    await open();
    expect(inCost().queryByText('Sale 1kg')).not.toBeInTheDocument();
  });

  it('shows a negative use as it is: a wrong number is not hidden', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 5 }, closing: { flour: 8 } })]);
    await open(fake);
    expect(inCost().getByText('-3 sacco')).toBeInTheDocument();
  });

  it('says there is nothing to cost when nothing has been counted', async () => {
    await open(source([monthDoc('2026-10')]));
    expect(inCost().getByText('Nothing has been counted yet, so there is nothing to cost.')).toBeInTheDocument();
    expect(inCost().getByText('£0.00')).toBeInTheDocument();
    expect(inCost().queryAllByRole('listitem')).toHaveLength(0);
  });

  it('says that it is an estimate, not an accounting record', async () => {
    await open();
    expect(inCost().getByText(
      'It rests on the prices entered in the app and on the count somebody made. It is a good estimate of what the shelves gave up, not an accounting record.',
    )).toBeInTheDocument();
  });
});

describe('what the month cost: a closed month', () => {
  const closed = () => source([closedMonthDoc('2026-09', {
    names: { flour: 'Farina 25kg', butter: 'Burro 1kg', deleted: 'Old yeast 500g' },
    opening: { flour: 30, butter: 10, deleted: 8 },
    closing: { flour: 8, butter: 6, deleted: 2 },
    // The price of ONE counted unit when it closed; butter froze none.
    unitPrice: { flour: 12, deleted: 3 },
  })]);

  it('values it only at what it froze: never at today\'s price', async () => {
    await open(closed(), {}, '2026-09');
    // 22 sacks at the frozen 12 (today's would be 20), a deleted product at its frozen 3.
    expect(inCost().getByText('£282.00')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Farina 25kg', 'Old yeast 500g', 'Burro 1kg']);
    expect(within(inCost().getAllByRole('listitem')[0] as HTMLElement).getByText('£264.00')).toBeInTheDocument();
  });

  it('keeps a product deleted since: it still costs what it cost', async () => {
    await open(closed(), {}, '2026-09');
    const row = inCost().getAllByRole('listitem')[1] as HTMLElement;
    expect(within(row).getByText('£18.00')).toBeInTheDocument();
    expect(within(row).getByText('6 packs')).toBeInTheDocument();
  });

  it('says that a row has no value because none was recorded when the month closed', async () => {
    await open(closed(), {}, '2026-09');
    const row = inCost().getAllByRole('listitem')[2] as HTMLElement;
    expect(within(row).getByText('4 pz · no price recorded when the month closed')).toBeInTheDocument();
  });
});

describe('what the month cost: who sees it', () => {
  it('is sent back to the month\'s list when an employee opens the address, with nothing of it drawn', async () => {
    const { router } = renderStocktake('/stocktake/2026-10/cost', { source: source(), session: EMPLOYEE });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-10'); }, LOAD);
    expect(router.state.historyAction).toBe('REPLACE');
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    expect(screen.queryByRole('region', { name: 'What the month cost' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[£€]/);
  });

  it('is shown to a manager', async () => {
    await open(source(), { session: MANAGER });
    expect(inCost().getByText('£472.00')).toBeInTheDocument();
  });
});

describe('what the month cost: arriving and leaving', () => {
  const costButton = () => screen.getByRole('button', { name: 'What it cost' });

  it('puts the focus on its title when it opens from the list, and Back hands it back to the button', async () => {
    const { router, user } = renderStocktake('/stocktake/2026-10', { source: source() });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    await user.click(costButton());
    const title = await screen.findByRole('heading', { level: 2, name: 'What the month cost' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/cost');
    expect(router.state.historyAction).toBe('PUSH');
    expect(inCost().getByText('October 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-10'); });
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => { expect(costButton()).toHaveFocus(); });
  });

  it('opened by its address, Back replaces it with the list', async () => {
    const { router, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-10'); });
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => { expect(costButton()).toHaveFocus(); });
  });

  it('keeps the focus where it was when it is opened by its address', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 2, name: 'What the month cost' })).not.toHaveFocus();
  });

  it('speaks Italian', async () => {
    const { user } = renderStocktake('/stocktake/2026-10', { source: source(), lang: 'it' });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    await user.click(screen.getByRole('button', { name: italian['stock.seeCost'] }));
    expect(await screen.findByRole('heading', { level: 2, name: italian['stock.costTitle'] }, LOAD)).toBeInTheDocument();
    const region = within(screen.getByRole('region', { name: italian['stock.costTitle'] }));
    expect(region.getByText(italian['stock.costThisMonth'])).toBeInTheDocument();
    expect(region.getByText(italian['stock.costCaveat'])).toBeInTheDocument();
    expect(region.getByText('ottobre 2026')).toBeInTheDocument();
  });
});

describe('what the month cost: on the tablet\'s split', () => {
  function split() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1000px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  it('opens on the right beside the list, and picking a product replaces it, so Back still goes to the list', async () => {
    split();
    const { router, user } = renderStocktake('/stocktake/2026-10', { source: source() });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    await user.click(screen.getByRole('button', { name: 'What it cost' }));
    await cost();
    expect(router.state.historyAction).toBe('PUSH');
    expect(screen.getByRole('button', { name: 'Open Farina 25kg' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Farina 25kg' }));
    await screen.findByRole('region', { name: 'Farina 25kg' }, LOAD);
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/product/flour');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: 'What the month cost' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-10'); });
  });

  it('replaces a product with the cost when «What it cost» is pressed beside it', async () => {
    split();
    const { router, user } = renderStocktake('/stocktake/2026-10/product/flour', { source: source() });
    await screen.findByRole('region', { name: 'Farina 25kg' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'What it cost' }));
    await cost();
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/cost');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  // Changing month is lateral and lands on that month's LIST: the right-hand side goes back to
  // saying what to do, rather than showing one month's cost under another month's name.
  it('goes back to the prompt when the month is changed beside it', async () => {
    split();
    const { router, user } = renderStocktake('/stocktake/2026-10/cost', { source: source() });
    await cost();
    await user.click(screen.getByRole('button', { name: 'The month before' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-09'); });
    expect(screen.queryByRole('region', { name: 'What the month cost' })).not.toBeInTheDocument();
    expect(screen.getByText('Tap a product to see its figures.')).toBeInTheDocument();
  });
});
