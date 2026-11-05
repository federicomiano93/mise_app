import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { LOAD, product, renderFoodcost, sourceWith, split } from '../testing/renderFoodcost';

// A product's margin history: the points, the note, the empty and failed answers, and the way back
// to the product.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const POINTS = [
  { id: 'h2', recordedAt: '2026-10-14T09:00:00.000Z', foodCostPct: 31.5, unitCost: 0.35, sellingPrice: 1.5, vatRate: 20 },
  { id: 'h1', recordedAt: '2026-09-02T09:00:00.000Z', foodCostPct: 28, unitCost: 0.0345, sellingPrice: 1.4, vatRate: 5 },
];

function source(history: Record<string, typeof POINTS> = { Green: POINTS }) {
  return sourceWith([product('Green')], { history });
}

const heading = (name: string) => screen.findByRole('heading', { level: 2, name }, LOAD);

describe('the margin history', () => {
  it('shows each point: the food cost, what it cost and sold for, the date — and the note', async () => {
    renderFoodcost('/food-cost/product/Green/history', { source: source() });
    await heading('Margin history');

    const rows = await within(await screen.findByRole('region', { name: 'Margin history' }, LOAD)).findAllByRole('listitem', undefined, LOAD);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('31.5%');
    expect(rows[0]).toHaveTextContent('£0.35 cost · £1.50 at 20% VAT');
    expect(rows[0]).toHaveTextContent('14 Oct 2026');
    // A cost per unit keeps the decimals a small number needs; a total has two.
    expect(rows[1]).toHaveTextContent('28%');
    expect(rows[1]).toHaveTextContent('£0.0345 cost · £1.40 at 5% VAT');
    expect(rows[1]).toHaveTextContent('2 Sept 2026');
    expect(screen.getByText(/^A point is recorded when the price or the recipe changes/)).toBeInTheDocument();
  });

  it('names the product under the title', async () => {
    renderFoodcost('/food-cost/product/Green/history', { source: source() });
    await heading('Margin history');
    expect(within(screen.getByRole('region', { name: 'Margin history' })).getByText('Green')).toBeInTheDocument();
  });

  it('says «Loading…» until the points arrive', async () => {
    const fake = source();
    let answer: (points: typeof POINTS) => void = () => undefined;
    vi.mocked(fake.getProductHistory).mockImplementation(() => new Promise(resolve => { answer = resolve as typeof answer; }));
    renderFoodcost('/food-cost/product/Green/history', { source: fake });
    const region = await screen.findByRole('region', { name: 'Margin history' }, LOAD);
    expect(within(region).getByText('Loading…')).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'true');

    await act(async () => { answer(POINTS); });
    expect(await within(region).findByText('31.5%')).toBeInTheDocument();
    expect(within(region).queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('says so when nothing has been recorded yet', async () => {
    renderFoodcost('/food-cost/product/Green/history', { source: source({}) });
    expect(await screen.findByText('Nothing recorded yet. A point is added whenever the price or the recipe changes.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/^A point is recorded when/)).not.toBeInTheDocument();
  });

  it('says so when the history could not be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = source();
    fake.refuse.history = true;
    renderFoodcost('/food-cost/product/Green/history', { source: fake });
    expect(await screen.findByText('Could not load the history — check your connection and try again.', undefined, LOAD)).toBeInTheDocument();
  });

  // Read on demand, never watched: a point is added by a save, and a save returns to the list.
  it('reads the history once, even when the products change meanwhile', async () => {
    const fake = source();
    renderFoodcost('/food-cost/product/Green/history', { source: fake });
    await screen.findByText('31.5%', undefined, LOAD);
    act(() => { fake.push(); });
    expect(fake.getProductHistory).toHaveBeenCalledTimes(1);
    expect(fake.getProductHistory).toHaveBeenCalledWith('Green');
  });

  it('reads the history of the product in the address, id decoded', async () => {
    const fake = sourceWith([product('a/b c')], { history: { 'a/b c': POINTS } });
    renderFoodcost('/food-cost/product/a%2Fb%20c/history', { source: fake });
    expect(await screen.findByText('31.5%', undefined, LOAD)).toBeInTheDocument();
    expect(fake.getProductHistory).toHaveBeenCalledWith('a/b c');
  });
});

describe('the way to the history and back', () => {
  it('goes from the product to its history and back to the product, one level at a time', async () => {
    const { router, user } = renderFoodcost('/food-cost/product/Green', { source: source() });
    await user.click(await screen.findByRole('button', { name: 'Margin history' }, LOAD));
    await heading('Margin history');
    expect(router.state.location.pathname).toBe('/food-cost/product/Green/history');
    expect(router.state.historyAction).toBe('PUSH');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(await heading('Green')).toBeInTheDocument();
  });

  it('puts the product in its place when it was opened by its address', async () => {
    const { router, user } = renderFoodcost('/food-cost/product/Green/history', { source: source() });
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('takes the product\'s place beside the list, so the list\'s next pick still replaces', async () => {
    split();
    const fake = sourceWith([product('Green'), product('Red')], { history: { Green: POINTS } });
    const { router, user } = renderFoodcost('/food-cost', { source: fake });
    await user.click(await screen.findByRole('button', { name: /^Green/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Margin history' }, LOAD));
    await screen.findByText('31.5%', undefined, LOAD);
    expect(router.state.historyAction).toBe('REPLACE');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost');
  });
});

describe('the margin history in Italian', () => {
  it('speaks Italian, with the date and the money of the venue', async () => {
    renderFoodcost('/food-cost/product/Green/history', {
      source: source(), lang: 'it', session: { language: 'it', location: { country: 'IT' } },
    });
    await heading('Storico dei margini');
    const rows = await within(screen.getByRole('region', { name: 'Storico dei margini' })).findAllByRole('listitem', undefined, LOAD);
    expect(rows[0]).toHaveTextContent('31,5%');
    expect(rows[0]).toHaveTextContent(/0,35\s€ di costo · 1,50\s€ con IVA al 20%/);
    expect(rows[0]).toHaveTextContent('14 ott 2026');
    expect(screen.getByText(/^Un punto viene registrato quando cambia il prezzo o la ricetta/)).toBeInTheDocument();
  });
});
