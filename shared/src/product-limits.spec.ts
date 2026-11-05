// Unit tests for the numbers the database accepts on a product, checked before a save (P15), run against
// BOTH implementations: the TypeScript port in shared/ and js/foodcost/product-limits.js, which the live
// app uses today. Ported from tests/foodcost-save-limits.test.mjs: 'what the database would refuse, and
// what it would take'. The module is a FULL port, so parity.spec.ts also compares its exports name by name.
//
// NOT PORTED, because they read a file rather than run the module: 'the limits are the rules' own
// numbers, read back out of firestore.rules' (the current app's suite keeps guarding the js/ side, and
// the port's list is compared with it below), 'the editor checks BEFORE it asks…', 'the hourly cost is
// checked before its confirmation…' (both read the editors' source), 'the words exist in both languages'
// (the dictionary) and 'a VAT group that says nothing…' (vat-guide.spec.ts has the data half).

import { describe, expect, test } from 'vitest';
import * as ported from './product-limits';
import * as legacyJs from '../../js/foodcost/product-limits.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('what the database would refuse, and what it would take', () => {
    expect(m.firstInvalidNumber({}), 'every number is optional').toBe(null);
    expect(m.firstInvalidNumber(null)).toBe(null);
    expect(m.firstInvalidNumber({ labourPeople: 0 }), 'the reviewed case: 0 people').toBe('labourPeople');
    expect(m.firstInvalidNumber({ labourMinutes: -5 })).toBe('labourMinutes');
    expect(m.firstInvalidNumber({ packSize: 1000001 })).toBe('packSize');
    expect(m.firstInvalidNumber({ sellingPrice: Number('x') }), 'NaN is not a price').toBe('sellingPrice');
    expect(m.firstInvalidNumber({ vatRate: 0 }), '⚠️ a VAT rate of 0 is a REAL answer').toBe(null);
    expect(m.firstInvalidNumber({ vatRate: 101 })).toBe('vatRate');
    expect(m.firstInvalidNumber({ foodCostTarget: 100, packSize: 1000000, labourPeople: 1000 }), 'the ceilings themselves are allowed').toBe(null);
    expect(m.firstInvalidNumber({ piecesPerBatch: 0, labourPeople: 0 }), 'the first one, in a fixed order').toBe('piecesPerBatch');
    expect(m.numberAllowed(m.PRODUCT_NUMBER_LIMITS[0]!, undefined)).toBe(true);
    expect(m.labourRateAllowed(null), 'clearing the rate is allowed').toBe(true);
    expect(m.labourRateAllowed(0), '⚠️ a 0 no longer clears the rate in silence').toBe(false);
    expect(m.labourRateAllowed(m.LABOUR_RATE_MAX)).toBe(true);
    expect(m.labourRateAllowed(m.LABOUR_RATE_MAX + 0.01)).toBe(false);
  });

  test('a number typed as text, or anything but a finite number, is refused', () => {
    expect(m.firstInvalidNumber({ packSize: '500' })).toBe('packSize');
    expect(m.firstInvalidNumber({ packSize: Infinity })).toBe('packSize');
    expect(m.firstInvalidNumber({ sellingPrice: {} })).toBe('sellingPrice');
    expect(m.labourRateAllowed('12')).toBe(false);
    expect(m.labourRateAllowed(NaN)).toBe(false);
  });

  test('the limits are the rules’ numbers, in a fixed order, frozen', () => {
    expect(m.PRODUCT_NUMBER_LIMITS.map(l => [l.key, l.min, l.minInclusive, l.max])).toStrictEqual([
      ['piecesPerBatch', 0, false, null],
      ['packSize', 0, false, 1000000],
      ['labourMinutes', 0, false, 100000],
      ['labourPeople', 0, false, 1000],
      ['sellingPrice', 0, false, null],
      ['vatRate', 0, true, 100],
      ['foodCostTarget', 0, false, 100],
    ]);
    expect(m.LABOUR_RATE_MAX).toBe(10000);
    expect(Object.isFrozen(m.PRODUCT_NUMBER_LIMITS)).toBe(true);
    for (const limit of m.PRODUCT_NUMBER_LIMITS) expect(Object.isFrozen(limit)).toBe(true);
  });
});
