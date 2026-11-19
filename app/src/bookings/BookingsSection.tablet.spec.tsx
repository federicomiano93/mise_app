import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { bookingFixture, fakeBookingsSource } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import { dayAfter } from './bookingModel';
import listCss from './BookingsList.module.css?raw';
import sectionCss from './BookingsSection.module.css?raw';

// The bookings screen on the TABLET (19 Nov 2026, the owner's design approved on the tablet): the day's card on the right, a booking
// opened IN it, in place of its row. jsdom lays nothing out, so the grid itself is pinned on the stylesheet. ⚠️ Fake customers only.

const TODAY = todayISO();
const OTHER = dayAfter(TODAY, TODAY.endsWith('-01') ? 1 : -1);
const LOAD = { timeout: 5000 };

const seed = () => [
  bookingFixture({ id: 'A1', date: TODAY, time: '10:00', slotEnd: '11:00', customerName: 'Niccolò Rossi', number: 1 }),
  bookingFixture({ id: 'A2', date: TODAY, time: '09:00', slotEnd: '10:00', customerName: 'Anna Bianchi', number: 2 }),
  bookingFixture({ id: 'B1', date: OTHER, time: '08:00', customerName: 'Sara Altrove', number: 3 }),
];

function show(path = '/bookings', options: Parameters<typeof renderApp>[1] = {}) {
  const source = fakeBookingsSource(seed());
  const view = renderApp(path, { ...options, data: { bookings: () => source } });
  return { ...view, source };
}

const bookings = () => screen.getByRole('region', { name: 'Bookings' });
// The rows' own links (a card opened in the list holds a phone link of its own).
const links = () => [...bookings().querySelectorAll('[data-booking]')].map(link => link.textContent);
const cell = (iso: string) => document.querySelector(`[data-day="${iso}"]`) as HTMLButtonElement;

function onTablet() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1000px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  onTablet();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the list on the tablet', () => {
  it('is the whole screen: no «Pick a booking» pane, the doors beside the calendar, the day\'s card holding the rows', async () => {
    show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    expect(screen.queryByText(/Pick a booking/)).toBeNull();
    const list = bookings();
    expect(within(list).getByRole('button', { name: 'New booking' })).toBeInTheDocument();
    expect(within(list).getByRole('table')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Receipt printer' })).toBeInTheDocument();
    // The day's card: its heading, the search box and the rows.
    const card = list.querySelector('section') as HTMLElement;
    expect(within(card).getByRole('searchbox')).toBeInTheDocument();
    expect(within(card).getAllByRole('link')).toHaveLength(2);
    expect((document.querySelector('[data-view]') as HTMLElement).dataset.view).toBe('list');
  });

  it('the stylesheet: two columns on the tablet, the day on the right, the move animated 350 ms and none under reduced motion', () => {
    expect(listCss).toMatch(/@media \(min-width: 1000px\)\s*\{\s*\.list\s*\{[^}]*grid-template-columns: 1fr 1fr;[^}]*transition: grid-template-columns 350ms/);
    expect(listCss).toMatch(/\.list\[data-open="true"\]\s*\{\s*grid-template-columns: 3\.2fr 6\.8fr;/);
    expect(listCss).toMatch(/\.day\s*\{\s*grid-column: 2;/);
    expect(listCss).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.list\s*\{\s*transition: none;/);
    // The booking's own pane is hidden on the tablet: the booking is in the list.
    expect(sectionCss).toMatch(/\.layout\[data-view="booking"\] \.detail\s*\{\s*display: none;/);
  });
});

describe('a booking opened in place', () => {
  it('replaces its row; the other rows stay listed; the URL is the booking\'s; the focus goes to its heading', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(links()).toEqual(['Anna Bianchi', 'Niccolò Rossi']); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Niccolò Rossi' }));
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(bookings()).toContainElement(card);
    expect(card).toHaveAttribute('data-in-place', 'true');
    expect(router.state.location.pathname).toBe('/bookings/A1');
    // Its row is gone (it is the card now); the other is still there, and the list is not hidden.
    expect(links()).toEqual(['Anna Bianchi']);
    expect(bookings().querySelector('[data-open="true"]')).toBeNull();
    expect(bookings()).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    // An X in place of Back.
    expect(within(card).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Back' })).toBeNull();
    // The calendar is still there and usable.
    expect(cell(TODAY)).toBeInTheDocument();
  });

  it('only one at a time: another row opens that one instead', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Niccolò Rossi' }));
    await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Anna Bianchi' }));
    await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    expect(screen.queryByRole('region', { name: 'Niccolò Rossi' })).toBeNull();
    expect(links()).toEqual(['Niccolò Rossi']);
    expect(router.state.location.pathname).toBe('/bookings/A2');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('closes by its X: back to /bookings, both rows listed, the focus on the booking\'s row', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Niccolò Rossi' }));
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    await waitFor(() => { expect(links()).toEqual(['Anna Bianchi', 'Niccolò Rossi']); });
    expect(screen.queryByRole('region', { name: 'Niccolò Rossi' })).toBeNull();
    expect(within(bookings()).getByRole('link', { name: 'Niccolò Rossi' })).toHaveFocus();
    expect(bookings()).not.toHaveAttribute('data-open');
  });

  it('closes by Escape, and the focus goes back to its row', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Anna Bianchi' }));
    await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    await waitFor(() => { expect(within(bookings()).getByRole('link', { name: 'Anna Bianchi' })).toHaveFocus(); });
  });

  it('⚠️ Escape inside the cancel question closes the question only, not the booking', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Anna Bianchi' }));
    const card = await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Cancel booking' }));
    await screen.findByRole('alertdialog', { name: 'Cancel this booking?' });
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).toBeNull(); });
    expect(router.state.location.pathname).toBe('/bookings/A2');
    expect(screen.getByRole('region', { name: 'Anna Bianchi' })).toBeInTheDocument();
  });

  it('the browser\'s Back closes it too', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Anna Bianchi' }));
    await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(links()).toHaveLength(2); });
    expect(router.state.location.pathname).toBe('/bookings');
  });

  it('a deep link opens it in the list and chooses its day on the calendar', async () => {
    const { router } = show('/bookings/B1');
    await screen.findByRole('region', { name: 'Sara Altrove' }, LOAD);
    await waitFor(() => { expect(bookings()).toContainElement(screen.getByRole('region', { name: 'Sara Altrove' })); });
    await waitFor(() => { expect(cell(OTHER)).toHaveAttribute('aria-pressed', 'true'); });
    expect(router.state.location.pathname).toBe('/bookings/B1');
    // Its own day's other rows are not shown: it is the only booking that day.
    expect(links()).toEqual([]);
  });

  it('changing the day closes it; picking the day it is on does not', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Anna Bianchi' }));
    await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    await user.click(cell(TODAY));
    expect(router.state.location.pathname).toBe('/bookings/A2');
    expect(screen.getByRole('region', { name: 'Anna Bianchi' })).toBeInTheDocument();
    await user.click(cell(OTHER));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    expect(screen.queryByRole('region', { name: 'Anna Bianchi' })).toBeNull();
    expect(cell(OTHER)).toHaveAttribute('aria-pressed', 'true');
    expect(links()).toEqual(['Sara Altrove']);
  });

  it('the editor (pencil) and «New booking» stay full screen: the list is hidden behind them', async () => {
    const { user } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('button', { name: 'New booking' }));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect((document.querySelector('[data-view]') as HTMLElement).className).toContain('fullForm');
  });

  it('a booking not in the day shown (the search hides its row) still shows its card, above the rows', async () => {
    const { user } = show();
    await waitFor(() => { expect(links()).toHaveLength(2); }, LOAD);
    await user.click(within(bookings()).getByRole('link', { name: 'Anna Bianchi' }));
    await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    fireEvent.change(within(bookings()).getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByRole('region', { name: 'Anna Bianchi' })).toBeInTheDocument();
  });
});
