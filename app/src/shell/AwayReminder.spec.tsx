import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeSettingsSource } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';

// Saturday 7 November 2026, 09:00. Only Date is faked: user-event and the router keep their real timers.
const NOW = new Date(2026, 10, 7, 9, 0, 0);
const KEY = 'away-reminded-date';
const AWAY = { away: { until: '2026-11-16' } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.removeItem(KEY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.removeItem(KEY);
});

async function open(path: string, seed: Parameters<typeof fakeSettingsSource>[0] = AWAY, options: NonNullable<Parameters<typeof renderApp>[1]> = {}) {
  const source: FakeSettingsSource = fakeSettingsSource(seed);
  const view = renderApp(path, { ...options, data: { settings: () => source } });
  await waitFor(() => { expect(source.readMyAway).toHaveBeenCalled(); });
  return { ...view, source };
}

const rail = () => within(screen.getByRole('navigation', { name: 'All sections' }));
// A section loads lazily: under a full parallel run the question can come later than the default wait.
const LOAD = { timeout: 10_000 };
const reminder = () => screen.findByRole('alertdialog', { name: 'You are on holiday' }, LOAD);
const noReminder = async () => {
  // Give the one read time to answer and the effect time to run.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(screen.queryByRole('alertdialog', { name: 'You are on holiday' })).not.toBeInTheDocument();
};

// Each case opens a whole section under the shell (Recipes, loaded lazily): under a full parallel run that alone took over the
// default 5 s twice (7 Nov 2026), so the cases get 15 s.
describe('the once-a-day holiday reminder', { timeout: 15_000 }, () => {
  it('asks when a section other than the Home and Settings is entered, with «I am back» as the main button', async () => {
    const { user, router } = await open('/home');
    await noReminder();
    await user.click(rail().getByRole('link', { name: 'Recipes' }));

    const question = await reminder();
    expect(within(question).getByText('Until 16 November your phone does not alert you. If you are already back, say so now and your notifications start again.')).toBeInTheDocument();
    const back = within(question).getByRole('button', { name: 'I am back' });
    expect(back.className).toMatch(/primary/);
    expect(back.className).not.toMatch(/danger/);
    expect(within(question).getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    // The section is open behind the question: the navigation is never blocked.
    expect(router.state.location.pathname).toBe('/recipes');
  });

  it('writes today into the key BEFORE it asks', async () => {
    const { user } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await reminder();
    expect(localStorage.getItem(KEY)).toBe('2026-11-07');
  });

  it('keeps the holiday on Continue, and asks nothing more that day, whichever section is entered next', async () => {
    const { user, source } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await user.click(within(await reminder()).getByRole('button', { name: 'Continue' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.saveAway).not.toHaveBeenCalled();

    await user.click(rail().getByRole('link', { name: 'Home' }));
    await user.click(rail().getByRole('link', { name: 'Calculator' }));
    await noReminder();
  });

  it('keeps the holiday on Escape', async () => {
    const { user, source } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await reminder();
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.saveAway).not.toHaveBeenCalled();
  });

  it('ends the holiday on «I am back», writing an empty day, and asks nothing further', async () => {
    const { user, source } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await user.click(within(await reminder()).getByRole('button', { name: 'I am back' }));

    expect(source.saveAway).toHaveBeenCalledWith('u1', '');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
  });

  it('says «Not saved» when ending it is refused', async () => {
    const { user, source } = await open('/home');
    source.refuseWith = Object.assign(new Error('no'), { code: 'permission-denied' });
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await user.click(within(await reminder()).getByRole('button', { name: 'I am back' }));
    expect(await screen.findByText('Not saved — check the connection and try again.')).toBeInTheDocument();
  });

  it('asks again the next day', async () => {
    localStorage.setItem(KEY, '2026-11-06');
    const { user } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    expect(await reminder()).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe('2026-11-07');
  });

  it('does not ask when today has had its reminder already', async () => {
    localStorage.setItem(KEY, '2026-11-07');
    const { user } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await noReminder();
  });

  it('is not triggered by the Home or by Settings', async () => {
    const { user } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Settings' }));
    await noReminder();
    await user.click(rail().getByRole('link', { name: 'Home' }));
    await noReminder();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is triggered by Orders, or any section, however it is entered: opening the app straight into one', async () => {
    await open('/recipes');
    expect(await reminder()).toBeInTheDocument();
  });

  it('is triggered from «More» on a phone, because it is the section entered that counts', async () => {
    const { user } = await open('/more');
    await noReminder();
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Pastries' }));
    expect(await reminder()).toBeInTheDocument();
  });

  it('does nothing for somebody who is not on holiday', async () => {
    const { user } = await open('/home', {});
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await noReminder();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does nothing once the holiday has ended by itself', async () => {
    const { user } = await open('/home', { away: { until: '2026-11-06' } });
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await noReminder();
  });

  it('still reminds when the phone’s storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private mode'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private mode'); });
    const { user } = await open('/home');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    expect(await reminder()).toBeInTheDocument();
  });

  describe('when the day changes under somebody sitting in a section', () => {
    // The tablet wakes on a new day: the clock moved and the page became visible again.
    const wakeOn = (day: Date) => {
      vi.setSystemTime(day);
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    };

    it('judges them again for the new day, key written first', async () => {
      const { user } = await open('/home');
      await user.click(rail().getByRole('link', { name: 'Recipes' }));
      await user.click(within(await reminder()).getByRole('button', { name: 'Continue' }));
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(localStorage.getItem(KEY)).toBe('2026-11-07');

      wakeOn(new Date(2026, 10, 8, 8, 0, 0));
      expect(await reminder()).toBeInTheDocument();
      expect(localStorage.getItem(KEY)).toBe('2026-11-08');
    });

    it('does not ask twice on the same day when the tablet wakes again', async () => {
      const { user } = await open('/home');
      await user.click(rail().getByRole('link', { name: 'Recipes' }));
      await user.click(within(await reminder()).getByRole('button', { name: 'Continue' }));
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      wakeOn(new Date(2026, 10, 7, 18, 0, 0));
      await noReminder();
    });

    it('asks nothing in the Home or in Settings when the day changes there', async () => {
      await open('/home');
      wakeOn(new Date(2026, 10, 8, 8, 0, 0));
      await noReminder();
    });

    // Review, 7 Nov 2026: the minute's tick, not a wake. The reminder's effect can run before the holiday store has asked the clock again.
    it('asks nothing just after midnight on a tablet left awake, when the holiday ended with the old day', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(NOW);
      const { user } = await open('/home', { away: { until: '2026-11-07' } });
      await user.click(rail().getByRole('link', { name: 'Recipes' }));
      await user.click(within(await reminder()).getByRole('button', { name: 'Continue' }));
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      vi.setSystemTime(new Date(2026, 10, 8, 0, 0, 30));
      act(() => { vi.advanceTimersByTime(60_000); });
      await noReminder();
      expect(localStorage.getItem(KEY)).toBe('2026-11-07');
    });

    it('asks nothing when the holiday has ended with the old day', async () => {
      const { user } = await open('/home', { away: { until: '2026-11-07' } });
      await user.click(rail().getByRole('link', { name: 'Recipes' }));
      await user.click(within(await reminder()).getByRole('button', { name: 'Continue' }));
      wakeOn(new Date(2026, 10, 8, 8, 0, 0));
      await noReminder();
    });
  });

  it('speaks Italian', async () => {
    const { user } = await open('/home', AWAY, { lang: 'it' });
    await user.click(within(screen.getByRole('navigation', { name: 'Tutte le sezioni' })).getByRole('link', { name: 'Ricette' }));
    const question = await screen.findByRole('alertdialog', { name: 'Sei in ferie' });
    expect(within(question).getByRole('button', { name: 'Sono tornato' })).toBeInTheDocument();
    expect(within(question).getByRole('button', { name: 'Continua' })).toBeInTheDocument();
  });
});
