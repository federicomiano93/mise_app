import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { BRIOCHE, FOCACCIA, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The app runs under React's StrictMode in development: every component is mounted, unmounted and mounted
// again, and every effect runs twice. The store is started, stopped and started again by its provider, and the
// new-day sweep runs twice — none of that may double a watcher, lose the note or clear a tab twice.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./CalculatorSection');
}, 60_000);

afterAll(() => {
  configure({ reactStrictMode: false });
});

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(at(12, 10));
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));

describe('under StrictMode: the Calculator', () => {
  it('draws the tabs, takes a number and shows the recipe', async () => {
    const { user } = renderCalculator('/calculator/brioche', {
      source: fakeCalculatorSource({ config: configOf({ recipes: [FOCACCIA, BRIOCHE] }) }),
    });
    const box = await main().findByLabelText('Total dough (g)', undefined, LOAD);
    await user.click(box);
    await user.keyboard('1000');
    expect(main().getByText('1,000 g raw')).toBeInTheDocument();
    expect(window.localStorage.getItem('total-brioche')).toBe('1000');
    expect(main().getAllByRole('tab')).toHaveLength(2);
  });

  it('keeps the «new day» note once, and clears the tab once', async () => {
    window.localStorage.setItem('total-brioche', '900');
    window.localStorage.setItem('touched-brioche', String(at(11, 15)));
    renderCalculator('/calculator/brioche', {
      source: fakeCalculatorSource({ config: configOf({ recipes: [FOCACCIA, BRIOCHE] }) }),
    });
    expect(await main().findByText('Fields cleared — this is a new day.', undefined, LOAD)).toBeInTheDocument();
    expect(main().getAllByText('Fields cleared — this is a new day.')).toHaveLength(1);
    expect(main().getByLabelText('Total dough (g)')).toHaveValue(0);
    expect(window.localStorage.getItem('total-brioche')).toBeNull();
  });
});
