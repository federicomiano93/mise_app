// labSlips.ts — which lab slips a booking prints (bookings rebuild step 4, 19 Nov 2026). Pure: no React, no dictionary.
//
// The owner's real use is 24 December: many bookings of stuffed focaccia («scacciate»). In the lab each piece gets its OWN paper
// slip — the customer's name and how many pieces they have — stuck on the piece with a toothpick, so none is lost in the oven. So a
// line of a product the venue marked «Chiedi per pezzo» (`perPiece` on the published price list) with N pieces gives N identical
// slips; any other line gives ONE slip with its quantity («12 × Cannoli siciliani»). «Tutto insieme» is ONE slip with every line.
//
// ⚠️ THE QUESTION IS ASKED ONLY WHEN IT MEANS SOMETHING: the venue's switch «Biglietti per pezzo» is on AND the booking holds a
// line of a per-piece product. Otherwise the lab slip prints «Tutto insieme» without a word.

import type { PriceItem } from '@mise/shared/price-list';
import type { Booking, BookingLine } from './bookingModel';

export type LabSlipMode = 'perPiece' | 'together';

// The products marked «Chiedi per pezzo» on the published list, by product id. ⚠️ Empty when the venue's switch is off: the
// products keep their stored mark while the switch hides it, and a hidden mark must not change what prints.
export function perPieceProducts(items: readonly PriceItem[], perPieceSlips: boolean): ReadonlySet<string> {
  if (!perPieceSlips) return new Set();
  return new Set(items.filter(item => item.perPiece).map(item => item.productId));
}

// A line counted piece by piece: a per-piece product booked in whole pieces. ⚠️ An old line in KILOS (1,5 kg) is not pieces,
// whatever the product says now, and gives one slip.
export function isPieceLine(line: BookingLine, perPiece: ReadonlySet<string>): boolean {
  return line.productId !== null && perPiece.has(line.productId)
    && line.unit === 'pcs' && Number.isInteger(line.qty) && line.qty >= 1;
}

// Whether «Laboratorio» asks «Uno per pezzo» / «Tutto insieme» first.
export function asksSlipChoice(booking: Booking, perPiece: ReadonlySet<string>): boolean {
  return booking.lines.some(line => isPieceLine(line, perPiece));
}

// The slips, each the lines it holds. «Uno per pezzo»: a per-piece line of N pieces → N slips of ONE piece each (the quantity
// then reads as nothing, the weight stays); any other line → one slip as booked. «Tutto insieme»: one slip with every line.
export function labSlips(booking: Booking, perPiece: ReadonlySet<string>, mode: LabSlipMode): BookingLine[][] {
  if (mode === 'together') return [[...booking.lines]];
  const slips: BookingLine[][] = [];
  for (const line of booking.lines) {
    if (!isPieceLine(line, perPiece)) {
      slips.push([line]);
      continue;
    }
    for (let piece = 0; piece < line.qty; piece += 1) slips.push([{ ...line, qty: 1 }]);
  }
  return slips;
}

// The [N] after the customer's name on every lab slip: how many slips «Uno per pezzo» makes for this booking, i.e. how many pieces
// the customer has (his paper slips: «Anna Finta [3]»). The same on «Tutto insieme», so the number on the bench never changes.
export function pieceCount(booking: Booking, perPiece: ReadonlySet<string>): number {
  return booking.lines.reduce((sum, line) => sum + (isPieceLine(line, perPiece) ? line.qty : 1), 0);
}

// A line's note in its pieces, each highlighted on its own: «senza cipolla, + provola» → «senza cipolla», «+ provola». ⚠️ A comma
// between two digits is a decimal one («+ 0,5 kg ricotta») and does not split.
export function noteParts(note: string): string[] {
  return note.split(/,(?!\d)|(?<!\d),/).map(part => part.trim()).filter(part => part !== '');
}
