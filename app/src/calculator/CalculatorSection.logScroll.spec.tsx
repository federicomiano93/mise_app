import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { NOW, logOf } from '../testing/logFixtures';
import { LOAD, configOf, renderCalculator, split } from '../testing/renderCalculator';

// Where the page is scrolled to when the Dough history moves between its list and a log. The shell has ONE scroll
// area (the main landmark) and resets it at every address; the Dough history owns it for the moves inside itself
// (shell/scrollArea.tsx). jsdom does not lay out or scroll: the position is planted.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const back = () => main().getAllByRole('button', { name: 'Back' }).at(-1)!;

const logs = () => [
  logOf('a', { dough: 'Focaccia A', createdAtMs: NOW - 60_000 }),
  logOf('b', { dough: 'Focaccia B', createdAtMs: NOW - 120_000 }),
];

async function open(path: string) {
  const view = renderCalculator(path, { source: fakeCalculatorSource({ config: configOf({ logRetentionHours: 24 }), logs: logs() }) });
  await main().findByRole('button', { name: 'Focaccia A' }, LOAD);
  return view;
}

// The shell's scroll area, scrolled to `top`.
function scrolledTo(top: number): HTMLElement {
  const area = screen.getByRole('main');
  Object.defineProperty(area, 'scrollTop', { value: top, writable: true });
  return area;
}

describe('the Dough history\'s scroll on a phone', () => {
  it('opens a log at the top, and Back brings the list to the place it was left at', async () => {
    const view = await open('/calculator/log');
    const area = scrolledTo(700);

    await view.user.click(main().getByRole('button', { name: 'Focaccia A' }));
    await main().findByRole('heading', { level: 2, name: 'Focaccia A' }, LOAD);
    expect(area.scrollTop).toBe(0);

    await view.user.click(back());
    await waitFor(() => { expect(area.scrollTop).toBe(700); });
    expect(main().getByRole('button', { name: 'Focaccia A' })).toHaveFocus();
  });

  it('shows the list at the top when Back leaves a log that was opened by its address', async () => {
    const view = renderCalculator('/calculator/log/a', {
      source: fakeCalculatorSource({ config: configOf({ logRetentionHours: 24 }), logs: logs() }),
    });
    await main().findByRole('button', { name: 'History' }, LOAD);
    const area = scrolledTo(400);
    await view.user.click(back());
    await main().findByRole('button', { name: 'Focaccia A' }, LOAD);
    expect(area.scrollTop).toBe(0);
  });

  it('starts the list at the top when it is entered from the work view', async () => {
    const view = renderCalculator('/calculator', {
      source: fakeCalculatorSource({ config: configOf({ logRetentionHours: 24 }), logs: logs() }),
    });
    const door = await main().findByRole('button', { name: 'Dough history' }, LOAD);
    const area = scrolledTo(500);
    await view.user.click(door);
    await main().findByRole('button', { name: 'Focaccia A' }, LOAD);
    expect(area.scrollTop).toBe(0);
  });

  it('starts the work view at the top when the list is left for it', async () => {
    const view = await open('/calculator/log');
    const area = scrolledTo(300);
    await view.user.click(back());
    await main().findByRole('button', { name: 'Dough history' }, LOAD);
    expect(area.scrollTop).toBe(0);
  });
});

describe('the Dough history\'s scroll on the tablet\'s split', () => {
  it('keeps the place in the list when a log is opened, and when another one is', async () => {
    split();
    const view = await open('/calculator/log');
    const area = scrolledTo(900);

    await view.user.click(main().getByRole('button', { name: 'Focaccia A' }));
    await main().findByRole('heading', { level: 2, name: 'Focaccia A' }, LOAD);
    expect(area.scrollTop).toBe(900);

    await view.user.click(main().getByRole('button', { name: 'Focaccia B' }));
    await main().findByRole('heading', { level: 2, name: 'Focaccia B' }, LOAD);
    expect(area.scrollTop).toBe(900);
  });
});
