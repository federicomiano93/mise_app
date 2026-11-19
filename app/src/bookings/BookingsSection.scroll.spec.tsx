import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { bookingFixture, fakeBookingsSource } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';

// Where the page is scrolled to when Bookings moves between its list and a booking (architecture rule 9: the section owns the
// scroll for the moves inside itself). jsdom does not lay out or scroll: the position is planted on the shell's main.

afterEach(() => { vi.unstubAllGlobals(); });

const TODAY = todayISO();
const LOAD = { timeout: 5000 };

function show(path = '/bookings') {
  const source = fakeBookingsSource([
    bookingFixture({ id: 'A1', date: TODAY, time: '09:00', customerName: 'Mario Prova' }),
    bookingFixture({ id: 'A2', date: TODAY, time: '10:00', customerName: 'Anna Finta' }),
  ]);
  return renderApp(path, { data: { bookings: () => source } });
}

function scrolledTo(top: number): HTMLElement {
  const main = screen.getByRole('main');
  Object.defineProperty(main, 'scrollTop', { value: top, writable: true });
  fireEvent.scroll(main);
  return main;
}

const rows = () => within(screen.getByRole('region', { name: 'Bookings' })).getAllByRole('link');

describe('the scroll inside Bookings (a phone)', () => {
  it('a booking opens at the top, and Back puts the list where it was', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(rows()).toHaveLength(2); }, LOAD);
    const main = scrolledTo(420);
    await user.click(rows()[1] as HTMLElement);
    await screen.findByRole('region', { name: 'Anna Finta' });
    expect(main.scrollTop).toBe(0);
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    expect(main.scrollTop).toBe(420);
  });

  it('the editor of a new booking opens at the top', async () => {
    const { user } = show();
    await waitFor(() => { expect(rows()).toHaveLength(2); }, LOAD);
    const main = scrolledTo(300);
    await user.click(screen.getByRole('button', { name: 'New booking' }));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(main.scrollTop).toBe(0);
  });
});

describe('the scroll inside Bookings (the split, 1000px and wider)', () => {
  it('⚠️ a booking takes the whole width (bookings rebuild step 3): it opens at the top, and Back puts the list where it was', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1000px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { user, router } = show();
    await waitFor(() => { expect(rows()).toHaveLength(2); }, LOAD);
    const main = scrolledTo(420);
    await user.click(rows()[1] as HTMLElement);
    await screen.findByRole('region', { name: 'Anna Finta' });
    expect(main.scrollTop).toBe(0);
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(rows()).toHaveLength(2); });
    expect(main.scrollTop).toBe(420);
  });

  it('⚠️ the full-width form opens at the top, and closing it puts the list back where it was (hidden, it lost its place)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1000px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { user, router } = show();
    await waitFor(() => { expect(rows()).toHaveLength(2); }, LOAD);
    const main = scrolledTo(420);
    await user.click(screen.getByRole('button', { name: 'New booking' }));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(main.scrollTop).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    expect(main.scrollTop).toBe(420);
  });
});
