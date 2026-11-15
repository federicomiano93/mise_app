// Unit tests for what an order costs (P15 — the owner cannot read code, so these tests are the safety
// net), run against BOTH implementations: the TypeScript port in shared/ and js/order-cost.js, which
// the live app uses today. Ported from tests/order-cost.test.mjs, tests/line-unit-cost.test.mjs,
// tests/readers-regression-grid.test.mjs and, for the tests that price a line, tests/case-price.test.mjs
// and tests/pack-case.test.mjs; the two must stay equal until the switch to Mise 2. The module is a
// FULL port, so parity.spec.ts also compares its exports name by name.
//
// Each side is tested with its OWN neighbours: the TypeScript order-cost with the TypeScript price
// model, the js/ one with the js/ one, so a test never mixes the two apps.
//
// THE WRITER. Some tests need a stored price in the shape the card writes. pricePatch is the writing
// half of the price model, which has no TypeScript copy until step 3e, so the js/ one produces those
// fixtures for BOTH sides: what the card writes today is exactly what the TypeScript reader must price.
//
// PORTED, from tests/order-cost.test.mjs: all 28 tests. From tests/line-unit-cost.test.mjs: all 9.
// From tests/case-price.test.mjs: the 10 «Orders» tests, and the unitCost lines of 'a price deleted on
// an old phone stays deleted…' and 'orders and the stocktake use the typed rate, not the stale case'.
// From tests/pack-case.test.mjs: '⚠️ the stored case does not depend on the weight edited afterwards',
// the 5 «Orders» tests, the 3 «package word means nothing on any other case» tests, 'a package word
// that is also a case word…', 'a case of one package prices the pack…' and '20 for 4 × 2.5 kg is 2 a
// kilo and 5 a busta…'. From tests/readers-regression-grid.test.mjs: the grid, the changed shape
// spelled out by hand, and the order half of the carton cases.
//
// A FROZEN COPY runs in the grid: tests/helpers/legacy-order-cost.mjs, taken from `git show main:…`
// before «Cartone» (1 Oct 2026). Both files are held to it, number for number.
//
// NOT PORTED — the stocktake and the writing half:
//   * tests/case-price.test.mjs: every test of pricePatch and priceChanged, 'splitPriceFields sends
//     the case…', the whole stocktake block (packPrice, valueBlocker, lineValue, casePackNote: they are
//     js/inventory/inventory-value.js), the packPrice lines of 'a price deleted on an old phone…' and
//     'orders and the stocktake use the typed rate…'.
//   * tests/pack-case.test.mjs: the pricePatch tests ('the patch copies the package size…', 'a weight
//     that cannot be read gives no price…', 'a size typed into the (hidden) size box…', 'packBasis
//     makes the stored size authoritative…') and the three stocktake ones.
//   * tests/readers-regression-grid.test.mjs: 'the stocktake gives EXACTLY the old numbers…',
//     'qtyInCardUnit gives EXACTLY the old numbers…' and 'the stocktake counts a carton card in
//     cartons…' (js/inventory/), and the packPrice, packKgFor and valueBlocker lines of the two
//     tests that are ported.
//   * Everything in these files that is about the price model alone (caseRate, caseOf, storedCaseOf,
//     packBaseOf, formatRate, withPrices) is in price-model.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './order-cost';
import * as portedPrice from './price-model';
import * as legacyJs from '../../js/order-cost.js';
import * as legacyPriceJs from '../../js/price-model.js';
import * as frozenOld from '../../tests/helpers/legacy-order-cost.mjs';

const legacy = legacyJs as unknown as typeof ported;
const legacyPrice = legacyPriceJs as unknown as typeof portedPrice;

const AT = '2026-09-30T09:00:00.000Z';
const NO_TOTALS = { net: 0, vatByRate: {}, gross: 0, missingPrice: 0, missingVat: 0, costed: 0 };

// The pack-case fixtures: a case of 4 packages at 20, priced per kilo for a 2.5 kg package.
const FORM = { priceUnit: legacyPriceJs.CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' };
const patchFor = (weight: string, form: Record<string, unknown> = FORM): Record<string, unknown> =>
  legacyPriceJs.pricePatch(form, AT, weight);

const eggs = { casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.4 };
const flour = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };

describe.each([
  ['shared/ (TypeScript)', ported, portedPrice],
  ['js/ (current app)', legacy, legacyPrice],
] as const)('%s', (_name, m, price) => {
  // ── unitCost ───────────────────────────────────────────────────────────────

  test('priceUnit pcs: unitCost is pricePerUnit itself, no conversion', () => {
    expect(m.unitCost({ weight: '' }, { priceUnit: 'pcs', pricePerUnit: 0.9 })).toBe(0.9);
  });

  test('priceUnit kg: unitCost is pricePerUnit × the pack weight in kilos', () => {
    expect(m.unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(45);
  });

  test('priceUnit l: the same reading, litres treated as kilos', () => {
    expect(m.unitCost({ weight: '1L' }, { priceUnit: 'l', pricePerUnit: 1.2 })).toBe(1.2);
  });

  test('an unreadable pack weight -> null, never a guess', () => {
    expect(m.unitCost({ weight: 'sacco' }, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(null);
    expect(m.unitCost({ weight: '' }, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(null);
    expect(m.unitCost({}, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(null);
  });

  test('no price at all -> null', () => {
    expect(m.unitCost({ weight: '25kg' }, null)).toBe(null);
    expect(m.unitCost({ weight: '25kg' }, undefined)).toBe(null);
    expect(m.unitCost({ weight: '25kg' }, {})).toBe(null);
    expect(m.unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: null })).toBe(null);
    expect(m.unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 0 })).toBe(null);
    expect(m.unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 'free' })).toBe(null);
  });

  test('an invalid priceUnit -> null, never a silent fallback', () => {
    expect(m.unitCost({ weight: '25kg' }, { priceUnit: 'crate', pricePerUnit: 5 })).toBe(null);
    expect(m.unitCost({ weight: '25kg' }, { pricePerUnit: 5 })).toBe(null);
  });

  // ── orderCost ──────────────────────────────────────────────────────────────

  test('qty 0 or non-numeric: not a line at all, excluded from every count', () => {
    const result = m.orderCost([
      { qty: 0, unitCost: 5, vatRate: 4 },
      { qty: 'lots', unitCost: 5, vatRate: 4 },
      { qty: -3, unitCost: 5, vatRate: 4 },
      { qty: null, unitCost: 5, vatRate: 4 },
    ]);
    expect(result).toStrictEqual(NO_TOTALS);
  });

  test('a missing price: excluded from net, counted, never treated as £0', () => {
    const result = m.orderCost([
      { qty: 3, unitCost: null, vatRate: 4 },
      { qty: 2, unitCost: 10, vatRate: 4 },
    ]);
    expect(result.missingPrice).toBe(1);
    expect(result.net).toBe(20); // only the priced line
    expect(result.vatByRate[4]).toBe(0.8);
  });

  test('a priced line with no VAT rate: still added to net, counted in missingVat, never taxed at 0', () => {
    const result = m.orderCost([
      { qty: 4, unitCost: 45, vatRate: null },
    ]);
    expect(result.net).toBe(180);
    expect(result.vatByRate).toStrictEqual({});
    expect(result.missingVat).toBe(1);
    expect(result.gross).toBe(180); // no VAT counted, but the net is real
  });

  test('a genuine 0% VAT rate reads exactly like any other stated rate — never confused with "not stated"', () => {
    const result = m.orderCost([{ qty: 2, unitCost: 10, vatRate: 0 }]);
    expect(result.missingVat).toBe(0);
    expect(result.vatByRate).toStrictEqual({ 0: 0 });
    expect(result.gross).toBe(20);
  });

  test('mixed rates: one bucket per rate, summed independently', () => {
    const result = m.orderCost([
      { qty: 2, unitCost: 10, vatRate: 4 },   // net 20, vat 0.8
      { qty: 1, unitCost: 100, vatRate: 22 }, // net 100, vat 22
      { qty: 3, unitCost: 5, vatRate: 4 },    // net 15, vat 0.6
    ]);
    expect(result.net).toBe(135);
    expect(result.vatByRate[4]).toBe(1.4);
    expect(result.vatByRate[22]).toBe(22);
    expect(result.gross).toBe(135 + 1.4 + 22);
    expect(result.missingPrice).toBe(0);
    expect(result.missingVat).toBe(0);
  });

  test('pcs and kg lines together, exactly as unitCost() would hand them over', () => {
    const lines = [
      { qty: 4, unitCost: m.unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), vatRate: 4 },
      { qty: 2, unitCost: m.unitCost({}, { priceUnit: 'pcs', pricePerUnit: 0.9 }), vatRate: 4 },
    ];
    const result = m.orderCost(lines);
    expect(result.net).toBe(4 * 45 + 2 * 0.9);
  });

  test('empty / missing lines -> all zero, never throws', () => {
    expect(m.orderCost([])).toStrictEqual(NO_TOTALS);
    expect(m.orderCost(undefined)).toStrictEqual(NO_TOTALS);
    expect(m.orderCost(null)).toStrictEqual(NO_TOTALS);
  });

  // ⚠️ The order unit decides what the quantity counts (review of 28 Sep 2026): a
  // guess here is a total 25 times too high or 6 times too low that looks right.
  test('a kg price ordered IN kilos costs the kilos, not whole packs', () => {
    expect(m.unitCost({ weight: '25kg', unit: 'kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(1.8);
    expect(m.unitCost({ weight: '25kg', unit: 'g' }, { priceUnit: 'kg', pricePerUnit: 2 })).toBe(0.002);
    expect(m.unitCost({ weight: '', unit: 'L' }, { priceUnit: 'l', pricePerUnit: 1.2 })).toBe(1.2);
  });

  test('a kg price ordered by the sack costs the sack', () => {
    expect(m.unitCost({ weight: '25kg', unit: 'sacchi' }, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(45);
    expect(m.unitCost({ weight: '6x1kg', unit: 'casse' }, { priceUnit: 'kg', pricePerUnit: 2 })).toBe(12);
    expect(m.unitCost({ weight: 'sacco', unit: 'sacchi' }, { priceUnit: 'kg', pricePerUnit: 2 })).toBe(null);
  });

  test('a per-piece price is used only when one ordered unit is plainly one piece', () => {
    expect(m.unitCost({ weight: '1kg', unit: 'pz' }, { priceUnit: 'pcs', pricePerUnit: 9.5 })).toBe(9.5);
    expect(m.unitCost({ weight: '', unit: '' }, { priceUnit: 'pcs', pricePerUnit: 0.35 })).toBe(0.35);
    expect(m.unitCost({ weight: '6x1kg', unit: 'casse' }, { priceUnit: 'pcs', pricePerUnit: 2 })).toBe(null);
    expect(m.unitCost({ weight: '', unit: 'kg' }, { priceUnit: 'pcs', pricePerUnit: 2 })).toBe(null);
  });

  test('costed counts the lines that got a price', () => {
    const r = m.orderCost([
      { qty: 2, unitCost: 10, vatRate: 4 },
      { qty: 1, unitCost: null, vatRate: 4 },
      { qty: 3, unitCost: 1, vatRate: null },
    ]);
    expect(r.costed).toBe(2);
    expect(r.missingPrice).toBe(1);
    expect(r.missingVat).toBe(1);
  });

  test('weight words are read in the forms people type, in both languages', () => {
    for (const unit of ['kili', 'Kg.', 'chili', 'kilo']) {
      expect(m.unitCost({ weight: '25kg', unit }, { priceUnit: 'kg', pricePerUnit: 1.8 }), unit).toBe(1.8);
    }
    expect(m.unitCost({ weight: '25kg', unit: 'gr' }, { priceUnit: 'kg', pricePerUnit: 2 })).toBe(0.002);
    expect(m.unitCost({ weight: '', unit: 'litri' }, { priceUnit: 'l', pricePerUnit: 1.2 })).toBe(1.2);
  });

  // ── «Cartone» (1 Oct 2026, review): current product data × the stored cost of ONE item ──────────
  // An employee can change the count, the package word or the weight from a screen with no price
  // section; the frozen case then no longer matches. The readers therefore compute from what the card
  // says NOW: cost of ONE item × the items in one ORDERED unit (packCount for the carton word, 1 for
  // the package word). Items with no packCount are priced exactly as before (the grid below).

  const CARTON_CARD = { unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };

  test('2(a) a one-pack case of 5 turned into a carton of 4 costs 20, not 5', () => {
    const oneBag = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 5, caseCount: 1, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(m.unitCost(CARTON_CARD, oneBag)).toBe(20);
    expect(m.unitCost({ ...CARTON_CARD, unit: 'busta' }, oneBag), 'and one busta is still 5').toBe(5);
  });

  test('2(b) a pack case of 4 turned into a Singola prices one bag as 5, not the whole 20', () => {
    const packCase = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    // what the card writes for Singola after Cartone: no packCount, the carton word replaced by the package word
    const single = { unit: 'busta', packUnit: 'busta', weight: '2.5kg' };
    expect(m.unitCost(single, packCase)).toBe(5);
    // the carton itself is unchanged
    expect(m.unitCost(CARTON_CARD, packCase)).toBe(20);
  });

  test('2(c) a typed 0.40 a piece turned into a carton of 50 costs 20, not 0.40', () => {
    const perPiece = { priceUnit: 'pcs', pricePerUnit: 0.4 };
    const card = { unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '' };
    expect(m.unitCost(card, perPiece)).toBe(20);
    expect(m.unitCost({ ...card, unit: 'pezzo' }, perPiece)).toBe(0.4);
  });

  test('3 a legacy «6x1kg» weight with packCount 6 is NOT multiplied twice: 12, not 72', () => {
    const card = { unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1kg' };
    expect(m.unitCost(card, { priceUnit: 'kg', pricePerUnit: 2 })).toBe(12);
    expect(m.costPerItem(card, { priceUnit: 'kg', pricePerUnit: 2 }), 'one item\'s weight is unknown').toBe(null);
    // a pieces rate on a multiplier text stays ambiguous, as it always was
    expect(m.unitCost(card, { priceUnit: 'pcs', pricePerUnit: 0.4 })).toBe(null);
    // «sacco» is no weight either
    expect(m.unitCost({ ...card, weight: 'sacco' }, { priceUnit: 'kg', pricePerUnit: 2 })).toBe(null);
  });

  test('5th review F2: one busta of a «6x1kg» carton has no price — never the whole carton\'s 12', () => {
    const card = { unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1kg' };
    const perKg = { priceUnit: 'kg', pricePerUnit: 2 };
    expect(m.unitCost(card, perKg), 'the carton line keeps the old whole-unit reading').toBe(12);
    expect(m.lineUnitCost(card, perKg, 'busta')).toBe(null);
    expect(m.unitCost({ ...card, unit: 'busta' }, perKg)).toBe(null);
    // a carton of ONE: the package IS the carton
    expect(m.unitCost({ ...card, packCount: 1, unit: 'busta' }, perKg)).toBe(12);
  });

  test('4th review 3: a piece that is not the item (eggs on a 360 g tray) has no carton price', () => {
    const egg = { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const card = { unit: 'cartone', packUnit: 'vaschetta', packCount: 10, weight: '360g' };
    expect(m.costPerItem(card, egg), 'one tray is not one egg').toBe(null);
    expect(m.unitCost(card, egg)).toBe(null);
    expect(m.lineUnitCost(card, egg, 'vaschetta')).toBe(null);
    // the piece IS the item when the price remembers the card's own weight, or no weight at all
    expect(m.unitCost({ ...card, weight: '60g' }, egg)).toBe(2.5);
    expect(m.unitCost(card, { priceUnit: 'pcs', pricePerUnit: 0.25 })).toBe(2.5);
    expect(m.unitCost({ ...card, weight: '' }, egg), 'no weight on the card: the piece is the item').toBe(2.5);
    // litres read 1:1 as kilos
    expect(m.unitCost({ ...card, weight: '750ml' }, { priceUnit: 'pcs', pricePerUnit: 3, unitWeightKg: 0.75 })).toBe(30);
    // and an item with NO packCount reads exactly as before
    expect(m.unitCost({ unit: 'vaschetta', weight: '360g' }, egg)).toBe(0.25);
  });

  test('a per-kilo rate × one item\'s weight × the items in the unit', () => {
    const perKg = { priceUnit: 'kg', pricePerUnit: 2 };
    expect(m.unitCost(CARTON_CARD, perKg), '2 a kilo × 2.5 kg × 4').toBe(20);
    expect(m.unitCost({ ...CARTON_CARD, unit: 'busta' }, perKg)).toBe(5);
    expect(m.unitCost({ ...CARTON_CARD, weight: '500g' }, perKg), 'grams read as thousandths of a kilo').toBe(4);
    expect(m.unitCost({ ...CARTON_CARD, unit: 'kg' }, perKg), 'ordered by weight it is still the plain rate').toBe(2);
  });

  test('a case of pieces, priced per item, follows the count the card says now', () => {
    const pcsCase = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
    const card = { unit: 'cartone', packUnit: 'pezzo', packCount: 40, weight: '' };
    expect(m.unitCost(card, pcsCase), '40 × 0.40 — not the 20 the old 50 cost').toBe(16);
    expect(m.unitCost({ ...card, packCount: 50 }, pcsCase)).toBe(20);
  });

  test('itemsPerOrderedUnit: the carton word counts packCount, the package or a piece word counts one, no packCount is null', () => {
    expect(m.itemsPerOrderedUnit(CARTON_CARD)).toBe(4);
    expect(m.itemsPerOrderedUnit({ ...CARTON_CARD, unit: 'Busta' })).toBe(1);
    expect(m.itemsPerOrderedUnit({ ...CARTON_CARD, unit: 'pz' })).toBe(1);
    expect(m.itemsPerOrderedUnit({ unit: 'cartone', packUnit: 'busta' })).toBe(null);
    for (const packCount of [0, -1, 2.5, '4', null, undefined, NaN]) {
      expect(m.validPackCount({ packCount }), String(packCount)).toBe(null);
    }
  });

  test('the per-item price storage (pcs rate + piece weight) prices every way', () => {
    // an egg at 0.25 a piece, 60 g: a carton of 30 costs 7.50; one egg 0.25; per kilo it is 4.1667
    const egg = { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const card = { unit: 'cartone', packUnit: 'uovo', packCount: 30, weight: '60g' };
    expect(m.unitCost(card, egg)).toBe(7.5);
    expect(m.unitCost({ ...card, unit: 'uovo' }, egg)).toBe(0.25);
  });

  // ── Orders: what ONE ORDERED UNIT costs, with a price quoted per CASE (30 Sep 2026) ──────────────

  test('1 cartone of 50 pz at 20 is 20, not 0.40', () => {
    expect(m.unitCost({ unit: 'cartone', weight: '' }, eggs)).toBe(20);
    expect(m.unitCost({ unit: 'cassa', weight: '' }, eggs)).toBe(20);
    expect(m.unitCost({ unit: 'box' }, eggs)).toBe(20);
  });

  test('an empty order unit reads as one case', () => {
    expect(m.unitCost({ unit: '' }, eggs)).toBe(20);
    expect(m.unitCost({}, eggs)).toBe(20);
  });

  test('ordered by the piece, a case of pieces costs the per-piece rate', () => {
    for (const unit of ['pz', 'pz.', 'Pezzi', 'pezzo', 'pcs', 'pc', 'piece', 'pieces', 'each']) {
      expect(m.unitCost({ unit }, eggs), unit).toBe(0.4);
    }
  });

  test('ordered by weight, a case of pieces stays null (as any per-piece price does)', () => {
    expect(m.unitCost({ unit: 'kg' }, eggs)).toBe(null);
  });

  test('ordered by weight, a case of kilos is the rate times that unit', () => {
    expect(m.unitCost({ unit: 'kg' }, flour)).toBe(2);
    expect(m.unitCost({ unit: 'g' }, flour)).toBe(0.002);
  });

  test('a case of kilos ordered in cartoni is the case price, whatever the pack text says', () => {
    expect(m.unitCost({ unit: 'cartone', weight: '2.5kg' }, flour)).toBe(20);
  });

  test('a piece word on a case of kilos is ONE ITEM of the case (a bag), not the case', () => {
    expect(m.unitCost({ unit: 'pz' }, flour)).toBe(5);
  });

  test('case words and an empty unit are the whole case; other words on a case of several are null', () => {
    for (const unit of ['cartone', 'cartoni', 'cassa', 'casse', 'collo', 'colli', 'confezione', 'confezioni',
      'scatola', 'scatole', 'box', 'case', 'cases', 'carton', 'crate', 'pack', 'Cartone']) {
      expect(m.unitCost({ unit }, flour), unit).toBe(20);
    }
    expect(m.unitCost({ unit: '' }, flour)).toBe(20);
    for (const unit of ['busta', 'sacco', 'bottiglia']) {
      expect(m.unitCost({ unit }, flour), unit).toBe(null);
    }
  });

  test('a case of ONE costs the case price for any non-weight word', () => {
    const sack = { casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 0.8 };
    expect(m.unitCost({ unit: 'sacco' }, sack)).toBe(20);
    expect(m.unitCost({ unit: 'pz' }, sack)).toBe(20);
    expect(m.unitCost({ unit: 'kg' }, sack)).toBe(0.8);
  });

  test('without a stored case, unitCost is exactly what it was', () => {
    expect(m.unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(45);
    expect(m.unitCost({ unit: 'pz' }, { priceUnit: 'pcs', pricePerUnit: 0.9 })).toBe(0.9);
    expect(m.unitCost({ unit: 'kg' }, { priceUnit: 'pcs', pricePerUnit: 0.9 })).toBe(null);
    // a half-stored case is not a case
    expect(m.unitCost({ unit: 'cartone' }, { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20 })).toBe(0.4);
  });

  test('a price deleted on an old phone stays deleted: the leftover case is not a price', () => {
    // (The original goes on to packPrice and valueBlocker, which are the stocktake's.)
    const deleted = { ...flour, priceUnit: null, pricePerUnit: null };
    expect(price.storedCaseOf(deleted)).toBe(null);
    expect(m.unitCost({ unit: 'cartone' }, deleted)).toBe(null);
  });

  test('orders and the stocktake use the typed rate, not the stale case', () => {
    // (The original goes on to packPrice, which is the stocktake's.)
    const stale = { ...flour, pricePerUnit: 3 };
    expect(m.unitCost({ unit: 'kg' }, stale)).toBe(3);
    expect(m.unitCost({ unit: 'cartone', weight: '10kg' }, stale)).toBe(30);
  });

  // ── A case of packages: the package word is ONE busta ──────────────────────

  test('⚠️ the stored case does not depend on the weight edited afterwards', () => {
    const stored = patchFor('2.5 kg');
    expect(price.storedCaseOf(stored)).not.toBe(null);
    // nothing about the ingredient's weight is an input any more
    expect(m.unitCost({ unit: 'kg', weight: '3 kg' }, stored)).toBe(2);
    expect(m.unitCost({ unit: 'kg', weight: 'sacco' }, stored)).toBe(2);
    expect(m.unitCost({ unit: 'cartone', weight: '3 kg' }, stored)).toBe(20);
    expect(m.unitCost({ unit: 'cartone' }, stored)).toBe(20);
  });

  const packed = patchFor('2.5 kg');
  const busta = (unit: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ unit, weight: '2.5 kg', packUnit: 'busta', ...extra });

  test('ordered by weight, a pack case is the rate times that unit', () => {
    expect(m.unitCost(busta('kg'), packed)).toBe(2);
    expect(m.unitCost(busta('g'), packed)).toBe(0.002);
  });

  test('the package word and piece words are ONE package: case price / count', () => {
    expect(m.unitCost(busta('busta'), packed)).toBe(5);
    expect(m.unitCost(busta(' Busta '), packed)).toBe(5);
    expect(m.unitCost(busta('busta.'), packed)).toBe(5);
    expect(m.unitCost(busta('Busta', { packUnit: ' busta. ' }), packed)).toBe(5);
    expect(m.unitCost(busta('pz'), packed)).toBe(5);
    expect(m.unitCost(busta('pezzi'), packed)).toBe(5);
  });

  test('case words and an empty unit are the whole case', () => {
    expect(m.unitCost(busta('cartone'), packed)).toBe(20);
    expect(m.unitCost(busta(''), packed)).toBe(20);
  });

  test('a package declared with a CASE word is asked first: «scatola» ordered by scatola is one package', () => {
    expect(m.unitCost({ unit: 'scatola', weight: '2.5 kg', packUnit: 'scatola' }, packed)).toBe(5);
    expect(m.unitCost({ unit: 'box', packUnit: 'box' }, packed)).toBe(5);
    expect(m.unitCost({ unit: 'scatola', packUnit: 'busta' }, packed), 'another word: still the case').toBe(20);
  });

  test('another word on a case of several is null; on a case of one it is the case price', () => {
    expect(m.unitCost(busta('sacco'), packed)).toBe(null);
    const one = patchFor('2.5 kg', { ...FORM, caseCount: 1 });
    expect(m.unitCost(busta('sacco'), one)).toBe(20);
  });

  // ── The package word means nothing on any other case ───────────────────────

  test('⚠️ eggs: a «vaschetta» of 360 g ordered by vaschetta from a case of 60 pieces at 12 is null, not 0.20', () => {
    const tray = { casePrice: 12, caseCount: 60, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.2 };
    expect(m.unitCost({ unit: 'vaschetta', weight: '360 g', packUnit: 'vaschetta' }, tray)).toBe(null);
    expect(m.unitCost({ unit: 'pz', packUnit: 'vaschetta' }, tray), 'a piece word still counts').toBe(0.2);
    expect(m.unitCost({ unit: 'cartone', packUnit: 'vaschetta' }, tray)).toBe(12);
  });

  test('⚠️ a «sacco» of 5 kg ordered by sacco from a case of 10 × 1 kg is null, not the price of 1 kg', () => {
    const tenKilos = { casePrice: 20, caseCount: 10, caseItemSize: 1, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };
    expect(m.unitCost({ unit: 'sacco', weight: '5 kg', packUnit: 'sacco' }, tenKilos)).toBe(null);
    expect(m.unitCost({ unit: 'busta', packUnit: 'busta' }, tenKilos)).toBe(null);
    expect(m.unitCost({ unit: 'kg', packUnit: 'sacco' }, tenKilos)).toBe(2);
  });

  test('without a case, packUnit changes nothing', () => {
    expect(m.unitCost({ weight: '25kg', packUnit: 'sacco', unit: 'sacco' }, { priceUnit: 'kg', pricePerUnit: 1.8 })).toBe(45);
  });

  // ⚠️ Review of 30 Sep 2026: on a case that is NOT of packages, an order unit equal to the
  // ingredient's package word is ambiguous even when it is also a CASE word — a box priced
  // «100 pz at 30» declared as a «scatola» and ordered by «scatola» is not 30 € a scatola.
  test('a package word that is also a case word, on a case of pieces or kilos, is no price', () => {
    const boxes = { priceUnit: 'pcs', pricePerUnit: 0.3, casePrice: 30, caseCount: 100, caseItemSize: null, caseItemUnit: 'pcs' };
    expect(m.unitCost({ unit: 'scatola', packUnit: 'scatola' }, boxes)).toBe(null);
    expect(m.unitCost({ unit: 'scatola.', packUnit: 'Scatola' }, boxes)).toBe(null);
    // Without a package word «scatola» is only a case word: one case.
    expect(m.unitCost({ unit: 'scatola' }, boxes)).toBe(30);
    expect(m.unitCost({ unit: 'pz', packUnit: 'scatola' }, boxes)).toBe(0.3);

    const tenOfOneKilo = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 10, caseItemSize: 1, caseItemUnit: 'kg' };
    expect(m.unitCost({ unit: 'confezione', packUnit: 'confezione', weight: '1 kg' }, tenOfOneKilo)).toBe(null);
    // A case of ONE item is never ambiguous.
    const single = { priceUnit: 'pcs', pricePerUnit: 30, casePrice: 30, caseCount: 1, caseItemSize: null, caseItemUnit: 'pcs' };
    expect(m.unitCost({ unit: 'scatola', packUnit: 'scatola' }, single)).toBe(30);
  });

  // ── A case of ONE package, and the 4 × 2.5 kg carton (1 Oct 2026) ──────────
  // «Singola» with a weight that reads is a case of one: 20 for a 25 kg sack is 0.80 a kilo.
  test('a case of one package prices the pack: 20 for a 25 kg sack is 0.80 a kilo, and the sack costs 20', () => {
    const p = patchFor('25kg', { priceUnit: legacyPriceJs.CASE_MODE, casePrice: 20, caseCount: 1, caseItemUnit: 'pack' });
    expect([p.priceUnit, p.pricePerUnit, p.caseCount, p.caseItemUnit, p.caseItemSize]).toStrictEqual(['kg', 0.8, 1, 'pack', 25]);
    expect(price.storedCaseOf(p), 'a case of one stands on its own rate').not.toBe(null);
    for (const unit of ['', 'sacco', 'busta', 'pz']) {
      expect(m.unitCost({ unit, weight: '25kg' }, p), `ordered in "${unit}"`).toBe(20);
    }
    expect(m.unitCost({ unit: 'kg', weight: '25kg' }, p), 'ordered by weight it is the rate').toBe(0.8);
  });

  test('20 for 4 × 2.5 kg is 2 a kilo and 5 a busta, ordered either way', () => {
    const p = patchFor('2.5kg');
    expect(p.pricePerUnit).toBe(2);
    const card = { unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
    expect(m.unitCost(card, p)).toBe(20);
    expect(m.unitCost({ ...card, unit: 'busta' }, p)).toBe(5);
  });

  // ── lineUnitCost: what ONE of a line's CHOSEN unit costs ───────────────────
  // A busta is priced only from a stored case of packages; every other way of pricing it
  // would be a guess that looks like a number (review of 30 Sep 2026).

  const card = { unit: 'cartone', packUnit: 'busta', weight: '2.5kg' };
  const pcsNoCase = { ...card, priceUnit: 'pcs', pricePerUnit: 20 };
  const kgNoCase = { ...card, priceUnit: 'kg', pricePerUnit: 2 };
  const packCase = {
    ...card, priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
  };
  const pcsCase = {
    ...card, priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs',
  };

  test('a per-piece price without a case cannot price a busta', () => {
    expect(m.lineUnitCost(pcsNoCase, pcsNoCase, 'busta')).toBe(null);
    expect(m.lineUnitCost(pcsNoCase, pcsNoCase, 'cartone')).toBe(20);
  });

  test('a per-kilo price without a case cannot price a busta', () => {
    expect(m.lineUnitCost(kgNoCase, kgNoCase, 'busta')).toBe(null);
  });

  test('a stored case of packages prices both units', () => {
    expect(m.lineUnitCost(packCase, packCase, 'busta')).toBe(5);
    expect(m.lineUnitCost(packCase, packCase, 'Busta')).toBe(5);
    expect(m.lineUnitCost(packCase, packCase, 'cartone')).toBe(20);
  });

  test('a stale or unknown unit gets no price', () => {
    expect(m.lineUnitCost(packCase, packCase, 'sacchetto')).toBe(null);
    expect(m.lineUnitCost(pcsNoCase, pcsNoCase, 'sacchetto')).toBe(null);
  });

  test('a case that is not a case of packages cannot price the package word', () => {
    expect(m.lineUnitCost(pcsCase, pcsCase, 'busta')).toBe(null);
  });

  test('no unit or the card unit is exactly unitCost()', () => {
    for (const p of [pcsNoCase, kgNoCase, packCase, pcsCase]) {
      expect(m.lineUnitCost(p, p, '')).toBe(m.unitCost(p, p));
      expect(m.lineUnitCost(p, p, undefined)).toBe(m.unitCost(p, p));
      expect(m.lineUnitCost(p, p, 'cartone')).toBe(m.unitCost(p, p));
    }
  });

  // ── «Cartone: contiene 50 × pezzo» (1 Oct 2026, review): the package word is ONE item ──────────
  test('a carton card prices its package word as ONE item, whatever case was stored', () => {
    const carton = { unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '' };
    expect(m.lineUnitCost(carton, pcsCase, 'pezzo')).toBe(0.4);
    expect(m.lineUnitCost(carton, pcsCase, 'cartone')).toBe(20);
    expect(m.lineUnitCost(carton, pcsCase, ''), 'no choice is the card unit').toBe(20);
    // a count that is no longer the case's: the item price still stands, the carton follows the count
    expect(m.lineUnitCost({ ...card, packUnit: 'busta', packCount: 12, unit: 'cartone' }, pcsCase, 'busta')).toBe(0.4);
    // (never rounded in this file: a rate × 12 carries float dust)
    const carton12 = m.lineUnitCost({ ...card, packUnit: 'busta', packCount: 12, unit: 'cartone' }, pcsCase, 'cartone');
    expect(Math.abs((carton12 ?? NaN) - 4.8) < 1e-9).toBe(true);
    expect(m.lineUnitCost({ ...card, packUnit: 'busta', packCount: 50 }, pcsCase, 'sacco'), 'a stale unit is still nothing').toBe(null);
  });

  test('without a packCount a pieces case still cannot price the package word (unchanged)', () => {
    expect(m.lineUnitCost({ ...card, packUnit: 'busta' }, pcsCase, 'busta')).toBe(null);
  });

  test('a pack case is priced the same with or without the packCount', () => {
    expect(m.lineUnitCost({ ...card, packCount: 4 }, packCase, 'busta')).toBe(5);
    expect(m.lineUnitCost({ ...card, packCount: 4 }, packCase, 'cartone')).toBe(20);
    expect(m.lineUnitCost(card, packCase, 'busta')).toBe(5);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the fixtures above are what the card writes today (the js/ writer, until step 3e ports it)', () => {
    const p = patchFor('2.5 kg');
    expect([p.priceUnit, p.pricePerUnit, p.caseItemUnit, p.caseItemSize, p.casePrice, p.caseCount])
      .toStrictEqual(['kg', 2, 'pack', 2.5, 20, 4]);
  });

  test('a piece weight is the card’s weight to within a billionth of a kilo — float dust is not a different weight', () => {
    // 60 g is 0.06 kg; a stored piece weight that differs from it by 5 billionths no longer is the item.
    const tray = { unit: 'cartone', packUnit: 'vaschetta', packCount: 10, weight: '60g' };
    expect(m.unitCost(tray, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 + 1e-11 })).toBe(2.5);
    expect(m.unitCost(tray, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 - 1e-11 })).toBe(2.5);
    expect(m.unitCost(tray, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 + 5e-9 })).toBe(null);
    expect(m.pieceIsNotItem(tray, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 + 5e-9 })).toBe(true);
    expect(m.pieceIsNotItem(tray, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 + 5e-10 })).toBe(false);
  });

  // ── «An item with no packCount must give EXACTLY today's numbers» (readers-regression-grid) ──────
  //
  // ⚠️ THE READERS WERE REWRITTEN FOR «CARTONE» (1 Oct 2026, review), and the one promise that must
  // outlive that is that nothing already in production reprices. So this runs a FROZEN COPY of the old
  // functions (tests/helpers/legacy-order-cost.mjs, taken from `git show main:…`) against the live ones
  // over every stored shape that has no packCount — or an invalid one, which the rules would never
  // store — and demands IDENTICAL results, number for number, null for null.

  interface Shape {
    id: string;
    unit: string;
    packUnit: string;
    weight: string;
    packCount: unknown;
    priceUnit?: string;
    pricePerUnit?: number;
    unitWeightKg?: number;
    casePrice?: number;
    caseCount?: number;
    caseItemSize?: number;
    caseItemUnit?: string;
  }
  type StoredPart = Pick<Shape, 'priceUnit' | 'pricePerUnit' | 'unitWeightKg' | 'casePrice' | 'caseCount' | 'caseItemSize' | 'caseItemUnit'>;

  const UNITS = ['', 'kg', 'g', 'l', 'ml', 'pz', 'pezzo', 'cartone', 'Cassa', 'busta', 'sacco', 'scatola', 'vassoio', 'confezione', 'box.'];
  const PACK_UNITS = ['', 'busta', 'pezzo', 'scatola', 'sacco'];
  const WEIGHTS = ['', '25kg', '2.5kg', '500g', '750ml', '1l', '6x1kg', 'sacco', '2,27 kg', '12x500g', '360 pz'];
  // What the rules would never store, or nothing: all of them mean «no packCount».
  const NO_COUNT = [undefined, null, 0, -1, 2.5, '4', NaN];

  const CASES: Record<string, StoredPart> = {
    none: {},
    rateKg: { priceUnit: 'kg', pricePerUnit: 2 },
    rateL: { priceUnit: 'l', pricePerUnit: 3.2 },
    ratePcs: { priceUnit: 'pcs', pricePerUnit: 0.4 },
    ratePcsWeighed: { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
    packCase: { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
    packCaseL: { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 0.5, caseItemUnit: 'pack' },
    oneBag: { priceUnit: 'kg', pricePerUnit: 0.8, casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'pack' },
    kgCase: { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
    gCase: { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
    mlCase: { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
    pcsCase: { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' },
    pcsCaseOne: { priceUnit: 'pcs', pricePerUnit: 5, casePrice: 5, caseCount: 1, caseItemUnit: 'pcs' },
    staleCase: { priceUnit: 'kg', pricePerUnit: 3, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
    zeroRate: { priceUnit: 'kg', pricePerUnit: 0 },
    badUnit: { priceUnit: 'box', pricePerUnit: 2 },
  };

  function* shapes(): Generator<{ name: string; ing: Shape }> {
    for (const [name, stored] of Object.entries(CASES)) {
      for (const unit of UNITS) {
        for (const packUnit of PACK_UNITS) {
          for (const weight of WEIGHTS) {
            for (const packCount of NO_COUNT) {
              yield { name, ing: { id: 'x', unit, packUnit, weight, packCount, ...stored } };
            }
          }
        }
      }
    }
  }

  const same = (a: unknown, b: unknown): boolean => Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && a === b);

  // ⚠️ EXACTLY ONE SHAPE READS DIFFERENTLY FROM MAIN (2nd review, 1 Oct 2026), and it goes from null to a number —
  // never from a number to another number, never the other way. It is asserted here by a hand-made expectation;
  // every other shape must be identical. (A package word on a case of PIECES stays null on purpose: on legacy data
  // a case of 30 eggs ordered by its own package word is not ONE egg — refuse rather than guess.)
  const norm = (v: unknown): string => String(v || '').trim().toLowerCase().replace(/\.$/, '');
  const WEIGHT_WORDS = ['kg', 'g', 'l', 'ml'];   // the weight words the grid uses (order-cost.ts knows more)
  const KILOS_OF_WORD: Record<string, number> = { kg: 1, l: 1, g: 0.001, ml: 0.001 };
  // B. A WEIGHT WORD ON A PER-PIECE PRICE THAT REMEMBERS ONE PIECE'S WEIGHT: kilos × (rate ÷ piece weight).
  const shapeB = (ing: Shape): boolean =>
    ing.priceUnit === 'pcs' && (ing.unitWeightKg ?? 0) > 0 && (ing.pricePerUnit ?? 0) > 0 && WEIGHT_WORDS.includes(norm(ing.unit));
  const expectedB = (ing: Shape): number =>
    (KILOS_OF_WORD[norm(ing.unit)] ?? NaN) * ((ing.pricePerUnit ?? NaN) / (ing.unitWeightKg ?? NaN));
  const near = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) < 1e-9;

  test('the grid is big enough to mean something', () => {
    let n = 0;
    for (const _ of shapes()) n += 1;
    expect(n, `${n} shapes`).toBeGreaterThan(90000);
  });

  test('unitCost and lineUnitCost give EXACTLY the old numbers for every item with no packCount, but for the named shape', () => {
    const bad: string[] = [];
    let changed = 0;
    for (const { name, ing } of shapes()) {
      const now = m.unitCost(ing, ing);
      const was = frozenOld.unitCost(ing, ing);
      if (!same(now, was)) {
        if (shapeB(ing) && was === null && near(now, expectedB(ing))) changed += 1;
        else bad.push(`unitCost ${name} ${JSON.stringify(ing)}: ${was} -> ${now}`);
      }
      for (const chosen of ['', ing.unit, ing.packUnit, 'cartone', 'busta', 'pz']) {
        const viaUnit = chosen === '' || norm(chosen) === norm(ing.unit);
        const a = m.lineUnitCost(ing, ing, chosen);
        const b = frozenOld.lineUnitCost(ing, ing, chosen);
        if (same(a, b)) continue;
        // a line in the card's own unit goes through unitCost: the same shape; any other unit is unchanged
        if (viaUnit && shapeB(ing) && b === null && near(a, expectedB(ing))) continue;
        bad.push(`lineUnitCost(${chosen}) ${name} ${JSON.stringify(ing)}`);
      }
      if (bad.length > 5) break;
    }
    expect(bad).toStrictEqual([]);
    expect(changed, 'the named shape must actually occur in the grid').toBeGreaterThan(0);
  }, 120_000);

  test('the changed shape, spelled out by hand — and the one that must NOT change', () => {
    // (The original ends this block with a packPrice line, which is the stocktake's.)
    // a per-piece price with one piece's weight read by weight — 0.25 an egg of 60 g is 4.1667 a kilo (was: no price)
    const egg = { unit: 'kg', packUnit: '', weight: '', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    expect(frozenOld.unitCost(egg, egg)).toBe(null);
    expect(near(m.unitCost(egg, egg), 0.25 / 0.06)).toBe(true);
    expect(near(m.unitCost({ ...egg, unit: 'g' }, egg), 0.25 / 0.06 / 1000)).toBe(true);
    // without a piece weight it stays no price
    expect(m.unitCost(egg, { priceUnit: 'pcs', pricePerUnit: 0.25 })).toBe(null);
    // ⚠️ A «vaschetta» of 30 eggs ordered by its own package word is NOT one egg: refuse rather than guess
    const tray = { unit: 'vaschetta', packUnit: 'vaschetta', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 12, caseCount: 30, caseItemUnit: 'pcs' };
    expect(frozenOld.unitCost(tray, tray)).toBe(null);
    expect(m.unitCost(tray, tray)).toBe(null);
    // and an explicit-size case still says nothing
    const kgCase = { unit: 'busta', packUnit: 'busta', weight: '', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
    expect(m.unitCost(kgCase, kgCase)).toBe(null);
  });

  // ── The carton cases of the review, against hand-computed answers ──────────

  test('2(a) 2(b) 2(c) and 3 give 20 / 5 / 20 / 12 on the stocktake as well as on the order', () => {
    // The order half: the original goes on to the stocktake's packPrice, valueBlocker and packKgFor.
    // (a) a one-pack case of 5 turned into a carton of 4
    const a = { id: 'a', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg',
      priceUnit: 'kg', pricePerUnit: 2, casePrice: 5, caseCount: 1, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(m.unitCost(a, a)).toBe(20);
    // (b) a pack case of 4 turned into a Singola (the card writes the package word as the unit)
    const b = { id: 'b', unit: 'busta', packUnit: 'busta', weight: '2.5kg',
      priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(m.unitCost(b, b)).toBe(5);
    // (c) a typed 0.40 a piece turned into a carton of 50
    const c = { id: 'c', unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '', priceUnit: 'pcs', pricePerUnit: 0.4 };
    expect(m.unitCost(c, c)).toBe(20);
    // 3: a legacy «6x1kg» weight with packCount 6, a rate of 2 a kilo
    const d = { id: 'd', unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2 };
    expect(m.unitCost(d, d)).toBe(12);
  });
});
