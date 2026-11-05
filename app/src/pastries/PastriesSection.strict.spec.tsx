import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, screen, waitFor, within } from '@testing-library/react';
import { fakePastriesSource } from '../testing/fakePastriesSource';
import { dayDoc, freezeClock, logDoc, renderPastries } from '../testing/renderPastries';

// The app runs under React's StrictMode in development: every component is mounted, unmounted and
// mounted again, and every effect runs twice. A question asked from an effect (the lock question of
// an editor opened by its address) must survive that — it once could have been answered «no» by
// the simulated unmount and sent the person away before they had read it.

const THURSDAY = [['Cornetti', 24], ['Krapfen', 12]] as const;
const LOAD = { timeout: 10_000 };

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./PastriesSection');
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

const recorded = () => fakePastriesSource({ days: [dayDoc('Thursday', THURSDAY)], logs: [logDoc('Thursday', THURSDAY)] });
const ask = () => screen.findByRole('alertdialog', { name: 'Edit Thursday?' }, LOAD);

describe('under StrictMode: the editor opened by its address on a recorded day', () => {
  it('asks the question once, and stays asking until it is answered', async () => {
    renderPastries('/pastries/Thursday/edit', { source: recorded() });
    await ask();
    await new Promise(resolve => { setTimeout(resolve, 60); });

    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('leaves for the day on Cancel', async () => {
    const { router, user } = renderPastries('/pastries/Thursday/edit', { source: recorded() });
    await user.click(within(await ask()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('opens the form on Edit, once, with the rows', async () => {
    const { user } = renderPastries('/pastries/Thursday/edit', { source: recorded() });
    await user.click(within(await ask()).getByRole('button', { name: 'Edit' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Edit Thursday' })).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('under StrictMode: the editor reached with the data already loaded', () => {
  // The editor mounts already knowing the day is recorded (the browser's Forward, a link typed into
  // the app), so its question starts in the very first effects — the ones StrictMode runs twice.
  it('still asks the question, and is not answered «no» by the simulated unmount', async () => {
    const { router, user } = renderPastries('/pastries/Thursday', { source: recorded() });
    await vi.waitFor(() => { expect(within(screen.getByRole('tabpanel')).getByText('Confirmed')).toBeVisible(); }, LOAD);

    await act(async () => { await router.navigate('/pastries/Thursday/edit'); });
    const question = await ask();
    await new Promise(resolve => { setTimeout(resolve, 60); });

    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await user.click(within(question).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Edit Thursday' })).toBeInTheDocument();
  });
});

describe('under StrictMode: Confirm', () => {
  it('lands and puts the focus on the Edit button of the confirmed row', async () => {
    const source = fakePastriesSource({ days: [dayDoc('Thursday', THURSDAY)] });
    const { user } = renderPastries('/pastries', { source });
    await user.click(await screen.findByRole('button', { name: 'Confirm' }, LOAD));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled(); });
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Confirm Thursday?' })).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Thursday recorded.')).toBeInTheDocument();
    await new Promise(resolve => { setTimeout(resolve, 60); });
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
  });
});
