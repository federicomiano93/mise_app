import { describe, expect, it } from 'vitest';
import { priceListOf, bookingFixture } from '../testing/fakeBookingsSource';
import type { BookingLine } from './bookingModel';
import { slipDay, slipLineParts, slipUnitWords } from './bookingWords';
import { asksSlipChoice, isPieceLine, labSlips, noteParts, perPieceProducts, pieceCount } from './labSlips';

// Bookings rebuild step 4: which lab slips a booking prints — one per piece of a «Chiedi per pezzo» product, one for any other line,
// or one with everything — and the [N] after the name. ⚠️ Fake customers and products.

const line = (over: Partial<BookingLine>): BookingLine => ({
  recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'X', qty: 1, unit: 'pcs', note: '',
  ...over,
});
const SCACCIATA = line({ productId: 'pS', name: 'Scacciata broccoli', qty: 3, weightKg: 1.5, unitPrice: 24, note: 'senza cipolla, + provola' });
const CANNOLI = line({ productId: 'pC', name: 'Cannoli siciliani', qty: 12, unitPrice: 2 });
const booking = bookingFixture({ id: 'S1', customerName: 'Anna Finta', lines: [SCACCIATA, CANNOLI] });

const LIST = priceListOf([
  { productId: 'pS', name: 'Scacciata broccoli', price: 16, per: 'kg', perPiece: true },
  { productId: 'pC', name: 'Cannoli siciliani', price: 2, per: 'piece' },
]).items;
const PER_PIECE = perPieceProducts(LIST, true);

describe('the per-piece products', () => {
  it('are the ones marked «Chiedi per pezzo» — and none while the venue\'s switch is off', () => {
    expect([...PER_PIECE]).toEqual(['pS']);
    expect(perPieceProducts(LIST, false).size).toBe(0);
  });

  it('a line counts piece by piece only in whole pieces of such a product', () => {
    expect(isPieceLine(SCACCIATA, PER_PIECE)).toBe(true);
    expect(isPieceLine(CANNOLI, PER_PIECE)).toBe(false);
    // An old line in kilos, or a free name, is never pieces.
    expect(isPieceLine(line({ productId: 'pS', qty: 1.5, unit: 'kg' }), PER_PIECE)).toBe(false);
    expect(isPieceLine(line({ productId: null, qty: 3 }), PER_PIECE)).toBe(false);
  });
});

describe('the question', () => {
  it('is asked when the booking holds a per-piece product and the switch is on', () => {
    expect(asksSlipChoice(booking, PER_PIECE)).toBe(true);
  });

  it('is not asked with the switch off, nor for a booking with no per-piece product', () => {
    expect(asksSlipChoice(booking, perPieceProducts(LIST, false))).toBe(false);
    expect(asksSlipChoice({ ...booking, lines: [CANNOLI] }, PER_PIECE)).toBe(false);
  });
});

describe('the slips', () => {
  it('«Uno per pezzo»: 3 scacciate and 12 cannoli give 4 slips — three of one scacciata each, one of the 12 cannoli', () => {
    const slips = labSlips(booking, PER_PIECE, 'perPiece');
    expect(slips).toHaveLength(4);
    for (const slip of slips.slice(0, 3)) expect(slip).toEqual([{ ...SCACCIATA, qty: 1 }]);
    expect(slips[3]).toEqual([CANNOLI]);
  });

  it('«Tutto insieme»: one slip with every line as booked', () => {
    expect(labSlips(booking, PER_PIECE, 'together')).toEqual([[SCACCIATA, CANNOLI]]);
  });

  it('[N] is how many slips «Uno per pezzo» makes: the pieces the customer has', () => {
    expect(pieceCount(booking, PER_PIECE)).toBe(4);
    expect(pieceCount({ ...booking, lines: [SCACCIATA] }, PER_PIECE)).toBe(3);
    // With the switch off every line is one.
    expect(pieceCount(booking, perPieceProducts(LIST, false))).toBe(2);
  });

  it('a note is split on its commas, each piece on its own', () => {
    expect(noteParts('senza cipolla, + provola')).toEqual(['senza cipolla', '+ provola']);
    expect(noteParts(' ben cotta ,, ')).toEqual(['ben cotta']);
    expect(noteParts('')).toEqual([]);
  });
});

describe('the words on a slip', () => {
  const it_ = slipUnitWords({ country: 'IT' });

  it('a piece is «N ×», its weight after the name; one piece on the lab slip says no quantity', () => {
    expect(slipLineParts(SCACCIATA, 'it-IT', it_, 'always')).toEqual({ qty: '3 ×', name: 'Scacciata broccoli', size: '1,5 kg' });
    expect(slipLineParts({ ...SCACCIATA, qty: 1 }, 'it-IT', it_, 'many')).toEqual({ qty: '', name: 'Scacciata broccoli', size: '1,5 kg' });
    expect(slipLineParts({ ...SCACCIATA, qty: 1 }, 'it-IT', it_, 'always').qty).toBe('1 ×');
    expect(slipLineParts(CANNOLI, 'it-IT', it_, 'many')).toEqual({ qty: '12 ×', name: 'Cannoli siciliani', size: '' });
  });

  it('kilos and packs keep their words, always', () => {
    expect(slipLineParts(line({ qty: 1.5, unit: 'kg', name: 'Focaccia' }), 'it-IT', it_, 'many').qty).toBe('1,5 kg');
    expect(slipLineParts(line({ qty: 1, packSize: 250, packUnit: 'g', name: 'Grissini' }), 'it-IT', it_, 'many').qty).toBe('1 confezione (250 g)');
  });

  it('the day on the customer slip is short: «gio 24 dic» / «Thu 24 Dec»', () => {
    expect(slipDay('2026-12-24', 'it-IT')).toBe('gio 24 dic');
    expect(slipDay('2026-12-24', 'en-GB')).toBe('Thu 24 Dec');
  });
});
