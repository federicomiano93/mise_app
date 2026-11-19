// slipText.ts — the booking slips as lines of text for the receipt printer (bookings step 3, 18 Nov 2026; redrawn in bookings
// rebuild step 4, 19 Nov 2026).
//
// ⚠️ THE SAME CONTENT AS THE SLIPS PRINTED THROUGH THE BROWSER (BookingSlips.tsx), line for line: the LAB slip is the name with
// [N], a dashed line, the products and their notes — no date, no time, no number, no price, no phone, no address; the CUSTOMER
// slip has the venue, «Prenotazione N. 12», the name, the day and the slot, the numbered lines with what each priced one comes to,
// the money and the privacy line. The words are handed in already chosen (the interface's t(), the venue's country for units,
// numbers and dates, the venue's money), so this file only lays them out on a paper COLUMNS wide.
//
// Where the browser highlights the lab slip's note white on black, this paper prints it DOUBLE SIZE (style 'big'): reverse print
// is not verified on the shop's Epson (receiptPrinter.ts, FONT).

import { formatMoney } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import { lineAmount } from '@mise/shared/price-list';
import { toPay } from './bookingModel';
import type { Booking, BookingLine } from './bookingModel';
import type { CustomerSlipWords } from './BookingSlips';
import { slipLineParts } from './bookingWords';
import type { SlipLineParts, UnitWords } from './bookingWords';
import { noteParts } from './labSlips';
import { BIG_COLUMNS, COLUMNS, plainText, wrapLines } from './receiptPrinter';
import type { SlipLine, SlipStyle } from './receiptPrinter';

const INDENT = '   ';
const RULE = '-'.repeat(COLUMNS);
const line = (text: string, style: SlipStyle = 'normal'): SlipLine => ({ text, style });

// «Totale ........ 42,50 €»: the left words and the right figure on one line when they fit, else the figure on a line of its own,
// against the right edge.
export function twoColumns(left: string, right: string, style: SlipStyle = 'normal', columns: number = COLUMNS): SlipLine[] {
  if (right === '') return [line(left, style)];
  if (left.length + 1 + right.length <= columns) return [line(`${left}${' '.repeat(columns - left.length - right.length)}${right}`, style)];
  return [line(left, style), line(`${' '.repeat(Math.max(0, columns - right.length))}${right}`, style)];
}

type Paper = {
  readonly locale: string;
  readonly units: UnitWords;
  // ⚠️ «Plain letters only» is applied HERE, to every piece before it is laid out: «€» → «EUR» and «à» → «a'» make a line
  // longer, so converting a padded line afterwards would push each price past the paper's edge and onto a line of its own.
  readonly plain?: boolean;
};

const lettersOf = (plain: boolean | undefined) => (text: string): string => (plain === true ? plainText(text) : text);

// «2 × Scacciata broccoli 1,5 kg», the pieces that are there.
const productText = (parts: SlipLineParts): string => [parts.qty, parts.name, parts.size].filter(part => part !== '').join(' ');

// ── The lab ──

// ONE lab slip: «Anna Finta [3]» double size, a dashed line, each product in bold (the quantity only when more than one) and
// under it each piece of its note double size, then the booking's general note, each piece double size, at the foot of EVERY slip
// (the owner's decision, 19 Nov 2026). ⚠️ NOTHING ELSE: no date, no time, no number, no price, no phone, no address.
export function labSlipLines(input: Paper & {
  readonly who: string; readonly lines: readonly BookingLine[]; readonly generalNote?: string;
}): SlipLine[] {
  const { who, lines, locale, units, generalNote = '' } = input;
  const p = lettersOf(input.plain);
  const out: SlipLine[] = [line(p(who), 'big'), line(RULE)];
  for (const item of lines) {
    out.push(line(p(productText(slipLineParts(item, locale, units, 'many'))), 'bold'));
    for (const note of noteParts(item.note)) out.push(line(p(note), 'big'));
  }
  for (const note of noteParts(generalNote)) out.push(line(p(note), 'big'));
  return out;
}

// Every lab slip of one print, each its own document: the printer cuts after each, so «Uno per pezzo» comes out as separate slips.
export function labSlipDocuments(input: Paper & { readonly who: string; readonly slips: readonly (readonly BookingLine[])[]; readonly generalNote?: string }): SlipLine[][] {
  const { slips, ...rest } = input;
  return slips.map(lines => labSlipLines({ ...rest, lines }));
}

// ── The customer ──

// «Biglietto cliente»: the venue, «Prenotazione N. 12», the name double size, «Ritiro: gio 24 dic», «dalle 09:00 alle 10:00», the
// numbered lines with each priced one's amount and its note under it, Totale / Acconto / Da pagare (double size), the privacy line.
export function customerSlipLines(input: Paper & {
  readonly booking: Booking; readonly words: CustomerSlipWords; readonly venueName: string; readonly money: Money;
}): SlipLine[] {
  const { booking, words, locale, units, venueName, money } = input;
  const p = lettersOf(input.plain);
  const out: SlipLine[] = [];
  if (venueName !== '') out.push(line(p(venueName), 'bold'));
  out.push(
    line(p(words.title), 'bold'),
    line(p(booking.customerName), 'big'),
    line(p(words.when), 'bold'),
    line(p(words.time), 'bold'),
    line(RULE),
  );
  booking.lines.forEach((item, index) => {
    const left = p(`${index + 1}. ${productText(slipLineParts(item, locale, units, 'always'))}`);
    const right = item.unitPrice !== null ? p(formatMoney(lineAmount(item.qty, item.unitPrice), money)) : '';
    out.push(...twoColumns(left, right));
    // ⚠️ A NOTE LONGER THAN THE PAPER KEEPS ITS INDENT on every wrapped line (wrapped later, the rest would start at the edge).
    if (item.note !== '') {
      for (const wrapped of wrapLines([line(p(item.note))], COLUMNS - INDENT.length)) out.push(line(`${INDENT}${wrapped.text}`));
    }
  });
  // The booking's general note, plain, after the lines and before the money.
  if (booking.notes.trim() !== '') out.push(line(p(booking.notes.trim())));
  const due = toPay(booking.total, booking.deposit);
  if (booking.total !== null || booking.deposit !== null) {
    out.push(line(RULE));
    if (booking.total !== null) out.push(...twoColumns(p(words.total), p(formatMoney(booking.total, money))));
    if (booking.deposit !== null) out.push(...twoColumns(p(words.deposit), p(formatMoney(booking.deposit, money))));
    if (due !== null) out.push(...twoColumns(p(words.toPay), p(formatMoney(due, money)), 'big', BIG_COLUMNS));
  }
  out.push(line(RULE), line(p(words.privacy)));
  return out;
}
