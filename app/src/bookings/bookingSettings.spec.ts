import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, HALF_HOURS, MAX_EXTRAS, cleanExtras, generateSlots, onlyMode, placesLeft, readSettings, reminderOn,
  sameSettings, settingsChanges, settingsToStore, slotFromValue, slotValue, slotsOf,
} from './bookingSettings';
import type { BookingSettings } from './bookingSettings';
import { bookingFixture } from '../testing/fakeBookingsSource';

// Bookings settings (18 Nov 2026): config/bookings, read by the form on every device.

describe('readSettings: the defaults are today\'s form', () => {
  it('a venue with no document asks the phone, sends reminders, takes both modes and the exact time', () => {
    expect(readSettings(null)).toEqual({
      askPhone: true, whatsappReminder: true, modes: 'both', slotFirst: null, slotLast: null, slotMinutes: 60, slotLimit: null,
      perPieceSlips: true, extras: [],
    });
    expect(readSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ bakery: 'main' })).toEqual(DEFAULT_SETTINGS);
  });

  it('reads every field', () => {
    expect(readSettings({
      askPhone: false, whatsappReminder: false, modes: 'pickup', slotFirst: '08:00', slotLast: '13:00', slotMinutes: 30,
      slotLimit: 12, perPieceSlips: false, extras: ['Cipolla', 'Acciughe'],
    })).toEqual({
      askPhone: false, whatsappReminder: false, modes: 'pickup', slotFirst: '08:00', slotLast: '13:00', slotMinutes: 30,
      slotLimit: 12, perPieceSlips: false, extras: ['Cipolla', 'Acciughe'],
    });
  });

  it('⚠️ a wrong field is its default, never the end of the others', () => {
    const read = readSettings({
      askPhone: 'no', whatsappReminder: 0, modes: 'post', slotMinutes: 45, slotLimit: 0, perPieceSlips: null, extras: 'x', askPhoneTwice: true,
    });
    expect(read).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ slotLimit: 1000 }).slotLimit).toBeNull();
    expect(readSettings({ slotLimit: 2.5 }).slotLimit).toBeNull();
    expect(readSettings({ slotLimit: 999 }).slotLimit).toBe(999);
    expect(readSettings({ modes: 'delivery', askPhone: 'x' })).toMatchObject({ modes: 'delivery', askPhone: true });
  });

  it('slots count only as a pair, first before last', () => {
    expect(readSettings({ slotFirst: '08:00' })).toMatchObject({ slotFirst: null, slotLast: null });
    expect(readSettings({ slotFirst: '13:00', slotLast: '08:00' })).toMatchObject({ slotFirst: null, slotLast: null });
    expect(readSettings({ slotFirst: '8:00', slotLast: '13:00' })).toMatchObject({ slotFirst: null, slotLast: null });
    expect(readSettings({ slotFirst: '08:00', slotLast: '08:00' })).toMatchObject({ slotFirst: null, slotLast: null });
  });

  it('extras: trimmed, each once, at most forty of forty letters', () => {
    expect(cleanExtras([' Cipolla ', 'cipolla', '', 3, 'Acciughe', 'x'.repeat(50)])).toEqual(['Cipolla', 'Acciughe', 'x'.repeat(40)]);
    expect(cleanExtras(Array.from({ length: 50 }, (_, i) => `e${i}`))).toHaveLength(MAX_EXTRAS);
  });
});

describe('settingsToStore', () => {
  const full: BookingSettings = { ...DEFAULT_SETTINGS, slotFirst: '08:00', slotLast: '13:00', slotLimit: 5, extras: ['Cipolla'] };

  it('writes every field with a value, and deletes no slot and no limit', () => {
    expect(settingsToStore(full)).toEqual({
      fields: {
        askPhone: true, whatsappReminder: true, modes: 'both', slotMinutes: 60, perPieceSlips: true, extras: ['Cipolla'],
        slotFirst: '08:00', slotLast: '13:00', slotLimit: 5,
      },
      cleared: [],
    });
    expect(settingsToStore(DEFAULT_SETTINGS).cleared).toEqual(['slotFirst', 'slotLast', 'slotLimit']);
  });

  it('⚠️ the reminder is stored off with the phone off', () => {
    expect(settingsToStore({ ...full, askPhone: false, whatsappReminder: true }).fields.whatsappReminder).toBe(false);
    expect(reminderOn({ ...full, askPhone: false, whatsappReminder: true })).toBe(false);
    expect(reminderOn(full)).toBe(true);
  });

  it('reads back as it was saved', () => {
    expect(readSettings(settingsToStore(full).fields)).toEqual(full);
    expect(sameSettings(readSettings(settingsToStore(full).fields), full)).toBe(true);
    expect(sameSettings(full, { ...full, extras: ['Cipolla', 'Olive'] })).toBe(false);
  });

  it('one mode only', () => {
    expect(onlyMode(DEFAULT_SETTINGS)).toBeNull();
    expect(onlyMode({ ...DEFAULT_SETTINGS, modes: 'pickup' })).toBe('pickup');
    expect(onlyMode({ ...DEFAULT_SETTINGS, modes: 'delivery' })).toBe('delivery');
  });
});

describe('generateSlots', () => {
  it('hours from the first to the last', () => {
    expect(generateSlots('08:00', '11:00', 60)).toEqual([
      { start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' },
    ]);
  });

  it('half hours and two hours', () => {
    expect(generateSlots('08:00', '09:30', 30).map(slotValue)).toEqual(['08:00-08:30', '08:30-09:00', '09:00-09:30']);
    expect(generateSlots('08:00', '12:00', 120).map(slotValue)).toEqual(['08:00-10:00', '10:00-12:00']);
  });

  it('⚠️ the last slot never runs past the last time: it is cut short', () => {
    expect(generateSlots('08:00', '12:30', 60).map(slotValue)).toEqual(['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-12:30']);
    expect(generateSlots('08:00', '09:00', 120).map(slotValue)).toEqual(['08:00-09:00']);
  });

  it('one slot when first and last are one length apart; none when last is not after first', () => {
    expect(generateSlots('08:00', '08:30', 30)).toHaveLength(1);
    expect(generateSlots('08:00', '08:00', 30)).toEqual([]);
    expect(generateSlots('09:00', '08:00', 30)).toEqual([]);
  });

  it('the whole day in half hours, up to the last half hour', () => {
    const slots = generateSlots('00:00', '23:30', 30);
    expect(slots).toHaveLength(47);
    expect(slots.at(-1)).toEqual({ start: '23:00', end: '23:30' });
    expect(HALF_HOURS).toHaveLength(48);
    expect(HALF_HOURS[0]).toBe('00:00');
    expect(HALF_HOURS.at(-1)).toBe('23:30');
  });

  it('nothing for times that are not HH:MM', () => {
    expect(generateSlots('8:00', '12:00', 60)).toEqual([]);
    expect(generateSlots('08:00', '25:00', 60)).toEqual([]);
    expect(generateSlots('08:00', '12:00', 0)).toEqual([]);
  });

  it('slotsOf: the venue\'s slots, or null for the exact time', () => {
    expect(slotsOf(DEFAULT_SETTINGS)).toBeNull();
    expect(slotsOf({ ...DEFAULT_SETTINGS, slotFirst: '08:00', slotLast: '10:00' })?.map(slotValue)).toEqual(['08:00-09:00', '09:00-10:00']);
  });

  it('a slot travels through the select and back', () => {
    expect(slotFromValue('09:00-10:00')).toEqual({ start: '09:00', end: '10:00' });
    expect(slotFromValue('10:00-09:00')).toBeNull();
    expect(slotFromValue('')).toBeNull();
    expect(slotFromValue('09:00')).toBeNull();
  });
});

describe('placesLeft', () => {
  const DAY = '2026-12-24';
  const slot = { start: '09:00', end: '10:00' };
  const bookings = [
    bookingFixture({ id: 'a', date: DAY, time: '09:00', slotEnd: '10:00' }),
    bookingFixture({ id: 'b', date: DAY, time: '09:00', slotEnd: '10:00' }),
    // An old booking with an exact time inside the slot counts too.
    bookingFixture({ id: 'c', date: DAY, time: '09:45' }),
    // Cancelled: not counted.
    bookingFixture({ id: 'd', date: DAY, time: '09:00', slotEnd: '10:00', status: 'cancelled' }),
    // Another slot, another day: not counted.
    bookingFixture({ id: 'e', date: DAY, time: '10:00', slotEnd: '11:00' }),
    bookingFixture({ id: 'f', date: '2026-12-23', time: '09:00', slotEnd: '10:00' }),
  ];

  it('the limit less the bookings of that day and slot, cancelled ones aside', () => {
    expect(placesLeft(bookings, { date: DAY, slot, limit: 5, editingId: null, chosen: false })).toBe(2);
    expect(placesLeft(bookings, { date: DAY, slot, limit: 3, editingId: null, chosen: false })).toBe(0);
  });

  it('no limit, no count', () => {
    expect(placesLeft(bookings, { date: DAY, slot, limit: null, editingId: null, chosen: true })).toBeNull();
  });

  it('a new booking choosing the slot takes one place', () => {
    expect(placesLeft(bookings, { date: DAY, slot, limit: 5, editingId: null, chosen: true })).toBe(1);
  });

  it('⚠️ the booking being edited is counted once: as the form places it, never also as stored', () => {
    // Booking a is in the slot and stays there: counted once.
    expect(placesLeft(bookings, { date: DAY, slot, limit: 5, editingId: 'a', chosen: true })).toBe(2);
    // Booking a moved elsewhere in the form: this slot has its place back.
    expect(placesLeft(bookings, { date: DAY, slot, limit: 5, editingId: 'a', chosen: false })).toBe(3);
  });

  it('the edge of a slot: its end belongs to the next one', () => {
    const late = [bookingFixture({ id: 'z', date: DAY, time: '10:00' })];
    expect(placesLeft(late, { date: DAY, slot, limit: 1, editingId: null, chosen: false })).toBe(1);
    expect(placesLeft(late, { date: DAY, slot: { start: '10:00', end: '11:00' }, limit: 1, editingId: null, chosen: false })).toBe(0);
  });
});

describe('settingsChanges: a Save writes only what it changed', () => {
  it('one setting changed, one field written; another device\'s change to another field is left alone', () => {
    expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, modes: 'pickup' })).toEqual({ fields: { modes: 'pickup' }, cleared: [] });
  });

  it('slots set, slots cleared', () => {
    const slots = { ...DEFAULT_SETTINGS, slotFirst: '08:00', slotLast: '12:00', slotLimit: 4 };
    expect(settingsChanges(DEFAULT_SETTINGS, slots)).toEqual({ fields: { slotFirst: '08:00', slotLast: '12:00', slotLimit: 4 }, cleared: [] });
    expect(settingsChanges(slots, DEFAULT_SETTINGS)).toEqual({ fields: {}, cleared: ['slotFirst', 'slotLast', 'slotLimit'] });
  });

  it('the phone off takes the reminder with it', () => {
    expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, askPhone: false })).toEqual({
      fields: { askPhone: false, whatsappReminder: false }, cleared: [],
    });
  });

  it('nothing changed, nothing written', () => {
    expect(settingsChanges(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual({ fields: {}, cleared: [] });
  });
});
