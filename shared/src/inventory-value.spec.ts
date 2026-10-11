// Unit tests for what a month's consumption was worth (P15 — the owner cannot read code, so these
// tests are the safety net), run against BOTH implementations: the TypeScript port in shared/ and
// js/inventory/inventory-value.js, which the live app uses today. Ported from
// tests/inventory-value.test.mjs and, for the tests that value a counted unit, tests/case-price.test.mjs,
// tests/pack-case.test.mjs and tests/readers-regression-grid.test.mjs; the two must stay equal until
// the switch to Mise 2.
//
// The awkward joint of the whole feature: the count is in PACKS and the price is per KILO, and the only
// bridge is a free-text field somebody typed. These tests exist to pin the one rule that keeps the
// figure honest — where the bridge cannot be read, there is NO money, never a guessed one.
//
// inventory-value.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports
// formatTotal, which writes the month's total with the venue's money, read from a module variable. In
// Mise 2 the app writes money with formatMoney(value, money) of price-model.ts. The last block of this
// file stands in for what pairing would have checked: the same names, the same constants, the same
// frozen-ness, the same function shapes.
//
// Each side is tested with its OWN neighbours: the TypeScript inventory-value with the TypeScript
// order-cost and price-model, the js/ one with the js/ ones, so a test never mixes the two apps.
//
// THE WRITER. Some tests need a stored price in the shape the card writes. pricePatch is the writing half
// of the price model, which has no TypeScript copy until step 3e, so the js/ one produces those fixtures
// for BOTH sides: what the card writes today is exactly what the TypeScript reader must value.
//
// PORTED, from tests/inventory-value.test.mjs: all 34 tests. From tests/case-price.test.mjs: the 12 tests
// of «The stocktake» (from 'an open month counts one case as one unit' to 'casePackNote names the fix…'),
// plus the packPrice and valueBlocker lines of 'a price deleted on an old phone stays deleted…' and the
// packPrice line of 'orders and the stocktake use the typed rate, not the stale case' (their unitCost
// lines are in order-cost.spec.ts; here they are kept, so each test reads whole). From
// tests/pack-case.test.mjs: the 3 tests of «The stocktake». From tests/readers-regression-grid.test.mjs:
// 'the stocktake gives EXACTLY the old numbers…' (the grid), the packPrice line of 'the changed shape,
// spelled out by hand', the stocktake half of '2(a) 2(b) 2(c) and 3…' and 'the stocktake counts a carton
// card in cartons…'. A FROZEN COPY runs in the grid: tests/helpers/legacy-inventory-value.mjs, taken from
// `git show main:…` before «Cartone» (1 Oct 2026). Both files are held to it, number for number.
//
// NOT PORTED: formatTotal has no test of its own in the original (nothing asserts it), and it is not ported.
// The grid of qtyInCardUnit is in inventory-purchases.spec.ts; everything about the price model alone is
// in price-model.spec.ts and about the order's cost in order-cost.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './inventory-value';
import * as portedCost from './order-cost';
import * as portedPrice from './price-model';
import * as portedPack from './pack-size';
import * as legacyJs from '../../js/inventory/inventory-value.js';
import * as legacyCostJs from '../../js/order-cost.js';
import * as legacyPriceJs from '../../js/price-model.js';
import * as legacyPackJs from '../../js/pack-size.js';
import * as frozenOld from '../../tests/helpers/legacy-inventory-value.mjs';

const legacy = legacyJs as unknown as typeof ported;
const legacyCost = legacyCostJs as unknown as typeof portedCost;
const legacyPrice = legacyPriceJs as unknown as typeof portedPrice;
const legacyPack = legacyPackJs as unknown as typeof portedPack;

const AT = '2026-09-30T09:00:00.000Z';

// The pack-case fixtures: a case of 4 packages at 20, priced per kilo for a 2.5 kg package.
const FORM = { priceUnit: legacyPriceJs.CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' };
const patchFor = (weight: string, form: Record<string, unknown> = FORM): Record<string, unknown> =>
  legacyPriceJs.pricePatch(form, AT, weight);

type Fixture = Record<string, unknown> & { id: string };
const byKg = (over: Record<string, unknown> = {}): Fixture =>
  ({ id: 'flour', name: 'Flour', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8, ...over });
const byPiece = (over: Record<string, unknown> = {}): Fixture =>
  ({ id: 'box', name: 'Box', weight: '', priceUnit: 'pcs', pricePerUnit: 0.15, ...over });

const eggs = { casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.4 };
const flour = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };

describe.each([
  ['shared/ (TypeScript)', ported, portedCost, portedPrice, portedPack],
  ['js/ (current app)', legacy, legacyCost, legacyPrice, legacyPack],
] as const)('%s', (_name, m, cost, price, pack) => {
  // ── Reading a pack weight out of free text ─────────────────────────────────

  test('the ordinary shapes somebody actually types', () => {
    expect(m.parsePackSize('25kg')).toBe(25);
    expect(m.parsePackSize('2.27kg')).toBe(2.27);
    expect(m.parsePackSize('2,27 kg')).toBe(2.27);
    expect(m.parsePackSize('500g')).toBe(0.5);
    expect(m.parsePackSize('500 G')).toBe(0.5);
    expect(m.parsePackSize('1L')).toBe(1);
    expect(m.parsePackSize('750 ml')).toBe(0.75);
    expect(m.parsePackSize('50cl')).toBe(0.5);
  });

  test('a case of several packs multiplies out', () => {
    expect(m.parsePackSize('6x1kg')).toBe(6);
    expect(m.parsePackSize('12 x 500g')).toBe(6);
    expect(m.parsePackSize('6 × 1 kg')).toBe(6);
  });

  test('the unit written first, the way an invoice often has it', () => {
    expect(m.parsePackSize('kg 5')).toBe(5);
    expect(m.parsePackSize('KG 2,5')).toBe(2.5);
  });

  test('⚠️ what it cannot read it refuses, rather than guessing', () => {
    // A guessed pack weight does not look wrong on the screen. It just makes the
    // month's cost wrong, which is worse.
    expect(m.parsePackSize('sacco')).toBe(null);
    expect(m.parsePackSize('10 pz')).toBe(null);
    expect(m.parsePackSize('big bag')).toBe(null);
    expect(m.parsePackSize('25'), 'a bare number names no unit').toBe(null);
    expect(m.parsePackSize('25kg circa')).toBe(null);
    expect(m.parsePackSize('')).toBe(null);
    expect(m.parsePackSize('   ')).toBe(null);
    expect(m.parsePackSize(null)).toBe(null);
    expect(m.parsePackSize(25)).toBe(null);
  });

  test('a zero or negative weight is not a pack', () => {
    expect(m.parsePackSize('0kg')).toBe(null);
    expect(m.parsePackSize('-2kg')).toBe(null);
  });

  // ── Which pack weight the month uses ───────────────────────────────────────

  test('what somebody typed in beats what the text says', () => {
    const doc = { packKg: { flour: 20 } };
    expect(m.packKgFor(doc, byKg())).toBe(20);
  });

  test('with nothing typed in, the text is read', () => {
    expect(m.packKgFor({ packKg: {} }, byKg())).toBe(25);
    expect(m.packKgFor(null, byKg())).toBe(25);
  });

  test('a corrupt stored weight falls back to the text rather than to nonsense', () => {
    expect(m.packKgFor({ packKg: { flour: 'HELLO' } }, byKg())).toBe(25);
    expect(m.packKgFor({ packKg: { flour: 0 } }, byKg())).toBe(25);
  });

  // ── What one pack costs ────────────────────────────────────────────────────

  test('a pack priced by weight costs its weight times the rate', () => {
    expect(m.packPrice({ packKg: {} }, byKg(), false)).toBe(20);
  });

  test('⚠️ a product priced by the piece needs no pack weight at all', () => {
    // Its rate already is "per one of them", which is what the stocktake counts.
    expect(m.packPrice({ packKg: {} }, byPiece(), false)).toBe(0.15);
    expect(m.valueBlocker({ packKg: {} }, byPiece())).toBe(null);
  });

  test('no price means no pack price, and the screen is told which job would fix it', () => {
    const unpriced = byKg({ priceUnit: null, pricePerUnit: null });
    expect(m.packPrice({ packKg: {} }, unpriced, false)).toBe(null);
    expect(m.valueBlocker({ packKg: {} }, unpriced)).toBe(m.NO_PRICE);
  });

  test('an unreadable pack weight means no pack price, and says so differently', () => {
    const vague = byKg({ weight: 'sacco' });
    expect(m.packPrice({ packKg: {} }, vague, false)).toBe(null);
    expect(m.valueBlocker({ packKg: {} }, vague)).toBe(m.NO_PACK);
  });

  test('a piece-priced product with no price is a price problem, not a pack one', () => {
    expect(m.valueBlocker({}, byPiece({ pricePerUnit: null }))).toBe(m.NO_PRICE);
  });

  test('⚠️ a CLOSED month uses the price frozen into it, not today\'s', () => {
    // A price changed next spring must not restate what last September cost.
    const doc = { packKg: { flour: 25 }, unitPrice: { flour: 12.5 } };
    expect(m.packPrice(doc, byKg(), true), 'what one sack cost that month').toBe(12.5);
    expect(m.packPrice(doc, byKg(), false), 'open month uses today\'s 0.80/kg').toBe(20);
  });

  test('⚠️ the frozen figure is a PACK price, so a piece-priced product freezes too', () => {
    // A rate per kilo could not hold this at all: the product has no weight and its
    // price is per one of them. Freezing the pack price makes both cases one case.
    const doc = { packKg: {}, unitPrice: { box: 0.11 } };
    expect(m.packPrice(doc, byPiece(), true)).toBe(0.11);
    expect(m.packPrice(doc, byPiece(), false)).toBe(0.15);
  });

  // ── One row of the month ───────────────────────────────────────────────────

  test('a row is worth what was used times what a pack costs', () => {
    expect(m.lineValue({ packKg: {} }, byKg(), 3, false)).toStrictEqual({ value: 60, blocker: null });
  });

  test('⚠️ a product nobody counted has no cost — not a zero cost', () => {
    // A zero would quietly flatter the total by exactly the amount nobody counted.
    expect(m.lineValue({ packKg: {} }, byKg(), null, false)).toStrictEqual({ value: null, blocker: null });
  });

  test('a row that cannot be valued keeps its quantity and loses only its money', () => {
    const out = m.lineValue({ packKg: {} }, byKg({ weight: 'sacco' }), 3, false);
    expect(out.value).toBe(null);
    expect(out.blocker).toBe(m.NO_PACK);
  });

  test('half a pack is worth half a pack', () => {
    expect(m.lineValue({ packKg: {} }, byKg(), 0.5, false).value).toBe(10);
  });

  // ── The month, added up ────────────────────────────────────────────────────

  const used = (map: Record<string, number>) => (ing: { id: string }): number | null => (ing.id in map ? (map[ing.id] as number) : null);

  test('the month adds up, most expensive first, and counts what it could not value', () => {
    const ingredients = [
      byKg(),
      byPiece(),
      byKg({ id: 'oil', name: 'Oil', weight: 'damigiana', priceUnit: 'l', pricePerUnit: 3 }),
    ];
    const out = m.monthCost({
      month: { packKg: {}, unitPrice: {} },
      ingredients,
      consumptionOf: used({ flour: 3, box: 100, oil: 2 }),
      closed: false,
    });
    expect(out.total, '3 × 20 + 100 × 0.15').toBe(75);
    expect(out.counted).toBe(3);
    expect(out.withoutValue).toBe(1);
    expect(out.lines.map(l => l.ingredient.id)).toStrictEqual(['flour', 'box', 'oil']);
    expect(out.lines[2]?.blocker).toBe(m.NO_PACK);
  });

  test('a row with no consumption is not in the list at all', () => {
    const out = m.monthCost({
      month: { packKg: {} },
      ingredients: [byKg(), byPiece()],
      consumptionOf: used({ flour: 1 }),
      closed: false,
    });
    expect(out.lines.length).toBe(1);
    expect(out.counted).toBe(1);
  });

  test('a month where nothing can be valued still adds up to zero without failing', () => {
    const out = m.monthCost({
      month: { packKg: {} },
      ingredients: [byKg({ priceUnit: null, pricePerUnit: null })],
      consumptionOf: used({ flour: 5 }),
      closed: false,
    });
    expect(out.total).toBe(0);
    expect(out.withoutValue).toBe(1);
    expect(out.lines[0]?.blocker).toBe(m.NO_PRICE);
  });

  test('nothing at all is an empty month, not a crash', () => {
    const out = m.monthCost({ month: {}, ingredients: [], consumptionOf: () => null, closed: false });
    expect(out).toStrictEqual({ lines: [], total: 0, counted: 0, withoutValue: 0 });
  });

  test('pennies add up without float dust', () => {
    const cheap = byKg({ weight: '1kg', pricePerUnit: 0.1 });
    const out = m.monthCost({
      month: { packKg: {} },
      ingredients: [cheap],
      consumptionOf: used({ flour: 3 }),
      closed: false,
    });
    expect(out.total).toBe(0.3);
  });

  // ── A closed month is frozen, and «frozen» has to mean it ──────────────────
  //
  // ⚠️⚠️ THE DEFECT THESE PIN, BECAUSE IT SHIPPED AND WAS CAUGHT BY A REVIEW AND NOT
  // BY A TEST: a closed month fell back to TODAY'S price when the frozen figure was
  // missing, and to TODAY'S pack text when the frozen weight was. So a price typed in
  // November, or a pack size corrected in the spring, silently changed what September
  // had cost — while the screen said «this month is closed: its figures no longer
  // change». A number business decisions are made on is not allowed to move.

  test('⚠️⚠️ a closed month with no frozen price has NO cost — it does not borrow the price of today', () => {
    const closed = { packKg: { flour: 25 }, unitPrice: {} };
    expect(m.packPrice(closed, byKg(), true),
      'the 0.80/kg on the product record belongs to today, not to the month that was closed').toBe(null);
    expect(m.packPrice(closed, byKg(), false), 'and an OPEN month still uses it').toBe(20);
  });

  test('⚠️ nor does a closed month read the live pack text', () => {
    // The pack text is free text on the product record. Correcting «sacco» to «25kg»
    // next spring must not hand every closed month a cost it never had.
    const closed = { packKg: {}, unitPrice: { flour: 12.5 } };
    expect(m.packKgFor(closed, byKg(), true)).toBe(null);
    expect(m.packKgFor(closed, byKg(), false)).toBe(25);
    // The price is frozen, so the row is still worth what it was worth: the frozen
    // figure is per COUNTED UNIT and needs no weight to be useful.
    expect(m.packPrice(closed, byKg(), true)).toBe(12.5);
  });

  test('⚠️ a closed month with nothing frozen says what happened, not what to do', () => {
    // "no price entered" would send somebody to enter one and change nothing.
    const closed = { packKg: {}, unitPrice: {} };
    expect(m.valueBlocker(closed, byKg(), true),
      'the product still has a price and a readable pack — neither belongs to this month').toBe(m.NO_FROZEN_PRICE);
    expect(m.valueBlocker(closed, byKg({ weight: 'sacco' }), false),
      'while an open month names the job that would fix it').toBe(m.NO_PACK);
    expect(m.lineValue(closed, byKg(), 3, true)).toStrictEqual({ value: null, blocker: m.NO_FROZEN_PRICE });
  });

  test('a closed month that froze everything values every row', () => {
    const closed = { packKg: { flour: 25 }, unitPrice: { flour: 12.5, box: 0.11 } };
    expect(m.valueBlocker(closed, byKg(), true)).toBe(null);
    expect(m.lineValue(closed, byKg(), 2, true)).toStrictEqual({ value: 25, blocker: null });
    expect(m.lineValue(closed, byPiece(), 100, true)).toStrictEqual({ value: 11, blocker: null });
  });

  test('⚠️ a product DELETED after the close still costs what it cost', () => {
    // It reaches this file as the frozen label and its id, with no price and no pack
    // text of its own — everything the row needs was written into the month.
    const gone = { id: 'flour', name: 'Flour 25kg', weight: '' };
    const closed = { packKg: { flour: 25 }, unitPrice: { flour: 12.5 } };
    const out = m.monthCost({
      month: closed,
      ingredients: [gone],
      consumptionOf: () => 4,
      closed: true,
    });
    expect(out.total).toBe(50);
    expect(out.withoutValue).toBe(0);
  });

  test('a frozen price of zero is not a price', () => {
    // Nothing is free, and a 0 in that map is the shape a half-written close leaves.
    expect(m.packPrice({ unitPrice: { flour: 0 } }, byKg(), true)).toBe(null);
  });

  // ── «Cartone»: the weight is one item's, the stocktake counts cartoni (1 Oct 2026) ──

  test('packKgFor multiplies the weight by packCount when the stocktake counts in the carton', () => {
    const carton = byKg({ unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' });
    expect(m.packKgFor({ packKg: {} }, carton)).toBe(10);
    expect(m.packPrice({ packKg: {} }, { ...carton, pricePerUnit: 2 }), 'a carton is not priced as one busta').toBe(20);
    // counted in the package word itself, the weight is already one item's
    expect(m.packKgFor({ packKg: {} }, { ...carton, unit: 'busta' })).toBe(2.5);
  });

  test('a weight somebody typed into the month, and a closed month, are never multiplied', () => {
    const carton = byKg({ unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' });
    expect(m.packKgFor({ packKg: { flour: 12 } }, carton)).toBe(12);
    expect(m.packKgFor({ packKg: {} }, carton, true)).toBe(null);
    expect(m.packKgFor({ packKg: { flour: 12 } }, carton, true)).toBe(12);
  });

  test('no packCount: the weight is the pack, as it always was', () => {
    expect(m.packKgFor({ packKg: {} }, byKg({ unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }))).toBe(2.5);
    expect(m.packKgFor({ packKg: {} }, byKg())).toBe(25);
    expect(m.packKgFor({ packKg: {} }, byKg({ weight: 'sacco', packCount: 4 })), 'an unreadable weight stays unreadable').toBe(null);
  });

  // ── 3rd deep review (1 Oct 2026): a carton that cannot be priced has NO price ───────────────────

  test('packCount set and the carton cannot be priced (a multiplier weight, «6x1l»): refuse, never one item\'s rate as a whole carton', () => {
    const doc = { packKg: {} };
    const ing = { id: 'c', unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1l', priceUnit: 'pcs', pricePerUnit: 0.4 };
    expect(cost.unitCost(ing, ing), 'the reader refuses').toBe(null);
    expect(m.packPrice(doc, ing, false), 'the stocktake used to answer 0.4 for a whole carton').toBe(null);
    expect(m.valueBlocker(doc, ing, false)).toBe(m.NO_PRICE);
    // a carton that CAN be priced is, and a Singola (no packCount) keeps today's answer
    expect(m.packPrice(doc, { ...ing, weight: '' }, false)).toBe(2.4);
    expect(m.valueBlocker(doc, { ...ing, weight: '' }, false)).toBe(null);
    const { packCount: _packCount, ...single } = ing;
    expect(m.packPrice(doc, single, false)).toBe(0.4);
  });

  // ── A price quoted per CASE (case-price.test.mjs): the stocktake counts one order unit ────────────

  test('a price deleted on an old phone stays deleted: the leftover case is not a price', () => {
    const deleted = { ...flour, priceUnit: null, pricePerUnit: null };
    expect(price.storedCaseOf(deleted)).toBe(null);
    expect(cost.unitCost({ unit: 'cartone' }, deleted)).toBe(null);
    expect(m.packPrice({}, { id: 'f', ...deleted }, false)).toBe(null);
    expect(m.valueBlocker({}, { id: 'f', ...deleted }, false)).toBe(m.NO_PRICE);
  });

  test('orders and the stocktake use the typed rate, not the stale case', () => {
    const stale = { ...flour, pricePerUnit: 3 };
    expect(cost.unitCost({ unit: 'kg' }, stale)).toBe(3);
    expect(cost.unitCost({ unit: 'cartone', weight: '10kg' }, stale)).toBe(30);
    expect(m.packPrice({}, { id: 'f', weight: '10kg', ...stale }, false)).toBe(30);
  });

  test('an open month counts one case as one unit: the case price, no pack weight needed', () => {
    expect(m.packPrice({}, { id: 'e', weight: '', ...eggs }, false)).toBe(20);
    expect(m.packPrice({}, { id: 'f', weight: 'sacco', ...flour }, false)).toBe(20);
  });

  test('a case carries no blocker', () => {
    expect(m.valueBlocker({}, { id: 'f', weight: '', ...flour }, false)).toBe(null);
    expect(m.valueBlocker({}, { id: 'e', weight: '', ...eggs }, false)).toBe(null);
  });

  test('a line is valued at the case price', () => {
    expect(m.lineValue({}, { id: 'e', ...eggs }, 3, false)).toStrictEqual({ value: 60, blocker: null });
  });

  test('counted in the ORDER unit: 720 eggs from a 360-egg case at 54 cost 108, not 38,880', () => {
    const egg = { id: 'e', unit: 'pz', casePrice: 54, caseCount: 360, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.15 };
    expect(m.packPrice({}, egg, false)).toBe(0.15);
    expect(m.lineValue({}, egg, 720, false).value).toBe(108);
    expect(m.lineValue({}, { ...egg, unit: 'cartone' }, 2, false).value).toBe(108);
  });

  test('counted in kilos: 50 kg from a 25 kg case at 20 cost 40', () => {
    const sack = { id: 'f', unit: 'kg', casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 0.8 };
    expect(m.lineValue({}, sack, 50, false).value).toBe(40);
  });

  test('an order unit that leaves doubt gives no value, with the no-price blocker', () => {
    const bag = { id: 'f', unit: 'busta', ...flour };
    expect(m.packPrice({}, bag, false)).toBe(null);
    expect(m.lineValue({}, bag, 3, false)).toStrictEqual({ value: null, blocker: m.NO_PRICE });
  });

  test('a tiny per-item cost is not rounded away in the stocktake', () => {
    const straw = { id: 's', unit: 'pz', casePrice: 0.49, caseCount: 10000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.000049 };
    expect(m.packPrice({}, straw, false)).toBe(0.000049);
  });

  test('a closed month still uses only what was frozen into it', () => {
    const doc = { unitPrice: { e: 18 } };
    expect(m.packPrice(doc, { id: 'e', ...eggs }, true)).toBe(18);
    expect(m.packPrice({ unitPrice: {} }, { id: 'e', ...eggs }, true)).toBe(null);
  });

  test('an ingredient without a case is valued as before', () => {
    expect(m.packPrice({}, { id: 'x', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8 }, false)).toBe(20);
    expect(m.packPrice({}, { id: 'p', priceUnit: 'pcs', pricePerUnit: 0.15 }, false)).toBe(0.15);
  });

  // ── The stocktake detail's sentence for a case ─────────────────────────────

  test('casePackNote: the price of one counted unit, in the ingredient order unit', () => {
    const egg = { unit: 'pz', ...eggs };
    expect(m.casePackNote(egg)).toStrictEqual({ key: 'inv.packCasePer', value: 0.4, unit: 'pz' });
    expect(m.casePackNote({ unit: 'cartone', ...eggs })).toStrictEqual({ key: 'inv.packCasePer', value: 20, unit: 'cartone' });
    expect(m.casePackNote({ unit: 'kg', ...flour })).toStrictEqual({ key: 'inv.packCasePer', value: 2, unit: 'kg' });
    expect(m.casePackNote({ ...flour })).toStrictEqual({ key: 'inv.packCasePer', value: 20, unit: '' });
  });

  test('casePackNote keeps a tiny price whole, for formatRate to show', () => {
    const straw = { unit: 'pz', casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.001745 };
    expect((m.casePackNote(straw) as { value: number }).value).toBe(0.001745);
  });

  test('casePackNote names the fix when the order unit leaves doubt, and is null without a valid case', () => {
    expect(m.casePackNote({ unit: 'busta', ...flour })).toStrictEqual({ key: 'inv.packCaseAmbiguous' });
    expect(m.casePackNote({ unit: 'pz', priceUnit: 'pcs', pricePerUnit: 0.4 })).toBe(null);
    expect(m.casePackNote({ unit: 'pz', ...eggs, pricePerUnit: 9 })).toBe(null);
  });

  // ── A case of buste (pack-case.test.mjs): the stocktake ────────────────────

  const packed = patchFor('2.5 kg');
  const busta = (unit: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ unit, weight: '2.5 kg', packUnit: 'busta', ...extra });

  test('the stocktake values one busta and reads «€5.00 per busta»', () => {
    const ing = { id: 'F', ...busta('busta'), ...packed };
    expect(m.packPrice({}, ing, false)).toBe(5);
    expect(m.valueBlocker({}, ing, false)).toBe(null);
    expect(m.casePackNote(ing)).toStrictEqual({ key: 'inv.packCasePer', value: 5, unit: 'busta' });
  });

  test('the stocktake ignores a weight edited afterwards: the case stands on its stored size', () => {
    const ing = { id: 'F', unit: 'cartone', weight: 'sacco', packUnit: 'busta', ...packed };
    expect(m.packPrice({}, ing, false)).toBe(20);
    expect(m.valueBlocker({}, ing, false)).toBe(null);
  });

  test('a stale pack case falls back to the typed rate and its pack weight', () => {
    const ing = { id: 'F', unit: 'kg', weight: 'sacco', ...packed, pricePerUnit: 3 };
    expect(m.valueBlocker({}, ing, false)).toBe(m.NO_PACK);
  });

  // ── Readers regression grid, the stocktake's hand-made cases ───────────────

  test('the changed shape, the stocktake line: a «vaschetta» of 30 eggs ordered by its own package word is not ONE egg', () => {
    // ⚠️ The order's half of this test is in order-cost.spec.ts: refuse rather than guess.
    const tray = { unit: 'vaschetta', packUnit: 'vaschetta', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 12, caseCount: 30, caseItemUnit: 'pcs' };
    expect(cost.unitCost(tray, tray)).toBe(null);
    expect(m.packPrice({ packKg: {} }, tray, false)).toBe(null);
  });

  test('2(a) 2(b) 2(c) and 3 give 20 / 5 / 20 / 12 on the stocktake as well as on the order', () => {
    const doc = { packKg: {} };
    // (a) a one-pack case of 5 turned into a carton of 4
    const a = { id: 'a', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg',
      priceUnit: 'kg', pricePerUnit: 2, casePrice: 5, caseCount: 1, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(cost.unitCost(a, a)).toBe(20);
    expect(m.packPrice(doc, a, false)).toBe(20);
    // (b) a pack case of 4 turned into a Singola (the card writes the package word as the unit)
    const b = { id: 'b', unit: 'busta', packUnit: 'busta', weight: '2.5kg',
      priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(cost.unitCost(b, b)).toBe(5);
    expect(m.packPrice(doc, b, false)).toBe(5);
    // (c) a typed 0.40 a piece turned into a carton of 50
    const c = { id: 'c', unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '', priceUnit: 'pcs', pricePerUnit: 0.4 };
    expect(cost.unitCost(c, c)).toBe(20);
    expect(m.packPrice(doc, c, false)).toBe(20);
    expect(m.valueBlocker(doc, c, false)).toBe(null);
    // 3: a legacy «6x1kg» weight with packCount 6, a rate of 2 a kilo
    const d = { id: 'd', unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2 };
    expect(cost.unitCost(d, d)).toBe(12);
    expect(m.packKgFor(doc, d), 'the whole ordered unit, not multiplied').toBe(6);
    expect(m.packPrice(doc, d, false)).toBe(12);
  });

  test('the stocktake counts a carton card in cartons: weight × packCount, or the per-item rate × packCount', () => {
    const doc = { packKg: {} };
    const kg = { id: 'k', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };
    expect(m.packKgFor(doc, kg)).toBe(10);
    expect(m.packPrice(doc, kg, false)).toBe(20);
    expect(m.packKgFor({ packKg: { k: 12 } }, kg), 'a weight typed into the month still wins').toBe(12);
    expect(m.packKgFor(doc, { ...kg, unit: 'busta' }), 'counted in the package word, one item').toBe(2.5);
    const egg = { id: 'e', unit: 'cartone', packUnit: 'uovo', packCount: 30, weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    expect(m.packPrice(doc, egg, false)).toBe(7.5);
    expect(m.packPrice(doc, { ...egg, unit: 'uovo' }, false)).toBe(0.25);
  });

  // ── «An item with no packCount must give EXACTLY today's numbers» (readers-regression-grid) ──────
  //
  // ⚠️ THE READERS WERE REWRITTEN FOR «CARTONE» (1 Oct 2026, review), and the one promise that must
  // outlive that is that nothing already in production reprices. So this runs a FROZEN COPY of the old
  // functions (tests/helpers/legacy-inventory-value.mjs, taken from `git show main:…`) against the live
  // ones over every stored shape that has no packCount — or an invalid one, which the rules would never
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
  // every other shape must be identical.
  const norm = (v: unknown): string => String(v || '').trim().toLowerCase().replace(/\.$/, '');
  const WEIGHT_WORDS = ['kg', 'g', 'l', 'ml'];   // the weight words the grid uses (order-cost.ts knows more)
  // B. A WEIGHT WORD ON A PER-PIECE PRICE THAT REMEMBERS ONE PIECE'S WEIGHT: kilos × (rate ÷ piece weight).
  const shapeB = (ing: Shape): boolean =>
    ing.priceUnit === 'pcs' && (ing.unitWeightKg ?? 0) > 0 && (ing.pricePerUnit ?? 0) > 0 && WEIGHT_WORDS.includes(norm(ing.unit));
  const hasCase = (ing: Shape): boolean => ing.caseItemUnit !== undefined && (ing.casePrice ?? 0) > 0;

  test('the grid is big enough to mean something', () => {
    let n = 0;
    for (const _ of shapes()) n += 1;
    expect(n, `${n} shapes`).toBeGreaterThan(90000);
  });

  test('the stocktake gives EXACTLY the old numbers for every item with no packCount, but for the named shape', () => {
    const bad: string[] = [];
    const months: unknown[] = [{ packKg: {} }, { packKg: { x: 12 } }, { packKg: { x: 0 } }, null];
    for (const { name, ing } of shapes()) {
      const touched = shapeB(ing) && hasCase(ing);
      for (const doc of months) {
        for (const closed of [false, true]) {
          const d = doc && closed ? { ...(doc as object), unitPrice: { x: 1.5 } } : doc;
          if (!same(m.packKgFor(d, ing, closed), frozenOld.packKgFor(d, ing, closed))) bad.push(`packKgFor ${name} ${JSON.stringify(ing)}`);
          const p = m.packPrice(d, ing, closed);
          const q = frozenOld.packPrice(d, ing, closed);
          if (!same(p, q) && !(touched && !closed && q === null && typeof p === 'number')) {
            bad.push(`packPrice ${name} ${JSON.stringify(ing)} ${JSON.stringify(d)}: ${q} -> ${p}`);
          }
          const v = m.valueBlocker(d, ing, closed);
          const w = frozenOld.valueBlocker(d, ing, closed);
          if (v !== w && !(touched && !closed && w === 'no-price' && v === null)) bad.push(`valueBlocker ${name} ${JSON.stringify(ing)}`);
        }
      }
      const note = m.casePackNote(ing);
      const was = frozenOld.casePackNote(ing);
      if (JSON.stringify(note) !== JSON.stringify(was)
        && !(touched && was && was.key === 'inv.packCaseAmbiguous' && note && note.key === 'inv.packCasePer')) {
        bad.push(`casePackNote ${name} ${JSON.stringify(ing)}`);
      }
      if (bad.length > 5) break;
    }
    expect(bad).toStrictEqual([]);
  }, 120_000);

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in the original tests.

  test('the reasons a row has no money are three words the screen looks up, and parsePackSize is the pack-size one', () => {
    expect([m.NO_PRICE, m.NO_PACK, m.NO_FROZEN_PRICE]).toStrictEqual(['no-price', 'no-pack', 'no-frozen-price']);
    expect(m.parsePackSize, 'the re-export keeps every existing import working').toBe(pack.parsePackSize);
  });

  test('rows worth the same are put in the order of the names the screens show', () => {
    const rows = [
      byKg({ id: 'z', name: 'Zucchero', pricePerUnit: 1, weight: '1kg' }),
      byKg({ id: 'a', name: 'Anything', shortName: 'Burro', pricePerUnit: 1, weight: '1kg' }),
      byKg({ id: 'm', name: 'Mandorle', pricePerUnit: 1, weight: '1kg' }),
    ];
    const out = m.monthCost({
      month: { packKg: {} }, ingredients: rows, consumptionOf: () => 2, closed: false,
    });
    expect(out.lines.map(l => l.ingredient.id), 'Burro (the short name) before Mandorle before Zucchero').toStrictEqual(['a', 'm', 'z']);
  });

  test('rows with no money come last, with the quantity, and are told apart from the ones with', () => {
    const out = m.monthCost({
      month: { packKg: {} },
      ingredients: [byKg({ id: 'vague', name: 'Aaa', weight: 'sacco' }), byKg({ id: 'cheap', name: 'Zzz', pricePerUnit: 0.1, weight: '1kg' })],
      consumptionOf: () => 5,
      closed: false,
    });
    expect(out.lines.map(l => [l.ingredient.id, l.used, l.value, l.blocker])).toStrictEqual([
      ['cheap', 5, 0.5, null],
      ['vague', 5, null, m.NO_PACK],
    ]);
  });

  test('a month with no ingredients list at all is an empty month', () => {
    for (const ingredients of [null, undefined]) {
      expect(m.monthCost({ month: {}, ingredients, consumptionOf: () => 1, closed: false })).toStrictEqual(
        { lines: [], total: 0, counted: 0, withoutValue: 0 });
    }
  });

  test('a used amount can be negative and is valued as it is: the figure never hides that something is wrong', () => {
    expect(m.lineValue({ packKg: {} }, byKg(), -2, false)).toStrictEqual({ value: -40, blocker: null });
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // formatTotal writes the total with the money the session set (js/currency.js); Mise 2 hands the money
  // to price-model's formatMoney instead. The original still exports it.
  const LEFT_OUT = ['formatTotal'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except that one', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
