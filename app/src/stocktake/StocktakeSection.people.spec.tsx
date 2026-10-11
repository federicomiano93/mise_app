import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import {
  closedMonthDoc, freezeClock, ingredient, monthDoc, renderStocktake,
} from '../testing/renderStocktake';
import { SCREEN_EVENT } from '../telemetry/usage';

// Who sees what. A manager (or the owner) runs the place; an employee counts, sees no money, and
// where the rules refuse them a month they get one sentence instead of a list.

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

// An employee at a venue that chose to show the Stocktake's card to staff.
const EMPLOYEE = {
  canManage: false,
  isOwner: false,
  role: 'staff' as const,
  location: { staffShownCards: { inventory: true } },
};
const MANAGER = { canManage: true, isOwner: false, role: 'manager' as const };

const INGREDIENTS = [
  ingredient('flour', { name: 'Farina', category: 'Dispensa' }),
  ingredient('butter', { name: 'Burro', category: 'Frigo' }),
];

const SENTENCE = 'This month cannot be opened here: it is closed, or the Stocktake is no longer shown to employees. Owners and managers still see it.';
const INTERRUPTED = 'Live updates interrupted — reopen the page to reconnect.';

const month = (name: string) => screen.findByRole('heading', { level: 2, name }, LOAD);
const bar = () => screen.getByRole('group', { name: 'Month' });

describe('the Stocktake for whoever runs the place', () => {
  it.each([['the owner', {}], ['a manager', MANAGER]])('offers %s both fill-in actions on an open month', async (_who, session) => {
    renderStocktake('/stocktake/2026-10', {
      session,
      source: fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: INGREDIENTS }),
    });
    expect(await screen.findByRole('button', { name: 'Carry forward' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'From the orders' })).toBeInTheDocument();
  });

  it('shows the list from the phone\'s own copy, and the notice, when the month\'s stream fails', async () => {
    const fake = fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: INGREDIENTS });
    fake.refuse.watchMonth = true;
    renderStocktake('/stocktake/2026-10', { source: fake, session: MANAGER });

    expect(await screen.findByText(INTERRUPTED, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Dispensa' })).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  it('says the notice in a status region that was there before it spoke', async () => {
    const fake = fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: INGREDIENTS });
    fake.refuse.watchMonth = true;
    renderStocktake('/stocktake/2026-10', { source: fake, session: MANAGER });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    expect((await screen.findByText(INTERRUPTED, undefined, LOAD)).closest('[role="status"]')).not.toBeNull();
  });
});

describe('the Stocktake for an employee', () => {
  it('shows the list and the orders fill-in, but not «Carry forward»', async () => {
    renderStocktake('/stocktake/2026-10', {
      session: EMPLOYEE,
      source: fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: INGREDIENTS }),
    });
    expect(await screen.findByRole('button', { name: 'From the orders' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carry forward' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Dispensa' })).toBeInTheDocument();
  });

  it('lets an employee count', async () => {
    const fake = fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: INGREDIENTS });
    const { user } = renderStocktake('/stocktake/2026-10', { session: EMPLOYEE, source: fake });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    const box = screen.getByRole('textbox', { name: 'How many of Farina are left' });
    await waitFor(() => { expect(box).toBeEnabled(); }, LOAD);
    await user.type(box, '4');
    await user.tab();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  // The rules keep a closed month (and one still carrying frozen prices) from an employee: the
  // stream is refused, which is the answer and not a hiccup.
  describe('where the rules refuse the month', () => {
    function refused() {
      const fake = fakeStocktakeSource({ months: [closedMonthDoc('2026-09')], ingredients: INGREDIENTS });
      fake.refuse.watchMonth = true;
      return fake;
    }

    it('shows the sentence instead of everything under the month bar, and no notice', async () => {
      renderStocktake('/stocktake/2026-09', { session: EMPLOYEE, source: refused() });

      expect(await screen.findByText(SENTENCE, undefined, LOAD)).toBeInTheDocument();
      expect(screen.queryByText(INTERRUPTED)).not.toBeInTheDocument();
      // Nothing of the list: no summary, no actions, no search, no rows, no boxes.
      expect(screen.queryByText('Counted')).not.toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'From the orders' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    });

    it('keeps the month bar, whose arrows are the way to a month that can be opened', async () => {
      const { router, user } = renderStocktake('/stocktake/2026-09', { session: EMPLOYEE, source: refused() });
      await screen.findByText(SENTENCE, undefined, LOAD);
      expect(await month('September 2026')).toBeInTheDocument();
      expect(within(bar()).getByRole('button', { name: 'The month before' })).toBeEnabled();
      expect(within(bar()).getByRole('button', { name: 'The month after' })).toBeEnabled();

      await user.click(within(bar()).getByRole('button', { name: 'The month after' }));
      await month('October 2026');
      expect(router.state.location.pathname).toBe('/stocktake/2026-10');
    });

    it('does not repaint the refusal away when an ingredient changes later', async () => {
      const fake = refused();
      renderStocktake('/stocktake/2026-09', { session: EMPLOYEE, source: fake });
      await screen.findByText(SENTENCE, undefined, LOAD);

      fake.ingredients.set('cocoa', ingredient('cocoa', { name: 'Cacao' }));
      act(() => { fake.push(); });
      act(() => { fake.push(); });

      expect(screen.getByText(SENTENCE)).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('lifts the sentence for the next month, which the rules do let through', async () => {
      const fake = fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: INGREDIENTS });
      const { user } = renderStocktake('/stocktake/2026-10', { session: EMPLOYEE, source: fake });
      await screen.findAllByRole('heading', { level: 3 }, LOAD);

      // The closed month before this one is refused to an employee...
      fake.refuse.watchMonth = true;
      await user.click(within(bar()).getByRole('button', { name: 'The month before' }));
      expect(await screen.findByText(SENTENCE, undefined, LOAD)).toBeInTheDocument();

      // ...and the way forward again lists the month.
      fake.refuse.watchMonth = false;
      await user.click(within(bar()).getByRole('button', { name: 'The month after' }));
      expect(await screen.findByRole('heading', { level: 3, name: 'Dispensa' }, LOAD)).toBeInTheDocument();
      expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
    });

    it('says it in Italian', async () => {
      renderStocktake('/stocktake/2026-09', { session: EMPLOYEE, source: refused(), lang: 'it' });
      expect(await screen.findByText(
        'Questo mese non si può aprire qui: è chiuso, oppure il Magazzino non è più visibile ai dipendenti. Titolare e manager lo vedono comunque.',
        undefined,
        LOAD,
      )).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Mese' })).toBeInTheDocument();
    });

    it('is a different screen in the usage record from the list', async () => {
      const heard: string[] = [];
      const listener = (event: Event) => { heard.push((event as CustomEvent<string>).detail); };
      window.addEventListener(SCREEN_EVENT, listener);
      try {
        renderStocktake('/stocktake/2026-09', { session: EMPLOYEE, source: refused() });
        await screen.findByText(SENTENCE, undefined, LOAD);
        expect(heard).toContain('stocktake');
        expect(heard.at(-1)).toBe('stocktake-unavailable');
        // Said once, not on every redraw.
        expect(heard.filter(name => name === 'stocktake-unavailable')).toHaveLength(1);
      } finally {
        window.removeEventListener(SCREEN_EVENT, listener);
      }
    });
  });
});

describe('the Stocktake in the usage record', () => {
  let heard: string[];
  const listener = (event: Event) => { heard.push((event as CustomEvent<string>).detail); };

  beforeEach(() => {
    heard = [];
    window.addEventListener(SCREEN_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(SCREEN_EVENT, listener);
  });

  const withFlour = () => fakeStocktakeSource({ months: [monthDoc('2026-10')], ingredients: INGREDIENTS });

  it('names the counting list `stocktake`, and does not count a month changed as a new screen', async () => {
    const { user } = renderStocktake('/stocktake', { source: withFlour() });
    await month('October 2026');
    await user.click(within(bar()).getByRole('button', { name: 'The month before' }));
    await month('September 2026');
    await user.click(within(bar()).getByRole('button', { name: 'The month before' }));
    await month('August 2026');
    expect(new Set(heard)).toEqual(new Set(['stocktake']));
  });

  it('names one product and «What it cost» as screens of their own', async () => {
    const { router } = renderStocktake('/stocktake/2026-10', { source: withFlour() });
    await month('October 2026');
    await act(async () => { await router.navigate('/stocktake/2026-10/product/flour'); });
    expect(heard.at(-1)).toBe('stocktake-product');
    await act(async () => { await router.navigate('/stocktake/2026-10/cost'); });
    expect(heard.at(-1)).toBe('stocktake-cost');
    await act(async () => { await router.navigate('/stocktake/2026-10'); });
    expect(heard.at(-1)).toBe('stocktake');
  });
});
