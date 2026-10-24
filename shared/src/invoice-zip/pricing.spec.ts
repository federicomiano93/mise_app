// Unit tests for the invoice price maths (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/invoice-zip/pricing.js. Ported from tests/invoice-zip-pricing.test.mjs (itself a port of
// invoice-import/tests/test_pricing.py); the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 3 of 3 tests of tests/invoice-zip-pricing.test.mjs that need only pricing.js ('weight and volume
// units', 'every other unit is pieces', 'rounding is half up').
// LEFT FOR A2 WITH products.ts: the other 32 tests of that file, which build an invented invoice with `newCase`
// and read the price through products.js (`evaluate`, `makeConfig`, `proposeParams`, `typeOf`, `vatOf`) —
// every spelling of kg, quintals, grams/litres/millilitres, kg times count, grams in packs, litres in
// bottles, eggs priced per egg, the egg weight option, eggs without a count, pasta with egg, pieces with no
// weight, the five «X 30» egg tests, the three portion tests, the five out-of-scale tests, the bounds, free
// goods, the discount line, two invoices, zero quantity, sugar in sacks, info lines and costs, the VAT rate and
// mixed units. The test helper `newCase` (tests/helpers/invoice-builders.mjs) needs the zip reader, the
// invoice parser, products and the import builder, so it comes with them.
// Added here, so that pricing.ts is exercised on its own now: `params`, `computeDocument` and `worse`, which
// the originals' tests reach only through products.js. Each runs against both files.

import { describe, expect, test } from 'vitest';
import * as ported from './pricing';
import * as legacyJs from '../../../js/orders/invoice-zip/pricing.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('weight and volume units', () => {
    for (const raw of ['KG', 'kg', 'KGM', 'KILOGRAMMI', 'KG.']) expect(m.unitClass(raw), raw).toStrictEqual(['kg', 1.0]);
    for (const raw of ['GR', 'G', 'GRAMMI']) expect(m.unitClass(raw), raw).toStrictEqual(['kg', 0.001]);
    for (const raw of ['QL', 'QLI', 'QUINTALI']) expect(m.unitClass(raw), raw).toStrictEqual(['kg', 100.0]);
    for (const raw of ['LT', 'L', 'LITRI']) expect(m.unitClass(raw), raw).toStrictEqual(['l', 1.0]);
    expect(m.unitClass('ML')).toStrictEqual(['l', 0.001]);
    expect(m.unitClass('CL')).toStrictEqual(['l', 0.01]);
  });

  test('every other unit is pieces', () => {
    for (const raw of ['PZ', 'NR', 'N.', 'CT', 'CF', 'CONF', 'SC', 'BT', '', null, 'constructor', 'toString']) {
      expect(m.unitClass(raw)[0], String(raw)).toBe('pc');
    }
  });

  test('rounding is half up', () => {
    expect(m.roundHalfUp(0.00005, 4)).toBe(0.0001);
    expect(m.roundHalfUp(2.675, 2)).toBe(2.68);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('params fills what the owner left out', () => {
    expect(m.params()).toStrictEqual({ priceUnit: null, pack: null, packCount: null, egg: false, eggWeightKg: 0.05 });
    expect(m.params({ priceUnit: 'kg', pack: { size: 2.5, unit: 'kg' }, packCount: 4 }))
      .toStrictEqual({ priceUnit: 'kg', pack: { size: 2.5, unit: 'kg' }, packCount: 4, egg: false, eggWeightKg: 0.05 });
  });

  test('unitWeightKg: an egg weighs what the config says, a pack in kg is its own weight, anything else is unknown', () => {
    expect(m.unitWeightKg(m.params({ egg: true, eggWeightKg: 0.06 }))).toBe(0.06);
    expect(m.unitWeightKg(m.params({ pack: { size: 250, unit: 'g' } }))).toBe(0.25);
    expect(m.unitWeightKg(m.params({ pack: { size: 1, unit: 'l' } }))).toBe(null);
    expect(m.unitWeightKg(m.params())).toBe(null);
  });

  const line = (number: number, unit: string, quantity: number, total: number, vatRate = 4) => (
    { number, unit, quantity, total, vatRate });

  test('computeDocument: by weight is «alta», and free goods lower the price', () => {
    const one = m.computeDocument([line(1, 'KG', 25, 14.25)], m.params({ priceUnit: 'kg' }));
    expect([one.price, one.qty, one.reliability, one.note, one.vatRate]).toStrictEqual([0.57, 25, 'alta', 'invoiced-by-weight', 4]);
    const free = m.computeDocument([line(2, 'KG', 1, 0), line(1, 'KG', 10, 100)], m.params({ priceUnit: 'kg' }));
    expect([free.price, free.qty]).toStrictEqual([100 / 11, 11]);
  });

  test('computeDocument: pieces need a weight from somewhere, and a believable price', () => {
    expect(m.computeDocument([line(1, 'PZ', 4, 20)], m.params()).note).toBe('no-weight-on-invoice');
    expect(m.computeDocument([line(1, 'PZ', 4, 20)], m.params({ priceUnit: 'pcs' })).note).toBe('no-piece-weight');
    const packs = m.computeDocument([line(1, 'CT', 3, 60)],
      m.params({ priceUnit: 'kg', pack: { size: 2.5, unit: 'kg' }, packCount: 4 }));
    expect([packs.price, packs.qty, packs.reliability, packs.note]).toStrictEqual([2, 30, 'media', 'weight-from-description']);
    const mismatch = m.computeDocument([line(1, 'CT', 3, 60)], m.params({ priceUnit: 'l', pack: { size: 1, unit: 'kg' } }));
    expect([mismatch.price, mismatch.note]).toStrictEqual([null, 'price-unit-pack-mismatch']);
    const dear = m.computeDocument([line(1, 'KG', 1, 350)], m.params({ priceUnit: 'kg' }));
    expect([dear.reliability, dear.note]).toStrictEqual(['da verificare', 'price-out-of-scale']);
  });

  test('computeDocument: eggs read the tray count as eggs or as packs, whichever gives an egg price', () => {
    const eggs = m.params({ priceUnit: 'pcs', egg: true, packCount: 30 });
    const inEggs = m.computeDocument([line(1, 'NR', 180, 27.27)], eggs);
    expect([inEggs.qty, inEggs.reliability, inEggs.note]).toStrictEqual([180, 'media', 'egg-weight-from-config; egg-quantity-counts-eggs']);
    const unclear = m.computeDocument([line(1, 'NR', 1, 100)], eggs);
    expect([unclear.qty, unclear.reliability, unclear.note]).toStrictEqual([30, 'da verificare', 'egg-quantity-unclear']);
    const noCount = m.computeDocument([line(1, 'PZ', 10, 3)], m.params({ priceUnit: 'pcs', egg: true }));
    expect([noCount.price, noCount.note]).toStrictEqual([0.3, 'egg-weight-from-config; egg-pack-count-missing']);
  });

  test('computeDocument: a mixed or discounted document is «da verificare», zero or negative has no price', () => {
    const mixed = m.computeDocument([line(1, 'KG', 10, 10), line(2, 'PZ', 3, 3)], m.params({ priceUnit: 'kg' }));
    expect([mixed.reliability, mixed.note]).toStrictEqual(['da verificare', 'mixed-units']);
    const discounted = m.computeDocument([line(1, 'KG', 10, 10)], m.params({ priceUnit: 'kg' }), true);
    expect([discounted.reliability, discounted.note]).toStrictEqual(['da verificare', 'unattributed-discount']);
    expect(m.computeDocument([line(1, 'KG', 0, 5)], m.params({ priceUnit: 'kg' })).note).toBe('quantity-zero-or-negative');
    expect(m.computeDocument([line(1, 'KG', 5, 0)], m.params({ priceUnit: 'kg' })).note).toBe('amount-zero-or-negative');
    expect(m.computeDocument([line(1, 'KG', 5, 5)], m.params({ priceUnit: 'l' })).note).toBe('price-unit-differs-from-invoice-unit');
    expect(m.computeDocument([line(1, 'KG', 5, 5)], m.params()).note).toBe('no-price-unit');
  });

  test('worse picks the less reliable of two', () => {
    expect(m.worse('alta', 'media')).toBe('media');
    expect(m.worse('da verificare', 'alta')).toBe('da verificare');
    expect(m.worse('media', 'media')).toBe('media');
  });
});
