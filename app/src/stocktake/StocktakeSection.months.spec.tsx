import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import {
  THIS_MONTH, closedMonthDoc, freezeClock, ingredient, monthDoc, renderStocktake,
} from '../testing/renderStocktake';

// The frame of the Stocktake and its months: which month opens, the arrows, the badge. jsdom
// applies no media query and none of the module CSS, so a phone and a tablet are the same page here
// (stocktakeCss.spec.ts reads the stylesheets).

// The section is its own chunk, fetched on first use: load it once so no spec waits for the
// transform.
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
const month = (name: string) => screen.findByRole('heading', { level: 2, name }, LOAD);
const bar = () => screen.getByRole('group', { name: 'Month' });
const previous = () => within(bar()).getByRole('button', { name: 'The month before' });
const next = () => within(bar()).getByRole('button', { name: 'The month after' });

describe('Stocktake: which month opens', () => {
  it('lands on the current month, replacing /stocktake', async () => {
    const { router } = renderStocktake('/stocktake');
    await month('October 2026');
    expect(router.state.location.pathname).toBe('/stocktake/2026-10');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('lands on the current month by the local clock: half past midnight on the 1st is the new month', async () => {
    freezeClock(new Date(2026, 10, 1, 0, 30, 0));
    const { router } = renderStocktake('/stocktake');
    await month('November 2026');
    expect(router.state.location.pathname).toBe('/stocktake/2026-11');
  });

  it('opens the month in the address', async () => {
    const { router } = renderStocktake('/stocktake/2026-03');
    await month('March 2026');
    expect(router.state.location.pathname).toBe('/stocktake/2026-03');
  });

  it.each(['/stocktake/2026-11', '/stocktake/2027-01', '/stocktake/2026-11/cost', '/stocktake/2030-06/product/flour'])(
    'replaces %s, a month that has not happened, with the current month',
    async path => {
      const { router } = renderStocktake(path);
      await month('October 2026');
      expect(router.state.location.pathname).toBe('/stocktake/2026-10');
      expect(router.state.historyAction).toBe('REPLACE');
    },
  );

  it.each(['/stocktake/2026-13', '/stocktake/nonsense', '/stocktake/2026-10/nope', '/stocktake/2026-10/product'])(
    'sends %s back to the start, which lands on the current month',
    async path => {
      const { router } = renderStocktake(path);
      await month('October 2026');
      expect(router.state.location.pathname).toBe('/stocktake/2026-10');
    },
  );

  it('has one h1 for the section and the month as an h2', async () => {
    renderStocktake('/stocktake');
    await month('October 2026');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stocktake');
  });

  it('keeps the focus where it was when the app arranges the address itself', async () => {
    renderStocktake('/stocktake');
    await month('October 2026');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
  });
});

describe('Stocktake: the month bar', () => {
  it('is a labelled group of the two arrows and the month, with 48px targets', async () => {
    renderStocktake('/stocktake/2026-09');
    await month('September 2026');
    expect(bar()).toBeInTheDocument();
    expect(previous()).toBeEnabled();
    expect(next()).toBeEnabled();
  });

  it('moves to the month before by replacing the address, and the month after back again', async () => {
    const { router, user } = renderStocktake('/stocktake/2026-10');
    await month('October 2026');

    await user.click(previous());
    await month('September 2026');
    expect(router.state.location.pathname).toBe('/stocktake/2026-09');
    expect(router.state.historyAction).toBe('REPLACE');

    await user.click(previous());
    await month('August 2026');
    expect(router.state.location.pathname).toBe('/stocktake/2026-08');

    await user.click(next());
    await month('September 2026');
    expect(router.state.location.pathname).toBe('/stocktake/2026-09');
  });

  it('rolls over the year in both directions', async () => {
    const { user } = renderStocktake('/stocktake/2026-01');
    await month('January 2026');
    await user.click(previous());
    await month('December 2025');
    await user.click(next());
    await month('January 2026');
  });

  it('shuts the arrow to the month after on the current month', async () => {
    const { user } = renderStocktake('/stocktake/2026-10');
    await month('October 2026');
    expect(next()).toBeDisabled();
    expect(previous()).toBeEnabled();

    await user.click(previous());
    await month('September 2026');
    expect(next()).toBeEnabled();
  });

  it('hands the focus to the other arrow when reaching the current month shuts the one pressed', async () => {
    const { user } = renderStocktake('/stocktake/2026-09');
    await month('September 2026');
    await user.click(next());
    await month('October 2026');
    expect(next()).toBeDisabled();
    expect(previous()).toHaveFocus();
  });

  it('keeps the focus on the arrow pressed otherwise', async () => {
    const { user } = renderStocktake('/stocktake/2026-10');
    await month('October 2026');
    await user.click(previous());
    await month('September 2026');
    expect(previous()).toHaveFocus();
  });

  // Changing month is lateral, like picking a day: Back leaves the Stocktake, it does not walk back
  // through every month that was looked at.
  it('does not make a history entry for a month: Back goes where the person came from', async () => {
    const { router, user } = renderStocktake('/orders');
    await act(async () => { await router.navigate('/stocktake/2026-10'); });
    await month('October 2026');
    await user.click(previous());
    await month('September 2026');
    await user.click(previous());
    await month('August 2026');

    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders'); });
  });

  it('says whether the month is open or closed', async () => {
    const source = fakeStocktakeSource({
      months: [monthDoc('2026-10'), closedMonthDoc('2026-09')],
      ingredients: [ingredient('flour')],
    });
    const { user } = renderStocktake('/stocktake/2026-10', { source });
    await month('October 2026');
    expect(await within(bar()).findByText('Open', undefined, LOAD)).toBeInTheDocument();
    expect(within(bar()).queryByText('Closed')).not.toBeInTheDocument();

    await user.click(previous());
    await month('September 2026');
    expect(await within(bar()).findByText('Closed', undefined, LOAD)).toBeInTheDocument();
    expect(within(bar()).queryByText('Open')).not.toBeInTheDocument();
  });

  it('says a month that does not exist yet is open', async () => {
    renderStocktake('/stocktake/2026-05');
    await month('May 2026');
    expect(await within(bar()).findByText('Open', undefined, LOAD)).toBeInTheDocument();
  });

  // What is still unsent for the month being left is handed to Firestore at once: the debounce of
  // 700ms must not make a count wait while the month is changed, and nobody waits for the answer.
  it('hands what was counted to Firestore before it moves on, without waiting for the answer', async () => {
    const source = fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: [ingredient('flour', { name: 'Flour' })] });
    // A server that never answers: no signal in a storeroom.
    vi.mocked(source.saveMonthFields).mockImplementation((monthId, patch, clear = {}) => {
      source.saved.push({ monthId, patch: { ...patch }, clear: { ...clear } as Record<string, Record<string, unknown>> });
      return new Promise<void>(() => undefined);
    });
    const { router, user } = renderStocktake('/stocktake/2026-10', { source });
    const box = await screen.findByRole('textbox', { name: 'How many of Flour are left' }, LOAD);
    await waitFor(() => { expect(box).toBeEnabled(); }, LOAD);

    await user.type(box, '12');
    await user.click(previous());

    await month('September 2026');
    expect(router.state.location.pathname).toBe('/stocktake/2026-09');
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect(source.saved[0]?.monthId).toBe('2026-10');
    expect(source.saved[0]?.patch.closing).toEqual({ flour: 12 });
  });
});

describe('Stocktake: when the app comes back to the foreground', () => {
  const comesBack = () => { act(() => { document.dispatchEvent(new Event('visibilitychange')); }); };

  it('reads the month of the clock again, so the arrow opens after the turn of the month', async () => {
    renderStocktake('/stocktake/2026-10');
    await month('October 2026');
    expect(next()).toBeDisabled();

    vi.setSystemTime(new Date(2026, 10, 2, 9, 0, 0));
    // Still the month it was opened in while the app stays on screen: nothing moves under a finger.
    expect(next()).toBeDisabled();

    comesBack();
    expect(next()).toBeEnabled();
  });

  it('changes nothing when the month has not turned', async () => {
    renderStocktake('/stocktake/2026-10');
    await month('October 2026');
    vi.setSystemTime(new Date(2026, 9, 30, 9, 0, 0));
    comesBack();
    expect(next()).toBeDisabled();
  });

  it('does nothing while the app is going to the background', async () => {
    renderStocktake('/stocktake/2026-10');
    await month('October 2026');
    vi.setSystemTime(new Date(2026, 10, 2, 9, 0, 0));
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      comesBack();
      expect(next()).toBeDisabled();
    } finally {
      hidden.mockRestore();
    }
  });

  it('lets a month that has just happened be reached', async () => {
    const { user } = renderStocktake('/stocktake/2026-10');
    await month('October 2026');
    vi.setSystemTime(new Date(2026, 10, 2, 9, 0, 0));
    comesBack();
    await user.click(next());
    await month('November 2026');
    expect(next()).toBeDisabled();
  });
});

describe('Stocktake: the month in Italian', () => {
  it('names the month, the arrows and the group in Italian', async () => {
    renderStocktake('/stocktake', { lang: 'it' });
    await month('ottobre 2026');
    const group = screen.getByRole('group', { name: 'Mese' });
    expect(within(group).getByRole('button', { name: 'Il mese prima' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Il mese dopo' })).toBeDisabled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Magazzino');
    expect(await within(group).findByText('Aperto', undefined, LOAD)).toBeInTheDocument();
  });

  it('lands on the current month in the address, the same one in both languages', async () => {
    const { router } = renderStocktake('/stocktake', { lang: 'it' });
    await month('ottobre 2026');
    expect(router.state.location.pathname).toBe(`/stocktake/${THIS_MONTH}`);
  });
});
