import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { isBusy } from '../session/busy';
import { bookingFixture, fakeBookingsSource, permissionDenied, priceListOf } from '../testing/fakeBookingsSource';
import type { FakeBookingsSource } from '../testing/fakeBookingsSource';
import { addProduct } from '../testing/bookingForm';
import { renderApp } from '../testing/renderApp';
import { dayAfter, monthOf, monthRange, nextNumber } from './bookingModel';
import type { Booking } from './bookingModel';
import { SLIP_HOST_ID, SLIP_PRINTING_CLASS, closeSlipHost } from './slipHost';

// «Bookings» (18 Nov 2026): the list by day, a booking, the editor (P20), the two slips, the bin. ⚠️ Fake customers only.

const TODAY = todayISO();
const TOMORROW = dayAfter(TODAY, 1);
const LATER = dayAfter(TODAY, 5);
const PAST = dayAfter(TODAY, -3);
const LOAD = { timeout: 5000 };

const seed = () => [
  bookingFixture({ id: 'A1', date: TODAY, time: '11:00', customerName: 'Mario Prova', number: 3 }),
  bookingFixture({ id: 'A2', date: TODAY, time: '09:00', customerName: 'Anna Finta', mode: 'delivery', address: 'Via Finta 1, Roma', number: 4,
    lines: [
      { recipeId: null, productId: 'pF', unitPrice: 12, packSize: null, packUnit: null, weightKg: null, name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' },
      { recipeId: null, productId: 'pP', unitPrice: 10, packSize: null, packUnit: null, weightKg: null, name: 'Panettone', qty: 2, unit: 'pcs', note: '' },
      { recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'Grissini', qty: 1, unit: 'kg', note: '' },
    ],
    total: 42.5, deposit: 10, notes: 'Ring twice' }),
  bookingFixture({ id: 'B1', date: TOMORROW, customerName: 'Luca Tomorrow', number: 5 }),
  bookingFixture({ id: 'C1', date: LATER, customerName: 'Sara Later', number: 6 }),
  bookingFixture({ id: 'P1', date: PAST, customerName: 'Pia Past', status: 'collected', number: 2 }),
];

// The price list Food cost published (bookings step 2): Focaccia by the kilo, Panettone by the piece, Grissini by the pack.
const PRICES = () => priceListOf([
  { productId: 'pF', name: 'Focaccia', price: 12, per: 'kg' },
  { productId: 'pP', name: 'Panettone', price: 25, per: 'piece' },
  { productId: 'pG', name: 'Grissini', price: 3.5, per: 'pack', packSize: 250, packUnit: 'g' },
]);

function show(path: string, source: FakeBookingsSource = fakeBookingsSource(seed(), PRICES()), options: Parameters<typeof renderApp>[1] = {}) {
  const view = renderApp(path, { ...options, data: { bookings: () => source, ...options.data } });
  return { ...view, source };
}

const list = (name = 'Bookings') => within(screen.getByRole('region', { name }));
const rowNames = (name = 'Bookings') => list(name).queryAllByRole('link').map(link => link.textContent);
// A row of the list: the list item that holds the booking's name (the name is the row's link).
const rowOf = (name: string, region = 'Bookings') => list(region).getByRole('link', { name }).closest('li') as HTMLElement;
const dialog = (name: string) => screen.findByRole('alertdialog', { name });

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => {
  closeSlipHost();
  vi.restoreAllMocks();
});

describe('the list by day', () => {
  it('opens on today, by time, each row with its slot, name, products one per line and pickup or delivery', async () => {
    show('/bookings');
    await waitFor(() => { expect(rowNames()).toEqual(['Anna Finta', 'Mario Prova']); }, LOAD);
    const row = rowOf('Anna Finta');
    expect(row).toHaveTextContent('09:00');
    expect(within(row).getAllByRole('listitem').map(line => line.textContent)).toEqual(['11.5 kg Focaccia', '22 pcs Panettone', '31 kg Grissini']);
    expect(row).toHaveTextContent('Delivery');
    expect(row).not.toHaveTextContent('To do');
    expect(within(row).getByRole('button', { name: 'Collected' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument();
  });

  it('says when a day has none, and when the live stream broke', async () => {
    const source = fakeBookingsSource([]);
    show('/bookings', source);
    expect(await list().findByText('No bookings for this day.', {}, LOAD)).toBeInTheDocument();
    act(() => { source.breakStreams(); });
    expect(await list().findByText('Live sync interrupted — bookings may be out of date.')).toBeInTheDocument();
  });

  it('in Italian', async () => {
    show('/bookings', undefined, { lang: 'it' });
    await waitFor(() => { expect(rowNames('Prenotazioni')).toHaveLength(2); }, LOAD);
    expect(screen.getByRole('heading', { level: 1, name: 'Prenotazioni' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuova prenotazione' })).toBeInTheDocument();
    for (const word of ['Oggi', 'Domani', 'Più avanti', 'Giorno passato']) expect(screen.queryByRole('button', { name: word })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mese precedente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cerca per nome')).toBeInTheDocument();
    expect(rowOf('Anna Finta', 'Prenotazioni')).toHaveTextContent('Consegna');
    expect(rowOf('Mario Prova', 'Prenotazioni')).toHaveTextContent('Ritiro');
    expect(within(rowOf('Mario Prova', 'Prenotazioni')).getByRole('button', { name: 'Ritirata' })).toBeInTheDocument();
  });

  it('⚠️ reads ONE month, the one shown, with one listener that stops when the section closes', async () => {
    const { source, router } = show('/bookings');
    await waitFor(() => { expect(source.watching()).toBe(1); }, LOAD);
    expect(source.watch).toHaveBeenLastCalledWith(monthRange(monthOf(TODAY)), expect.any(Function), expect.any(Function));
    await act(async () => { await router.navigate('/settings'); });
    await waitFor(() => { expect(source.watching()).toBe(0); });
  });
});

describe('a booking', () => {
  it('shows everything about it, opened from the list', async () => {
    const { user } = show('/bookings');
    await waitFor(() => { expect(rowNames()).toHaveLength(2); }, LOAD);
    await user.click(list().getAllByRole('link')[0] as HTMLElement);
    const card = await screen.findByRole('region', { name: 'Anna Finta' });
    expect(card).toHaveTextContent('Anna Finta');
    expect(within(card).getByRole('link', { name: 'Call +39 333 000 0000' })).toHaveAttribute('href', 'tel:+393330000000');
    expect(card).toHaveTextContent('Via Finta 1, Roma');
    expect(card).toHaveTextContent('sliced');
    expect(card).toHaveTextContent('Ring twice');
    expect(card).toHaveTextContent('£32.50');
    expect(within(card).getByRole('heading', { level: 1, name: 'Anna Finta' })).toHaveFocus();
  });

  it('the WhatsApp reminder opens the customer\'s chat with the message written, in a new tab (bookings step 4)', async () => {
    show('/bookings/A2', undefined, { session: { location: { country: 'IT' }, name: 'Panificio Prova' } });
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    const link = within(card).getByRole('link', { name: 'WhatsApp reminder' });
    expect(link).toHaveAccessibleDescription('Opens WhatsApp with the message ready: check it, then send it.');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const url = new URL(link.getAttribute('href') as string);
    expect(url.origin + url.pathname).toBe('https://wa.me/393330000000');
    const text = (url.searchParams.get('text') ?? '').replace(/\u00a0/g, ' ');
    expect(text).toMatch(/^Hello Anna Finta,\na reminder of your booking No\. 4 with Panificio Prova, to be delivered on:\n\S+ \d+ \S+ at 09:00\nAddress: Via Finta 1, Roma\n/);
    expect(text).toContain('• 1,5 kg Focaccia');
    expect(text).toContain('To pay: 32,50 €');
    expect(text).not.toContain('Ring twice');
  });

  it('no reminder for an order collected or cancelled, nor for a number WhatsApp cannot open', async () => {
    const source = fakeBookingsSource([
      bookingFixture({ id: 'X1', date: TODAY, number: 7, status: 'collected' }),
      bookingFixture({ id: 'X2', date: TODAY, number: 8, phone: '123' }),
    ]);
    const { router } = show('/bookings/X1', source, { session: { location: { country: 'IT' } } });
    const card = await screen.findByRole('region', { name: 'Mario Prova' }, LOAD);
    expect(within(card).queryByRole('link', { name: 'WhatsApp reminder' })).toBeNull();
    await act(async () => { await router.navigate('/bookings/X2'); });
    const other = await screen.findByRole('region', { name: 'Mario Prova' });
    expect(within(other).getByRole('link', { name: 'Call 123' })).toBeInTheDocument();
    expect(within(other).queryByRole('link', { name: 'WhatsApp reminder' })).toBeNull();
  });

  it('in Italian: «Promemoria WhatsApp», and the message in Italian', async () => {
    show('/bookings/A1', undefined, { lang: 'it', session: { location: { country: 'IT' }, name: 'Panificio Prova' } });
    const card = await screen.findByRole('region', { name: 'Mario Prova' }, LOAD);
    const link = within(card).getByRole('link', { name: 'Promemoria WhatsApp' });
    const text = new URL(link.getAttribute('href') as string).searchParams.get('text') ?? '';
    expect(text).toMatch(/^Ciao Mario Prova,\nti ricordiamo il ritiro della tua prenotazione N\. 3 da Panificio Prova:\n.+ alle 11:00\n/);
    expect(text).toMatch(/A presto!$/);
  });

  it('a tap on a status saves it; cancelling asks first', async () => {
    const { user, source } = show('/bookings/A1');
    const card = await screen.findByRole('region', { name: 'Mario Prova' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Collected' }));
    await waitFor(() => { expect(source.items.get('A1')?.status).toBe('collected'); });
    expect(within(card).getByRole('button', { name: 'Collected' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(card).getByRole('button', { name: 'Cancelled' }));
    const ask = await dialog('Cancel this booking?');
    await user.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(source.items.get('A1')?.status).toBe('collected');
    await user.click(within(card).getByRole('button', { name: 'Cancelled' }));
    await user.click(within(await dialog('Cancel this booking?')).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => { expect(source.items.get('A1')?.status).toBe('cancelled'); });
  });

  it('⚠️ the bin asks, then deletes it for good (also a customer\'s «delete my data») and goes back to the list', async () => {
    const { user, source, router } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Delete booking' }));
    const ask = await dialog('Delete this booking?');
    expect(ask).toHaveTextContent('Use this also when a customer asks for their data to be deleted.');
    await user.click(within(ask).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(source.items.has('A2')).toBe(false); });
    expect(router.state.location.pathname).toBe('/bookings');
  });

  it('a booking deleted on another device is said, not drawn', async () => {
    show('/bookings/GONE');
    expect(await screen.findByText(/This booking is no longer here/, {}, LOAD)).toBeInTheDocument();
  });
});

describe('the two slips', () => {
  it('⚠️ the lab slip: date, time, pickup or delivery, the products and notes, the number — NO phone, NO address, NO name', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/A2', undefined, { session: { location: { country: 'IT' }, name: 'Panificio Prova' } });
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Print for the lab' }));
    expect(print).toHaveBeenCalledTimes(1);
    const host = document.getElementById(SLIP_HOST_ID) as HTMLElement;
    expect(host.parentElement).toBe(document.body);
    expect(document.documentElement).toHaveClass(SLIP_PRINTING_CLASS);
    expect(host).toHaveTextContent('LAB');
    expect(host).toHaveTextContent('No. 4');
    expect(host).toHaveTextContent('09:00');
    expect(host).toHaveTextContent('Delivery');
    // The unit follows the venue's COUNTRY: «pz» in Italy, whatever the interface language.
    expect(host).toHaveTextContent('2 pz');
    expect(host).toHaveTextContent('1,5 kg');
    expect(host).toHaveTextContent('sliced');
    expect(host).toHaveTextContent('Ring twice');
    expect(host).not.toHaveTextContent('333');
    expect(host).not.toHaveTextContent('Via Finta');
    expect(host).not.toHaveTextContent('Anna Finta');
  });

  it('⚠️ both slips and the booking say a pack as «3 confezioni (250 g)», never as pieces', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'G1', date: TODAY, number: 9, lines: [
      { recipeId: null, productId: 'pG', unitPrice: 3.5, packSize: 250, packUnit: 'g', weightKg: null, name: 'Grissini', qty: 3, unit: 'pcs', note: '' },
    ] })]);
    const { user } = show('/bookings/G1', source, { session: { location: { country: 'IT' }, name: 'Panificio Prova' } });
    const card = await screen.findByRole('region', { name: 'Mario Prova' }, LOAD);
    expect(card).toHaveTextContent('3 packs (250 g)');
    await user.click(within(card).getByRole('button', { name: 'Print for the lab' }));
    expect(document.getElementById(SLIP_HOST_ID)).toHaveTextContent('3 confezioni (250 g)');
    await user.click(within(card).getByRole('button', { name: 'Print for the customer' }));
    expect(document.getElementById(SLIP_HOST_ID)).toHaveTextContent('3 confezioni (250 g)');
    expect(document.getElementById(SLIP_HOST_ID)).not.toHaveTextContent('3 pz');
  });

  it('the customer slip: the venue, the number, the name, the products, when, the money and the privacy line', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/A2', undefined, { session: { location: { country: 'IT' }, name: 'Panificio Prova' } });
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Print for the customer' }));
    const host = document.getElementById(SLIP_HOST_ID) as HTMLElement;
    // What each priced line comes to (18,00 € and 20,00 €; Grissini has no price).
    for (const text of ['Panificio Prova', 'No. 4', 'Anna Finta', 'Focaccia', 'Delivery', '09:00', '42,50 €', '10,00 €', '32,50 €', '18,00 €', '20,00 €',
      'deleted 30 days after pickup']) {
      expect(host, text).toHaveTextContent(text);
    }
    expect(host).not.toHaveTextContent('333');
  });

  it('a second print replaces the first host, and a tap back in the page after printing removes it', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/A1');
    const card = await screen.findByRole('region', { name: 'Mario Prova' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(card).getByRole('button', { name: 'Print for the customer' }));
    expect(document.querySelectorAll(`#${SLIP_HOST_ID}`)).toHaveLength(1);
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.getElementById(SLIP_HOST_ID)).not.toBeNull();
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    expect(document.getElementById(SLIP_HOST_ID)).toBeNull();
    expect(document.documentElement).not.toHaveClass(SLIP_PRINTING_CLASS);
  });
});

describe('the editor', () => {
  async function openNew() {
    const view = show('/bookings/new');
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    return view;
  }
  const fill = async (user: ReturnType<typeof renderApp>['user']) => {
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.type(screen.getByLabelText('Phone'), '+39 333 111 2222');
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    // On the price list Focaccia is sold by the kilo: the window asks the weight of the piece (one of 1.5 kg here).
    await addProduct(user, 'Focaccia', { otherWeight: '1.5' });
  };

  it('starts empty, with placeholders, and no line about allergies under the notes', async () => {
    await openNew();
    expect(screen.getByLabelText('Customer name')).toHaveValue('');
    expect(screen.getByLabelText('Customer name')).toHaveAttribute('placeholder', 'Customer’s name');
    expect(screen.getByText('No product yet: tap “Add a product”.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Pickup' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Delivery' })).not.toBeChecked();
    // The owner took the allergy line away (19 Nov 2026): the notes box has no sentence under it.
    expect(screen.getByLabelText('Notes')).not.toHaveAttribute('aria-describedby');
    expect(isBusy()).toBe(false);
  });

  it('⚠️ Save with a required field empty: blocked, the focus on the first empty one, marked and said', async () => {
    const { user, source } = await openNew();
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Phone')).toHaveFocus();
    expect(screen.getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription('Fill this in.');
    expect(await screen.findByText('Check “Phone”.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.create).not.toHaveBeenCalled();
    // Letters in the phone are refused too.
    await user.type(screen.getByLabelText('Phone'), 'call me');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription('Digits, spaces and + only.');
  });

  it('a delivery needs its address', async () => {
    const { user } = await openNew();
    await fill(user);
    expect(screen.queryByLabelText('Delivery address')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Delivery' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Delivery address')).toHaveFocus();
  });

  it('saves after a question, writes what was typed, returns to the list on the booking\'s day', async () => {
    const { user, source, router } = await openNew();
    await fill(user);
    await user.type(screen.getByLabelText('Total (£)'), '30');
    await user.type(screen.getByLabelText('Deposit (£)'), '5');
    expect(screen.getByText('To pay').parentElement).toHaveTextContent('£25.00');
    expect(isBusy()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const ask = await dialog('Save this booking?');
    expect(ask).toHaveTextContent('Gino Prova');
    await user.click(within(ask).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    expect(source.create).toHaveBeenCalledWith({
      customerName: 'Gino Prova', phone: '+39 333 111 2222', mode: 'pickup', address: '', date: TOMORROW, time: '08:15', slotEnd: null,
      // One piece of 1.5 kg, priced £12.00 a kilo: £18.00 the piece.
      lines: [{ recipeId: null, productId: 'pF', unitPrice: 18, name: 'Focaccia', qty: 1, unit: 'pcs', weightKg: 1.5 }],
      // One more than the highest number in the month of the booking's day (the listener reads that month).
      deposit: 5, total: 30, notes: '', status: 'todo', number: nextNumber(seed().filter(b => monthOf(b.date) === monthOf(TOMORROW))),
    });
    await waitFor(() => { expect(rowNames()).toEqual(['Gino Prova', 'Luca Tomorrow']); });
    expect(list().getByRole('button', { pressed: true })).toHaveAttribute('data-day', TOMORROW);
    // The focus is on the saved booking's row, not lost with the editor.
    await waitFor(() => { expect(list().getAllByRole('link')[0]).toHaveFocus(); });
    expect(isBusy()).toBe(false);
  });

  it('⚠️ leaving with unsaved edits asks; Cancel stays with the typing, Discard leaves', async () => {
    const { user, router } = await openNew();
    await user.type(screen.getByLabelText('Customer name'), 'Gino');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/bookings/new');
    expect(screen.getByLabelText('Customer name')).toHaveValue('Gino');
    // Any other way out asks too (the rail, the browser's Back: the list is hidden beside the form on the tablet).
    act(() => { void router.navigate('/bookings/A2'); });
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings/A2'); });
  });

  it('nothing typed: Back leaves without a question', async () => {
    const { user, router } = await openNew();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('products: the window offers the price list with its prices; a kilo product asks the weight; the card says what it comes to', async () => {
    const { user } = await openNew();
    await user.click(screen.getByRole('button', { name: 'Add a product' }));
    const win = await screen.findByRole('dialog', { name: 'Add a product' });
    // No favourite on this list: the search over the whole list opens at once, every product with its price.
    expect(within(win).getByLabelText('Search the price list')).toHaveFocus();
    expect(within(win).getAllByRole('button').map(b => b.textContent)).toEqual(expect.arrayContaining([
      'Focaccia £12.00 per kg', 'Grissini £3.50 per pack', 'Panettone £25.00 each',
    ]));
    await user.click(within(win).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await addProduct(user, 'Focaccia', { otherWeight: '1.5' });
    const card = screen.getByRole('group', { name: '1. Focaccia · 1.5 kg' });
    expect(card).toHaveTextContent('£18.00'); expect(card).not.toHaveTextContent('each');
    expect(within(card).getByLabelText('Quantity of Focaccia · 1.5 kg')).toHaveValue('1');
    await user.click(within(card).getByRole('button', { name: 'One more: Focaccia · 1.5 kg' }));
    expect(card).toHaveTextContent('£36.00');
    expect(screen.getByLabelText('Total (£)')).toHaveAttribute('placeholder', '£36.00'); // the list's total, grey inside the box;
  });

  it('a product sold by the pack is booked in packs, with what one pack holds', async () => {
    const { user } = await openNew();
    // Nothing to weigh, nothing to change: one tap adds the card.
    await addProduct(user, 'Grissini');
    const card = screen.getByRole('group', { name: '1. Grissini · 250 g' });
    expect(card).toHaveTextContent('£3.50'); expect(card).not.toHaveTextContent('each');
    await user.click(within(card).getByRole('button', { name: 'One more: Grissini · 250 g' }));
    await user.click(within(card).getByRole('button', { name: 'One more: Grissini · 250 g' }));
    expect(card).toHaveTextContent('£10.50');
  });

  it('products: add and remove a card, a name typed freely accepted with no price, said under the total', async () => {
    const { user } = await openNew();
    await addProduct(user, 'Focaccia', { otherWeight: '1' });
    await addProduct(user, 'Torta su misura');
    expect(screen.getAllByRole('group', { name: /^\d\. / }).map(card => card.getAttribute('aria-label'))).toEqual(['1. Focaccia · 1 kg', '2. Torta su misura']);
    expect(screen.getByText('1 product has no price: it is not in the total.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Torta su misura' }));
    expect(screen.getAllByRole('group', { name: /^\d\. / })).toHaveLength(1);
    expect(screen.queryByText(/has no price/)).toBeNull();
  });

  it('an empty total box saves the price list\'s total; a typed one wins (a discount)', async () => {
    const { user, source } = await openNew();
    await fill(user);
    expect(screen.getByLabelText('Total (£)')).toHaveAttribute('placeholder', '£18.00'); // the list's total, grey inside the box;
    await user.type(screen.getByLabelText('Deposit (£)'), '5');
    expect(screen.getByText('To pay').parentElement).toHaveTextContent('£13.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.create).toHaveBeenCalledWith(expect.objectContaining({ total: 18, deposit: 5 })); });
  });

  it('⚠️ a booking opened again keeps the prices it was saved with, even after a new price list, and saves unchanged', async () => {
    const { user, source } = show('/bookings/A2/edit');
    await screen.findByRole('region', { name: 'Edit booking No. 4' }, LOAD);
    // Panettone was booked at £10.00; the list now says £25.00. Focaccia is a line of kilos from before the weights: it says so.
    expect(screen.getByRole('group', { name: '2. Panettone' })).toHaveTextContent('£20.00'); // 2 × the £10.00 it was booked at
    expect(screen.getByRole('group', { name: '1. Focaccia' })).toHaveTextContent('£18.00');
    // Grissini was saved with no price: it stays free.
    expect(screen.getByRole('group', { name: '3. Grissini' })).not.toHaveTextContent('£');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.update).toHaveBeenCalled(); });
    const lines = vi.mocked(source.update).mock.calls[0]?.[1].lines;
    // ⚠️ EXACTLY AS STORED: an old booking opens and saves unchanged.
    expect(lines).toEqual([
      { recipeId: null, productId: 'pF', unitPrice: 12, name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' },
      { recipeId: null, productId: 'pP', unitPrice: 10, name: 'Panettone', qty: 2, unit: 'pcs' },
      { recipeId: null, productId: null, unitPrice: null, name: 'Grissini', qty: 1, unit: 'kg' },
    ]);
  });

  it('⚠️ a quantity is checked in the unit it will be written in — the list\'s — even when the list came after it was typed', async () => {
    const source = fakeBookingsSource(seed());
    const { user } = show('/bookings/new', source);
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.type(screen.getByLabelText('Phone'), '333 111 2222');
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    // No list yet: Panettone typed as a name of its own, and a quantity of 1.5 typed on its card.
    await addProduct(user, 'Panettone');
    const qty = screen.getByLabelText('Quantity of Panettone');
    await user.clear(qty);
    await user.type(qty, '1.5');
    // The list arrives now: Panettone is sold by the piece.
    act(() => { source.priceList = PRICES(); });
    // The card no longer shows a price of one to wait for, and 1.5 pieces has no total: let the list's render settle.
    await act(async () => { await Promise.resolve(); });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Quantity of Panettone')).toHaveFocus();
    expect(screen.getByLabelText('Quantity of Panettone')).toHaveAccessibleDescription('A number above zero (whole for pieces).');
    expect(source.create).not.toHaveBeenCalled();
  });

  it('a total from the list past 100,000 is stopped at Save, on the total', async () => {
    const { user, source } = await openNew();
    await fill(user);
    await user.clear(screen.getByLabelText('Quantity of Focaccia · 1.5 kg'));
    await user.type(screen.getByLabelText('Quantity of Focaccia · 1.5 kg'), '9000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Total (£)')).toHaveFocus();
    expect(screen.getByLabelText('Total (£)')).toHaveAccessibleDescription(/The total is over 100,000: check the quantities\./);
    expect(source.create).not.toHaveBeenCalled();
  });

  it('nothing is said about the price list while it is on its way', async () => {
    const source = fakeBookingsSource(seed(), PRICES());
    vi.mocked(source.watchPriceList).mockImplementation(() => () => undefined);
    show('/bookings/new', source);
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.queryByText(/No price list published yet/)).toBeNull();
  });

  it('no price list published: names typed freely only, and it says so', async () => {
    const { user } = show('/bookings/new', fakeBookingsSource(seed()));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Add a product' }));
    const win = await screen.findByRole('dialog', { name: 'Add a product' });
    expect(within(win).getByText('No price list yet: type the product’s name.')).toBeInTheDocument();
  });

  it('edits an existing booking on a copy, keeps its number and status, and writes on Save', async () => {
    const { user, source } = show('/bookings/A2/edit');
    await screen.findByRole('region', { name: 'Edit booking No. 4' }, LOAD);
    expect(screen.getByLabelText('Customer name')).toHaveValue('Anna Finta');
    expect(screen.getByLabelText('Delivery address')).toHaveValue('Via Finta 1, Roma');
    expect(screen.getByLabelText('Quantity of Focaccia')).toHaveValue('1.5');
    await user.clear(screen.getByLabelText('Customer name'));
    await user.type(screen.getByLabelText('Customer name'), 'Anna Nuova');
    expect(source.items.get('A2')?.customerName).toBe('Anna Finta');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.items.get('A2')?.customerName).toBe('Anna Nuova'); });
    expect(source.update).toHaveBeenCalledWith('A2', expect.objectContaining({ number: 4, status: 'todo', mode: 'delivery', notes: 'Ring twice' }));
  });

  it('⚠️ a save the server refuses keeps the typing: the list offers it back, the editor opens with it', async () => {
    const source = fakeBookingsSource(seed());
    const { user, router } = show('/bookings/new', source);
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    await fill(user);
    source.refuseWith = permissionDenied();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The booking wasn’t saved: you can’t change bookings in this venue.')).toBeInTheDocument();
    const banner = await list().findByRole('alert');
    expect(banner).toHaveTextContent('A booking was not saved.');
    await user.click(within(banner).getByRole('button', { name: 'Open it to try again' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings/new'); });
    expect(await screen.findByLabelText('Customer name')).toHaveValue('Gino Prova');
    expect(screen.getByRole('group', { name: '1. Focaccia · 1.5 kg' })).toBeInTheDocument();
    // The region stays on the page (a live region inserted already filled is not announced), empty.
    await waitFor(() => { expect(list().getByRole('alert')).toBeEmptyDOMElement(); });
    // ⚠️ A new card after the restore is a card of its own (review, 18 Nov 2026: its key was shared with a restored row, and typing
    // in it wrote into both).
    await addProduct(user, 'Grissini');
    await user.type(screen.getByLabelText('Note for Grissini'), 'x');
    expect(screen.getByLabelText('Note for Focaccia · 1.5 kg')).toHaveValue('');
  });

  it('⚠️ a Save never puts back a status set on another device while the editor was open', async () => {
    const { user, source } = show('/bookings/A1/edit');
    await screen.findByRole('region', { name: 'Edit booking No. 3' }, LOAD);
    await user.type(screen.getByLabelText('Phone'), '9');
    // The counter tablet cancels it meanwhile.
    act(() => { source.items.set('A1', { ...(source.items.get('A1') as Booking), status: 'cancelled' }); source.push(); });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.update).toHaveBeenCalledWith('A1', expect.objectContaining({ status: 'cancelled', phone: '+39 333 000 00009' })); });
  });

  it('⚠️ a refused save of a booking deleted on another device is made again as a new booking', async () => {
    const source = fakeBookingsSource(seed());
    const { user } = show('/bookings/A1/edit', source);
    await screen.findByRole('region', { name: 'Edit booking No. 3' }, LOAD);
    await user.type(screen.getByLabelText('Customer name'), ' Jr');
    source.refuseWith = permissionDenied();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    const banner = await list().findByRole('button', { name: 'Open it to try again' });
    act(() => { source.items.delete('A1'); source.push(); });
    source.refuseWith = null;
    await user.click(banner);
    expect(await screen.findByLabelText('Customer name')).toHaveValue('Mario Prova Jr');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.create).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Mario Prova Jr', number: 3 })); });
  });

  it('an existing booking\'s editor waits for the bookings before it copies one', async () => {
    const source = fakeBookingsSource(seed());
    let release: () => void = () => undefined;
    vi.mocked(source.watch).mockImplementation(({ from, until }, onChange) => {
      release = () => { onChange([...source.items.values()].filter(b => b.date >= from && b.date < until), false); };
      return () => undefined;
    });
    show('/bookings/A1/edit', source);
    expect(await screen.findByText('The booking hasn’t arrived yet — it opens as soon as it does.', {}, LOAD)).toBeInTheDocument();
    act(() => { release(); });
    expect(await screen.findByLabelText('Customer name')).toHaveValue('Mario Prova');
  });

  it('in Italian', async () => {
    show('/bookings/new', undefined, { lang: 'it' });
    expect(await screen.findByRole('region', { name: 'Nuova prenotazione' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ritiro' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Consegna' })).toBeInTheDocument();
    expect(screen.getByLabelText('Acconto (£)')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome cliente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi un prodotto' })).toBeInTheDocument();
    expect(screen.queryByText(/allergie/)).toBeNull();
  });

  it('an address that leads nowhere goes back to the list', async () => {
    const { router } = show('/bookings/A1/nonsense');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); }, LOAD);
  });
});
