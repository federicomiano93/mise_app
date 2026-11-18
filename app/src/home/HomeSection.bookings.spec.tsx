import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { bookingFixture, fakeBookingsSource } from '../testing/fakeBookingsSource';
import type { FakeBookingsSource } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import homeCss from './HomeSection.module.css?raw';

// «Prenotazioni di oggi» on the Home (18 Nov 2026): today's bookings still to hand over, a tap opens one; none left, or nobody
// shown Bookings, and the card is gone. ⚠️ Fake customers only.

afterEach(() => { vi.restoreAllMocks(); });

const TODAY = todayISO();
const LOAD = { timeout: 5000 };

function show(source: FakeBookingsSource, options: Parameters<typeof renderApp>[1] = {}) {
  return renderApp('/home', { ...options, data: { bookings: () => source, ...options.data } });
}
const card = () => screen.queryByRole('region', { name: 'Today’s bookings' });
const rows = () => within(card() as HTMLElement).getAllByRole('link').map(link => link.textContent);

describe('the «Prenotazioni di oggi» card', () => {
  it('lists today\'s bookings still to hand over, by time: not collected, not cancelled, not another day', async () => {
    const source = fakeBookingsSource([
      bookingFixture({ id: 'a', date: TODAY, time: '11:00', customerName: 'Mario Prova' }),
      bookingFixture({ id: 'b', date: TODAY, time: '09:00', customerName: 'Anna Finta', status: 'ready' }),
      bookingFixture({ id: 'c', date: TODAY, time: '08:00', customerName: 'Done Prova', status: 'collected' }),
      bookingFixture({ id: 'd', date: TODAY, time: '08:00', customerName: 'Gone Prova', status: 'cancelled' }),
      bookingFixture({ id: 'e', date: '2999-01-01', customerName: 'Far Prova' }),
    ]);
    show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    expect(rows()).toEqual(['09:00 · Anna Finta — Ready', '11:00 · Mario Prova — To do']);
    expect(source.watchDay).toHaveBeenCalledWith(TODAY, expect.any(Function), expect.any(Function));
  });

  it('opens the booking', async () => {
    const source = fakeBookingsSource([bookingFixture({ id: 'a', date: TODAY, customerName: 'Mario Prova' })]);
    const { router, user } = show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    await user.click(within(card() as HTMLElement).getAllByRole('link')[0] as HTMLElement);
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings/a'); });
  });

  it('goes when the last one is collected, and the Home keeps one column', async () => {
    const source = fakeBookingsSource([bookingFixture({ id: 'a', date: TODAY })]);
    show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    const stored = bookingFixture({ id: 'a', date: TODAY });
    act(() => { source.items.set('a', { ...stored, status: 'collected' }); source.push(); });
    await waitFor(() => { expect(card()).toBeNull(); });
    expect(document.querySelector('[data-two]')).toBeNull();
  });

  it('reads nothing for somebody the venue does not show Bookings to', async () => {
    const source = fakeBookingsSource([bookingFixture({ id: 'a', date: TODAY })]);
    show(source, { session: { canManage: false, isOwner: false, role: 'staff', location: { staffHiddenCards: { bookings: true } } } });
    expect(await screen.findByRole('heading', { level: 2, name: 'To do' }, LOAD)).toBeInTheDocument();
    expect(source.watchDay).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('⚠️ the right-hand column is never hidden: a part that FAILED draws its «didn\'t load» box there, and it must be seen', () => {
    expect(homeCss).not.toMatch(/\.side[^{]*\{[^}]*display:\s*none/);
  });
});
