import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSettingsSource } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';

// Saturday 7 November 2026, 09:00. Only Date is faked: user-event and the router keep their real timers.
const NOW = new Date(2026, 10, 7, 9, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const main = () => within(screen.getByRole('main'));

async function open(seed: Parameters<typeof fakeSettingsSource>[0] = {}, options: NonNullable<Parameters<typeof renderApp>[1]> = {}) {
  const source: FakeSettingsSource = fakeSettingsSource(seed);
  const view = renderApp('/home', { ...options, data: { settings: () => source } });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Da fare' : 'To do' });
  await waitFor(() => { expect(source.readMyAway).toHaveBeenCalled(); });
  return { ...view, source };
}

const band = () => main().findByRole('button', { name: /On holiday until 16 November/ });

describe('Home: the holiday band', () => {
  it('is not there when the person is not on holiday', async () => {
    await open();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(main().queryByText(/On holiday until/)).not.toBeInTheDocument();
  });

  it('is not there when the holiday is over, the last day included', async () => {
    await open({ away: { until: '2026-11-06' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(main().queryByText(/On holiday until/)).not.toBeInTheDocument();
  });

  it('is a BUTTON with a bold line and the sentence, above the «To do» card', async () => {
    await open({ away: { until: '2026-11-16' } });
    const button = await band();
    expect(button.tagName).toBe('BUTTON');
    expect(within(button).getByText('On holiday until 16 November')).toBeInTheDocument();
    expect(within(button).getByText('Your phone is not alerting you. Tap here if you are already back.')).toBeInTheDocument();
    const todo = main().getByRole('heading', { level: 2, name: 'To do' });
    expect(button.compareDocumentPosition(todo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is there for an employee too', async () => {
    await open({ away: { until: '2026-11-16' } }, { session: { role: 'staff', canManage: false, isOwner: false } });
    expect(await band()).toBeInTheDocument();
  });

  it('asks «Back already?» when tapped, and ends the holiday on «I am back»', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    await user.click(await band());

    const question = await screen.findByRole('alertdialog', { name: 'Back already?' });
    expect(within(question).getByText('Your holiday runs to 16 November. Ending it now turns your notifications back on.')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'I am back' }));

    expect(source.saveAway).toHaveBeenCalledWith('u1', '');
    await waitFor(() => { expect(main().queryByText(/On holiday until/)).not.toBeInTheDocument(); });
  });

  it('puts the focus on the card’s «Add» after «I am back», never on the page body', async () => {
    const { user } = await open({ away: { until: '2026-11-16' } });
    await user.click(await band());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'I am back' }));
    await waitFor(() => { expect(main().queryByText(/On holiday until/)).not.toBeInTheDocument(); });
    await waitFor(() => { expect(main().getByRole('button', { name: 'Add' })).toHaveFocus(); });
  });

  it('keeps the holiday on Cancel', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    await user.click(await band());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.saveAway).not.toHaveBeenCalled();
    expect(await band()).toBeInTheDocument();
  });

  it('says «Not saved» and keeps the band when the write is refused', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    source.refuseWith = Object.assign(new Error('no'), { code: 'permission-denied' });
    await user.click(await band());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'I am back' }));

    const notice = await screen.findByRole('alertdialog', { name: 'I am on holiday' });
    expect(within(notice).getByText('Not saved — check the connection and try again.')).toBeInTheDocument();
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(await band()).toBeInTheDocument();
  });

  // Review, 8 Nov 2026: the answer can land long after the Home has gone; the shell says it wherever the person is.
  it('says «Not saved» in a dialog even when the refusal arrives after the person left the Home', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    source.holdWrites = true;
    await user.click(await band());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'I am back' }));
    await waitFor(() => { expect(main().queryByText(/On holiday until/)).not.toBeInTheDocument(); });
    await user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Recipes' }));
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    source.refuseHeld(Object.assign(new Error('no'), { code: 'permission-denied' }));
    const notice = await screen.findByRole('alertdialog', { name: 'I am on holiday' });
    expect(within(notice).getByText('Not saved — check the connection and try again.')).toBeInTheDocument();
  });

  // Review, 8 Nov 2026: nobody pressed anything, so the focus is not moved (it would be announced out of nowhere).
  it('leaves the focus alone when the holiday ends because another phone ended it', async () => {
    const { source } = await open({ away: { until: '2026-11-16' } });
    await band();
    (document.activeElement as HTMLElement | null)?.blur();
    source.away = { until: '' };
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => { expect(main().queryByText(/On holiday until/)).not.toBeInTheDocument(); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('home-todo-add')).not.toBeNull();
    expect(document.getElementById('home-todo-add')).not.toHaveFocus();
    expect(document.getElementById('home-todo-title')).not.toHaveFocus();
  });

  // Review, 8 Nov 2026: a refusal that lands before React draws «back» leaves the arm on; it must not move the focus later.
  it('leaves the focus alone when the holiday ends by itself after an «I am back» that was refused', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    source.refuseWith = new Error('refused');
    await user.click(await band());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'I am back' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'I am on holiday' })).getByRole('button', { name: 'OK' }));
    await band();
    source.refuseWith = null;
    (document.activeElement as HTMLElement | null)?.blur();
    source.away = { until: '' };
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => { expect(main().queryByText(/On holiday until/)).not.toBeInTheDocument(); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('home-todo-add')).not.toHaveFocus();
  });

  it('closes «Back already?» when the holiday ends while it is open', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    await user.click(await band());
    await screen.findByRole('alertdialog', { name: 'Back already?' });
    source.away = { until: '' };
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => { expect(screen.queryByRole('alertdialog', { name: 'Back already?' })).not.toBeInTheDocument(); });
    expect(source.saveAway).not.toHaveBeenCalled();
  });

  it('speaks Italian', async () => {
    await open({ away: { until: '2026-11-16' } }, { lang: 'it' });
    const button = await main().findByRole('button', { name: /In ferie fino al 16 novembre/ });
    expect(within(button).getByText('Il telefono non ti avvisa. Tocca qui se sei già tornato.')).toBeInTheDocument();
  });
});
