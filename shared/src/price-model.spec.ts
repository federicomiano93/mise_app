// Unit tests for the ingredient price maths, the READING half (P15 — the owner cannot read code, so
// these tests are the safety net), run against BOTH implementations: the TypeScript port in shared/
// and js/price-model.js, which the live app uses today. Ported from tests/price-model.test.mjs,
// tests/case-price.test.mjs and tests/pack-case.test.mjs; the two must stay equal until the switch to
// Mise 2.
//
// What they are really guarding is a specific kind of silent wrongness: a cost that looks perfectly
// plausible on screen and is out by a factor of a thousand, or a zero that reads as "free" when it
// means "nobody has filled this in yet".
//
// price-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also holds the
// WRITING half (the ingredient card's, step 3e) and three functions that look a word up in the
// interface dictionary. The last block of this file stands in for what pairing would have checked: the
// same names, the same constants, the same frozen-ness, the same function shapes — except that
// formatMoney and formatRate take the venue's money as one more argument by design (see below).
//
// THE MONEY. The original formats with the symbol and the layout that the session set in js/currency.js
// (setCurrency); the port is handed a Money (moneyOf). The tests that format money therefore run each
// side through `venue(symbol, layout)`: the js/ file after setCurrency(symbol, layout), the TypeScript
// one with moneyOf(symbol, layout) — the same text is demanded of both. The js/ module is put back to
// its fallback after every test.
//
// THE WRITER. Some reading tests need a stored price in the shape the card writes. pricePatch is the
// writing half, which has no TypeScript copy until step 3e, so the js/ one produces those fixtures
// for BOTH sides: what the card writes today is exactly what the TypeScript reader must read.
//
// PORTED from tests/price-model.test.mjs: the 7 normalizePrice tests, the 5 pricePerKg tests, the 3
// costState tests (without the costReasonText lines), 'money is shown to the penny…', the 3 currency
// tests, 'a rate keeps the decimals it needs…', 'the list of price units is closed and frozen',
// 'rounding survives…', 'positiveNumber accepts…' and the 5 withPrices tests; from
// tests/case-price.test.mjs: the caseRate, caseOf, formatRate and storedCaseOf tests, 'the case keys
// are price fields but are never drained…' and 'withPrices puts the case back…'; from
// tests/pack-case.test.mjs: 'pack is a case unit…', 'packBaseOf reads…', '20 for 4 × a 2.5 kg
// package…' and 'a rate typed since (old phone) makes the pack case stale'. The tests that price a
// line (unitCost) are in order-cost.spec.ts.
//
// NOT PORTED — the writing half, or the dictionary, or the stocktake:
//   * tests/price-model.test.mjs (45 of its 73 tests): 'the headline rate reads "£7.20 / kg"…'
//     (formatPricePerUnit); the costReasonText lines of the three costState tests; the 20 tests of
//     pricePatch (6), priceChanged (6), priceRecord (3) and splitPriceFields (5, with 'split then
//     merge restores what the form had'); and the 24 tests from «Confezione» and the ONE price box on
//     (priceFormOf, formatPriceInput, priceBoxStart, weightNeededForPrice, singleFromCaseInput,
//     ownPieceWeight, storedPriceInput…), one of which, '«each» is an interface word…', needs the
//     dictionary.
//   * tests/case-price.test.mjs: every test of pricePatch ('a typed rate is still stored to four
//     decimals', 'a case in the form writes the case AND the derived rate', 'a case of pieces stores
//     no size…', 'an incomplete case is «no price»…', 'any other mode sends the four case keys as
//     null…', 'the patch never carries a bad case value', 'the history records the derived rate…'),
//     'splitPriceFields sends the case to the price half only', 'a legacy explicit-size case written
//     back untouched…'; the stocktake ones ('an open month counts one case as one unit' to
//     'casePackNote names the fix…': packPrice, valueBlocker, lineValue and casePackNote are
//     js/inventory/).
//   * tests/pack-case.test.mjs: the pricePatch ones ('the patch copies the package size…', 'a weight
//     that cannot be read gives no price…', 'a size typed into the (hidden) size box…', 'packBasis
//     makes the stored size authoritative…') and the stocktake ones ('the stocktake values one
//     busta…', 'the stocktake ignores a weight edited afterwards…', 'a stale pack case falls back to
//     the typed rate…').

import { afterEach, describe, expect, test } from 'vitest';
import * as ported from './price-model';
import { moneyOf } from './currency';
import * as legacyJs from '../../js/price-model.js';
import * as legacyCurrency from '../../js/currency.js';

const legacy = legacyJs as unknown as typeof ported;

const AT = '2026-09-30T09:00:00.000Z';
const CASE_KEYS = ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit'];
const IT = { decimal: ',', group: '.', symbolAfter: true };
const NB = ' ';

// A venue's money, written through whichever implementation is being tested.
interface Venue {
  formatMoney(value: unknown): string;
  formatRate(value: unknown): string;
}
type OpenVenue = (symbol?: unknown, layout?: unknown) => Venue;

const portedVenue: OpenVenue = (symbol, layout) => {
  const money = moneyOf(symbol, layout);
  return { formatMoney: value => ported.formatMoney(value, money), formatRate: value => ported.formatRate(value, money) };
};
const legacyVenue: OpenVenue = (symbol, layout) => {
  legacyCurrency.setCurrency(symbol, layout);
  return { formatMoney: value => legacyJs.formatMoney(value), formatRate: value => legacyJs.formatRate(value) };
};

// The js/ module keeps its money for the life of the process, so a test never leaves a venue open.
afterEach(() => { legacyCurrency.setCurrency(); });

const eggs = { casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.4 };
const flour = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };

describe.each([
  ['shared/ (TypeScript)', ported, portedVenue],
  ['js/ (current app)', legacy, legacyVenue],
] as const)('%s', (_name, m, venue) => {
  // ── The typed rate becomes a stored rate ───────────────────────────────────

  test('the rate is taken as typed — £7.20 a kilo is £7.20 a kilo', () => {
    const r = m.normalizePrice({ priceUnit: 'kg', pricePerUnit: 7.2 });
    expect(r.ok).toBe(true);
    expect(r.pricePerUnit).toBe(7.2);
    expect(r.reason).toBe(null);
  });

  test('a rate with more precision than money is kept, not rounded to the penny', () => {
    // A gelatine leaf at a third of a penny. Rounded to the penny this ingredient
    // would cost nothing at all, and a free ingredient looks like a working one.
    expect(m.normalizePrice({ priceUnit: 'pcs', pricePerUnit: 0.035 }).pricePerUnit).toBe(0.035);
    expect(m.normalizePrice({ priceUnit: 'kg', pricePerUnit: 3.3333 }).pricePerUnit).toBe(3.3333);
  });

  test('a rate pasted with floating-point noise is cleaned up', () => {
    // What a spreadsheet hands over for 10/3. Stored raw it would never compare
    // equal to a later 3.3333, so every save would look like a price change.
    expect(m.normalizePrice({ priceUnit: 'kg', pricePerUnit: 3.3333333333333335 }).pricePerUnit).toBe(3.3333);
  });

  test('an incomplete form names the box that is missing', () => {
    expect(m.normalizePrice({}).reason).toBe('unit');
    expect(m.normalizePrice({ priceUnit: 'litres' }).reason).toBe('unit');
    expect(m.normalizePrice({ priceUnit: 'kg' }).reason).toBe('price');
  });

  test('zero and negative numbers are refused, never treated as free', () => {
    expect(m.normalizePrice({ priceUnit: 'kg', pricePerUnit: 0 }).ok).toBe(false);
    expect(m.normalizePrice({ priceUnit: 'kg', pricePerUnit: -7.2 }).ok).toBe(false);
  });

  test('rubbish in the number box does not produce a rate', () => {
    for (const bad of ['', ' ', 'abc', null, undefined, NaN, Infinity, {}]) {
      expect(m.normalizePrice({ priceUnit: 'kg', pricePerUnit: bad }).ok, String(bad)).toBe(false);
    }
  });

  test('a number typed as text still works — every input arrives as a string', () => {
    const r = m.normalizePrice({ priceUnit: 'kg', pricePerUnit: '7.20' });
    expect(r.ok).toBe(true);
    expect(r.pricePerUnit).toBe(7.2);
  });

  // ── What a kilo costs ──────────────────────────────────────────────────────

  test('priced by weight, the rate IS the price per kilo', () => {
    expect(m.pricePerKg({ priceUnit: 'kg', pricePerUnit: 7.2 })).toBe(7.2);
  });

  test('priced by volume, one litre is treated as one kilo', () => {
    // The declared 1:1 approximation, and the same one catalogue-model.js uses when
    // it converts a recipe row in millilitres into grams. The two must agree.
    expect(m.pricePerKg({ priceUnit: 'l', pricePerUnit: 1.2 })).toBe(1.2);
  });

  test('priced by the piece, the weight of one piece turns it into a price per kilo', () => {
    // A vanilla pod at £2.10 weighing 3.5 g → £600/kg. This is the number that makes
    // vanilla worth writing in grams in a recipe rather than as "1 pod".
    expect(m.pricePerKg({ priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.0035 })).toBe(600);
  });

  test('priced by the piece with no piece weight, a price per kilo cannot be known', () => {
    // The important half: it returns null rather than falling back to the raw rate,
    // which would say a 55g egg costs £0.30 a KILO.
    expect(m.pricePerKg({ priceUnit: 'pcs', pricePerUnit: 0.3 })).toBe(null);
    expect(m.pricePerKg({ priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0 })).toBe(null);
  });

  test('an ingredient with no price at all has no price per kilo', () => {
    expect(m.pricePerKg({})).toBe(null);
    expect(m.pricePerKg(null)).toBe(null);
    expect(m.pricePerKg({ priceUnit: 'kg' })).toBe(null);
    expect(m.pricePerKg({ pricePerUnit: 7.2 })).toBe(null);           // no unit
    expect(m.pricePerKg({ priceUnit: 'crate', pricePerUnit: 7.2 })).toBe(null);
  });

  // ── Costable or not — flagged, never blocked ───────────────────────────────

  test('an ingredient with a complete price is costable', () => {
    expect(m.costState({ priceUnit: 'kg', pricePerUnit: 7.2 })).toStrictEqual({ costable: true, reason: null });
    expect(m.isCostable({ priceUnit: 'kg', pricePerUnit: 7.2 })).toBe(true);
  });

  test('the 65 ingredients that exist today are simply "no price yet"', () => {
    // The real shape in production before this feature: a name, a supplier, a
    // free-text weight. Nothing about them may look broken — they are just unpriced.
    const live = { name: 'Bacon', supplierId: 'SUP_1', weight: '2.27kg', unit: 'casse', active: true };
    expect(m.costState(live)).toStrictEqual({ costable: false, reason: 'no-price' });
  });

  test('priced by the piece without a piece weight says exactly what is missing', () => {
    const egg = { priceUnit: 'pcs', pricePerUnit: 0.3 };
    expect(m.costState(egg)).toStrictEqual({ costable: false, reason: 'no-piece-weight' });
  });

  // ── Formatting ─────────────────────────────────────────────────────────────

  test('money is shown to the penny, in whatever the venue counts in', () => {
    // The fallback, which is what every screen shows before a venue is open.
    const fallback = venue();
    expect(fallback.formatMoney(180)).toBe('£180.00');
    expect(fallback.formatMoney(7.2)).toBe('£7.20');
    expect(fallback.formatMoney(0)).toBe('£0.00');
    expect(fallback.formatMoney('nonsense')).toBe('£0.00');
  });

  // ⚠️⚠️ THE ONE THAT WOULD HAVE CAUGHT THE DEFECT FEDERICO PHOTOGRAPHED. The currency
  // used to be `const CURRENCY = '£'` in price-model.js, so an Italian bakery's ten
  // prices — typed in euros — were shown as pounds on every row and in every form.
  // Reading it INSIDE the formatter is the whole fix, and this is what pins it: if
  // anybody ever hoists it back to a module constant, the second half fails.
  // (The TypeScript port is handed the money, so it cannot be hoisted at all; the test still runs
  // against both, because the js/ file is the one that can.)
  test('⚠️ the currency is read when money is FORMATTED, not when the module loads', () => {
    const euros = venue('€');
    expect(euros.formatMoney(6.5), 'formatMoney must follow the venue').toBe('€6.50');
    expect(euros.formatRate(0.0035), 'so must a rate, decimals and all').toBe('€0.0035');
    // An Italian venue also WRITES the amount the Italian way (4 Oct 2026), read when
    // formatting like the symbol.
    const italy = venue('€', IT);
    expect(italy.formatMoney(1234.5)).toBe(`1.234,50${NB}€`);
    expect(italy.formatMoney(6.5)).toBe(`6,50${NB}€`);
    expect(italy.formatRate(0.0035)).toBe(`0,0035${NB}€`);
    // And back, in the same process: nothing may have been captured on first import.
    expect(venue('£').formatMoney(6.5), 'it must change back — nothing is frozen').toBe('£6.50');
  });

  // ⚠️ NOTHING CONVERTS. The symbol is a label on a number that is never touched — the
  // property that made this change safe to ship against ten real prices in production.
  test('⚠️⚠️ changing the currency changes the SYMBOL and never the number', () => {
    const pounds = venue('£').formatMoney(6.5);
    const euros = venue('€').formatMoney(6.5);
    expect(pounds.replace('£', ''),
      'the digits must be identical — a conversion here would silently restate every price')
      .toBe(euros.replace('€', ''));
  });

  test('a corrupt or missing currency falls back rather than blanking the price', () => {
    for (const bad of [null, undefined, '', 0, {}, []]) {
      expect(venue(bad).formatMoney(1), `${JSON.stringify(bad)} must fall back`).toBe('£1.00');
    }
  });

  test('a rate keeps the decimals it needs, and never fewer than two', () => {
    const fallback = venue();
    expect(fallback.formatRate(7.2)).toBe('£7.20');
    expect(fallback.formatRate(600)).toBe('£600.00');
    expect(fallback.formatRate(0.3)).toBe('£0.30');
    // The two that matter: rounded to the penny these read as 4p and as free.
    expect(fallback.formatRate(0.035)).toBe('£0.035');
    expect(fallback.formatRate(0.0035)).toBe('£0.0035');
    expect(fallback.formatRate('nonsense')).toBe('');
  });

  test('formatRate shows such small rates in full, never as 0.00', () => {
    const fallback = venue();
    expect(fallback.formatRate(0.001745)).toMatch(/0\.001745$/);
    expect(fallback.formatRate(0.000049)).toMatch(/0\.000049$/);
    expect(fallback.formatRate(7.2)).toMatch(/7\.20$/);
    expect(fallback.formatRate(0.035)).toMatch(/0\.035$/);
  });

  // ── Small guards ───────────────────────────────────────────────────────────

  test('the list of price units is closed and frozen', () => {
    expect([...m.PRICE_UNITS]).toStrictEqual(['kg', 'l', 'pcs']);
    expect(() => { (m.PRICE_UNITS as unknown as string[]).push('crate'); }).toThrow();
    expect(m.isPriceUnit('kg')).toBe(true);
    expect(m.isPriceUnit('casse')).toBe(false);
    expect(m.isPriceUnit('')).toBe(false);
  });

  test('rounding survives the classic floating-point traps', () => {
    expect(m.roundTo(1.005, 2)).toBe(1.01);
    expect(m.roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(m.roundTo('nonsense', 2)).toBe(0);
  });

  test('positiveNumber accepts only a real number above zero', () => {
    expect(m.positiveNumber('7.2')).toBe(7.2);
    expect(m.positiveNumber(0)).toBe(null);
    expect(m.positiveNumber(-1)).toBe(null);
    expect(m.positiveNumber('')).toBe(null);
    expect(m.positiveNumber(null)).toBe(null);
    expect(m.positiveNumber(Infinity)).toBe(null);
  });

  // ── A price quoted per CASE: the pure division ─────────────────────────────

  test('20 for a case of 50 pieces is 0.40 a piece', () => {
    expect(m.caseRate({ casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' }))
      .toStrictEqual({ priceUnit: 'pcs', pricePerUnit: 0.4 });
  });

  test('pieces ignore the size box', () => {
    expect(m.caseRate({ casePrice: 20, caseCount: 50, caseItemSize: 999, caseItemUnit: 'pcs' }))
      .toStrictEqual({ priceUnit: 'pcs', pricePerUnit: 0.4 });
  });

  test('20 for 4 bags of 2.5 kg is 2 a kilo', () => {
    expect(m.caseRate({ casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }))
      .toStrictEqual({ priceUnit: 'kg', pricePerUnit: 2 });
  });

  test('grams are thousandths of a kilo: 20 for 4 × 500 g is 10 a kilo', () => {
    expect(m.caseRate({ casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' }))
      .toStrictEqual({ priceUnit: 'kg', pricePerUnit: 10 });
  });

  test('litres and millilitres price per litre', () => {
    expect(m.caseRate({ casePrice: 12, caseCount: 6, caseItemSize: 1, caseItemUnit: 'l' }))
      .toStrictEqual({ priceUnit: 'l', pricePerUnit: 2 });
    expect(m.caseRate({ casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' }))
      .toStrictEqual({ priceUnit: 'l', pricePerUnit: 4 });
  });

  test('a derived rate keeps six decimals, never floating-point noise', () => {
    expect(m.caseRate({ casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' })?.pricePerUnit).toBe(3.333333);
  });

  test('a very small derived rate is kept, not rounded to nothing', () => {
    // 2000 straws at 3.49 is 0.001745 each — four decimals would store 0.0017 (2.6% out)
    expect(m.caseRate({ casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs' })?.pricePerUnit).toBe(0.001745);
    // 10,000 pieces at 0.49 is 0.000049 each, which is not free
    expect(m.caseRate({ casePrice: 0.49, caseCount: 10000, caseItemUnit: 'pcs' })?.pricePerUnit).toBe(0.000049);
  });

  test('anything missing, zero, negative or not a number gives null, never a guess', () => {
    const ok = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
    expect(m.caseRate(ok)).not.toBe(null);
    for (const bad of [
      { casePrice: '' }, { casePrice: 0 }, { casePrice: -1 }, { casePrice: 'abc' }, { casePrice: NaN },
      { caseCount: '' }, { caseCount: 0 }, { caseCount: -2 },
      { caseItemSize: '' }, { caseItemSize: 0 }, { caseItemSize: null },
      { caseItemUnit: '' }, { caseItemUnit: 'oz' }, { caseItemUnit: null },
    ]) {
      expect(m.caseRate({ ...ok, ...bad }), JSON.stringify(bad)).toBe(null);
    }
    expect(m.caseRate()).toBe(null);
    expect(m.caseRate({})).toBe(null);
  });

  test('a case so cheap that even six decimals round it to nothing is not free', () => {
    expect(m.caseRate({ casePrice: 0.0001, caseCount: 100000, caseItemUnit: 'pcs' })).toBe(null);
  });

  test('caseOf keeps a whole case and drops a partial one', () => {
    expect(m.caseOf({ casePrice: 20, caseCount: 50, caseItemSize: 3, caseItemUnit: 'pcs' }))
      .toStrictEqual({ casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs' });
    expect(m.caseOf({ casePrice: '20', caseCount: '4', caseItemSize: '2.5', caseItemUnit: 'kg' }))
      .toStrictEqual({ casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' });
    expect(m.caseOf({ casePrice: 20, caseCount: 4, caseItemUnit: 'kg' })).toBe(null);
    expect(m.caseOf({ priceUnit: 'kg', pricePerUnit: 2 })).toBe(null);
    expect(m.caseOf(null)).toBe(null);
  });

  // ── A case of packages ('pack'): the size is stored, never read from the weight ──

  test('pack is a case unit and needs a stored size', () => {
    expect(m.CASE_ITEM_UNITS.includes(m.PACK_ITEM)).toBe(true);
    expect(m.caseOf({ casePrice: 20, caseCount: 4, caseItemSize: null, caseItemUnit: 'pack' })).toBe(null);
    expect(m.caseOf({ casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' }))
      .toStrictEqual({ casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' });
  });

  test('packBaseOf reads a weight in the rate base, and nothing else', () => {
    expect(m.packBaseOf('2,5 kg')).toStrictEqual({ size: 2.5, priceUnit: 'kg' });
    expect(m.packBaseOf('500 g')).toStrictEqual({ size: 0.5, priceUnit: 'kg' });
    expect(m.packBaseOf('750 ml')).toStrictEqual({ size: 0.75, priceUnit: 'l' });
    expect(m.packBaseOf('1 l')).toStrictEqual({ size: 1, priceUnit: 'l' });
    for (const w of ['', undefined, 'sacco', '6x1kg', '50 cl']) expect(m.packBaseOf(w), String(w)).toBe(null);
  });

  test('20 for 4 × a 2.5 kg package is 2 a kilo; the stored size and unit decide', () => {
    const c = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(m.caseRate(c, 'kg')).toStrictEqual({ priceUnit: 'kg', pricePerUnit: 2 });
    expect(m.caseRate({ ...c, casePrice: 12, caseCount: 6, caseItemSize: 0.5 }, 'l'))
      .toStrictEqual({ priceUnit: 'l', pricePerUnit: 4 });
    expect(m.caseRate(c), 'no basis, no rate').toBe(null);
    expect(m.caseRate(c, 'pcs')).toBe(null);
    expect(m.caseRate({ ...c, caseItemSize: null }, 'kg')).toBe(null);
  });

  // ── A stale case is ignored (an old phone saved a rate over it) ────────────

  test('storedCaseOf accepts a case that reproduces its own rate exactly', () => {
    expect(m.storedCaseOf(flour)).toStrictEqual({ casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' });
    expect(m.storedCaseOf(eggs)).not.toBe(null);
    const small = { casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.001745 };
    expect(m.storedCaseOf(small)).not.toBe(null);
  });

  test('the patch a case save writes is recognised by storedCaseOf, at every size', () => {
    for (const form of [
      { casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs' },
      { casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' },
      { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
      { casePrice: 12, caseCount: 7, caseItemSize: 330, caseItemUnit: 'ml' },
    ]) {
      expect(m.storedCaseOf(legacyJs.pricePatch({ priceUnit: legacyJs.CASE_MODE, ...form }, AT)), JSON.stringify(form)).not.toBe(null);
    }
  });

  test('a rate typed on an old phone over the old case makes that case stale: null', () => {
    expect(m.storedCaseOf({ ...flour, pricePerUnit: 2.5 })).toBe(null);
    expect(m.storedCaseOf({ ...flour, priceUnit: 'l' })).toBe(null);
    expect(m.storedCaseOf({ ...eggs, priceUnit: 'kg' })).toBe(null);
  });

  test('a price deleted on an old phone stays deleted: the leftover case is not a price', () => {
    // (The original goes on to unitCost, packPrice and valueBlocker: unitCost is in order-cost.spec.ts.)
    const deleted = { ...flour, priceUnit: null, pricePerUnit: null };
    expect(m.storedCaseOf(deleted)).toBe(null);
  });

  test('storedCaseOf of nothing is null', () => {
    expect(m.storedCaseOf(null)).toBe(null);
    expect(m.storedCaseOf({})).toBe(null);
  });

  test('a rate typed since (old phone) makes the pack case stale', () => {
    const patchFor = (weight: string): Record<string, unknown> => legacyJs.pricePatch(
      { priceUnit: legacyJs.CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' }, AT, weight);
    expect(m.storedCaseOf({ ...patchFor('2.5 kg'), pricePerUnit: 3 })).toBe(null);
    expect(m.storedCaseOf({ ...patchFor('2.5 kg'), caseItemSize: null })).toBe(null);
  });

  // ── The price lives beside the ingredient, not on it ───────────────────────
  //
  // ⚠️ THE WHOLE POINT: Orders must read every ingredient to work, so a rate on the
  // ingredient document is a rate everybody in the building can read. Hiding the
  // Food Cost screen hid the margin and left "what a sack of flour costs" in plain
  // view — half an answer pretending to be a whole one.

  test('the case keys are price fields but are never drained onto an ingredient', () => {
    for (const key of CASE_KEYS) {
      expect((m.PRICE_FIELDS as readonly string[]).includes(key), key).toBe(true);
      expect((m.INGREDIENT_DRAINED_FIELDS as readonly string[]).includes(key), key).toBe(false);
    }
  });

  // ⚠️ A MISSING PRICE IS NOT AN ERROR. An employee cannot read that collection at
  // all, so withPrices returns the ingredients untouched — and every
  // screen already knows what an unpriced ingredient looks like, because most
  // ingredients have never had a price. No new failure mode to handle.
  test('an ingredient with no price comes back unchanged', () => {
    const ings = [{ id: 'I1', name: 'Flour' }];
    expect(m.withPrices(ings, {})).toStrictEqual(ings);
    expect(m.withPrices(ings, null)).toStrictEqual(ings);
  });

  test('a price is merged onto its own ingredient only', () => {
    const merged = m.withPrices(
      [{ id: 'I1', name: 'Flour' }, { id: 'I2', name: 'Butter' }],
      { I1: { priceUnit: 'kg', pricePerUnit: 7.2 } });
    expect(merged[0]?.pricePerUnit).toBe(7.2);
    expect(merged[1]?.pricePerUnit).toBe(undefined);
    expect(merged[0]?.name, 'the ingredient survives the merge').toBe('Flour');
  });

  test('a price for an ingredient that is not there is simply not used', () => {
    const merged = m.withPrices([{ id: 'I1' }], { GHOST: { pricePerUnit: 9 } });
    expect(merged.length).toBe(1);
    expect(merged[0]?.pricePerUnit).toBe(undefined);
  });

  // ⚠️⚠️ THE HOLE THE SECURITY AUDIT OF 23 SEP 2026 FOUND. The ingredient document is
  // writable by any employee who may edit ingredients; a price on IT — left over, or
  // made up — became the price a manager's Food cost used whenever the ingredient had
  // no price document of its own. The rules now refuse anything but null there, and
  // this refuses to read one, so neither half leans on the other.
  test('a price sitting on the ingredient itself is never used', () => {
    const planted = {
      id: 'I1', name: 'Flour', priceUnit: 'kg', pricePerUnit: 0.01, packPrice: 1, packSize: 100, unitWeightKg: 1,
      priceUpdatedAt: 'x', vatRate: 4, casePrice: 1, caseCount: 1, caseItemSize: 1, caseItemUnit: 'kg', priceBasis: 'rate',
    };
    const [alone] = m.withPrices([planted], {});
    for (const key of m.PRICE_FIELDS) expect(alone?.[key], `${key} leaked through from the ingredient`).toBe(null);
    expect(alone?.name, 'everything else on the ingredient survives').toBe('Flour');

    const [priced] = m.withPrices([planted], { I1: { priceUnit: 'kg', pricePerUnit: 7.2 } });
    expect(priced?.pricePerUnit, 'the price document wins').toBe(7.2);
    expect(priced?.packPrice, 'and nothing of the planted price is left beside it').toBe(null);
  });

  test('merging into nothing gives nothing', () => {
    expect(m.withPrices(null, { I1: { pricePerUnit: 1 } })).toStrictEqual([]);
    expect(m.withPrices(undefined, null)).toStrictEqual([]);
  });

  test('withPrices puts the case back on the ingredient for the screens', () => {
    const p = legacyJs.pricePatch({ priceUnit: legacyJs.CASE_MODE, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' }, AT);
    const [merged] = m.withPrices([{ id: 'E1', name: 'Eggs' }], { E1: p });
    expect(merged?.casePrice).toBe(20);
    expect(merged?.caseCount).toBe(50);
    expect(merged?.pricePerUnit).toBe(0.4);
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in the original tests: the lists of fields, which the rules pin.

  test('⚠️ the ingredient drains the six old price keys and NEVER vatRate, the case keys or priceBasis', () => {
    // Writing any of the last three onto an ingredient makes the rules refuse EVERY ingredient save
    // (review of 28 Sep 2026): they live on ingredient-prices only.
    expect([...m.INGREDIENT_DRAINED_FIELDS]).toStrictEqual(
      ['priceUnit', 'pricePerUnit', 'packPrice', 'packSize', 'unitWeightKg', 'priceUpdatedAt']);
    expect([...m.PRICE_FIELDS]).toStrictEqual([
      'priceUnit', 'pricePerUnit', 'packPrice', 'packSize', 'unitWeightKg', 'priceUpdatedAt', 'vatRate',
      'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'priceBasis']);
  });

  test('the lists a caller must not change are frozen', () => {
    for (const list of [m.PRICE_UNITS, m.PRICE_FIELDS, m.INGREDIENT_DRAINED_FIELDS, m.CASE_ITEM_UNITS]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
    expect(Object.isFrozen(m.PRICE_UNIT_LABELS)).toBe(true);
    expect(Object.isFrozen(m.COST_REASON_TEXT)).toBe(true);
  });

  test('the dictionary keys of the units and of the reasons are the current app’s', () => {
    expect({ ...m.PRICE_UNIT_LABELS }).toStrictEqual({ kg: 'price.byWeight', l: 'price.byVolume', pcs: 'price.byPiece' });
    expect({ ...m.COST_REASON_TEXT }).toStrictEqual({ 'no-price': 'price.none', 'no-piece-weight': 'price.needPieceWeight' });
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The three functions that look a word up in the interface dictionary, and the writing half (the
  // ingredient card's, step 3e). The original still exports all of them.
  const LEFT_OUT = [
    'priceUnitLabel', 'costReasonText', 'formatPricePerUnit',
    'CASE_MODE', 'pricePatch', 'PRICE_FORMS', 'ownPieceWeight', 'priceFormOf', 'PRICE_BASES', 'basisOptions',
    'defaultBasis', 'basisOf', 'basisToStore', 'rateBaseOf', 'basisToStoredPrice', 'storedPriceToBasis',
    'convertBasisPrice', 'shownPrice', 'formatPriceInput', 'storedPriceInput', 'singleFromCaseInput',
    'priceBoxStart', 'weightNeededForPrice', 'priceChangedByRepresentation', 'priceChanged', 'priceRecord',
    'splitPriceFields',
  ];
  // They take the venue's money as one more argument, by design.
  const TAKE_THE_MONEY = ['formatMoney', 'formatRate'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters (the money is one more)', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length + (TAKE_THE_MONEY.includes(name) ? 1 : 0));
    }
  });
});
