import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
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

  // The question and the notice are hooks that settle their answer when their component goes away:
  // the simulated remount must not answer «no» to a question asked afterwards, nor write twice.
  it('closes the month once: the next month, then this one', async () => {
    const fake = seeded();
    const { user } = renderStocktake('/stocktake/2026-10', { source: fake });
    const close = await screen.findByRole('button', { name: 'Close the month' }, LOAD);
    await waitFor(() => { expect(close).toBeEnabled(); }, LOAD);

    await user.click(close);
    const ask = await screen.findByRole('alertdialog', { name: 'Close the month?' }, LOAD);
    await user.click(within(ask).getByRole('button', { name: 'Close the month' }));

    expect(await screen.findByText(
      'Month closed. November 2026 is open, with what was left as its opening.',
      undefined,
      LOAD,
    )).toBeInTheDocument();
    expect(fake.saved.map(save => save.monthId)).toEqual(['2026-11', '2026-10']);
  });

  it('fills in the purchases once, and tells what could not be counted', async () => {
    const fake = seeded();
    fake.orders.push({ id: 'o1', date: '2026-10-03', quantities: { flour: 2, butter: 1 }, units: { butter: 'busta' } });
    const { user } = renderStocktake('/stocktake/2026-10', { source: fake });
    await user.click(await screen.findByRole('button', { name: 'From the orders' }, LOAD));
    const ask = await screen.findByRole('alertdialog', { name: 'Fill in what was bought?' }, LOAD);
    await user.click(within(ask).getByRole('button', { name: 'Fill them in' }));

    expect(await screen.findByText('1 product filled in from the orders.', undefined, LOAD)).toBeInTheDocument();
    const notice = await screen.findByRole('alertdialog', { name: /^Burro: not counted here/ }, LOAD);
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.purchased).toEqual({ flour: 2 });
  });
});
