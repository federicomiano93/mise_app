import { createElement } from 'react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { LOAD, product, renderFoodcost, sourceWith, split } from '../testing/renderFoodcost';

// ⚠️ ONE FAILING PART MUST NOT TAKE THE OTHER DOWN: the list and the right-hand side are two parts,
// each in its own boundary. Either is made to throw while it draws, the other must keep working.
const broken = vi.hoisted(() => ({ list: false, detail: false }));

vi.mock('./FoodcostList', async importOriginal => {
  const actual = await importOriginal<typeof import('./FoodcostList')>();
  const Stand = (props: Parameters<typeof actual.FoodcostList>[0]) => {
    if (broken.list) throw new Error('the list failed to draw');
    return createElement(actual.FoodcostList as ComponentType<typeof props>, props);
  };
  return { ...actual, FoodcostList: Stand };
});

vi.mock('./FoodcostDetail', async importOriginal => {
  const actual = await importOriginal<typeof import('./FoodcostDetail')>();
  const Stand = (props: Parameters<typeof actual.FoodcostDetail>[0]) => {
    if (broken.detail) throw new Error('the right-hand side failed to draw');
    return createElement(actual.FoodcostDetail as ComponentType<typeof props>, props);
  };
  return { ...actual, FoodcostDetail: Stand };
});

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

let logged: MockInstance;

beforeEach(() => {
  window.localStorage.clear();
  broken.list = false;
  broken.detail = false;
  // React and React Router log every render error they catch; these are expected.
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));

describe('Food cost: a part that fails', () => {
  it('leaves the list working when the right-hand side fails to draw', async () => {
    broken.detail = true;
    const { user } = renderFoodcost('/food-cost', { source: sourceWith([product('Green')]) });

    expect(await screen.findByRole('button', { name: /^Green/ }, LOAD)).toBeInTheDocument();
    expect(main().getByText('This part didn’t load.')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    // The list still works: it opens a new product.
    await user.click(screen.getByRole('button', { name: 'New product' }));
    // The screen is still one screen: one h1, the rail still there.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'All sections' })).toBeInTheDocument();
  });

  it('leaves the right-hand side working when the list fails to draw', async () => {
    split();
    broken.list = true;
    renderFoodcost('/food-cost', { source: sourceWith([product('Green')]) });

    expect(await screen.findByText('This part didn’t load.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New product' })).not.toBeInTheDocument();
  });

  it('shows the section\'s heading even when both parts are down', async () => {
    broken.list = true;
    broken.detail = true;
    renderFoodcost('/food-cost', { source: sourceWith([]) });
    await screen.findAllByText('This part didn’t load.', undefined, LOAD);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Food cost');
  });
});
