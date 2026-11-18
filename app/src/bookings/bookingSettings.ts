// bookingSettings.ts — how the venue takes bookings, the pure half (bookings settings, 18 Nov 2026).
//
// NEW IN MISE 2, no original in the current app. One document per venue, `locations/{lid}/config/bookings`, chosen in
// Bookings' «Impostazioni» by whoever manages bookings (firestore.rules, `match /config/bookings`) and obeyed by the booking
// form on every device. Plain TypeScript, no React, no Firebase: what the settings are, how a stored document is read, what
// is written, and the time slots the form offers.
//
// ⚠️ EVERY FIELD IS OPTIONAL AND A MISSING ONE MEANS TODAY'S BEHAVIOUR (DEFAULT_SETTINGS): a venue that never opened the
// screen — or a document that cannot be read — sees the form exactly as before (phone asked, WhatsApp reminder, pickup or
// delivery, the exact time). Every bound below is the rules' own.

import type { Booking } from './bookingModel';
import { TIME_RE, inSlotOf } from './bookingModel';

export type BookingModes = 'both' | 'pickup' | 'delivery';
export const BOOKING_MODES_SETTING: readonly BookingModes[] = ['both', 'pickup', 'delivery'];

export type SlotMinutes = 30 | 60 | 120;
export const SLOT_MINUTES: readonly SlotMinutes[] = [30, 60, 120];

export const MAX_SLOT_LIMIT = 999;
export const MAX_EXTRAS = 40;
export const MAX_EXTRA_LENGTH = 40;

export type BookingSettings = {
  // Off: the form neither asks nor shows the phone, the booking page hides it, and there is no WhatsApp reminder.
  readonly askPhone: boolean;
  // Off hides the WhatsApp reminder. ⚠️ Only meaningful with the phone asked: reminderOn() says whether it shows.
  readonly whatsappReminder: boolean;
  readonly modes: BookingModes;
  // The first slot's start and the last slot's END, 'HH:MM'. Both null: no slots, the form keeps the exact time.
  readonly slotFirst: string | null;
  readonly slotLast: string | null;
  readonly slotMinutes: SlotMinutes;
  // How many bookings one slot takes (1–999), null: no limit.
  readonly slotLimit: number | null;
  // «Biglietti per pezzo», the master switch: stored now, used by the per-piece lab slips (step 4 of the rebuild).
  readonly perPieceSlips: boolean;
  // «Da aggiungere»: the extras the form offers (step 2 of the rebuild).
  readonly extras: readonly string[];
};

export const DEFAULT_SETTINGS: BookingSettings = Object.freeze({
  askPhone: true,
  whatsappReminder: true,
  modes: 'both',
  slotFirst: null,
  slotLast: null,
  slotMinutes: 60,
  slotLimit: null,
  perPieceSlips: true,
  extras: Object.freeze([]) as readonly string[],
});

const fold = (text: string): string => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

// The extras as kept: trimmed, cut to MAX_EXTRA_LENGTH, each once (case and spaces aside), at most MAX_EXTRAS.
export function cleanExtras(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const word = value.trim().replace(/\s+/g, ' ').slice(0, MAX_EXTRA_LENGTH);
    if (word === '' || seen.has(fold(word))) continue;
    seen.add(fold(word));
    out.push(word);
    if (out.length >= MAX_EXTRAS) break;
  }
  return out;
}

const isTime = (value: unknown): value is string => typeof value === 'string' && TIME_RE.test(value);

// A stored document as the form reads it. Each field on its own: a wrong one is its default, never the end of the others.
// Slots count only as a pair, first before last; otherwise there are none.
export function readSettings(data: Record<string, unknown> | null | undefined): BookingSettings {
  if (!data) return DEFAULT_SETTINGS;
  const first = isTime(data.slotFirst) ? data.slotFirst : null;
  const last = isTime(data.slotLast) ? data.slotLast : null;
  const slots = first !== null && last !== null && first < last;
  const limit = data.slotLimit;
  return {
    askPhone: typeof data.askPhone === 'boolean' ? data.askPhone : DEFAULT_SETTINGS.askPhone,
    whatsappReminder: typeof data.whatsappReminder === 'boolean' ? data.whatsappReminder : DEFAULT_SETTINGS.whatsappReminder,
    modes: BOOKING_MODES_SETTING.find(mode => mode === data.modes) ?? DEFAULT_SETTINGS.modes,
    slotFirst: slots ? first : null,
    slotLast: slots ? last : null,
    slotMinutes: SLOT_MINUTES.find(minutes => minutes === data.slotMinutes) ?? DEFAULT_SETTINGS.slotMinutes,
    slotLimit: typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= MAX_SLOT_LIMIT ? limit : null,
    perPieceSlips: typeof data.perPieceSlips === 'boolean' ? data.perPieceSlips : DEFAULT_SETTINGS.perPieceSlips,
    extras: cleanExtras(data.extras),
  };
}

// What is written: the fields that have a value, and the names of the ones to DELETE (no slots, no limit). The source writes
// them with merge, so a key a later version adds is never wiped by this one.
export function settingsToStore(settings: BookingSettings): { fields: Record<string, unknown>; cleared: string[] } {
  const fields: Record<string, unknown> = {
    askPhone: settings.askPhone,
    // ⚠️ THE REMINDER NEEDS THE PHONE: with the phone off it is stored off too, so the two can never disagree on a device.
    whatsappReminder: settings.askPhone && settings.whatsappReminder,
    modes: settings.modes,
    slotMinutes: settings.slotMinutes,
    perPieceSlips: settings.perPieceSlips,
    extras: cleanExtras(settings.extras),
  };
  const cleared: string[] = [];
  const slots = isTime(settings.slotFirst) && isTime(settings.slotLast) && settings.slotFirst < settings.slotLast;
  if (slots) {
    fields.slotFirst = settings.slotFirst;
    fields.slotLast = settings.slotLast;
  } else {
    cleared.push('slotFirst', 'slotLast');
  }
  if (settings.slotLimit !== null && Number.isInteger(settings.slotLimit) && settings.slotLimit >= 1 && settings.slotLimit <= MAX_SLOT_LIMIT) {
    fields.slotLimit = settings.slotLimit;
  } else {
    cleared.push('slotLimit');
  }
  return { fields, cleared };
}

// Whether two settings say the same (what «unsaved changes» compares).
export function sameSettings(a: BookingSettings, b: BookingSettings): boolean {
  return a.askPhone === b.askPhone && a.whatsappReminder === b.whatsappReminder && a.modes === b.modes
    && a.slotFirst === b.slotFirst && a.slotLast === b.slotLast && a.slotMinutes === b.slotMinutes && a.slotLimit === b.slotLimit
    && a.perPieceSlips === b.perPieceSlips && JSON.stringify(a.extras) === JSON.stringify(b.extras);
}

// The WhatsApp reminder shows only with the phone asked AND the reminder on.
export const reminderOn = (settings: BookingSettings): boolean => settings.askPhone && settings.whatsappReminder;

// The one mode a venue takes, or null when it takes both.
export const onlyMode = (settings: BookingSettings): 'pickup' | 'delivery' | null => (settings.modes === 'both' ? null : settings.modes);

// ── Time slots ───────────────────────────────────────────────────────────────

export type Slot = { readonly start: string; readonly end: string };

const toMinutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// The slots from `first` to `last`, `minutes` long each. ⚠️ THE LAST SLOT NEVER RUNS PAST `last`: when the hours do not divide
// evenly it is cut short (08:00–12:30 in hours ends with 12:00–12:30), so no booking is offered after closing time.
// Nothing when the times are not 'HH:MM' or `last` is not after `first`.
export function generateSlots(first: string, last: string, minutes: number): Slot[] {
  if (!isTime(first) || !isTime(last) || !Number.isInteger(minutes) || minutes <= 0) return [];
  const from = toMinutes(first);
  const to = toMinutes(last);
  const slots: Slot[] = [];
  for (let start = from; start < to; start += minutes) {
    slots.push({ start: toTime(start), end: toTime(Math.min(start + minutes, to)) });
  }
  return slots;
}

// The venue's slots, or null when it has none (the form keeps the exact time).
export function slotsOf(settings: BookingSettings): Slot[] | null {
  if (settings.slotFirst === null || settings.slotLast === null) return null;
  const slots = generateSlots(settings.slotFirst, settings.slotLast, settings.slotMinutes);
  return slots.length > 0 ? slots : null;
}


// How many bookings a slot still takes: the limit less the bookings of that day and slot, cancelled ones aside. The booking
// being edited is counted ONCE — as the working copy places it (`chosen`: the slot is the one picked in the form), never also
// as it is stored. null when there is no limit.
// ⚠️ COUNTED ON THIS DEVICE (the owner accepted it, 18 Nov 2026): two tablets taking the last place in the same second, or one
// offline, can put one booking more in a slot than its limit. The rules cannot count a collection.
export function placesLeft(
  bookings: readonly Booking[],
  { date, slot, limit, editingId, chosen }: { date: string; slot: Slot; limit: number | null; editingId: string | null; chosen: boolean },
): number | null {
  if (limit === null) return null;
  const others = bookings.filter(b => b.id !== editingId && b.status !== 'cancelled' && inSlotOf(b, date, slot)).length;
  return limit - others - (chosen ? 1 : 0);
}

// The value of a slot in the form's select, and back.
export const slotValue = (slot: Slot): string => `${slot.start}-${slot.end}`;
export function slotFromValue(value: string): Slot | null {
  const [start, end] = value.split('-');
  return start !== undefined && end !== undefined && isTime(start) && isTime(end) && start < end ? { start, end } : null;
}

// The half hours of a day, for the settings' «Prima fascia dalle» / «Ultima fascia fino alle».
export const HALF_HOURS: readonly string[] = Array.from({ length: 48 }, (_, i) => toTime(i * 30));
