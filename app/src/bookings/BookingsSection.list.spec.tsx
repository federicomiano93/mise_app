import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { bookingFixture, fakeBookingsSource, permissionDenied } from '../testing/fakeBookingsSource';
import type { FakeBookingsSource } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import { DEFAULT_SETTINGS } from './bookingSettings';
import { dayAfter, monthAfter, monthOf, monthRange } from './bookingModel';
import type { Booking } from './bookingModel';

// Bookings rebuild step 3 (19 Nov 2026, the owner's design on the tablet): the month calendar, «Search by name», the rows with their
// one-tap «Collected», and the booking's page. ⚠️ Fake customers only.

const TODAY = todayISO();
const MONTH = monthOf(TODAY);
const NEXT = monthAfter(MONTH, 1);
const NEXT_DAY = `${NEXT}-15`;
const LOAD = { timeout: 5000 };

const line = (name: string, qty: number, extra: Partial<Booking['lines'][number]> = {}): Booking['lines'][number] => ({
  recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name, qty, unit: 'pcs', note: '', ...extra,
});

const seed = () => [
  bookingFixture({ id: 'A1', date: TODAY, time: '10:00', slotEnd: '11:00', customerName: 'Niccolò Rossi', number: 1,
    lines: [line('Panettone', 3, { weightKg: 1.5 }), line('Pandoro', 1)] }),
  bookingFixture({ id: 'A2', date: TODAY, time: '09:00', slotEnd: '10:00', customerName: 'Anna Bianchi', number: 2, status: 'ready' }),
  bookingFixture({ id: 'A3', date: TODAY, time: '08:40', customerName: 'Luca Verdi', number: 3 }),
  bookingFixture({ id: 'AX', date: TODAY, time: '09:00', customerName: 'Gone Prova', number: 4, status: 'cancelled' }),
  bookingFixture({ id: 'N1', date: NEXT_DAY, customerName: 'Sara Dopo', number: 5 }),
];

function show(path = '/bookings', source: FakeBookingsSource = fakeBookingsSource(seed()), options: Parameters<typeof renderApp>[1] = {}) {
  const view = renderApp(path, { ...options, data: { bookings: () => source, ...options.data } });
  return { ...view, source };
}

const list = (name = 'Bookings') => within(screen.getByRole('region', { name }));
const rowNames = (name = 'Bookings') => list(name).queryAllByRole('link').map(link => link.textContent);
const rowOf = (name: string, region = 'Bookings') => list(region).getByRole('link', { name }).closest('li') as HTMLElement;
const cell = (day: string) => document.querySelector(`[data-day="${day}"]`) as HTMLButtonElement;

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the month calendar', () => {
  it('replaces the four day buttons, opens on today (ringed, picked), and starts on Monday', async () => {
    show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    for (const word of ['Today', 'Tomorrow', 'Later', 'Past day']) expect(screen.queryByRole('button', { name: word })).toBeNull();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(th => th.querySelector('[aria-hidden]')?.textContent)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('Monday');
    expect(cell(TODAY)).toHaveAttribute('aria-current', 'date');
    expect(cell(TODAY)).toHaveAttribute('aria-pressed', 'true');
    // One Tab stop for the month: the picked day.
    expect(within(table).getAllByRole('button').filter(b => b.tabIndex === 0)).toEqual([cell(TODAY)]);
  });

  it('in Italian: L M M G V S D, the month by name, «Mese precedente / successivo»', async () => {
    show('/bookings', undefined, { lang: 'it' });
    await waitFor(() => { expect(rowNames('Prenotazioni')).toHaveLength(4); }, LOAD);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(th => th.querySelector('[aria-hidden]')?.textContent)).toEqual(['L', 'M', 'M', 'G', 'V', 'S', 'D']);
    expect(screen.getByRole('button', { name: 'Mese precedente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mese successivo' })).toBeInTheDocument();
    const monthName = new Intl.DateTimeFormat('it', { month: 'long' }).format(new Date(`${TODAY}T00:00:00`));
    expect(screen.getByRole('heading', { level: 3, name: new RegExp(`^${monthName} [0-9]{4}$`) })).toBeInTheDocument();
  });

  it('⚠️ an orange badge counts each day\'s bookings WITHOUT the cancelled ones', async () => {
    show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    // Four booked today, one of them cancelled: 3.
    expect(cell(TODAY)).toHaveAccessibleName(expect.stringMatching(/, 3 bookings$/));
    expect([...cell(TODAY).querySelectorAll('[aria-hidden="true"]')].map(node => node.textContent)).toEqual([String(Number(TODAY.slice(8))), '3']);
    const other = dayAfter(TODAY, TODAY.endsWith('-01') ? 1 : -1);
    expect(cell(other)?.textContent).not.toMatch(/booking/);
  });

  it('⚠️ › moves to the next month and RE-QUERIES that month alone; ‹ comes back', async () => {
    const { user, source } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    expect(source.watch).toHaveBeenLastCalledWith(monthRange(MONTH), expect.any(Function), expect.any(Function));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith(monthRange(NEXT), expect.any(Function), expect.any(Function)); });
    expect(source.watching()).toBe(1);
    // A month that is not today's opens on its 1st; the badge of the 15th says Sara's booking.
    expect(cell(`${NEXT}-01`)).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => { expect(cell(NEXT_DAY)).toHaveAccessibleName(expect.stringMatching(/, 1 booking$/)); });
    await user.click(cell(NEXT_DAY));
    expect(rowNames()).toEqual(['Sara Dopo']);
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith(monthRange(MONTH), expect.any(Function), expect.any(Function)); });
    await waitFor(() => { expect(rowNames()).toHaveLength(4); });
    expect(cell(TODAY)).toHaveAttribute('aria-pressed', 'true');
    expect(source.watching()).toBe(1);
  });

  it('a long-gone month reads empty (deleted 30 days after the day): that is fine', async () => {
    const { user, source } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith(monthRange(monthAfter(MONTH, -2)), expect.any(Function), expect.any(Function)); });
    expect(await screen.findByText('No bookings for this day.')).toBeInTheDocument();
  });

  it('tapping a day shows that day\'s bookings; the arrows move between days from the keyboard', async () => {
    const { user } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    const other = dayAfter(TODAY, TODAY.endsWith('-01') ? 1 : -1);
    await user.click(cell(other));
    expect(cell(other)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No bookings for this day.')).toBeInTheDocument();
    cell(other).focus();
    fireEvent.keyDown(cell(other), { key: other < TODAY ? 'ArrowRight' : 'ArrowLeft' });
    expect(cell(TODAY)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(rowNames()).toHaveLength(4);
  });
});

describe('«Search by name»', () => {
  it('filters the day\'s rows as you type, case and accents folded, and says when none matches', async () => {
    const { user } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    const box = screen.getByLabelText('Search by name');
    await user.type(box, 'nicco');
    expect(rowNames()).toEqual(['Niccolò Rossi']);
    await user.clear(box);
    await user.type(box, 'BIANCHI');
    expect(rowNames()).toEqual(['Anna Bianchi']);
    await user.type(box, 'xyz');
    expect(rowNames()).toEqual([]);
    expect(screen.getByText('No name with “BIANCHIxyz” on this day.')).toBeInTheDocument();
  });

  it('a new day starts with an empty box', async () => {
    const { user } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    await user.type(screen.getByLabelText('Search by name'), 'rossi');
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByLabelText('Search by name')).toHaveValue('');
  });
});

describe('the rows', () => {
  it('by time, cancelled last: the slot (start big, end under it), the products one per line, numbered, with the weight', async () => {
    show();
    await waitFor(() => { expect(rowNames()).toEqual(['Luca Verdi', 'Anna Bianchi', 'Niccolò Rossi', 'Gone Prova']); }, LOAD);
    const row = rowOf('Niccolò Rossi');
    expect(row).toHaveTextContent(/^10:00–11:00/);
    const lines = within(row).getAllByRole('listitem');
    expect(lines.map(item => item.textContent)).toEqual(['13 pcs (1.5 kg) Panettone', '21 pcs Pandoro']);
    expect(lines[0]?.querySelector('[aria-hidden="true"]')?.textContent).toBe('1');
    // An exact time (an old booking, no end) is the time alone.
    expect(rowOf('Luca Verdi')).toHaveTextContent(/^08:40Luca/);
    expect(rowOf('Luca Verdi')).toHaveTextContent('Pickup');
  });

  it('⚠️ a stored «ready» reads as open: no «To do» / «Ready» anywhere, and the same «Collected» button', async () => {
    show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    const shown = screen.getByRole('region', { name: 'Bookings' });
    expect(shown).not.toHaveTextContent(/To do|Ready/);
    expect(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Collected' })).toHaveAccessibleDescription('Anna Bianchi');
    expect(within(rowOf('Luca Verdi')).getByRole('button', { name: 'Collected' })).toBeInTheDocument();
  });

  it('a cancelled row: no button, a «Cancelled» tag, crossed out', async () => {
    show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    const row = rowOf('Gone Prova');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row).toHaveTextContent('Cancelled');
    expect(row.firstElementChild).toHaveAttribute('data-status', 'cancelled');
  });

  it('⚠️ ONE TAP sets «collected» at once (no question); «Undo» puts it back to open (todo)', async () => {
    const { user, source } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    // The server is slow: the row changes before it answers.
    let answer: () => void = () => undefined;
    const real = vi.mocked(source.setStatus).getMockImplementation();
    vi.mocked(source.setStatus).mockImplementationOnce((id, status) => new Promise(resolve => { answer = () => { void real?.(id, status).then(resolve); }; }));
    await user.click(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Collected' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rowOf('Anna Bianchi').firstElementChild).toHaveAttribute('data-status', 'collected');
    const undo = within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Undo the collection' });
    expect(source.setStatus).toHaveBeenLastCalledWith('A2', 'collected');
    await act(async () => { answer(); });
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('collected'); });
    await user.click(undo);
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('todo'); });
    expect(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Collected' })).toBeInTheDocument();
  });

  it('⚠️ a REFUSED tap puts the row back and says so', async () => {
    const { user, source } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    let refuse: () => void = () => undefined;
    vi.mocked(source.setStatus).mockImplementationOnce(() => new Promise((_, reject) => { refuse = () => { reject(permissionDenied()); }; }));
    await user.click(within(rowOf('Luca Verdi')).getByRole('button', { name: 'Collected' }));
    expect(rowOf('Luca Verdi').firstElementChild).toHaveAttribute('data-status', 'collected');
    await act(async () => { refuse(); });
    await waitFor(() => { expect(rowOf('Luca Verdi').firstElementChild).toHaveAttribute('data-status', 'todo'); });
    expect(within(rowOf('Luca Verdi')).getByRole('button', { name: 'Collected' })).toBeInTheDocument();
    expect(await screen.findByText('Not saved: you can’t change bookings in this venue. The booking is back as it was.')).toBeInTheDocument();
    expect(source.items.get('A3')?.status).toBe('todo');
  });

  it('a tap on the name opens the booking', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    await user.click(list().getByRole('link', { name: 'Luca Verdi' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings/A3'); });
  });
});

describe('«New booking» and the form\'s month', () => {
  it('pre-fills «Day» with the day picked, in another month too', async () => {
    const { user } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(cell(NEXT_DAY));
    await user.click(screen.getByRole('button', { name: 'New booking' }));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.getByLabelText('Day')).toHaveValue(NEXT_DAY);
  });

  it('⚠️ a form whose day moves to another month moves the ONE listener there (its slots and number are counted on it)', async () => {
    const { source } = show('/bookings/new');
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(source.watch).toHaveBeenLastCalledWith(monthRange(MONTH), expect.any(Function), expect.any(Function));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: NEXT_DAY } });
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith(monthRange(NEXT), expect.any(Function), expect.any(Function)); });
    expect(source.watching()).toBe(1);
  });
});

describe('the booking\'s page', () => {
  it('takes the whole width; its h1 is the customer\'s name, «Booking No. 1» small under it, Edit the pencil alone', async () => {
    show('/bookings/A1');
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Niccolò Rossi');
    expect(card).toHaveTextContent('Booking No. 1');
    const edit = within(card).getByRole('button', { name: 'Edit' });
    expect(edit).not.toHaveTextContent('Edit');
    expect(edit.querySelector('svg')).not.toBeNull();
    expect((document.querySelector('[data-view]') as HTMLElement).className).toContain('fullForm');
    // The browser tab keeps the section's name, never a customer's.
    expect(document.title).not.toContain('Niccolò');
  });

  it('«When» says the day and the slot; the products numbered with their price at the right', async () => {
    show('/bookings/A1', fakeBookingsSource([bookingFixture({ id: 'A1', date: TODAY, time: '10:00', slotEnd: '11:00', customerName: 'Niccolò Rossi',
      lines: [line('Panettone', 2, { unitPrice: 25 })] })]));
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(card).toHaveTextContent('10:00–11:00');
    const item = within(card).getAllByRole('listitem')[0] as HTMLElement;
    expect(item).toHaveTextContent('12 pcs Panettone£50.00');
  });

  it('⚠️ two statuses only, Collected and Cancelled; a tap on the one on puts the booking back to open', async () => {
    const { user, source } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    const statuses = within(within(card).getByRole('group', { name: 'Status' })).getAllByRole('button');
    expect(statuses.map(b => b.textContent)).toEqual(['Collected', 'Cancelled']);
    // A stored «ready» is open: neither is on.
    expect(statuses.every(b => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(card).not.toHaveTextContent(/To do|Ready/);
    await user.click(within(card).getByRole('button', { name: 'Collected' }));
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('collected'); });
    expect(within(card).getByRole('button', { name: 'Collected' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(card).getByRole('button', { name: 'Collected' }));
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('todo'); });
    // Cancelled still asks first; a second tap reopens without a question.
    await user.click(within(card).getByRole('button', { name: 'Cancelled' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Cancel this booking?' })).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('cancelled'); });
    await user.click(within(card).getByRole('button', { name: 'Cancelled' }));
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('todo'); });
  });

  it('the print buttons read «Lab» / «Customer», named «Print for the lab» / «Print for the customer»', async () => {
    show('/bookings/A1');
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(within(card).getByRole('button', { name: 'Print for the lab' })).toHaveTextContent(/^Lab$/);
    expect(within(card).getByRole('button', { name: 'Print for the customer' })).toHaveTextContent(/^Customer$/);
  });

  it('in Italian: «Prenotazione N. 1», «Ritirata» / «Annullata», «Laboratorio» / «Cliente»', async () => {
    show('/bookings/A1', undefined, { lang: 'it', session: { location: { country: 'IT' } } });
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(card).toHaveTextContent('Prenotazione N. 1');
    expect(within(card).getByRole('button', { name: 'Modifica' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Ritirata' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Annullata' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Stampa per laboratorio' })).toHaveTextContent('Laboratorio');
    expect(within(card).getByRole('button', { name: 'Stampa per cliente' })).toHaveTextContent('Cliente');
    expect(card).toHaveTextContent('3 pz (1,5 kg) Panettone');
    expect(card).not.toHaveTextContent(/Da fare|Pronta/);
  });

  it('⚠️ no «Customer» group when the phone is off and none is stored', async () => {
    show('/bookings/A1', fakeBookingsSource([bookingFixture({ id: 'A1', date: TODAY, customerName: 'Niccolò Rossi', phone: '' })], undefined,
      { ...DEFAULT_SETTINGS, askPhone: false }));
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(within(card).queryByText('Customer', { selector: 'dt' })).toBeNull();
  });

  it('opened from a row, the focus goes to its h1; Back brings the list back on the same day', async () => {
    const { user, router } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    await user.click(list().getByRole('link', { name: 'Luca Verdi' }));
    const card = await screen.findByRole('region', { name: 'Luca Verdi' });
    expect(within(card).getByRole('heading', { level: 1 })).toHaveFocus();
    await user.click(within(card).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    expect(cell(TODAY)).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toHaveLength(4);
  });

  it('⚠️ reloaded on a booking of another month, it opens that month (the day rides in the history entry)', async () => {
    const source = fakeBookingsSource(seed());
    renderApp('/bookings/N1', {
      data: { bookings: () => source },
      entries: [{ pathname: '/bookings' }, { pathname: '/bookings/N1', state: { fromBookingsList: true, keepFocus: true, bookingDay: NEXT_DAY } }],
    });
    expect(await screen.findByRole('region', { name: 'Sara Dopo' }, LOAD)).toBeInTheDocument();
    expect(source.watch).toHaveBeenLastCalledWith(monthRange(NEXT), expect.any(Function), expect.any(Function));
  });
});
