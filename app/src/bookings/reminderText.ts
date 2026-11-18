// reminderText.ts — the WhatsApp reminder to the customer (bookings step 4, 18 Nov 2026). Pure, no DOM.
//
// A button on the booking opens WhatsApp on THIS device, on the customer's chat, with the reminder already written: the person
// at the counter reads it, may change it, and sends it. Nothing is sent by the app and nothing goes through a server — WhatsApp
// itself (the app, or WhatsApp Web) does the sending, from the shop's own number.
//
// ⚠️ PERSONAL DATA: the customer's phone becomes part of a wa.me address, and the message carries their name (and, for a
// delivery, the address they gave). Both only to THEM, about THIS order — the use the slip's privacy line promises. Never logged.

import { formatMoney } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import type { Country } from '@mise/shared/market';
import { toPay } from './bookingModel';
import type { Booking } from './bookingModel';
import { lineQtyText, spellDate } from './bookingWords';
import type { UnitWords } from './bookingWords';

// The country code a number typed WITHOUT one is given: the venue's country, where its customers' phones are.
const CALLING_CODE: Readonly<Record<Country, string>> = Object.freeze({ GB: '44', IT: '39' });
// Shortest whole international number wa.me can open (country code + subscriber); anything shorter is a typo.
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

// The number as wa.me wants it: digits only, WITH the country code, no «+», no «00».
//   «+39 333 123 4567» / «0039 333…» → 393331234567 (already international);
//   «333 123 4567» in an Italian venue → 39 + the number as typed (Italian numbers keep their leading digit, a 0 included);
//   «07700 900123» in a UK venue → 44 + the number WITHOUT its leading 0 (the UK's trunk prefix);
//   «39 333 123 4567» / «44 7700 900123» — the venue's own code typed without «+» — is not given it twice.
// '' when it cannot be a phone WhatsApp could open (too short, too long, or no country to add).
export function whatsappNumber(phone: string, country: Country | null): string {
  const typed = phone.trim();
  const digits = typed.replace(/\D/g, '');
  let full: string;
  if (typed.startsWith('+')) full = digits;
  else if (digits.startsWith('00')) full = digits.slice(2);
  // The venue's own code typed without «+»: «39 333 123 4567» (12 digits; an Italian number alone is at most 11, so a 10-digit
  // mobile starting 39… is never taken for it), «44 7700 900000» (no UK number starts with 44 once its 0 is dropped).
  else if (country === 'IT' && digits.length === 12 && digits.startsWith('39')) full = digits;
  else if (country === 'GB' && digits.startsWith('44')) full = digits;
  else if (country === 'GB') full = `${CALLING_CODE.GB}${digits.replace(/^0/, '')}`;
  else if (country === 'IT') full = `${CALLING_CODE.IT}${digits}`;
  else return '';
  // «+44 07700 900000»: the UK's trunk 0 written after the code (a common habit) is dropped. Never after 39: Italian landlines
  // keep their 0 («+39 06…»).
  if (full.startsWith('440')) full = `44${full.slice(3)}`;
  return full.length >= MIN_DIGITS && full.length <= MAX_DIGITS ? full : '';
}

// The words of the message, chosen by the screen (its t(): the interface's language, as the slips).
export type ReminderWords = {
  // «Ciao {name},» — already filled with the customer's name.
  readonly hello: string;
  // «ti ricordiamo il ritiro della tua prenotazione N. 4 da Panificio Miano:» — already filled (pickup or delivery).
  // ⚠️ In the INTERFACE's language (as the slips), while the date and the units follow the venue's country: a venue whose screens
  // are in another language than its customers' would send a mixed message. Left for the owner (docs/parity/bookings.md).
  readonly intro: string;
  // «{date} alle {time}» → a function, because the date is spelled here in the venue's locale.
  readonly when: (date: string, time: string) => string;
  // «Indirizzo: {address}» — a delivery only.
  readonly address: (address: string) => string;
  // «Da pagare: {amount}».
  readonly toPay: (amount: string) => string;
  // «A presto!»
  readonly bye: string;
};

// The reminder, as it opens in WhatsApp:
//   Ciao Anna,
//   ti ricordiamo il ritiro della tua prenotazione N. 4 da Panificio Miano:
//   giovedì 24 dicembre alle 09:30
//
//   • 1,5 kg Focaccia
//   • 3 confezioni (250 g) Grissini
//
//   Da pagare: 32,50 €
//   A presto!
export function reminderMessage({ booking, words, locale, units, money }: {
  readonly booking: Booking;
  readonly words: ReminderWords;
  readonly locale: string;
  readonly units: UnitWords;
  readonly money: Money;
}): string {
  const out: string[] = [words.hello, words.intro, words.when(spellDate(booking.date, locale), booking.time)];
  if (booking.mode === 'delivery' && booking.address !== '') out.push(words.address(booking.address));
  if (booking.lines.length > 0) {
    out.push('');
    for (const line of booking.lines) out.push(`• ${lineQtyText(line, locale, units)} ${line.name}`);
  }
  out.push('');
  // What is left to pay: the total less the deposit, or the total when no deposit was taken. Nothing when it is all paid.
  const due = toPay(booking.total, booking.deposit) ?? booking.total;
  if (due !== null && due > 0) out.push(words.toPay(formatMoney(due, money)));
  out.push(words.bye);
  return out.join('\n');
}

// The address that opens the customer's chat with the message written. '' when the phone cannot be one (then no button).
export function reminderUrl(number: string, message: string): string {
  return number === '' ? '' : `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// Whether a reminder still makes sense: an order still to come — not collected, not cancelled, and not of a day gone by.
// `today` is the venue's day as YYYY-MM-DD (the same strings, so they compare as text).
export function wantsReminder(booking: Pick<Booking, 'status' | 'date'>, today: string): boolean {
  return (booking.status === 'todo' || booking.status === 'ready') && booking.date >= today;
}
