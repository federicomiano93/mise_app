import { describe, expect, it } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { bookingFixture } from '../testing/fakeBookingsSource';
import { slipUnitWords } from './bookingWords';
import { reminderMessage, reminderUrl, wantsReminder, whatsappNumber } from './reminderText';
import type { ReminderWords } from './reminderText';
import type { BookingLine } from './bookingModel';

// Bookings step 4: the WhatsApp reminder to the customer. ⚠️ Fake customers and fake numbers only.

const money = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });
const words: ReminderWords = {
  hello: 'Ciao Anna,',
  intro: 'ti ricordiamo la tua prenotazione N. 4 da Panificio Prova, con ritiro:',
  when: (date, time) => `${date} alle ${time}`,
  address: address => `Indirizzo: ${address}`,
  toPay: amount => `Da pagare: ${amount}`,
  bye: 'A presto!',
};
const units = slipUnitWords({ country: 'IT' });
const lines: BookingLine[] = [
  { recipeId: null, productId: 'pF', unitPrice: 12, packSize: null, packUnit: null, name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'affettata' },
  { recipeId: null, productId: 'pG', unitPrice: 3.5, packSize: 250, packUnit: 'g', name: 'Grissini', qty: 3, unit: 'pcs', note: '' },
];

describe('the customer\'s number for WhatsApp', () => {
  it('keeps a number typed with its country code, digits only', () => {
    expect(whatsappNumber('+39 333 000 0000', 'IT')).toBe('393330000000');
    expect(whatsappNumber('0039 333 000 0000', 'IT')).toBe('393330000000');
    expect(whatsappNumber('+44 7700 900000', 'IT')).toBe('447700900000');
  });

  it('adds the venue\'s country code to a number typed without one — the UK drops its leading 0, Italy keeps every digit', () => {
    expect(whatsappNumber('333 000 0000', 'IT')).toBe('393330000000');
    expect(whatsappNumber('06 0000 0000', 'IT')).toBe('390600000000');
    expect(whatsappNumber('07700 900000', 'GB')).toBe('447700900000');
  });

  it('is nothing when it cannot be a phone: too short, too long, or no country to add', () => {
    expect(whatsappNumber('12 34', 'IT')).toBe('');
    expect(whatsappNumber('+39 1234567890123456', 'IT')).toBe('');
    expect(whatsappNumber('333 000 0000', null)).toBe('');
    expect(whatsappNumber('', 'IT')).toBe('');
  });
});

describe('the reminder', () => {
  it('a pickup: hello, what and when, the products, what is left to pay, goodbye — no notes, no prices per line', () => {
    const booking = bookingFixture({ id: 'A', number: 4, customerName: 'Anna Finta', date: '2026-12-24', time: '09:30', mode: 'pickup',
      lines, total: 42.5, deposit: 10, notes: 'Suonare due volte' });
    const text = reminderMessage({ booking, words, locale: 'it-IT', units, money }).replace(/ /g, ' ');
    expect(text).toBe([
      'Ciao Anna,',
      'ti ricordiamo la tua prenotazione N. 4 da Panificio Prova, con ritiro:',
      'giovedì 24 dicembre alle 09:30',
      '',
      '• 1,5 kg Focaccia',
      '• 3 confezioni (250 g) Grissini',
      '',
      'Da pagare: 32,50 €',
      'A presto!',
    ].join('\n'));
  });

  it('a delivery says the address; with no deposit the whole total is to pay; all paid says nothing about money', () => {
    const delivery = bookingFixture({ id: 'B', mode: 'delivery', address: 'Via Finta 1, Roma', lines, total: 20, deposit: null });
    const text = reminderMessage({ booking: delivery, words, locale: 'it-IT', units, money }).replace(/ /g, ' ');
    expect(text).toContain('Indirizzo: Via Finta 1, Roma');
    expect(text).toContain('Da pagare: 20,00 €');
    const paid = bookingFixture({ id: 'C', lines, total: 20, deposit: 20 });
    expect(reminderMessage({ booking: paid, words, locale: 'it-IT', units, money })).not.toContain('Da pagare');
    const unpriced = bookingFixture({ id: 'D', lines, total: null, deposit: null });
    expect(reminderMessage({ booking: unpriced, words, locale: 'it-IT', units, money })).not.toContain('Da pagare');
  });

  it('opens the customer\'s chat with the message, written into the address; no number, no address', () => {
    expect(reminderUrl('393330000000', 'Ciao Anna,\nA presto! & 50%')).toBe('https://wa.me/393330000000?text=Ciao%20Anna%2C%0AA%20presto!%20%26%2050%25');
    expect(reminderUrl('', 'Ciao')).toBe('');
  });

  it('only for an order still to come', () => {
    expect(wantsReminder({ status: 'todo' })).toBe(true);
    expect(wantsReminder({ status: 'ready' })).toBe(true);
    expect(wantsReminder({ status: 'collected' })).toBe(false);
    expect(wantsReminder({ status: 'cancelled' })).toBe(false);
  });
});
