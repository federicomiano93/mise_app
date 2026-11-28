import { describe, expect, test } from 'vitest';
import { moneyOf } from './currency';
import { formatRate } from './price-model';
import { itemRates } from './rate-items';
import { formatRatePair, formatRateRun } from './rate-text';

// Prices are shown with two decimals (Federico, 28 Nov 2026), DISPLAY ONLY. The frozen js/ copy keeps six, so these are
// port-only specs; the original's formatRate is no longer paired.

const NB = ' ';
const GB = moneyOf('£', { decimal: '.', group: ',', symbolAfter: false });
const IT = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });

describe('formatRate: two decimals', () => {
  test('rounds to two decimals in both money layouts', () => {
    expect(formatRate(3.3608, GB)).toBe('£3.36');
    expect(formatRate(2.8566, GB)).toBe('£2.86');
    expect(formatRate(10, GB)).toBe('£10.00');
    expect(formatRate(3.3608, IT)).toBe(`3,36${NB}€`);
    expect(formatRate(2.8566, IT)).toBe(`2,86${NB}€`);
    expect(formatRate(10, IT)).toBe(`10,00${NB}€`);
  });

  test('a real cost never reads as zero', () => {
    expect(formatRate(0.004, IT)).toBe(`0,004${NB}€`);
    expect(formatRate(0.0004, IT)).toBe(`0,0004${NB}€`);
    expect(formatRate(0.000049, GB)).toBe('£0.00005');
    expect(formatRate(0, GB)).toBe('£0.00');
  });

  test('negative rates keep their sign and round the same way', () => {
    expect(formatRate(-3.3608, GB)).toBe('£-3.36');
    expect(formatRate(-0.004, GB)).toBe('£-0.004');
  });

  test('odd inputs: never NaN, never a minus zero, a positive value never all zeros', () => {
    for (const value of [NaN, Infinity, -Infinity, undefined, 'abc', {}, [1, 2]]) {
      expect(formatRate(value, GB), String(value)).toBe('');
    }
    for (const value of [null, '', -0, 0, '0', false]) expect(formatRate(value, GB), String(value)).toBe('£0.00');
    expect(formatRate(-0.001, GB)).toBe('£-0.001');
    for (const value of [1e-6, 4.9e-5, 0.00096, 0.004, 0.0049, 0.005, 0.0099, 0.0149, 1e-300, 1e21, 1e100, Number.MAX_VALUE, 5e-7]) {
      for (const money of [GB, IT]) {
        const text = formatRate(value, money);
        expect(text, String(value)).not.toMatch(/NaN|undefined|-0\.0+(?!\d)|-0(?![\d.])/);
        if (value >= 1e-6) expect(text, String(value)).toMatch(/[1-9]/);
      }
    }
  });
});

describe('formatRatePair / formatRateRun: neighbours that would print alike', () => {
  test('stay as they are when they already differ', () => {
    expect(formatRatePair(1, 1.1, GB)).toEqual(['£1.00', '£1.10']);
    expect(formatRatePair(0.71, 0.72, IT)).toEqual([`0,71${NB}€`, `0,72${NB}€`]);
  });

  test('get the fewest extra decimals that tell them apart', () => {
    expect(formatRatePair(0.71, 0.714, IT)).toEqual([`0,710${NB}€`, `0,714${NB}€`]);
    expect(formatRatePair(0.03, 0.0305, IT)).toEqual([`0,0300${NB}€`, `0,0305${NB}€`]);
    expect(formatRatePair(3.3608, 3.3612, GB)).toEqual(['£3.3608', '£3.3612']);
  });

  test('up to the stored precision, six decimals', () => {
    expect(formatRatePair(1.0000001, 1.0000002, GB)).toEqual(['£1.000000', '£1.000000']);
  });

  test('equal numbers stay equal, and an unreadable one gives an empty text', () => {
    expect(formatRatePair(0.71, 0.71, GB)).toEqual(['£0.71', '£0.71']);
    expect(formatRatePair(0.71, NaN, GB)).toEqual(['£0.71', '']);
    expect(formatRatePair(null, undefined, GB)).toEqual(['', '']);
  });

  test('a run: each row is compared with the row next to it and takes the most decimals either pair needs', () => {
    expect(formatRateRun([0.71, 0.714, 0.7141], GB)).toEqual(['£0.710', '£0.714', '£0.71']);
    expect(formatRateRun([0.7141, 0.714, 0.71], GB)).toEqual(['£0.7141', '£0.7140', '£0.71']);
    expect(formatRateRun([1, 0.71, 0.714], GB)).toEqual(['£1.00', '£0.710', '£0.714']);
  });
});

describe('itemRates: a price history', () => {
  test('tells apart neighbours of the same unit only, and skips rows with no price or unit', () => {
    const rows = [
      { priceUnit: 'kg', pricePerUnit: 0.714 },
      { priceUnit: 'kg', pricePerUnit: 0.71 },
      { priceUnit: 'l', pricePerUnit: 0.71 },
      { priceUnit: 'kg' },
      { priceUnit: 'crate', pricePerUnit: 1 },
    ];
    expect(itemRates(rows, GB)).toEqual(['£0.714', '£0.710', '£0.71', '', '']);
  });
});
