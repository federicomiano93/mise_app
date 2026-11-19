import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { bookingFixture, fakeBookingsSource } from '../testing/fakeBookingsSource';
import type { FakeBookingsSource } from '../testing/fakeBookingsSource';
import { addProduct } from '../testing/bookingForm';
import { renderApp } from '../testing/renderApp';
import { dayAfter } from './bookingModel';
import type { Booking } from './bookingModel';
import { DEFAULT_SETTINGS } from './bookingSettings';
import type { BookingSettings } from './bookingSettings';

// The booking form obeys the venue's settings (bookings settings, 18 Nov 2026): no phone, one mode only, time slots with the
// places left, the day the list shows. ⚠️ Fake customers only.

const TODAY = todayISO();
const TOMORROW = dayAfter(TODAY, 1);
const LOAD = { timeout: 5000 };
const SLOTS: BookingSettings = { ...DEFAULT_SETTINGS, slotFirst: '09:00', slotLast: '12:00', slotMinutes: 60, slotLimit: 2 };

function show(path: string, settings: BookingSettings, seed: Booking[] = [], options: Parameters<typeof renderApp>[1] = {}) {
  const source: FakeBookingsSource = fakeBookingsSource(seed, undefined, settings);
  const view = renderApp(path, { ...options, data: { bookings: () => source } });
  return { ...view, source };
}

const dialog = (name: string) => screen.findByRole('alertdialog', { name }, LOAD);
const options = () => within(screen.getByLabelText('Time slot')).getAllByRole('option').map(o => [o.textContent, (o as HTMLOptionElement).disabled]);

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('no phone asked', () => {
  const NO_PHONE: BookingSettings = { ...DEFAULT_SETTINGS, askPhone: false };

  it('the form has no phone box, and saves a booking without a phone', async () => {
    const { user, source } = show('/bookings/new', NO_PHONE);
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.queryByLabelText('Phone')).toBeNull();
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    await addProduct(user, 'Pane');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.create).toHaveBeenCalledWith(expect.objectContaining({ phone: '', slotEnd: null })); });
  });

  it('the booking page shows no phone and no WhatsApp reminder', async () => {
    show('/bookings/A1', NO_PHONE, [bookingFixture({ id: 'A1', date: TODAY, number: 3 })], { session: { location: { country: 'IT' } } });
    const card = await screen.findByRole('region', { name: 'Booking No. 3' }, LOAD);
    expect(card).not.toHaveTextContent('+39 333 000 0000');
    expect(within(card).queryByRole('link', { name: /WhatsApp/ })).toBeNull();
  });

  it('the reminder switched off alone hides only the reminder', async () => {
    show('/bookings/A1', { ...DEFAULT_SETTINGS, whatsappReminder: false }, [bookingFixture({ id: 'A1', date: TODAY, number: 3 })], { session: { location: { country: 'IT' } } });
    const card = await screen.findByRole('region', { name: 'Booking No. 3' }, LOAD);
    expect(card).toHaveTextContent('+39 333 000 0000');
    expect(within(card).queryByRole('link', { name: /WhatsApp/ })).toBeNull();
  });
});

describe('one mode only', () => {
  it('pickup only: no choice, a quiet «✓ Pickup» line; the list keeps its «Pickup» tag', async () => {
    const { user, source } = show('/bookings/new', { ...DEFAULT_SETTINGS, modes: 'pickup' });
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.queryByRole('radio', { name: 'Pickup' })).toBeNull();
    expect(screen.getByText('✓ Pickup')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.type(screen.getByLabelText('Phone'), '333');
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    await addProduct(user, 'Pane');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'pickup' })); });
  });

  it('delivery only: «✓ Delivery», and the address is always asked and required', async () => {
    const { user } = show('/bookings/new', { ...DEFAULT_SETTINGS, modes: 'delivery' });
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.getByText('✓ Delivery')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.type(screen.getByLabelText('Phone'), '333');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Delivery address')).toHaveFocus();
  });
});

describe('time slots', () => {
  const seed = () => [
    bookingFixture({ id: 'X1', date: TOMORROW, time: '09:00', slotEnd: '10:00', number: 1 }),
    bookingFixture({ id: 'X2', date: TOMORROW, time: '09:00', slotEnd: '10:00', number: 2 }),
    bookingFixture({ id: 'X3', date: TOMORROW, time: '10:00', slotEnd: '11:00', number: 3 }),
    bookingFixture({ id: 'X4', date: TOMORROW, time: '10:00', slotEnd: '11:00', number: 4, status: 'cancelled' }),
  ];

  it('«Time slot» instead of the time: the places left, a full slot disabled; saving writes the start and the end', async () => {
    const { user, source } = show('/bookings/new', SLOTS, seed());
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.queryByLabelText('Time')).toBeNull();
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    expect(options()).toEqual([
      ['Choose the slot', false],
      ['09:00–10:00 · full', true],
      // The cancelled booking leaves its place.
      ['10:00–11:00 · 1 left', false],
      ['11:00–12:00 · 2 left', false],
    ]);
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.type(screen.getByLabelText('Phone'), '333');
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    await addProduct(user, 'Pane');
    // No slot chosen: refused, said on the slot.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Time slot')).toHaveFocus();
    expect(await screen.findByText('Check “Time slot”.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Time slot'), '10:00-11:00');
    // Chosen, it counts this booking once.
    expect(options()[2]).toEqual(['10:00–11:00 · full', false]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const ask = await dialog('Save this booking?');
    // The slot is read as a slot, never «at 10:00–11:00».
    expect(ask).toHaveTextContent('between 10:00 and 11:00.');
    await user.click(within(ask).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.create).toHaveBeenCalledWith(expect.objectContaining({ time: '10:00', slotEnd: '11:00' })); });
  });

  it('no limit: no places said', async () => {
    show('/bookings/new', { ...SLOTS, slotLimit: null }, seed());
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(options().map(([text]) => text)).toEqual(['Choose the slot', '09:00–10:00', '10:00–11:00', '11:00–12:00']);
  });

  it('⚠️ editing a booking in a full slot keeps it there, counted once', async () => {
    show('/bookings/X1/edit', SLOTS, seed());
    await screen.findByLabelText('Time slot', {}, LOAD);
    expect(screen.getByLabelText('Time slot')).toHaveValue('09:00-10:00');
    expect(options()[1]).toEqual(['09:00–10:00 · full', false]);
  });

  it('⚠️ an old booking with an exact time not on a slot keeps that time as its own choice: nothing is lost', async () => {
    const { user, source } = show('/bookings/OLD/edit', SLOTS, [bookingFixture({ id: 'OLD', date: TOMORROW, time: '09:40', number: 9 })]);
    await screen.findByLabelText('Time slot', {}, LOAD);
    expect(screen.getByLabelText('Time slot')).toHaveDisplayValue('09:40 (as booked)');
    await user.type(screen.getByLabelText('Notes'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save this booking?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.update).toHaveBeenCalledWith('OLD', expect.objectContaining({ time: '09:40', slotEnd: null })); });
  });
});

describe('the day the list shows', () => {
  it('«New booking» from Tomorrow starts on tomorrow', async () => {
    const { user } = show('/bookings', DEFAULT_SETTINGS);
    await user.click(await screen.findByRole('button', { name: 'Tomorrow' }, LOAD));
    await user.click(screen.getByRole('button', { name: 'New booking' }));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.getByLabelText('Day')).toHaveValue(TOMORROW);
  });

  it('…from Today on today; from a past day, no day', async () => {
    const { user } = show('/bookings', DEFAULT_SETTINGS);
    await user.click(await screen.findByRole('button', { name: 'New booking' }, LOAD));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.getByLabelText('Day')).toHaveValue(TODAY);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'Past day' }, LOAD));
    await user.click(screen.getByRole('button', { name: 'New booking' }));
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    expect(screen.getByLabelText('Day')).toHaveValue('');
  });
});

describe('an old booking in the mode the venue no longer takes', () => {
  it('keeps the choice on screen while it is changed: a mistaken tap can be put back', async () => {
    const { user } = show('/bookings/D1/edit', { ...DEFAULT_SETTINGS, modes: 'pickup' },
      [bookingFixture({ id: 'D1', date: TOMORROW, mode: 'delivery', address: 'Via Finta 1', number: 8 })]);
    await screen.findByRole('radio', { name: 'Delivery' }, LOAD);
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    expect(screen.getByRole('radio', { name: 'Pickup' })).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: 'Delivery' }));
    expect(screen.getByLabelText('Delivery address')).toHaveValue('Via Finta 1');
  });
});
