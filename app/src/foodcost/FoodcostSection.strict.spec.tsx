import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import { LOAD, product, renderFoodcost, sourceWith } from '../testing/renderFoodcost';

// The app runs under React's StrictMode in development: every component is mounted, unmounted and
// mounted again, and every effect runs twice. The store is started, stopped and started again by its
// provider — none of that may double a watcher, leave the list empty or send a rate twice.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./FoodcostSection');
}, 60_000);

afterAll(() => {
  configure({ reactStrictMode: false });
});

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

describe('under StrictMode: Food cost', () => {
  it('draws the list, opens a product and steps back', async () => {
    const { router, user } = renderFoodcost('/food-cost', { source: sourceWith([product('Green')]) });
    await user.click(await screen.findByRole('button', { name: /^Green/ }, LOAD));
    expect(await screen.findByRole('heading', { level: 2, name: 'Green' }, LOAD)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost');
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Green/ })).toHaveFocus(); });
  });

  it('waits for the rate, then saves it once', async () => {
    const fake = sourceWith([product('Green')], { settings: { labourCostPerHour: 10 } });
    const { user } = renderFoodcost('/food-cost/settings', { source: fake });
    const box = await screen.findByRole('textbox', { name: 'Labour cost per hour (£)' }, LOAD);
    expect(box).toHaveValue('10');
    await user.type(box, '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const ask = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(ask).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(fake.saved).toHaveLength(1); });
    expect(fake.saved[0]).toMatchObject({ data: { labourCostPerHour: 105 } });
    expect(fake.watchSettings).toHaveBeenCalledTimes(2);
  });

  it('reads the history once for the product', async () => {
    const fake = sourceWith([product('Green')], { history: { Green: [{ id: 'h1', recordedAt: '2026-10-14T09:00:00.000Z', foodCostPct: 30, unitCost: 0.3, sellingPrice: 1, vatRate: 0 }] } });
    renderFoodcost('/food-cost/product/Green/history', { source: fake });
    expect(await screen.findByText('30%', undefined, LOAD)).toBeInTheDocument();
    // The simulated remount asks twice; each answer belongs to its own call and only one lands.
    expect(within(screen.getByRole('region', { name: 'Margin history' })).getAllByRole('listitem')).toHaveLength(1);
  });
});
