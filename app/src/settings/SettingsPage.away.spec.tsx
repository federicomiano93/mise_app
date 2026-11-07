import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  const view = renderApp('/settings', { ...options, data: { settings: () => source } });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Tu' : 'You' });
  // The one read has been asked; its answer reaches the row a moment later.
  await waitFor(() => { expect(source.readMyAway).toHaveBeenCalled(); });
  return { ...view, source };
}

const pickDate = (value: string) => fireEvent.change(screen.getByLabelText('Away until, and including'), { target: { value } });

describe('Settings: I am on holiday', () => {
  it('is a row in the You card; the dialog says what being away does, and does not do', async () => {
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'I am on holiday' }));
    const dialog = await screen.findByRole('dialog', { name: 'I am on holiday' });
    expect(within(dialog).getByText(/Your phone stops ringing\. The order lists still arrive/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Set' })).toBeInTheDocument();
  });

  it('offers the platform’s own date field, from today up to a year ahead, with a visible label', async () => {
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'I am on holiday' }));
    const input = await screen.findByLabelText('Away until, and including');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveAttribute('min', '2026-11-07');
    expect(input).toHaveAttribute('max', '2027-11-07');
    expect(screen.getByText('Away until, and including').tagName).toBe('LABEL');
  });

  it('sets the holiday: writes the chosen day and shows «On holiday until 16 November» at once', async () => {
    const { user, source } = await open();
    await user.click(main().getByRole('button', { name: 'I am on holiday' }));
    await screen.findByRole('dialog', { name: 'I am on holiday' });
    pickDate('2026-11-16');
    await user.click(screen.getByRole('button', { name: 'Set' }));

    expect(source.saveAway).toHaveBeenCalledWith('u1', '2026-11-16');
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    const row = main().getByRole('button', { name: 'On holiday until 16 November' });
    expect(row).toHaveAccessibleDescription('Your phone is not alerting you. Tap here if you are already back.');
  });

  it('does nothing harmful with no date: says so, keeps the dialog, writes nothing', async () => {
    const { user, source } = await open();
    await user.click(main().getByRole('button', { name: 'I am on holiday' }));
    await screen.findByRole('dialog', { name: 'I am on holiday' });
    await user.click(screen.getByRole('button', { name: 'Set' }));

    expect(await screen.findByText('That date cannot be used. Pick a day from today onwards, within a year.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'I am on holiday' })).toBeInTheDocument();
    expect(source.saveAway).not.toHaveBeenCalled();
  });

  it('refuses a day in the past or past the year the same way, and the words go once the date changes', async () => {
    const { user, source } = await open();
    await user.click(main().getByRole('button', { name: 'I am on holiday' }));
    await screen.findByRole('dialog', { name: 'I am on holiday' });
    pickDate('2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Set' }));
    expect(await screen.findByText(/That date cannot be used/)).toBeInTheDocument();
    pickDate('2029-01-01');
    expect(screen.queryByText(/That date cannot be used/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set' }));
    expect(await screen.findByText(/That date cannot be used/)).toBeInTheDocument();
    expect(source.saveAway).toHaveBeenCalledTimes(2);
    expect(source.away).toBeNull();
  });

  it('has its message region on the page, empty, before it speaks', async () => {
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'I am on holiday' }));
    const dialog = await screen.findByRole('dialog', { name: 'I am on holiday' });
    const regions = within(dialog).getAllByRole('status');
    expect(regions.some(region => region.textContent === '')).toBe(true);
  });

  it('does nothing on Cancel', async () => {
    const { user, source } = await open();
    await user.click(main().getByRole('button', { name: 'I am on holiday' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(source.saveAway).not.toHaveBeenCalled();
    expect(main().getByRole('button', { name: 'I am on holiday' })).toBeInTheDocument();
  });

  it('shows a holiday already in progress, in the interface’s words, and asks «Back already?» before ending it', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    const row = await main().findByRole('button', { name: 'On holiday until 16 November' });
    await user.click(row);

    const question = await screen.findByRole('alertdialog', { name: 'Back already?' });
    expect(within(question).getByText('Your holiday runs to 16 November. Ending it now turns your notifications back on.')).toBeInTheDocument();
    // Coming back is one tap and is not a destructive act: no danger look.
    const back = within(question).getByRole('button', { name: 'I am back' });
    expect(back.className).not.toMatch(/danger/);
    expect(source.saveAway).not.toHaveBeenCalled();

    await user.click(back);
    expect(source.saveAway).toHaveBeenCalledWith('u1', '');
    expect(await main().findByRole('button', { name: 'I am on holiday' })).toBeInTheDocument();
  });

  it('keeps the holiday when the question is cancelled', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    await user.click(await main().findByRole('button', { name: 'On holiday until 16 November' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.saveAway).not.toHaveBeenCalled();
    expect(main().getByRole('button', { name: 'On holiday until 16 November' })).toBeInTheDocument();
  });

  it('says «Not saved» and puts the holiday back when the write is refused', async () => {
    const { user, source } = await open({ away: { until: '2026-11-16' } });
    source.refuseWith = Object.assign(new Error('no'), { code: 'permission-denied' });
    await user.click(await main().findByRole('button', { name: 'On holiday until 16 November' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'I am back' }));

    expect(await screen.findByText('Not saved — check the connection and try again.')).toBeInTheDocument();
    expect(await main().findByRole('button', { name: 'On holiday until 16 November' })).toBeInTheDocument();
  });

  it('names the day in Italian', async () => {
    await open({ away: { until: '2026-11-16' } }, { lang: 'it' });
    expect(await main().findByRole('button', { name: 'In ferie fino al 16 novembre' })).toBeInTheDocument();
  });

  it('is there for an employee too', async () => {
    await open({}, { session: { role: 'staff', canManage: false, isOwner: false } });
    expect(main().getByRole('button', { name: 'I am on holiday' })).toBeInTheDocument();
  });
});
