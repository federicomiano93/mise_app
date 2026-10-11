import { createElement } from 'react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { dayDoc, freezeClock, renderPastries } from '../testing/renderPastries';
import { fakePastriesSource } from '../testing/fakePastriesSource';

// ⚠️ ONE FAILING PART MUST NOT TAKE THE OTHER DOWN: the days and the chosen day are two parts, each
// in its own boundary. Either is made to throw while it draws, the other must keep working.
const broken = vi.hoisted(() => ({ days: false, panel: false }));

vi.mock('./DayPanel', async importOriginal => {
  const actual = await importOriginal<typeof import('./DayPanel')>();
  const Stand = (props: Parameters<typeof actual.DayPanel>[0]) => {
    if (broken.panel) throw new Error('the day failed to draw');
    return createElement(actual.DayPanel as ComponentType<typeof props>, props);
  };
  return { ...actual, DayPanel: Stand };
});

vi.mock('./DaysNav', async importOriginal => {
  const actual = await importOriginal<typeof import('./DaysNav')>();
  const Stand = (props: Parameters<typeof actual.DaysNav>[0]) => {
    if (broken.days) throw new Error('the days failed to draw');
    return createElement(actual.DaysNav as ComponentType<typeof props>, props);
  };
  return { ...actual, DaysNav: Stand };
});

beforeAll(async () => { await import('./PastriesSection'); }, 60_000);

let logged: MockInstance;

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
  broken.days = false;
  broken.panel = false;
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

describe('Pastries: a part that fails', () => {
  it('leaves the days working when the chosen day fails to draw', async () => {
    broken.panel = true;
    const { router, user } = renderPastries('/pastries');

    const list = await screen.findByRole('tablist', { name: 'Days' }, LOAD);
    expect(main().getByText('This part didn’t load.')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(within(list).getAllByRole('tab')).toHaveLength(7);

    await user.click(within(list).getByRole('tab', { name: /^Friday/ }));
    expect(router.state.location.pathname).toBe('/pastries/Friday');
    expect(screen.getByRole('tab', { name: /^Friday/, selected: true })).toBeInTheDocument();
    // The screen is still one screen: one h1, the rail still there.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'All sections' })).toBeInTheDocument();
  });

  it('leaves the chosen day working when the days fail to draw', async () => {
    broken.days = true;
    const source = fakePastriesSource({ days: [dayDoc('Thursday', [['Cornetti', 24]])] });
    renderPastries('/pastries', { source });

    expect(await screen.findByRole('button', { name: /^Cornetti/ }, LOAD)).toBeInTheDocument();
    expect(main().getByText('This part didn’t load.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Thursday' })).toBeInTheDocument();
  });

  it('shows the section\'s data and heading even when both parts are down', async () => {
    broken.days = true;
    broken.panel = true;
    renderPastries('/pastries');
    await screen.findAllByText('This part didn’t load.', undefined, LOAD);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pastries');
  });
});
