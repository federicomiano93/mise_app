import { describe, expect, test } from 'vitest';
import { formatMoney } from '@mise/shared/price-model';
import { moneyForVenue } from './useMoney';

// The venue's money comes from its COUNTRY, whatever language the screen is in.
describe('the money a venue counts in', () => {
  test('a British venue writes «£1234.56», an Italian one «1.234,56 €» (no-break space before the symbol)', () => {
    expect(formatMoney(1234.56, moneyForVenue({ country: 'GB' }))).toBe('£1234.56');
    expect(formatMoney(1234.56, moneyForVenue({ country: 'IT' }))).toBe('1.234,56 €');
  });

  test('an unknown, missing or corrupt country falls back to the historical pounds, never a bare number', () => {
    for (const location of [null, {}, { country: 'FR' }, { country: 42 }, { country: 'it' }]) {
      expect(formatMoney(6.5, moneyForVenue(location))).toBe('£6.50');
    }
  });
});
