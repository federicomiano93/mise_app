import { createElement } from 'react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import { freezeClock, ingredient, monthDoc, renderStocktake } from '../testing/renderStocktake';

// ⚠️ ONE FAILING PART MUST NOT TAKE THE OTHER DOWN: the list and the right-hand side are two parts,
// each in its own boundary. Either is made to throw while it draws, the other must keep working.
const broken = vi.hoisted(() => ({ list: false, detail: false }));

vi.mock('./StocktakeList', async importOriginal => {
  const actual = await importOriginal<typeof import('./StocktakeList')>();
  const Stand = (props: Parameters<typeof actual.StocktakeList>[0]) => {
    if (broken.list) throw new Error('the list failed to draw');
    return createElement(actual.StocktakeList as ComponentType<typeof props>, props);
  };
  return { ...actual, StocktakeList: Stand };
});

vi.mock('./StocktakeDetail', async importOriginal => {
  const actual = await importOriginal<typeof import('./StocktakeDetail')>();
  const Stand = (props: Parameters<typeof actual.StocktakeDetail>[0]) => {
    if (broken.detail) throw new Error('the right-hand side failed to draw');
    return createElement(actual.StocktakeDetail as ComponentType<typeof props>, props);
  };
  return { ...actual, StocktakeDetail: Stand };
});

beforeAll(async () => { await import('./StocktakeSection'); }, 60_000);

let logged: MockInstance;

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
  broken.list = false;
  broken.detail = false;
  // React and React Router log every render error they catch; these are expected.
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };
const main = () => within(screen.getByRole('main'));
const seeded = () => fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: [ingredient('flour', { name: 'Farina' })] });

describe('Stocktake: a part that fails', () => {
  it('leaves the list working when the right-hand side fails to draw', async () => {
    broken.detail = true;
    const { user } = renderStocktake('/stocktake/2026-10', { source: seeded() });

    expect(await screen.findByRole('button', { name: 'Open Farina' }, LOAD)).toBeInTheDocument();
    expect(main().getByText('This part didn’t load.')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Reload' })).toBeInTheDocument();

    // The list still counts.
    const box = screen.getByRole('textbox', { name: 'How many of Farina are left' });
    await screen.findByText('0 of 1', undefined, LOAD);
    await user.type(box, '3');
    await user.tab();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    // The screen is still one screen: one h1, the rail still there.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'All sections' })).toBeInTheDocument();
  });

  it('leaves the right-hand side working when the list fails to draw', async () => {
    broken.list = true;
    renderStocktake('/stocktake/2026-10', { source: seeded() });

    expect(await screen.findByText('This part didn’t load.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Tap a product to see its figures.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Month' })).not.toBeInTheDocument();
  });

  it('shows the section\'s heading even when both parts are down', async () => {
    broken.list = true;
    broken.detail = true;
    renderStocktake('/stocktake/2026-10', { source: seeded() });
    await screen.findAllByText('This part didn’t load.', undefined, LOAD);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stocktake');
  });
});
