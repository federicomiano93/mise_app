// The suggestion engine bound to the records (suggester.ts): the row's line (parity L27, L29), the Stock box's fill (L28 and
// decision 1 of 3f-2b) and the confirm screen's «usually about N» (X2) — all from ONE engine.

import { describe, expect, it } from 'vitest';
import { createSuggester, NO_SUGGESTIONS } from './suggester';

// Four orders of flour, each 10 ordered with 2 on the shelf: par 12.
const history = ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'].map(date => ({
  id: `${date}_mill`, date, supplierId: 'mill', quantities: { flour: 10 }, stock: { flour: 2 },
}));
const flour = { id: 'flour', name: 'Flour', unit: 'sacco', packUnit: 'busta' };
const yeast = { id: 'yeast', name: 'Yeast' };
const s = createSuggester(history, [flour, yeast]);

describe('suggester — the row\'s line', () => {
  it('suggests par less the stock the order holds', () => {
    expect(s.hint(flour, { stock: 5 })).toStrictEqual({ kind: 'suggested', n: 7 });
    expect(s.hint(flour, undefined)).toStrictEqual({ kind: 'suggested', n: 12 });
    // Plenty on the shelf: «Suggested: 0», as the current app says.
    expect(s.hint(flour, { stock: 40 })).toStrictEqual({ kind: 'suggested', n: 0 });
  });

  it('says nothing before four past orders', () => {
    expect(s.hint(yeast, { qty: 3 })).toStrictEqual({ kind: 'none' });
    expect(NO_SUGGESTIONS.hint(flour, { stock: 1 })).toStrictEqual({ kind: 'none' });
  });

  it('⚠️ a quantity much more than usual takes the line over, and the suggestion is not shown with it', () => {
    expect(s.hint(flour, { qty: 120 })).toStrictEqual({ kind: 'unusual', usual: 12 });
    // Correcting the digit brings the suggestion back.
    expect(s.hint(flour, { qty: 12 })).toStrictEqual({ kind: 'suggested', n: 12 });
  });

  it('⚠️ says nothing for a line in another unit than its card\'s', () => {
    expect(s.hint(flour, { qty: 120, unit: 'busta' })).toStrictEqual({ kind: 'none' });
    expect(s.hint(flour, { qty: 3, unit: 'Sacco ' })).toStrictEqual({ kind: 'suggested', n: 12 });
  });
});

describe('suggester — the Stock box fills the Order box (decision 1 of 3f-2b)', () => {
  it('fills an empty box with the suggestion', () => {
    expect(s.fillFor(flour, undefined, 5)).toBe(7);
    expect(s.fillFor(flour, { qty: 0, stock: 3 }, 5)).toBe(7);
  });

  it('follows its own number as the reading is typed, digit by digit', () => {
    // «1» filled 11; «10» follows it to 2, because the box still holds the suggestion of the reading before.
    expect(s.fillFor(flour, undefined, 1)).toBe(11);
    expect(s.fillFor(flour, { qty: 11, stock: 1 }, 10)).toBe(2);
  });

  it('⚠️ never overwrites a number typed by hand', () => {
    // Stock 5 suggested 7; 9 was typed instead: a new reading leaves the 9.
    expect(s.fillFor(flour, { qty: 9, stock: 5 }, 4)).toBe(null);
  });

  it('writes nothing when the box already holds the number', () => {
    expect(s.fillFor(flour, { qty: 7, stock: 5 }, 5)).toBe(null);
    // An empty box and nothing to order: no write of a 0.
    expect(s.fillFor(flour, undefined, 40)).toBe(null);
  });

  it('a reading that empties the need empties the box it filled', () => {
    expect(s.fillFor(flour, { qty: 7, stock: 5 }, 40)).toBe(0);
  });

  it('fills nothing without a suggestion, or in another unit', () => {
    expect(s.fillFor(yeast, undefined, 1)).toBe(null);
    expect(s.fillFor(flour, { unit: 'busta' }, 1)).toBe(null);
  });
});

describe('suggester — the confirm screen', () => {
  it('quotes the usual amount only for a quantity that looks like an extra digit', () => {
    expect(s.usualFor(flour, 'sacco', 120)).toBe(12);
    expect(s.usualFor(flour, '', 120)).toBe(12);
    expect(s.usualFor(flour, 'sacco', 20)).toBe(null);
    expect(s.usualFor(yeast, '', 999)).toBe(null);
  });

  it('⚠️ none for a row shown in another unit', () => {
    expect(s.usualFor(flour, 'busta', 120)).toBe(null);
  });
});
