// slipText.ts — the two booking slips as lines of text for the receipt printer (bookings step 3, 18 Nov 2026).
//
// The same content as the slips printed through the browser (BookingSlips.tsx), line for line: the LAB slip has no name, no
// phone, no address and no price; the CUSTOMER slip has the venue, the number, the name, what was ordered with what each priced
// line comes to, when, the money and the privacy line. The words are handed in already chosen (the interface's t(), the venue's
// country for units, numbers and dates, the venue's money), so this file only lays them out on a paper COLUMNS wide.

import { formatMoney } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import { lineAmount } from '@mise/shared/price-list';
import { toPay } from './bookingModel';
import type { Booking } from './bookingModel';
import type { SlipWords } from './BookingSlips';
import { lineQtyText, shortDate, spellDate } from './bookingWords';
import type { UnitWords } from './bookingWords';
import { COLUMNS } from './receiptPrinter';
import type { SlipLine, SlipStyle } from './receiptPrinter';

const RULE = '-'.repeat(COLUMNS);
const line = (text: string, style: SlipStyle = 'normal'): SlipLine => ({ text, style });

// «Totale ........ 42,50 €»: the left words and the right figure on one line when they fit, else the figure on a line of its own,
// against the right edge.
export function twoColumns(left: string, right: string, style: SlipStyle = 'normal', columns: number = COLUMNS): SlipLine[] {
  if (right === '') return [line(left, style)];
  if (left.length + 1 + right.length <= columns) return [line(`${left}${' '.repeat(columns - left.length - right.length)}${right}`, style)];
  return [line(left, style), line(`${' '.repeat(Math.max(0, columns - right.length))}${right}`, style)];
}

type Common = {
  readonly booking: Booking;
  readonly words: SlipWords;
  readonly locale: string;
  readonly units: UnitWords;
};

function items({ booking, locale, units }: Common, money: Money | null): SlipLine[] {
  const out: SlipLine[] = [];
  for (const item of booking.lines) {
    const left = `${lineQtyText(item, locale, units)} ${item.name}`;
    const right = money !== null && item.unitPrice !== null ? formatMoney(lineAmount(item.qty, item.unitPrice), money) : '';
    out.push(...twoColumns(left, right));
    if (item.note !== '') out.push(line(`  ${item.note}`));
  }
  return out;
}

// «Foglio laboratorio»: what to make and when. ⚠️ NO NAME, NO PHONE, NO ADDRESS, NO PRICE.
export function labSlipLines(input: Common): SlipLine[] {
  const { booking, words, locale } = input;
  const out: SlipLine[] = [
    ...twoColumns(words.labTitle, words.number, 'bold'),
    line(`${spellDate(booking.date, locale)} · ${booking.time}`, 'bold'),
    line(words.mode.toLocaleUpperCase(locale), 'bold'),
    line(RULE),
    ...items(input, null),
  ];
  if (booking.notes !== '') out.push(line(RULE), line(`${words.notes}: ${booking.notes}`));
  return out;
}

// «Biglietto cliente»: the venue, the number, the name, what and when, the money, the privacy line.
export function customerSlipLines(input: Common & { readonly venueName: string; readonly money: Money }): SlipLine[] {
  const { booking, words, locale, venueName, money } = input;
  const out: SlipLine[] = [];
  if (venueName !== '') out.push(line(venueName, 'bold'));
  out.push(
    line(words.number, 'bold'),
    line(booking.customerName, 'bold'),
    line(`${words.mode}: ${shortDate(booking.date, locale)} ${booking.time}`),
    line(RULE),
    ...items(input, money),
  );
  const due = toPay(booking.total, booking.deposit);
  if (booking.total !== null || booking.deposit !== null) {
    out.push(line(RULE));
    if (booking.total !== null) out.push(...twoColumns(words.total, formatMoney(booking.total, money)));
    if (booking.deposit !== null) out.push(...twoColumns(words.deposit, formatMoney(booking.deposit, money)));
    if (due !== null) out.push(...twoColumns(words.toPay, formatMoney(due, money), 'bold'));
  }
  out.push(line(RULE), line(words.privacy));
  return out;
}
