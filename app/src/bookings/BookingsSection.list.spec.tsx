import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { bookingFixture, fakeBookingsSource, permissionDenied } from '../testing/fakeBookingsSource';
import type { FakeBookingsSource } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import { DEFAULT_SETTINGS } from './bookingSettings';
import { dayAfter, monthAfter, monthOf, monthRange } from './bookingModel';
import type { Booking } from './bookingModel';
import { READ_LIMIT } from './bookingsSource';

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

// The status buttons ignore a second tap for a moment (a double tap): a spec that taps twice on purpose lets that moment pass.
let skew = 0;
const realNow = Date.now.bind(Date);
const passTime = (ms: number) => {
  skew += ms;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
};

beforeEach(() => {
  skew = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
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

describe('a month that fills the query', () => {
  const crowd = (n: number) => Array.from({ length: n }, (_, i) => bookingFixture({ id: `C${String(i)}`, date: `${MONTH}-28`, number: i + 1, customerName: `Cliente ${String(i)}` }));

  it('⚠️ says so when the month reaches the read limit', async () => {
    show('/bookings', fakeBookingsSource(crowd(READ_LIMIT)));
    expect(await screen.findByText('Too many bookings in this month: some may not be shown.', {}, LOAD)).toBeInTheDocument();
  });

  it('says nothing below the limit', async () => {
    show('/bookings', fakeBookingsSource(crowd(READ_LIMIT - 1)));
    await waitFor(() => { expect(screen.queryByText('Loading bookings…')).toBeNull(); }, LOAD);
    expect(screen.queryByText(/Too many bookings in this month/)).toBeNull();
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

  it('⚠️ a stored «ready» reads as open: no «To do» / «Ready» anywhere, and the same «Mark collected» button', async () => {
    show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    const shown = screen.getByRole('region', { name: 'Bookings' });
    expect(shown).not.toHaveTextContent(/To do|Ready/);
    expect(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Mark collected' })).toHaveAccessibleDescription('Anna Bianchi');
    expect(within(rowOf('Luca Verdi')).getByRole('button', { name: 'Mark collected' })).toBeInTheDocument();
  });

  it('a cancelled row: no button, a «Cancelled» tag, crossed out', async () => {
    show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    const row = rowOf('Gone Prova');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row).toHaveTextContent('Cancelled');
    expect(row.firstElementChild).toHaveAttribute('data-status', 'cancelled');
  });

  it('⚠️ ONE TAP sets «collected» at once (no question); «Undo collection» puts it back to open (todo)', async () => {
    const { user, source } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    // The server is slow: the row changes before it answers.
    let answer: () => void = () => undefined;
    const real = vi.mocked(source.setStatus).getMockImplementation();
    vi.mocked(source.setStatus).mockImplementationOnce((id, status) => new Promise(resolve => { answer = () => { void real?.(id, status).then(resolve); }; }));
    await user.click(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Mark collected' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rowOf('Anna Bianchi').firstElementChild).toHaveAttribute('data-status', 'collected');
    const undo = within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Undo collection' });
    // The green «✓ Collected» is the state, written out, not a button (the owner read a green tick button as «already collected»).
    expect(within(rowOf('Anna Bianchi')).queryByRole('button', { name: 'Collected' })).toBeNull();
    expect(rowOf('Anna Bianchi')).toHaveTextContent('Collected');
    expect(source.setStatus).toHaveBeenLastCalledWith('A2', 'collected');
    await act(async () => { answer(); });
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('collected'); });
    passTime(900);
    await user.click(undo);
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('todo'); });
    expect(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Mark collected' })).toBeInTheDocument();
  });

  it('⚠️ a DOUBLE TAP on «Mark collected» leaves it collected with ONE write; a tap after the pause is the «Undo»', async () => {
    const { user, source } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    await user.click(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Mark collected' }));
    // The same button, now «Undo», tapped again a moment later by the same finger.
    await user.click(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Undo collection' }));
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('collected'); });
    expect(source.setStatus).toHaveBeenCalledTimes(1);
    expect(rowOf('Anna Bianchi').firstElementChild).toHaveAttribute('data-status', 'collected');
    passTime(900);
    await user.click(within(rowOf('Anna Bianchi')).getByRole('button', { name: 'Undo collection' }));
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('todo'); });
    expect(source.setStatus).toHaveBeenCalledTimes(2);
  });

  it('⚠️ a REFUSED tap puts the row back and says so', async () => {
    const { user, source } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    let refuse: () => void = () => undefined;
    vi.mocked(source.setStatus).mockImplementationOnce(() => new Promise((_, reject) => { refuse = () => { reject(permissionDenied()); }; }));
    await user.click(within(rowOf('Luca Verdi')).getByRole('button', { name: 'Mark collected' }));
    expect(rowOf('Luca Verdi').firstElementChild).toHaveAttribute('data-status', 'collected');
    await act(async () => { refuse(); });
    await waitFor(() => { expect(rowOf('Luca Verdi').firstElementChild).toHaveAttribute('data-status', 'todo'); });
    expect(within(rowOf('Luca Verdi')).getByRole('button', { name: 'Mark collected' })).toBeInTheDocument();
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
    // The browser tab keeps the section's name, never a customer's.
    expect(document.title).not.toContain('Niccolò');
  });

  it('⚠️ on a phone the page is still a screen of its own: Back (no X), no accent border', async () => {
    show('/bookings/A1');
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(within(card).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(card).not.toHaveAttribute('data-in-place');
  });

  it('«Order» says the day and the slot first and large, the lines numbered «1.» in a box with their price at the right', async () => {
    show('/bookings/A1', fakeBookingsSource([bookingFixture({ id: 'A1', date: TODAY, time: '10:00', slotEnd: '11:00', customerName: 'Niccolò Rossi',
      lines: [line('Panettone', 2, { unitPrice: 25 })] })]));
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(card).toHaveTextContent('10:00–11:00');
    const item = within(card).getAllByRole('listitem')[0] as HTMLElement;
    expect(item).toHaveTextContent('1.2 pcs Panettone£50.00');
    // No «When» heading to see (it stays for a screen reader), and «Items» is now «Order»; the lines are still an ordered list.
    expect(within(card).getByText('When')).toHaveClass('visually-hidden');
    expect(within(card).getByText('Order', { selector: 'dt' })).toBeInTheDocument();
    expect(within(card).queryByText('Items')).toBeNull();
    expect(item.closest('ol')).not.toBeNull();
  });

  it('⚠️ no status buttons on the page: «Collected» and «Cancelled» are not buttons any more', async () => {
    show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    expect(within(card).queryByRole('group', { name: 'Status' })).toBeNull();
    for (const name of ['Collected', 'Cancelled']) expect(within(card).queryByRole('button', { name })).toBeNull();
    // A stored «ready» is open: no tag at all, and never «To do» / «Ready».
    expect(card.querySelector('[data-tag]')).toBeNull();
    expect(card).not.toHaveTextContent(/To do|Ready/);
  });

  it('the status tag beside the name: «✓ Collected» for a collected booking, «Cancelled» for a cancelled one, none for an open one', async () => {
    const source = fakeBookingsSource([
      bookingFixture({ id: 'C1', date: TODAY, customerName: 'Ada Ritirata', status: 'collected' }),
      bookingFixture({ id: 'C2', date: TODAY, customerName: 'Bea Annullata', status: 'cancelled' }),
      bookingFixture({ id: 'C3', date: TODAY, customerName: 'Cleo Aperta', status: 'todo' }),
    ]);
    const { router } = show('/bookings/C1', source);
    const tagOf = async (name: string) => (await screen.findByRole('region', { name }, LOAD)).querySelector('[data-tag]');
    const collected = await tagOf('Ada Ritirata');
    expect(collected).toHaveTextContent('Collected');
    expect(collected?.querySelector('svg')).not.toBeNull();
    // The heading's own name stays the customer's alone.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Ada Ritirata$/);
    await act(async () => { await router.navigate('/bookings/C2'); });
    expect(await tagOf('Bea Annullata')).toHaveTextContent('Cancelled');
    await act(async () => { await router.navigate('/bookings/C3'); });
    expect(await tagOf('Cleo Aperta')).toBeNull();
  });

  it('⚠️ «Cancel booking» at the foot asks first, then cancels; «Reopen booking» puts it back to open without a question', async () => {
    const { user, source } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Anna Bianchi' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Cancel booking' }));
    expect(source.setStatus).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Cancel this booking?' })).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('cancelled'); });
    expect(card.querySelector('[data-tag="cancelled"]')).not.toBeNull();
    // Printing is hidden on a cancelled booking.
    expect(within(card).queryByRole('button', { name: 'Print for the lab' })).toBeNull();
    passTime(900);
    await user.click(within(card).getByRole('button', { name: 'Reopen booking' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => { expect(source.items.get('A2')?.status).toBe('todo'); });
    expect(within(card).getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument();
  });

  it('⚠️ a DOUBLE TAP on «Reopen booking» writes once', async () => {
    const { user, source } = show('/bookings/AX');
    const card = await screen.findByRole('region', { name: 'Gone Prova' }, LOAD);
    const button = within(card).getByRole('button', { name: 'Reopen booking' });
    await user.click(button);
    await user.click(button);
    await waitFor(() => { expect(source.items.get('AX')?.status).toBe('todo'); });
    expect(source.setStatus).toHaveBeenCalledTimes(1);
  });

  it('the print buttons read «Lab» / «Customer», named «Print for the lab» / «Print for the customer»', async () => {
    show('/bookings/A1');
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(within(card).getByRole('button', { name: 'Print for the lab' })).toHaveTextContent(/^Lab$/);
    expect(within(card).getByRole('button', { name: 'Print for the customer' })).toHaveTextContent(/^Customer$/);
  });

  it('in Italian: «Prenotazione N. 1», «Annulla prenotazione», «Ordine», «Laboratorio» / «Cliente»', async () => {
    show('/bookings/A1', undefined, { lang: 'it', session: { location: { country: 'IT' } } });
    const card = await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(card).toHaveTextContent('Prenotazione N. 1');
    expect(within(card).getByRole('button', { name: 'Modifica' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Annulla prenotazione' })).toBeInTheDocument();
    expect(within(card).getByText('Ordine', { selector: 'dt' })).toBeInTheDocument();
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

// ── Review fixes (19 Nov 2026): what the one-month listener must not break ──
describe('a booking moved to another month', () => {
  const saveAndConfirm = async (user: ReturnType<typeof renderApp>['user']) => {
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save this booking?' })).getByRole('button', { name: 'Save' }));
  };

  it('⚠️ listens to BOTH months while its form is open (its stored copy stays known)', async () => {
    const { source } = show('/bookings/A3/edit');
    await screen.findByLabelText('Customer name', {}, LOAD);
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: NEXT_DAY } });
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith({ from: `${MONTH}-01`, until: monthRange(NEXT).until }, expect.any(Function), expect.any(Function)); });
    expect(source.watching()).toBe(1);
  });

  it('⚠️ a refused save of the move, opened again and saved, UPDATES the booking — never a second copy', async () => {
    const source = fakeBookingsSource(seed());
    const { user } = show('/bookings/A3/edit', source);
    await screen.findByLabelText('Customer name', {}, LOAD);
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: NEXT_DAY } });
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith({ from: `${MONTH}-01`, until: monthRange(NEXT).until }, expect.any(Function), expect.any(Function)); });
    source.refuseWith = permissionDenied();
    await saveAndConfirm(user);
    const banner = await screen.findByRole('button', { name: 'Open it to try again' }, LOAD);
    source.refuseWith = null;
    await user.click(banner);
    expect(await screen.findByLabelText('Day', {}, LOAD)).toHaveValue(NEXT_DAY);
    // The stored booking's month is listened to again with the new one: it is found, and updated.
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith({ from: `${MONTH}-01`, until: monthRange(NEXT).until }, expect.any(Function), expect.any(Function)); });
    await waitFor(() => { expect(screen.queryByText('Loading bookings…')).toBeNull(); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.update).toHaveBeenCalledTimes(2); });
    expect(source.update).toHaveBeenLastCalledWith('A3', expect.objectContaining({ date: NEXT_DAY, number: 3 }));
    expect(source.create).not.toHaveBeenCalled();
  });

  it('⚠️ keeps its own number when moved to a month where it is already used', async () => {
    const source = fakeBookingsSource([...seed(), bookingFixture({ id: 'R5', date: TODAY, time: '12:00', customerName: 'Rita Cinque', number: 5 })]);
    const { user } = show('/bookings/R5/edit', source);
    await screen.findByLabelText('Customer name', {}, LOAD);
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: NEXT_DAY } });
    await waitFor(() => { expect(source.watch).toHaveBeenLastCalledWith({ from: `${MONTH}-01`, until: monthRange(NEXT).until }, expect.any(Function), expect.any(Function)); });
    await saveAndConfirm(user);
    // Sara Dopo is N. 5 in that month too, but the rules refuse a changed number: Rita keeps 5 (the slips carry the date).
    await waitFor(() => { expect(source.update).toHaveBeenCalledWith('R5', expect.objectContaining({ date: NEXT_DAY, number: 5 })); });
    expect(source.items.get('R5')?.number).toBe(5);
    expect(source.items.get('R5')?.date).toBe(NEXT_DAY);
  });

  it('⚠️ a month only this device\'s copy has answered for (offline) is said in the save question', async () => {
    const source = fakeBookingsSource(seed());
    vi.mocked(source.watch).mockImplementation(({ from, until }, onChange) => {
      queueMicrotask(() => { onChange([...source.items.values()].filter(b => b.date >= from && b.date < until), true); });
      return () => undefined;
    });
    const { user } = show('/bookings/A3/edit', source);
    await screen.findByLabelText('Customer name', {}, LOAD);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alertdialog', { name: 'Save this booking?' })).toHaveTextContent('No connection: the bookings of that month could not be checked');
  });
});

describe('getting there and back', () => {
  it('⚠️ a booking opened by its address in another month (no day in the history) is found: its month is opened', async () => {
    const { source } = show('/bookings/N1');
    expect(await screen.findByRole('region', { name: 'Sara Dopo' }, LOAD)).toBeInTheDocument();
    expect(source.dayOf).toHaveBeenCalledWith('N1');
    expect(source.watch).toHaveBeenLastCalledWith(monthRange(NEXT), expect.any(Function), expect.any(Function));
  });

  it('⚠️ no «no longer here» flash while the day of a booking in another month is still being read', async () => {
    const source = fakeBookingsSource(seed());
    let answer: (day: string | null) => void = () => undefined;
    vi.mocked(source.dayOf).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    show('/bookings/N1', source);
    await waitFor(() => { expect(source.dayOf).toHaveBeenCalledWith('N1'); }, LOAD);
    expect(screen.queryByText(/This booking is no longer here/)).toBeNull();
    expect(screen.getByText('Loading bookings…', { selector: 'p' })).toBeInTheDocument();
    await act(async () => { answer(NEXT_DAY); });
    expect(await screen.findByRole('region', { name: 'Sara Dopo' }, LOAD)).toBeInTheDocument();
  });

  it('⚠️ a failed day lookup (offline) keeps loading, and is tried again when the connection is back', async () => {
    const source = fakeBookingsSource(seed());
    vi.mocked(source.dayOf).mockImplementationOnce(() => Promise.reject(new Error('unavailable')));
    show('/bookings/N1', source);
    await waitFor(() => { expect(source.dayOf).toHaveBeenCalledTimes(1); }, LOAD);
    expect(screen.queryByText(/This booking is no longer here/)).toBeNull();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(await screen.findByRole('region', { name: 'Sara Dopo' }, LOAD)).toBeInTheDocument();
    expect(source.dayOf).toHaveBeenCalledTimes(2);
  });

  it('a booking that is gone is still «no longer here»', async () => {
    show('/bookings/GONE');
    expect(await screen.findByText(/This booking is no longer here/, {}, LOAD)).toBeInTheDocument();
  });

  it('⚠️ Back from a booking puts the focus on its row; a first load leaves the focus alone (the skip link first)', async () => {
    const { user } = show();
    await waitFor(() => { expect(rowNames()).toHaveLength(4); }, LOAD);
    await user.click(list().getByRole('link', { name: 'Anna Bianchi' }));
    const card = await screen.findByRole('region', { name: 'Anna Bianchi' });
    await user.click(within(card).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(list().getByRole('link', { name: 'Anna Bianchi' })).toHaveFocus(); });
  });

  it('a first load on a booking does not take the focus', async () => {
    show('/bookings/A1');
    await screen.findByRole('region', { name: 'Niccolò Rossi' }, LOAD);
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
  });
});
