import { describe, expect, it } from 'vitest';
import { readCount } from '@mise/shared/inventory-model';
import { boxText, displayNumber, monthName } from './stocktakeFormat';

describe('boxText: the text of a count box', () => {
  it('has no thousands separator, in either language', () => {
    expect(boxText(1234.5, 'en-GB')).toBe('1234.5');
    expect(boxText(1234.5, 'it-IT')).toBe('1234,5');
    expect(boxText(1234567, 'en-GB')).toBe('1234567');
    expect(boxText(1234567, 'it-IT')).toBe('1234567');
  });

  it('uses the language\'s decimal mark, to three decimals', () => {
    expect(boxText(3.5, 'en-GB')).toBe('3.5');
    expect(boxText(3.5, 'it-IT')).toBe('3,5');
    expect(boxText(0.125, 'it-IT')).toBe('0,125');
    expect(boxText(2, 'it-IT')).toBe('2');
  });

  it('writes a zero, which is a real answer, and nothing for a count nobody made', () => {
    expect(boxText(0, 'en-GB')).toBe('0');
    expect(boxText(null, 'en-GB')).toBe('');
  });

  // The point of it: what a box shows must be readable back to the number it came from.
  it.each(['en-GB', 'it-IT'])('reads back to the same number (%s)', locale => {
    for (const value of [0, 0.5, 1, 12, 1234, 1234.5, 99999.999]) {
      expect(readCount(boxText(value, locale))).toBe(value);
    }
  });
});

describe('displayNumber: a number on a row to be read', () => {
  it('groups thousands and follows the language\'s decimal mark', () => {
    expect(displayNumber(1234.5, 'en-GB')).toBe('1,234.5');
    expect(displayNumber(3.5, 'it-IT')).toBe('3,5');
    expect(displayNumber(0, 'en-GB')).toBe('0');
  });

  it('shows a dash for a figure that is not known', () => {
    expect(displayNumber(null, 'en-GB')).toBe('—');
  });

  it('shows a negative as it is: more used than possible is evidence, never clamped', () => {
    expect(displayNumber(-2, 'en-GB')).toMatch(/2$/);
    expect(displayNumber(-2, 'en-GB')).toMatch(/^[-−]/);
  });
});

describe('monthName', () => {
  it('is the platform\'s own name for the month, in the language', () => {
    expect(monthName('2026-10', 'en-GB')).toBe('October 2026');
    expect(monthName('2026-10', 'it-IT')).toBe('ottobre 2026');
    expect(monthName('2026-01', 'it-IT')).toBe('gennaio 2026');
  });

  it('does not slip into the next month on the 31st, or into the year before in January', () => {
    expect(monthName('2026-12', 'en-GB')).toBe('December 2026');
    expect(monthName('2027-01', 'en-GB')).toBe('January 2027');
  });
});
