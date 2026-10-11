import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor } from '@testing-library/react';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import { freezeClock, ingredient, monthDoc, renderStocktake } from '../testing/renderStocktake';

// The app runs under React's StrictMode in development: every component is mounted, unmounted and
// mounted again, and every effect runs twice. The store is started, stopped and started again by
// its provider, and the section opens its month from an effect — none of that may leave the list
// without a month, double a watcher, or send a count twice.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./StocktakeSection');
}, 60_000);

afterAll(() => {
  configure({ reactStrictMode: false });
});

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };
const SAVED = { timeout: 4000 };

const seeded = () => fakeStocktakeSource({
  months: [monthDoc('2026-10', { closing: { flour: 8 } })],
  ingredients: [ingredient('flour', { name: 'Farina' }), ingredient('butter', { name: 'Burro' })],
});

describe('under StrictMode: the Stocktake', () => {
  it('lands on the month, draws the list and opens the boxes', async () => {
    const { router } = renderStocktake('/stocktake', { source: seeded() });
    expect(await screen.findByRole('button', { name: 'Open Farina' }, LOAD)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/stocktake/2026-10');
    await waitFor(() => { expect(screen.getByRole('textbox', { name: 'How many of Farina are left' })).toBeEnabled(); }, LOAD);
    expect(screen.getByRole('textbox', { name: 'How many of Farina are left' })).toHaveValue('8');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('saves a count once', async () => {
    const fake = seeded();
    const { user } = renderStocktake('/stocktake/2026-10', { source: fake });
    await screen.findByRole('button', { name: 'Open Burro' }, LOAD);
    const box = screen.getByRole('textbox', { name: 'How many of Burro are left' });
    await waitFor(() => { expect(box).toBeEnabled(); }, LOAD);

    await user.type(box, '3');
    await user.tab();

    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ butter: 3 });
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(1);
  });

  it('still follows a colleague\'s count, and a month change, after the simulated remount', async () => {
    const fake = seeded();
    const { user } = renderStocktake('/stocktake/2026-10', { source: fake });
    await screen.findByRole('button', { name: 'Open Burro' }, LOAD);

    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: 8, butter: 6 } }));
    fake.push();
    await waitFor(() => { expect(screen.getByRole('textbox', { name: 'How many of Burro are left' })).toHaveValue('6'); });

    await user.click(screen.getByRole('button', { name: 'The month before' }));
    await screen.findByRole('heading', { level: 2, name: 'September 2026' }, LOAD);
    await waitFor(() => { expect(screen.getByRole('textbox', { name: 'How many of Burro are left' })).toBeEnabled(); }, LOAD);
    expect(screen.getByRole('textbox', { name: 'How many of Burro are left' })).toHaveValue('');
  });
});
