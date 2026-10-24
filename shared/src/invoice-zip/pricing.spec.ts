// Unit tests for the invoice price maths (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/invoice-zip/pricing.js (with the products.js / zip files that read an invented invoice
// into the price). Ported from tests/invoice-zip-pricing.test.mjs (itself a port of invoice-import/tests/test_pricing.py);
// the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 35 of 35 tests of tests/invoice-zip-pricing.test.mjs — the three that need only pricing.js ('weight and
// volume units', 'every other unit is pieces', 'rounding is half up') and the other 32, which build an invented
// invoice with `makeCase` (testing/invoice-builders.ts, the port of tests/helpers/invoice-builders.mjs) and read the
// price through products (`evaluate`, `makeConfig`, `proposeParams`, `typeOf`, `vatOf`). The invoices are loose
// files, so the port is driven with `looseRead` where the original uses its own zip reader.
// Added here, so that pricing.ts is exercised on its own: `params`, `computeDocument` and `worse`, which
// the originals' tests reach only through products.js. Each runs against both files.

import { describe, expect, test } from 'vitest';
import { implementations } from './testing/implementations';
import { makeCase } from './testing/invoice-builders';
import type { InvoiceCase, LineSpec } from './testing/invoice-builders';
import type { Evaluation, PricePoint } from './products';

describe.each(implementations)('%s', (_name, impl) => {
  const m = impl.pricing;
  const { evaluate, makeConfig, proposeParams, typeOf, vatOf } = impl.products;
  const newCase = (): InvoiceCase => makeCase(impl.caseImpl);

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

  // One invented invoice (or more) -> the only product, its proposal and its evaluation.
  function evaluateOnly(c: InvoiceCase, options = {}) {
    const [catalogue, product] = c.onlyProduct(c.catalogue(options));
    const p = proposeParams(product, catalogue.config);
    return { catalogue, product, params: p, ev: evaluate(product, p, catalogue) };
  }
  function priceOf(ev: Evaluation): PricePoint {
    expect(ev.points.length, ev.note).toBe(1);
    return ev.points[0] as PricePoint;
  }

  test('every spelling of kg gives a price per kg', () => {
    for (const unit of ['KG', 'KGM', 'KILOGRAMMI', 'KILOGRAMMO']) {
      const c = newCase();
      c.add([{ desc: 'FARINA TIPO 00', qty: 25, unit, total: 14.25 }]);
      const { params, ev } = evaluateOnly(c);
      const point = priceOf(ev);
      expect([point.price, point.qty, params.priceUnit], unit).toStrictEqual([0.57, 25.0, 'kg']);
      expect(ev.reliability).toBe('alta');
    }
  });

  test('quintals become kilograms', () => {
    const c = newCase();
    c.add([{ desc: 'FARINA', qty: 1, unit: 'QL', total: 57 }]);
    const point = priceOf(evaluateOnly(c).ev);
    expect([point.price, point.qty]).toStrictEqual([0.57, 100.0]);
  });

  test('grams, litres and millilitres', () => {
    let c = newCase();
    c.add([{ desc: 'LIEVITO SECCO', qty: 500, unit: 'GR', total: 5 }]);
    let { params, ev } = evaluateOnly(c);
    expect([priceOf(ev).price, priceOf(ev).qty, params.priceUnit]).toStrictEqual([10.0, 0.5, 'kg']);

    c = newCase();
    c.add([{ desc: 'OLIO DI OLIVA', qty: 10, unit: 'LT', total: 50 }]);
    ({ params, ev } = evaluateOnly(c));
    expect([priceOf(ev).price, params.priceUnit]).toStrictEqual([5.0, 'l']);
    expect(ev.reliability).toBe('alta');

    c = newCase();
    c.add([{ desc: 'ESSENZA', qty: 500, unit: 'ML', total: 5 }]);
    ({ params, ev } = evaluateOnly(c));
    expect([priceOf(ev).price, priceOf(ev).qty, params.priceUnit]).toStrictEqual([10.0, 0.5, 'l']);
  });

  test('kg times count in the description', () => {
    const c = newCase();
    c.add([{ desc: 'PASSATA kg 2,5 x 4', qty: 3, unit: 'CT', total: 60 }]);
    const { params, ev } = evaluateOnly(c);
    expect(params.priceUnit).toBe('kg');
    expect([(params.pack as { size: number }).size, (params.pack as { unit: string }).unit, params.packCount]).toStrictEqual([2.5, 'kg', 4]);
    const point = priceOf(ev);
    expect([point.price, point.qty]).toStrictEqual([2.0, 30.0]); // 3 cartons x 4 x 2.5 kg
    expect(ev.reliability).toBe('media');
  });

  test('grams in packs', () => {
    const c = newCase();
    c.add([{ desc: 'LIEVITO GR.250', qty: 10, unit: 'PZ', total: 25 }]);
    const { params, ev } = evaluateOnly(c);
    expect([(params.pack as { size: number }).size, (params.pack as { unit: string }).unit]).toStrictEqual([250, 'g']);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([10.0, 2.5]);
  });

  test('litres in bottles stay litres', () => {
    const c = newCase();
    c.add([{ desc: 'OLIO LT 1', qty: 6, unit: 'NR', total: 30 }]);
    const { params, ev } = evaluateOnly(c);
    expect(params.priceUnit).toBe('l');
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([5.0, 6.0]);
  });

  test('eggs are priced per egg', () => {
    const c = newCase();
    c.add([{ desc: 'UOVA FRESCHE DA 30 UOVA', qty: 2, unit: 'CT', total: 36 }]);
    const { params, ev } = evaluateOnly(c, { eggWeightG: 50 });
    expect([params.priceUnit, params.packCount]).toStrictEqual(['pcs', 30]);
    const point = priceOf(ev);
    expect([point.price, point.qty]).toStrictEqual([0.6, 60.0]);
    expect(ev.unitWeightKg).toBe(0.05);
    expect(ev.reliability).toBe('media');
  });

  test('the egg weight is an option, 50 g by default', () => {
    const c = newCase();
    c.add([{ desc: 'UOVA DA 30 UOVA', qty: 1, unit: 'CT', total: 30 }]);
    expect(evaluateOnly(c, { eggWeightG: 60 }).ev.unitWeightKg).toBe(0.06);
    expect(evaluateOnly(c).ev.unitWeightKg).toBe(0.05);
    for (const bad of [0, -3, NaN, '50', null]) expect(makeConfig({ eggWeightG: bad }).eggWeightG).toBe(50);
  });

  test('eggs without a count count one per unit', () => {
    const c = newCase();
    c.add([{ desc: 'UOVA CAT. M', qty: 10, unit: 'PZ', total: 3 }]);
    expect(priceOf(evaluateOnly(c).ev).price).toBe(0.3);
  });

  test('pasta with egg invoiced by kg is not treated as eggs', () => {
    const c = newCase();
    c.add([{ desc: "PASTA ALL'UOVO", qty: 2, unit: 'KG', total: 10 }]);
    const { params, ev } = evaluateOnly(c);
    expect([params.priceUnit, params.egg, priceOf(ev).price]).toStrictEqual(['kg', false, 5.0]);
  });

  test('pieces with no weight need checking and have no price', () => {
    const c = newCase();
    c.add([{ desc: 'TEGLIA ALLUMINIO', qty: 4, unit: 'PZ', total: 20 }]);
    const { params, ev } = evaluateOnly(c);
    expect(params.priceUnit).toBe(null);
    expect(ev.points).toStrictEqual([]);
    expect(ev.reliability).toBe('da verificare');
  });

  // ── the «X 30» of an egg line may or may not be applied on top of the quantity ──

  const UNCLEAR = 'egg-quantity-unclear';

  test('eggs: a quantity already in eggs is not divided by the tray size again', () => {
    const c = newCase();
    c.add([{ desc: 'UOVA IN VASSOI X 30L', qty: 180, unit: 'NR', total: 27.27 }]);
    const { params, ev } = evaluateOnly(c);
    expect(params.packCount).toBe(30);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([0.1515, 180.0]);
    expect(ev.reliability).toBe('media');
  });

  test('eggs: a quantity in packs is multiplied by the pack count', () => {
    const c = newCase();
    c.add([{ desc: 'CONFEZIONE DA 4 UOVA FRESCHE', qty: 77, unit: 'pz', total: 90.86 }]);
    const { params, ev } = evaluateOnly(c);
    expect(params.packCount).toBe(4);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([0.295, 308.0]);
    expect(ev.reliability).toBe('media');
  });

  test('eggs: both readings believable counts packs and asks for a check', () => {
    // 4.00 / 10 = 0.40 per egg and 4.00 / 40 = 0.10 per egg: both are egg prices.
    const c = newCase();
    c.add([{ desc: 'CONFEZIONE DA 4 UOVA FRESCHE', qty: 10, unit: 'pz', total: 4 }]);
    const { ev } = evaluateOnly(c);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([0.1, 40.0]);
    expect([ev.reliability, ev.note]).toStrictEqual(['da verificare', UNCLEAR]);
  });

  test('eggs: neither reading believable counts packs and asks for a check', () => {
    // 100 / 1 = 100 per egg and 100 / 30 = 3.33 per egg: neither is an egg price.
    const c = newCase();
    c.add([{ desc: 'UOVA IN VASSOI X 30', qty: 1, unit: 'NR', total: 100 }]);
    const { ev } = evaluateOnly(c);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([3.3333, 30.0]);
    expect([ev.reliability, ev.note]).toStrictEqual(['da verificare', UNCLEAR]);
  });

  test('eggs: a pack count corrected by the owner still drives the packs reading', () => {
    const c = newCase();
    c.add([{ desc: 'UOVA IN VASSOI X 30', qty: 10, unit: 'NR', total: 60 }]);
    const [catalogue, product] = c.onlyProduct();
    const proposal = proposeParams(product, catalogue.config);
    const p = m.params({ ...proposal, packCount: 20 });
    const ev = evaluate(product, p, catalogue);
    // eggs: 6.00 (out), packs of 20: 0.30 (in)
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([0.3, 200.0]);
  });

  // ── unit first, then size x count ──

  test('millilitre portions are summed into litres', () => {
    const c = newCase();
    c.add([{ desc: 'ML10X102 OLIO EVO MONODOSE', qty: 1, unit: 'NR', total: 15.63 }]);
    const { params, ev } = evaluateOnly(c);
    expect([(params.pack as { size: number }).size, (params.pack as { unit: string }).unit, params.packCount]).toStrictEqual([10, 'ml', 102]);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([15.3235, 1.02]);
    expect(ev.reliability).toBe('media');
  });

  test('gram portions are summed into kilograms', () => {
    const c = newCase();
    c.add([{ desc: 'GR25X40 ZUCCHERO BUSTINE', qty: 2, unit: 'CT', total: 6 }]);
    const { params, ev } = evaluateOnly(c);
    expect([(params.pack as { size: number }).size, (params.pack as { unit: string }).unit, params.packCount]).toStrictEqual([25, 'g', 40]);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([3.0, 2.0]);
  });

  test('kilograms times count', () => {
    const c = newCase();
    c.add([{ desc: 'KG1X10 FARINA', qty: 3, unit: 'CT', total: 24 }]);
    const { params, ev } = evaluateOnly(c);
    expect([(params.pack as { size: number }).size, (params.pack as { unit: string }).unit, params.packCount]).toStrictEqual([1, 'kg', 10]);
    expect([priceOf(ev).price, priceOf(ev).qty]).toStrictEqual([0.8, 30.0]);
  });

  // ── an implausible price is never «alta» or «media» ──

  const OUT_OF_SCALE = 'price-out-of-scale';
  function checkOutOfScale(row: LineSpec, expectedPrice: number): void {
    const c = newCase();
    c.add([row]);
    const { ev } = evaluateOnly(c);
    expect(priceOf(ev).price).toBe(expectedPrice);
    expect([ev.reliability, ev.note]).toStrictEqual(['da verificare', OUT_OF_SCALE]);
  }

  test('too cheap per kg', () => checkOutOfScale({ desc: 'FARINA', qty: 100, unit: 'KG', total: 4 }, 0.04));
  test('too dear per kg', () => checkOutOfScale({ desc: 'FARINA', qty: 1, unit: 'KG', total: 350 }, 350.0));
  test('too dear per litre from a misread pack', () => {
    checkOutOfScale({ desc: 'OLIO LT 0,01', qty: 1, unit: 'NR', total: 15 }, 1500.0);
  });
  test('pieces below and above their range', () => {
    checkOutOfScale({ desc: 'UOVA CAT. M', qty: 1000, unit: 'PZ', total: 5 }, 0.005);
    checkOutOfScale({ desc: 'UOVA CAT. M', qty: 1, unit: 'PZ', total: 60 }, 60.0);
  });
  test('the bounds themselves are fine', () => {
    for (const total of [5, 300]) { // exactly 0.05 and 300 per kg
      const c = newCase();
      c.add([{ desc: 'SPEZIA', qty: total === 5 ? 100 : 1, unit: 'KG', total }]);
      expect(evaluateOnly(c).ev.reliability, String(total)).toBe('alta');
    }
  });

  // ── document rules ──

  test('free goods on a separate line lower the price', () => {
    const c = newCase();
    c.add([
      { desc: 'BURRO PANETTO', code: 'B1', qty: 10, unit: 'KG', total: 100 },
      { desc: 'BURRO PANETTO OMAGGIO', code: 'B1', qty: 1, unit: 'KG', total: 0 },
    ]);
    const point = priceOf(evaluateOnly(c).ev);
    expect([point.price, point.qty, point.line]).toStrictEqual([9.0909, 11.0, 1]);
  });

  test('a discount line that names no product flags every product of the document', () => {
    const c = newCase();
    c.add([
      { desc: 'FARINA', qty: 10, unit: 'KG', total: 10 },
      { desc: 'ZUCCHERO', qty: 10, unit: 'KG', total: 12 },
      { desc: 'SCONTO', total: -3 },
    ]);
    const catalogue = c.catalogue();
    expect(catalogue.products.size).toBe(2);
    for (const product of catalogue.products.values()) {
      const ev = evaluate(product, proposeParams(product, catalogue.config), catalogue);
      expect(ev.reliability).toBe('da verificare');
      expect(ev.note).toBe('unattributed-discount');
      expect(ev.points.length).toBe(1);
    }
    expect(catalogue.excluded.filter((e) => e.level === 'line').map((e) => e.reason).includes('separate-discount-line')).toBeTruthy();
  });

  test('two invoices give two price points, oldest first', () => {
    const c = newCase();
    c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6 }], { date: '2026-09-10' });
    c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 5 }], { date: '2026-09-01' });
    const { ev } = evaluateOnly(c);
    expect(ev.points.map((p) => p.price)).toStrictEqual([0.5, 0.6]);
    expect(ev.points.map((p) => p.date)).toStrictEqual(['2026-09-01', '2026-09-10']);
  });

  test('zero quantity needs checking', () => {
    const c = newCase();
    c.add([{ desc: 'FARINA', qty: 0, unit: 'KG', total: 5 }]);
    const { ev } = evaluateOnly(c);
    expect([ev.points, ev.reliability, ev.note]).toStrictEqual([[], 'da verificare', 'quantity-zero-or-negative']);
  });

  test('the sugar in sacks is an ingredient', () => {
    const c = newCase();
    c.add([{ desc: 'ZUCCHERO SACCHI DA KG 25', qty: 2, unit: 'PZ', total: 50 }]);
    const [, product] = c.onlyProduct();
    expect(typeOf(product)).toBe('ingrediente');
  });

  test('info lines and costs are listed as excluded', () => {
    const c = newCase();
    c.add([
      { desc: 'FARINA', qty: 1, unit: 'KG', total: 1 },
      { desc: 'LOTTO 1234' },
      { desc: 'SPESE DI TRASPORTO', qty: 1, total: 4 },
    ]);
    const [catalogue] = c.onlyProduct();
    expect(catalogue.excluded.map((e) => e.reason).sort()).toStrictEqual(['costs', 'info-line']);
  });

  test('the VAT rate only when it is a known one', () => {
    expect(vatOf(22.0)).toBe(22);
    expect(vatOf(4.0)).toBe(4);
    expect(vatOf(0)).toBe(0);
    expect(vatOf(21.0)).toBe(null);
    expect(vatOf(null)).toBe(null);
  });

  test('mixed units on one invoice need checking', () => {
    const c = newCase();
    c.add([
      { desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 10 },
      { desc: 'FARINA', code: 'F', qty: 3, unit: 'PZ', total: 3 },
    ]);
    const { ev } = evaluateOnly(c);
    expect([ev.reliability, ev.note]).toStrictEqual(['da verificare', 'mixed-units']);
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
