import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { EMPLOYEE, LOAD, MANAGER, product, renderFoodcost, sourceWith } from '../testing/renderFoodcost';

// Who sees what. Whoever runs the place (the owner, a manager) sees Settings, which holds a wage
// figure; an employee shown Food cost sees the products and nothing of the labour cost.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const PRODUCTS = [product('Green')];
const settingsButton = () => screen.queryByRole('button', { name: 'Settings' });

describe('Settings on the list', () => {
  it.each([['the owner', {}], ['a manager', MANAGER]])('is offered to %s', async (_who, session) => {
    renderFoodcost('/food-cost', { session, source: sourceWith(PRODUCTS) });
    await screen.findByRole('button', { name: /^Green/ }, LOAD);
    expect(settingsButton()).toBeInTheDocument();
  });

  it('is not offered to an employee, who still sees the products', async () => {
    renderFoodcost('/food-cost', { session: EMPLOYEE, source: sourceWith(PRODUCTS) });
    await screen.findByRole('button', { name: /^Green/ }, LOAD);
    expect(screen.getByRole('button', { name: 'New product' })).toBeInTheDocument();
    expect(settingsButton()).not.toBeInTheDocument();
  });

  it('opens the hourly labour cost', async () => {
    const { router, user } = renderFoodcost('/food-cost', { source: sourceWith(PRODUCTS) });
    await user.click(await screen.findByRole('button', { name: 'Settings' }, LOAD));
    expect(router.state.location.pathname).toBe('/food-cost/settings');
    expect(await screen.findByRole('heading', { level: 2, name: 'Food cost settings' }, LOAD)).toBeInTheDocument();
  });
});

describe('the Settings address for an employee', () => {
  it('sends an employee to the list and draws nothing of the labour cost', async () => {
    const fake = sourceWith(PRODUCTS, { settings: { labourCostPerHour: 14 } });
    const { router } = renderFoodcost('/food-cost/settings', { session: EMPLOYEE, source: fake });

    expect(await screen.findByRole('button', { name: /^Green/ }, LOAD)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost');
    expect(screen.queryByRole('heading', { name: 'Food cost settings' })).not.toBeInTheDocument();
    expect(screen.queryByText('Labour cost per hour (£)')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('14')).not.toBeInTheDocument();
  });

  // The labour rate is a wage figure: the store never even listens for it for an employee.
  it('never asks for the labour cost on behalf of an employee', async () => {
    const fake = sourceWith(PRODUCTS, { settings: { labourCostPerHour: 14 } });
    renderFoodcost('/food-cost', { session: EMPLOYEE, source: fake });
    await screen.findByRole('button', { name: /^Green/ }, LOAD);
    expect(fake.watchSettings).not.toHaveBeenCalled();
  });

  it('asks for it on behalf of whoever runs the place', async () => {
    const fake = sourceWith(PRODUCTS);
    renderFoodcost('/food-cost', { source: fake });
    await screen.findByRole('button', { name: /^Green/ }, LOAD);
    expect(fake.watchSettings).toHaveBeenCalledTimes(1);
  });
});
