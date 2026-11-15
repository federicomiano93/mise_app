// Unit tests for the ingredient price maths, the WRITING half (P15 — the owner cannot read code, so
// these tests are the safety net), run against BOTH implementations: the TypeScript port in shared/ and
// js/price-model.js, which the live app uses today. The reading half is in price-model.spec.ts; the two
// files together are the whole of tests/price-model.test.mjs, tests/case-price.test.mjs,
// tests/pack-case.test.mjs and tests/price-basis.test.mjs that touch only price-model. The two
// implementations must stay equal until the switch to Mise 2.
//
// What they are really guarding is the SHAPE of what the ingredient card saves: a price typed in a box
// becomes a patch that is merged into Firestore, and a merge keeps whatever the patch leaves out. A field
// missing from the patch is therefore a stale price kept for ever, and a field that moved by a rounding
// is a «price change» in the history that nobody made.
//
// THE MONEY, as in price-model.spec.ts: each side formats through `venue(symbol, layout)` — the js/ file
// after setCurrency, the TypeScript one with moneyOf. The js/ module is put back to its fallback after
// every test.
//
// THE WORDS. Three functions look a word up in the interface dictionary (priceUnitLabel, costReasonText,
// formatPricePerUnit). The original reads js/i18n.js itself; the port is handed a translator last, as
// pack-format.spec.ts does: both are run after setLanguage(...) of js/i18n.js, the port with that same `t`,
// and must give the same text. The language is put back to English after every test.
//
// PORTED, with the original's names: from tests/price-model.test.mjs the formatPricePerUnit headline test,
// the 6 pricePatch, 6 priceChanged, 3 priceRecord and 5 splitPriceFields tests (with 'split then merge
// restores what the form had') and the 24 tests from «Confezione» and the ONE price box on; from
// tests/case-price.test.mjs the 7 pricePatch tests, 'splitPriceFields sends the case to the price half
// only' and 'a legacy explicit-size case…'; from tests/pack-case.test.mjs the 4 pricePatch ones; from
// tests/price-basis.test.mjs the 20 tests that call only price-model functions. Added here, not in an
// original: 'costReasonText says nothing…' (its lines are inside the three costState tests of the
// original, which price-model.spec.ts runs without them), the headline rate under another currency (two
// lines of the original's currency test) and priceUnitLabel.
//
// keepPriceDate (F4, PR #380) has no original in this stack yet: its tests are at the end, against the
// port alone.
//
// NOT PORTED:
//   * tests/case-price.test.mjs and tests/pack-case.test.mjs: every test that prices a line (unitCost —
//     order-cost.spec.ts) or values a stocktake (packPrice, valueBlocker, lineValue, casePackNote —
//     inventory-value.spec.ts). The unitCost lines inside 'a price deleted on an old phone…' and
//     'the stored case does not depend on the weight edited afterwards' are left to order-cost.spec.ts.
//   * tests/price-basis.test.mjs (4 of its 24 tests), because each reads the current card's source text
//     (newCardSource / legacyCardSource / readFileSync) — «reads the current card's source; the Mise 2
//     card has its own specs»:
//       - 'the new phrases exist once in each language and the card uses them'
//       - 'the card shows the selector only when its form offers a choice, reads labels while drawing, and
//         saves the choice'
//       - 'the old card never asks for a basis'
//       - 'the places that fill the price box go through shownPrice'

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as ported from './price-model';
import { moneyOf } from './currency';
import * as legacyJs from '../../js/price-model.js';
import * as legacyCurrency from '../../js/currency.js';
import { setLanguage, t } from '../../js/i18n.js';

const legacy = legacyJs as unknown as typeof ported;

const AT = '2026-09-30T09:00:00.000Z';
const NOW = '2026-10-01T10:00:00.000Z';
const CASE_KEYS = ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit'];
const IT = { decimal: ',', group: '.', symbolAfter: true };
const NB = ' ';

// A venue's money, written through whichever implementation is being tested.
interface Venue {
  formatPricePerUnit(ingredient: unknown): string;
}
type OpenVenue = (symbol?: unknown, layout?: unknown) => Venue;

const portedVenue: OpenVenue = (symbol, layout) => {
  const money = moneyOf(symbol, layout);
  return { formatPricePerUnit: ingredient => ported.formatPricePerUnit(ingredient, money, t) };
};
const legacyVenue: OpenVenue = (symbol, layout) => {
  legacyCurrency.setCurrency(symbol, layout);
  return { formatPricePerUnit: ingredient => legacyJs.formatPricePerUnit(ingredient) };
};

// The other two dictionary functions, behind the original's one-argument signature.
interface Words {
  costReasonText(ingredient: unknown): string;
  priceUnitLabel(unit: unknown): string;
}
const portedWords: Words = {
  costReasonText: ingredient => ported.costReasonText(ingredient, t),
  priceUnitLabel: unit => ported.priceUnitLabel(unit, t),
};
const legacyWords: Words = {
  costReasonText: ingredient => legacyJs.costReasonText(ingredient),
  priceUnitLabel: unit => legacyJs.priceUnitLabel(unit),
};

// The js/ modules keep their money and their language for the life of the process, so a test never leaves
// a venue or a language open.
beforeEach(() => { setLanguage('en'); });
afterEach(() => { legacyCurrency.setCurrency(); setLanguage('en'); });

// A key of an object whose shape the test does not spell out.
const at = (object: unknown, key: string): unknown => (object as Record<string, unknown>)[key];

const CARTON = (count: number | null, inner = 'busta') => ({ kind: 'carton', count, inner });
const SINGLE = { kind: 'single', count: null, inner: '' };

describe.each([
  ['shared/ (TypeScript)', ported, portedVenue, portedWords],
  ['js/ (current app)', legacy, legacyVenue, legacyWords],
] as const)('%s', (_name, m, venue, words) => {
  // ── The words ──────────────────────────────────────────────────────────────

  test('the headline rate reads "£7.20 / kg", and "each" for pieces', () => {
    const fallback = venue();
    expect(fallback.formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 7.2 })).toBe('£7.20 / kg');
    expect(fallback.formatPricePerUnit({ priceUnit: 'l', pricePerUnit: 1.2 })).toBe('£1.20 / l');
    expect(fallback.formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 })).toBe('£0.30 / each');
    expect(fallback.formatPricePerUnit({})).toBe('');
  });

  // Two lines of the original's currency test, which price-model.spec.ts runs without them: the headline
  // rate is written in the venue's money, symbol and layout.
  test('⚠️ the headline rate follows the venue’s currency and layout when it is formatted', () => {
    expect(venue('€').formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 6.5 })).toBe('€6.50 / kg');
    expect(venue('€', IT).formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 6.5 })).toBe(`6,50${NB}€ / kg`);
    expect(venue('£').formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 6.5 })).toBe('£6.50 / kg');
  });

  test('costReasonText says nothing for a costable ingredient, and what is missing otherwise', () => {
    expect(words.costReasonText({ priceUnit: 'kg', pricePerUnit: 7.2 })).toBe('');
    expect(words.costReasonText({ name: 'Bacon', supplierId: 'SUP_1', weight: '2.27kg', unit: 'casse', active: true })).toBe('No price yet');
    expect(words.costReasonText({ priceUnit: 'pcs', pricePerUnit: 0.3 })).toMatch(/weight of one piece/);
  });

  test('priceUnitLabel names the way of buying, and falls back to the weight for a unit it does not know', () => {
    expect(words.priceUnitLabel('kg')).toBe(words.priceUnitLabel('crate'));
    expect(words.priceUnitLabel('pcs')).not.toBe(words.priceUnitLabel('kg'));
    expect(words.priceUnitLabel('l')).not.toBe(words.priceUnitLabel('kg'));
    expect(words.priceUnitLabel(undefined)).toBe(words.priceUnitLabel('kg'));
  });

  test('«each» is an interface word: one phrase with a hole, in English and in Italian', () => {
    const fallback = venue();
    expect(fallback.formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 })).toBe('£0.30 / each');
    setLanguage('it');
    try { expect(fallback.formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 })).toBe('£0.30 al pezzo'); }
    finally { setLanguage('en'); }
    expect(fallback.formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 7.2 })).toBe('£7.20 / kg');
  });

  // ── The patch written to Firestore ─────────────────────────────────────────

  test('a complete form produces every field, so nothing stale is left behind', () => {
    const patch = m.pricePatch({ priceUnit: 'kg', pricePerUnit: '7.20' }, AT);
    expect(patch).toStrictEqual({
      priceUnit: 'kg', pricePerUnit: 7.2, packPrice: null, packSize: null,
      unitWeightKg: null, priceUpdatedAt: AT, vatRate: null,
      casePrice: null, caseCount: null, caseItemSize: null, caseItemUnit: null,
    });
    // Every field this module owns is present in the patch — a merge write leaves
    // out what it does not mention, so an omitted field would keep its old value.
    // The one exception is priceBasis, present only when the caller (the ingredient card) names it.
    expect(Object.keys(patch).sort()).toStrictEqual(m.PRICE_FIELDS.filter(k => k !== 'priceBasis').sort());
    expect('priceBasis' in m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2, priceBasis: null }, AT)).toBe(true);
    expect(m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2, priceBasis: 'rate' }, AT).priceBasis).toBe('rate');
    expect(m.pricePatch({ priceUnit: 'kg', pricePerUnit: '', priceBasis: 'rate' }, AT).priceBasis).toBe(null);
  });

  test('saving clears the retired pack fields off an ingredient that still carries them', () => {
    // The rate used to be packPrice ÷ packSize. Left in place they would sit under a
    // rate somebody has since corrected, saying £180 for 25kg beside £7.50 a kilo —
    // and a merge write cannot remove a field by leaving it out.
    const patch = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.5 }, AT);
    expect(patch.packPrice).toBe(null);
    expect(patch.packSize).toBe(null);
  });

  test('clearing the price box really clears the stored price', () => {
    const patch = m.pricePatch({ priceUnit: 'kg', pricePerUnit: '' }, AT);
    expect(patch.pricePerUnit).toBe(null);
    expect(patch.priceUpdatedAt).toBe(null);
    expect(Object.keys(patch).sort()).toStrictEqual(m.PRICE_FIELDS.filter(k => k !== 'priceBasis').sort());
  });

  test('the weight of one piece survives a half-filled price', () => {
    // It describes the article, not the money. Losing it while someone is still
    // typing the price would mean typing it again.
    const patch = m.pricePatch({ priceUnit: 'pcs', unitWeightKg: 0.0035 }, AT);
    expect(patch.unitWeightKg).toBe(0.0035);
    expect(patch.pricePerUnit).toBe(null);
  });

  test('switching away from pieces clears the piece weight', () => {
    // A leftover divisor nothing shows on screen is the kind of number that later
    // gets divided by without anyone knowing it is there.
    const patch = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: 0.0035 }, AT);
    expect(patch.unitWeightKg).toBe(null);
  });

  test('a piece weight keeps enough decimals for a gelatine leaf', () => {
    // 1.7 g. At four decimals this would be 0.0017 — a 2% error; six keeps it exact.
    const patch = m.pricePatch({ priceUnit: 'pcs', pricePerUnit: 0.035, unitWeightKg: 0.0017 }, AT);
    expect(patch.unitWeightKg).toBe(0.0017);
  });

  // ── When a history entry is worth writing ──────────────────────────────────

  test('re-saving an ingredient without touching its price writes no history', () => {
    const before = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null };
    const after = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
    expect(m.priceChanged(before, after)).toBe(false);
  });

  test('opening an old two-box price and saving it writes no history', () => {
    // Its packPrice/packSize get cleared by the save. If that counted as a change,
    // every ingredient priced before this rework would plant a history entry
    // recording a rate that never moved, the first time anyone opened it.
    const before = { priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25, unitWeightKg: null };
    const after = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
    expect(after.packPrice).toBe(null);
    expect(m.priceChanged(before, after)).toBe(false);
  });

  test('a real price change is recorded', () => {
    const before = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null };
    const after = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.6 }, AT);
    expect(m.priceChanged(before, after)).toBe(true);
  });

  test('a first price on an ingredient that never had one is recorded', () => {
    const after = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
    expect(m.priceChanged({ name: 'Flour' }, after)).toBe(true);
    expect(m.priceChanged(null, after)).toBe(true);
  });

  test('changing only the piece weight counts as a price change', () => {
    // No money moved, but every recipe using it just changed cost, so the history
    // has to be able to explain the step.
    const before = { priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.0035 };
    const after = m.pricePatch({ priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.004 }, AT);
    expect(m.priceChanged(before, after)).toBe(true);
  });

  test('a missing field and a null field are the same absence', () => {
    // The stored document omits a field it never had; the patch writes null. Without
    // this, every first save after the feature ships would look like a change.
    expect(m.priceChanged({ priceUnit: 'kg', pricePerUnit: 7.2 },
      { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null })).toBe(false);
  });

  // ── The history entry ──────────────────────────────────────────────────────

  test('a history entry carries the supplier and a date FIELD', () => {
    const ing = { name: 'Flour', supplierId: 'SUP_1' };
    const patch = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
    const record = m.priceRecord(ing, patch, AT);

    expect(record.supplierId).toBe('SUP_1');
    expect(record.source).toBe('manual');
    expect(record.pricePerUnit).toBe(7.2);
    // recordedAt must be a field: Firestore refuses to order a query descending by
    // document id, so a history without it could never be read newest-first.
    expect(record.recordedAt).toBe(AT);
  });

  test('a history entry carries no retired pack fields — not even as nulls', () => {
    // The rules accept them for records written by a phone still on the old code,
    // so a null would pass; it would just be a permanent empty column in an
    // append-only archive nobody can go back and tidy.
    const record = m.priceRecord({ supplierId: 'SUP_1' }, m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT), AT);
    expect(Object.keys(record).sort()).toStrictEqual(
      ['pricePerUnit', 'priceUnit', 'recordedAt', 'source', 'supplierId', 'unitWeightKg']);
  });

  test('a history entry for an ingredient with no supplier still records', () => {
    const patch = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
    expect(m.priceRecord({}, patch, AT).supplierId).toBe('');
    expect(m.priceRecord(null, patch, AT).supplierId).toBe('');
  });

  // ── The price lives beside the ingredient, not on it ───────────────────────

  test('a saved form splits into the ingredient and its price', () => {
    const { ingredient, price } = m.splitPriceFields({
      name: 'Flour', supplierId: 'S1', active: true,
      priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null, priceUpdatedAt: '2026-08-12',
      packPrice: null, packSize: null,
    });
    expect(ingredient.name).toBe('Flour');
    expect(ingredient.supplierId).toBe('S1');
    expect(price.priceUnit).toBe('kg');
    expect(price.pricePerUnit).toBe(7.2);
    expect(price.priceUpdatedAt).toBe('2026-08-12');
  });

  // ⚠️ THE KEYS STAY ON THE INGREDIENT, SET TO null. Omitting them would leave the
  // old rate on documents written before this change — readable by everybody, for
  // ever — which is the exact thing the split exists to stop.
  test('the ingredient keeps every price key it may carry, emptied', () => {
    const { ingredient } = m.splitPriceFields({ name: 'Flour', priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 });
    for (const key of m.INGREDIENT_DRAINED_FIELDS) {
      expect(key in ingredient, `${key} missing`).toBe(true);
      expect(ingredient[key], key).toBe(null);
    }
    // ⚠️ But never vatRate: the ingredients rule does not accept it, and one key it
    // refuses fails the whole save (tests/price-fields-whitelist.test.mjs).
    expect('vatRate' in ingredient).toBe(false);
  });

  test('a form with no price at all still empties the keys', () => {
    const { ingredient, price } = m.splitPriceFields({ name: 'Flour' });
    expect(ingredient.pricePerUnit).toBe(null);
    expect(price).toStrictEqual({});
  });

  test('splitting nothing does not throw', () => {
    for (const bad of [null, undefined, {}]) {
      const { ingredient, price } = m.splitPriceFields(bad);
      expect(price).toStrictEqual({});
      expect(ingredient.pricePerUnit).toBe(null);
    }
  });

  // The two halves are inverses for the fields that matter, which is what makes a
  // round trip through the form safe.
  test('split then merge restores what the form had', () => {
    const form = { id: 'I1', name: 'Flour', priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null };
    const { ingredient, price } = m.splitPriceFields(form);
    const [back] = m.withPrices([{ ...ingredient, id: 'I1' }], { I1: price });
    expect(at(back, 'priceUnit')).toBe('kg');
    expect(at(back, 'pricePerUnit')).toBe(7.2);
    expect(at(back, 'name')).toBe('Flour');
  });

  // ── tests/case-price.test.mjs: the patch of a price quoted per case ────────

  test('a typed rate is still stored to four decimals', () => {
    expect(m.pricePatch({ priceUnit: 'kg', pricePerUnit: 1.23456789 }, AT).pricePerUnit).toBe(1.2346);
  });

  test('a case in the form writes the case AND the derived rate', () => {
    const p = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: '20', caseCount: '4', caseItemSize: '2.5', caseItemUnit: 'kg', vatRate: '4' }, AT);
    expect(p.priceUnit).toBe('kg');
    expect(p.pricePerUnit).toBe(2);
    expect([p.casePrice, p.caseCount, p.caseItemSize, p.caseItemUnit]).toStrictEqual([20, 4, 2.5, 'kg']);
    expect(p.priceUpdatedAt).toBe(AT);
    expect(p.vatRate).toBe(4);
  });

  test('a case of pieces stores no size and keeps the piece weight', () => {
    const p = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: 20, caseCount: 50, caseItemSize: 7, caseItemUnit: 'pcs', unitWeightKg: '0.055' }, AT);
    expect(p.priceUnit).toBe('pcs');
    expect(p.pricePerUnit).toBe(0.4);
    expect(p.caseItemSize).toBe(null);
    expect(p.unitWeightKg).toBe(0.055);
  });

  test('an incomplete case is «no price» with all four case keys null', () => {
    const p = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: 20, caseCount: '', caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
    expect(p.priceUnit).toBe(null);
    expect(p.pricePerUnit).toBe(null);
    expect(p.priceUpdatedAt).toBe(null);
    CASE_KEYS.forEach(key => expect(at(p, key), key).toBe(null));
  });

  test('any other mode sends the four case keys as null, so a merge clears an old case', () => {
    for (const form of [
      { priceUnit: 'kg', pricePerUnit: 2 },
      { priceUnit: 'pcs', pricePerUnit: 0.4 },
      { priceUnit: null },
      // stale case boxes must be ignored outside case mode
      { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
    ]) {
      const p = m.pricePatch(form, AT);
      CASE_KEYS.forEach(key => {
        expect(key in p, `${key} must be present`).toBe(true);
        expect(at(p, key), key).toBe(null);
      });
    }
  });

  test('the patch never carries a bad case value', () => {
    const p = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: -5, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'oz' }, AT);
    CASE_KEYS.forEach(key => expect(at(p, key), key).toBe(null));
  });

  test('the history records the derived rate; a case price that moves the rate is a change', () => {
    const before = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
    const same = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
    const dearer = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: 24, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
    expect(m.priceChanged(before, same)).toBe(false);
    expect(m.priceChanged(before, dearer)).toBe(true);
    const record = m.priceRecord({ supplierId: 'S1' }, dearer, AT);
    expect(record.pricePerUnit).toBe(2.4);
    expect(record.priceUnit).toBe('kg');
    CASE_KEYS.forEach(key => expect(key in record, `${key} is not a history field`).toBe(false));
  });

  test('splitPriceFields sends the case to the price half only', () => {
    const p = m.pricePatch({ priceUnit: m.CASE_MODE, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' }, AT);
    const { ingredient, price } = m.splitPriceFields({ name: 'Eggs', ...p });
    CASE_KEYS.forEach(key => {
      expect(key in ingredient, `${key} must not reach the ingredient`).toBe(false);
      expect(key in price, key).toBe(true);
    });
    expect(price.casePrice).toBe(20);
  });

  // ⚠️ A legacy explicit-size case written back by an untouched save (1 Oct 2026). The card no longer
  // offers «Contiene count × size × unit», but 4 × 2.5 kg cases typed with it are in production: reopened
  // and saved without a touch they must come back as they were.
  test('a legacy explicit-size case (kg, g, l, ml) written back untouched is the same case and the same rate', () => {
    for (const stored of [
      { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
      { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
      { priceUnit: 'l', pricePerUnit: 2, casePrice: 12, caseCount: 6, caseItemSize: 1, caseItemUnit: 'l' },
      { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
    ]) {
      expect(m.storedCaseOf(stored), 'it stands before').toBeTruthy();
      const patch = m.pricePatch(m.storedPriceInput(stored, ''), AT, '');
      for (const key of ['priceUnit', 'pricePerUnit', ...CASE_KEYS]) expect(at(patch, key), key).toBe(at(stored, key));
      expect(m.storedCaseOf(patch), 'and it stands after').toStrictEqual(m.storedCaseOf(stored));
      expect(m.priceChanged(stored, patch)).toBe(false);
    }
  });

  // ── tests/pack-case.test.mjs: the patch of a case of packages ──────────────

  const FORM = { priceUnit: ported.CASE_MODE, casePrice: 20, caseCount: 4, caseItemUnit: 'pack' };
  const patchFor = (weight: unknown, form: ported.PriceInput = FORM): ported.PricePatch => m.pricePatch(form, AT, weight);

  test('the patch copies the package size in the base of the weight, whatever unit it was typed in', () => {
    let p = patchFor('2.5 kg');
    expect([p.priceUnit, p.pricePerUnit, p.caseItemUnit, p.caseItemSize, p.casePrice]).toStrictEqual(['kg', 2, 'pack', 2.5, 20]);
    p = patchFor('500 g');
    expect([p.priceUnit, p.pricePerUnit, p.caseItemSize]).toStrictEqual(['kg', 10, 0.5]);
    p = m.pricePatch({ ...FORM, casePrice: 12, caseCount: 6 }, AT, '500 ml');
    expect([p.priceUnit, p.pricePerUnit, p.caseItemSize]).toStrictEqual(['l', 4, 0.5]);
  });

  test('a weight that cannot be read gives no price, all four case keys null', () => {
    for (const weight of ['', undefined, 'sacco', '6x1kg']) {
      const p = patchFor(weight);
      expect(p.pricePerUnit).toBe(null);
      for (const key of CASE_KEYS) expect(at(p, key)).toBe(null);
    }
  });

  test('a size typed into the (hidden) size box never wins over the weight', () => {
    expect(patchFor('2.5 kg', { ...FORM, caseItemSize: '99' }).caseItemSize).toBe(2.5);
  });

  test('packBasis makes the stored size authoritative: the weight on the card is not read', () => {
    const stored = { priceUnit: m.CASE_MODE, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack', packBasis: 'kg' };
    for (const weight of ['2.5kg', '3kg', '', 'sacco', undefined]) {
      const p = m.pricePatch(stored, AT, weight);
      expect([p.priceUnit, p.pricePerUnit, p.caseItemSize], String(weight)).toStrictEqual(['kg', 2, 2.5]);
    }
    // a basis that is not kg or l is ignored, and the weight rules again (here: unreadable → no price)
    expect(m.pricePatch({ ...stored, packBasis: 'pcs' }, AT, '').pricePerUnit).toBe(null);
    expect(m.pricePatch({ ...stored, packBasis: 'l' }, AT, '').priceUnit).toBe('l');
  });

  // ── «Confezione» and the ONE price box (1 Oct 2026, reworked after the deep review) ───────────
  // What the card's price box means follows the format and the weight; these are the pure halves of it.
  //
  // ⚠️ THE STORAGE POLICY: a price typed for formatted goods is stored PER ITEM — priceUnit 'pcs', the
  // rate is ONE item's price, unitWeightKg is one item's weight in kilos when the weight reads (litres
  // 1:1). A carton is a case of that many pieces (casePrice, caseCount, caseItemUnit 'pcs'). The first
  // build stored a case of ONE package priced per kilo, and an egg at 0.25 a piece became 4.03 a kilo
  // with no piece weight — Food cost's «in pieces» lines and packaging lost their cost.

  test('the price box means: carton + weight → cartone; carton alone → pieces; single + weight → confezione; loose → typed', () => {
    expect(m.priceFormOf(CARTON(4), '2.5kg')).toBe(m.PRICE_FORMS.cartonPack);
    expect(m.priceFormOf(CARTON(50), '')).toBe(m.PRICE_FORMS.cartonPieces);
    expect(m.priceFormOf(CARTON(50), '6x1kg')).toBe(m.PRICE_FORMS.cartonPieces);
    expect(m.priceFormOf(SINGLE, '25kg')).toBe(m.PRICE_FORMS.singlePack);
    expect(m.priceFormOf(SINGLE, '500 ml')).toBe(m.PRICE_FORMS.singlePack);
    expect(m.priceFormOf(SINGLE, '')).toBe(m.PRICE_FORMS.typed);
    expect(m.priceFormOf(SINGLE, 'sacco')).toBe(m.PRICE_FORMS.typed);
  });

  test('a carton priced 20 for 4 × 2.5 kg is stored per item: 5 a busta, a case of 4 pieces, 2.5 kg each', () => {
    const patch = m.pricePatch(m.formatPriceInput(CARTON(4), '2.5kg', { price: '20', vat: '' }), NOW, '2.5kg');
    expect([patch.priceUnit, patch.pricePerUnit, patch.caseItemUnit, patch.caseItemSize, patch.caseCount, patch.casePrice, patch.unitWeightKg])
      .toStrictEqual(['pcs', 5, 'pcs', null, 4, 20, 2.5]);
    expect(m.storedCaseOf(patch), 'the case stands on its own rate (casePrice ÷ count)').toBeTruthy();
    expect(m.pricePerKg(patch), 'and the per-kilo consumers still get 2 a kilo').toBe(2);
  });

  test('litres read 1:1 as kilos, grams as thousandths: 12 for 6 × 750 ml is 2 a bottle, 2.6667 a litre', () => {
    const patch = m.pricePatch(m.formatPriceInput(CARTON(6), '750ml', { price: '12', vat: '' }), NOW, '750ml');
    expect([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg]).toStrictEqual(['pcs', 2, 0.75]);
    expect(m.pricePerKg(patch)).toBe(2.6667);
    const grams = m.pricePatch(m.formatPriceInput(CARTON(4), '500g', { price: '20', vat: '' }), NOW, '500g');
    expect([grams.pricePerUnit, grams.unitWeightKg]).toStrictEqual([5, 0.5]);
  });

  test('a carton with no readable weight is a case of PIECES: a rate per piece, the piece weight kept', () => {
    const input = m.formatPriceInput(CARTON(50, 'pezzo'), '', { price: '20', pieceKg: '0.06', vat: '22' });
    const patch = m.pricePatch(input, NOW, '');
    expect([patch.priceUnit, patch.pricePerUnit, patch.caseItemUnit, patch.caseCount, patch.unitWeightKg, patch.vatRate])
      .toStrictEqual(['pcs', 0.4, 'pcs', 50, 0.06, 22]);
    // a readable weight wins over the piece-weight box
    const weighed = m.pricePatch(m.formatPriceInput(CARTON(50, 'pezzo'), '60g', { price: '20', pieceKg: '0.5', vat: '' }), NOW, '60g');
    expect(weighed.unitWeightKg).toBe(0.06);
  });

  test('defect 1: a single with a weight that reads keeps «a piece»: an egg at 0.25 with 60 g stays 0.25 a piece', () => {
    const patch = m.pricePatch(m.formatPriceInput(SINGLE, '60g', { price: '0.25', vat: '' }), NOW, '60g');
    expect([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg]).toStrictEqual(['pcs', 0.25, 0.06]);
    for (const key of CASE_KEYS) expect(at(patch, key), `${key} is written null`).toBe(null);
    expect(m.pricePerKg(patch), 'per kilo it is derived, never stored as the price').toBe(4.1667);
    expect(m.costState(patch).costable).toBe(true);
    // a packaging «vaschetta 500 ml» ends per piece as well
    const tub = m.pricePatch(m.formatPriceInput(SINGLE, '500ml', { price: '0.12', vat: '' }), NOW, '500ml');
    expect([tub.priceUnit, tub.pricePerUnit, tub.unitWeightKg]).toStrictEqual(['pcs', 0.12, 0.5]);
  });

  test('a single priced 20 for a 25 kg sack is 20 a piece weighing 25 kg — 0.80 a kilo through pricePerKg', () => {
    const patch = m.pricePatch(m.formatPriceInput(SINGLE, '25kg', { price: '20', vat: '' }), NOW, '25kg');
    expect([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg, patch.caseCount]).toStrictEqual(['pcs', 20, 25, null]);
    expect(m.pricePerKg(patch)).toBe(0.8);
  });

  test('a loose single keeps today\'s typed rate, exactly as it was', () => {
    const input = m.formatPriceInput(SINGLE, '', { rate: '7.2', unit: 'kg', pieceKg: '', vat: '' });
    const patch = m.pricePatch(input, NOW, '');
    expect([patch.priceUnit, patch.pricePerUnit, patch.caseCount]).toStrictEqual(['kg', 7.2, null]);
    const none = m.pricePatch(m.formatPriceInput(SINGLE, '', { rate: '', unit: null, vat: '' }), NOW, '');
    expect(none.pricePerUnit).toBe(null);
  });

  test('an empty carton count prices nothing (the card refuses the save before it gets here)', () => {
    const patch = m.pricePatch(m.formatPriceInput(CARTON(null), '2.5kg', { price: '20', vat: '' }), NOW, '2.5kg');
    expect(patch.pricePerUnit).toBe(null);
    expect(patch.caseCount).toBe(null);
  });

  // ── What the price box shows: the stored figure only while it still means the same thing ─────────

  test('priceBoxStart: a stored case in its own format shows its price; changed, it is EMPTY with the suggestion', () => {
    const pcsCase = { priceUnit: 'pcs', pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5 };
    expect(m.priceBoxStart(pcsCase, CARTON(4), '2.5kg', false)).toStrictEqual({ value: 20, suggestion: 20 });
    expect(m.priceBoxStart(pcsCase, CARTON(5), '2.5kg', true), 'the same price per item, five of them').toStrictEqual({ value: null, suggestion: 25 });
    expect(m.priceBoxStart(pcsCase, SINGLE, '2.5kg', true)).toStrictEqual({ value: null, suggestion: 5 });
  });

  test('priceBoxStart: a legacy per-kilo case carries its RATE to the new weight', () => {
    const packCase = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(m.priceBoxStart(packCase, CARTON(4), '2.5kg', false)).toStrictEqual({ value: 20, suggestion: 20 });
    expect(m.priceBoxStart(packCase, CARTON(4), '3kg', true), '2 a kilo × 3 kg × 4').toStrictEqual({ value: null, suggestion: 24 });
    expect(m.priceBoxStart(packCase, SINGLE, '2.5kg', false), 'a case of one has the case price ÷ count').toStrictEqual({ value: 5, suggestion: 5 });
    expect(m.priceBoxStart(packCase, CARTON(4), '', true), 'no weight, no suggestion').toStrictEqual({ value: null, suggestion: null });
  });

  test('priceBoxStart: with only a typed rate the box shows that rate carried over', () => {
    expect(m.priceBoxStart({ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(4), '2.5kg')).toStrictEqual({ value: 20, suggestion: 20 });
    expect(m.priceBoxStart({ priceUnit: 'kg', pricePerUnit: 2 }, SINGLE, '500g')).toStrictEqual({ value: 1, suggestion: 1 });
    expect(m.priceBoxStart({ priceUnit: 'pcs', pricePerUnit: 0.4 }, CARTON(50, 'pezzo'), '')).toStrictEqual({ value: 20, suggestion: 20 });
    expect(m.priceBoxStart({ priceUnit: 'pcs', pricePerUnit: 1.2 }, SINGLE, '500g')).toStrictEqual({ value: 1.2, suggestion: 1.2 });
    // nothing to carry: empty, never a guess
    const nothing: ReadonlyArray<readonly [unknown, unknown, string]> = [
      [{ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(null), '2.5kg'],
      [{}, CARTON(4), '2.5kg'],
      [null, CARTON(4), '2.5kg'],
      [{ priceUnit: 'kg', pricePerUnit: 2 }, SINGLE, ''],
      [{ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(4), ''],
    ];
    for (const [item, fmt, weight] of nothing) {
      expect(m.priceBoxStart(item, fmt as ported.PriceFormat, weight), JSON.stringify([item, fmt, weight])).toStrictEqual({ value: null, suggestion: null });
    }
  });

  test('a price carried to a new format is the same per-item price: typing the suggestion keeps the per-kilo rate', () => {
    const carried: ReadonlyArray<readonly [{ priceUnit: string; pricePerUnit: number }, ported.PriceFormat, string]> = [
      [{ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(4), '2.5kg'],
      [{ priceUnit: 'kg', pricePerUnit: 0.8 }, SINGLE, '25kg'],
      [{ priceUnit: 'l', pricePerUnit: 4 }, CARTON(6), '500ml'],
      [{ priceUnit: 'kg', pricePerUnit: 10 }, CARTON(12), '250 g'],
    ];
    for (const [item, fmt, weight] of carried) {
      const box = m.priceBoxStart(item, fmt, weight).suggestion;
      const patch = m.pricePatch(m.formatPriceInput(fmt, weight, { price: String(box), vat: '' }), NOW, weight);
      const perKg = m.pricePerKg(patch) as number;
      expect(Math.abs(perKg - item.pricePerUnit) < 1e-3, `${JSON.stringify(item)} ${weight}: ${perKg}`).toBe(true);
    }
  });

  test('a price document written verbatim by the untouched path equals the stored one, for any stored case', () => {
    for (const stored of [
      { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
      { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
      { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
      { priceUnit: 'l', pricePerUnit: 3.2, casePrice: 12.8, caseCount: 4, caseItemSize: 1, caseItemUnit: 'pack' },
      { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' },
      { priceUnit: 'pcs', pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5 },
      { priceUnit: 'pcs', pricePerUnit: 3.333333, casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' },
      { priceUnit: 'kg', pricePerUnit: 7.2 },
      { priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.05 },
    ]) {
      // whatever the weight says now — the stored case is its own authority
      for (const weight of ['2.5kg', '3kg', '', 'sacco']) {
        const patch = m.pricePatch(m.storedPriceInput(stored, ''), NOW, weight);
        for (const key of ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg']) {
          expect(at(patch, key) ?? null, `${key} (${JSON.stringify(stored)}, weight "${weight}")`).toBe(at(stored, key) ?? null);
        }
        expect(m.priceChanged(stored, patch)).toBe(false);
      }
    }
  });

  test('defect 6: a tiny rate retouched through the card writes no history entry — the stored price is verbatim', () => {
    // 0.0123 a kilo on a 250 g pack: a typed price (0.003075) would not survive four decimals; untouched, it never goes through one
    const stored = { priceUnit: 'kg', pricePerUnit: 0.0123 };
    const patch = m.pricePatch(m.storedPriceInput(stored, ''), NOW, '250g');
    expect(patch.pricePerUnit).toBe(0.0123);
    expect(m.priceChanged(stored, patch)).toBe(false);
  });

  test('a STALE case (a rate typed over it) is not written back: the stored rate is', () => {
    const stale = { priceUnit: 'kg', pricePerUnit: 3, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    const patch = m.pricePatch(m.storedPriceInput(stale, ''), NOW, '2.5kg');
    expect(patch.pricePerUnit).toBe(3);
    expect(patch.caseCount, 'and the dead case goes out as null, as every typed-rate save does').toBe(null);
  });

  test('only the VAT is read live on the untouched path', () => {
    const stored = { priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 };
    expect(m.pricePatch(m.storedPriceInput(stored, '10'), NOW, '').vatRate).toBe(10);
    expect(m.pricePatch(m.storedPriceInput(stored, ''), NOW, '').vatRate).toBe(null);
    expect(m.pricePatch(m.storedPriceInput(stored, '4'), NOW, '').priceUnit).toBe('kg');
  });

  test('a weight-priced case cannot be re-priced once its weight stops reading; pieces and empty boxes can', () => {
    const kgCase = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    const base = { item: kgCase, fmt: CARTON(4), weightText: 'sacco', dirty: true, priceBox: '22' };
    expect(m.weightNeededForPrice(base)).toBe(true);
    expect(m.weightNeededForPrice({ ...base, weightText: '2.5kg' }), 'a readable weight is fine').toBe(false);
    expect(m.weightNeededForPrice({ ...base, dirty: false }), 'untouched writes the stored case').toBe(false);
    expect(m.weightNeededForPrice({ ...base, priceBox: '' }), 'an emptied box is no price').toBe(false);
    expect(m.weightNeededForPrice({ ...base, fmt: SINGLE })).toBe(false);
    const pieces = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
    expect(m.weightNeededForPrice({ ...base, item: pieces })).toBe(false);
    expect(m.weightNeededForPrice({ ...base, item: { priceUnit: 'kg', pricePerUnit: 2 } }), 'a typed rate has no case to protect').toBe(false);
  });

  // ── 2nd deep review (1 Oct 2026): a Cartone turned into a Singola keeps the money ───────────────
  test('singleFromCaseInput: the same cost per item, in the per-item shape, with six decimals kept', () => {
    const pack = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    const a = m.pricePatch(m.singleFromCaseInput(pack, ''), NOW, '2.5kg');
    expect([a.priceUnit, a.pricePerUnit, a.unitWeightKg, a.caseCount, a.casePrice]).toStrictEqual(['pcs', 5, 2.5, null, null]);
    expect(m.pricePerKg(a), 'per kilo is unchanged').toBe(2);
    const grams = m.pricePatch(m.singleFromCaseInput({ priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' }, ''), NOW, '');
    expect([grams.pricePerUnit, grams.unitWeightKg]).toStrictEqual([5, 0.5]);
    const litres = m.pricePatch(m.singleFromCaseInput({ priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' }, ''), NOW, '');
    expect([litres.pricePerUnit, litres.unitWeightKg]).toStrictEqual([2, 0.5]);
    // a case of pieces keeps the piece weight the price already remembers, and an odd division keeps six decimals
    const odd = m.pricePatch(m.singleFromCaseInput({ priceUnit: 'pcs', pricePerUnit: 3.333333, casePrice: 10, caseCount: 3, caseItemUnit: 'pcs', unitWeightKg: 0.2 }, ''), NOW, '');
    expect([odd.pricePerUnit, odd.unitWeightKg]).toStrictEqual([3.333333, 0.2]);
    // no stored case: the stored price as it is
    expect(m.singleFromCaseInput({ priceUnit: 'kg', pricePerUnit: 7.2 }, '4')).toStrictEqual(m.storedPriceInput({ priceUnit: 'kg', pricePerUnit: 7.2 }, '4'));
  });

  test('a rate typed without keepRate is still rounded to four decimals (only the converter keeps six)', () => {
    expect(m.pricePatch({ priceUnit: 'pcs', pricePerUnit: 3.333333 }, NOW, '').pricePerUnit).toBe(3.3333);
  });

  // ── 3rd deep review (1 Oct 2026) ───────────────────────────────────────────

  test('ownPieceWeight: only a per-piece price whose piece weight is the weight tracks it', () => {
    const pcs = (uwk: number | undefined) => ({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: uwk });
    expect(m.ownPieceWeight(pcs(0.06), '60g'), 'what the new card writes').toBe(false);
    expect(m.ownPieceWeight(pcs(0.06), '0.06 kg')).toBe(false);
    expect(m.ownPieceWeight(pcs(0.06), '360g'), 'eggs: weight is the PACK').toBe(true);
    expect(m.ownPieceWeight({ priceUnit: 'pcs', pricePerUnit: 0.03, unitWeightKg: 0.002 }, '1kg'), 'gelatine').toBe(true);
    expect(m.ownPieceWeight(pcs(undefined), '500ml'), 'no piece weight: today\'s per-piece form').toBe(true);
    expect(m.ownPieceWeight(pcs(0.06), ''), 'nothing to compare with').toBe(true);
    // a weight EDITED later must not flip a tracking price: the weight it opened with decides
    expect(m.ownPieceWeight(pcs(0.06), '70g', '60g')).toBe(false);
    expect(m.ownPieceWeight(pcs(0.06), '400g', '360g')).toBe(true);
    // not a per-piece price, or a new item
    expect(m.ownPieceWeight({ priceUnit: 'kg', pricePerUnit: 2 }, '2.5kg')).toBe(false);
    expect(m.ownPieceWeight(null, '2.5kg')).toBe(false);
  });

  test('ownPiece keeps today\'s typed form and never writes the pack weight as the piece weight', () => {
    const single = { kind: 'single', count: null, inner: '' };
    expect(m.priceFormOf(single, '360g', true)).toBe(m.PRICE_FORMS.typed);
    expect(m.priceFormOf(CARTON(4, 'x'), '360g', true)).toBe(m.PRICE_FORMS.cartonPieces);
    const patch = m.pricePatch(m.formatPriceInput(single, '360g', { rate: '0.26', unit: 'pcs', pieceKg: '0.06', ownPiece: true, vat: '' }), NOW, '360g');
    expect([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg]).toStrictEqual(['pcs', 0.26, 0.06]);
    const carton = m.pricePatch(m.formatPriceInput(CARTON(4, 'x'), '360g', { price: '1', pieceKg: '0.06', ownPiece: true, vat: '' }), NOW, '360g');
    expect(carton.unitWeightKg).toBe(0.06);
  });

  test('3rd review 4: priceChanged compares the MONEY, not the stored representation', () => {
    const kg2 = { priceUnit: 'kg', pricePerUnit: 2 };
    // the same money in another shape: no change
    expect(m.priceChanged(kg2, { priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: 2.5 }), '2 a kilo is 5 for 2.5 kg').toBe(false);
    expect(m.priceChanged({ priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: 2.5 }, kg2)).toBe(false);
    expect(m.priceChanged({ priceUnit: 'pcs', pricePerUnit: 3.333333, unitWeightKg: 1 }, { priceUnit: 'pcs', pricePerUnit: 3.3333, unitWeightKg: 1 }), 'within rounding').toBe(false);
    expect(m.priceChanged(kg2, { priceUnit: 'l', pricePerUnit: 2 }), 'a litre is read as a kilo').toBe(false);
    // a real change in either dimension
    expect(m.priceChanged(kg2, { priceUnit: 'pcs', pricePerUnit: 6, unitWeightKg: 2.5 })).toBe(true);
    expect(m.priceChanged(kg2, { priceUnit: 'kg', pricePerUnit: 2.1 })).toBe(true);
    expect(m.priceChanged({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, { priceUnit: 'pcs', pricePerUnit: 0.26, unitWeightKg: 0.06 })).toBe(true);
    // a changed piece weight IS a change (the divisor of the cost per kilo), and so is one appearing
    expect(m.priceChanged({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.07 })).toBe(true);
    expect(m.priceChanged({ priceUnit: 'pcs', pricePerUnit: 0.25 }, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 })).toBe(true);
    // nothing to compare: the representation decides, as it always did
    expect(m.priceChanged(null, { priceUnit: 'kg', pricePerUnit: 2 })).toBe(true);
    expect(m.priceChanged({}, {})).toBe(false);
    expect(m.priceChanged({ priceUnit: 'pcs', pricePerUnit: 1 }, { priceUnit: 'pcs', pricePerUnit: 1.5 })).toBe(true);
    expect(m.priceChanged({ priceUnit: 'pcs', pricePerUnit: 1 }, { priceUnit: 'pcs', pricePerUnit: 1 })).toBe(false);
  });

  test('3rd review 5: a per-item price carried from a case keeps six decimals when the card writes it', () => {
    const single = { kind: 'single', count: null, inner: '' };
    const patch = m.pricePatch(m.formatPriceInput(single, '1kg', { price: '3.333333', vat: '' }), NOW, '1kg');
    expect(patch.pricePerUnit).toBe(3.333333);
  });

  // ── tests/price-basis.test.mjs: what the number in the price box REFERS to (7 Oct 2026) ─────────
  // A pack, a carton, or a price per kilo / litre. The choice is only a way of typing and showing one number
  // — the stored price keeps its shape — so these pin the conversions both ways, the round trip, the
  // defaults, that the choice never plants a history entry, and that the typed form has no selector.

  const single = SINGLE;
  const carton = CARTON;

  test('each form offers its own choices, default first; the typed form offers none', () => {
    expect(m.basisOptions(m.PRICE_FORMS.singlePack)).toStrictEqual(['pack', 'rate']);
    expect(m.basisOptions(m.PRICE_FORMS.cartonPack)).toStrictEqual(['case', 'pack', 'rate']);
    expect(m.basisOptions(m.PRICE_FORMS.cartonPieces)).toStrictEqual(['case', 'pack']);
    expect(m.basisOptions(m.PRICE_FORMS.typed)).toStrictEqual([]);
    expect(m.defaultBasis(m.PRICE_FORMS.singlePack)).toBe('pack');
    expect(m.defaultBasis(m.PRICE_FORMS.cartonPack)).toBe('case');
    expect(m.defaultBasis(m.PRICE_FORMS.cartonPieces)).toBe('case');
    expect(m.defaultBasis(m.PRICE_FORMS.typed)).toBe(null);
  });

  test('nothing stored means the default; a basis the form does not offer falls back to the default', () => {
    expect(m.basisOf(m.PRICE_FORMS.singlePack, null)).toBe('pack');
    expect(m.basisOf(m.PRICE_FORMS.singlePack, undefined)).toBe('pack');
    expect(m.basisOf(m.PRICE_FORMS.cartonPack, null)).toBe('case');
    expect(m.basisOf(m.PRICE_FORMS.singlePack, 'case')).toBe('pack');
    expect(m.basisOf(m.PRICE_FORMS.cartonPieces, 'rate')).toBe('case');
    expect(m.basisOf(m.PRICE_FORMS.typed, 'rate')).toBe(null);
    expect(m.basisOf(m.PRICE_FORMS.cartonPack, 'bogus')).toBe('case');
  });

  test('the default is stored as null (absent = default), a real choice as itself, a form with none as null', () => {
    expect(m.basisToStore(m.PRICE_FORMS.singlePack, 'pack')).toBe(null);
    expect(m.basisToStore(m.PRICE_FORMS.singlePack, null)).toBe(null);
    expect(m.basisToStore(m.PRICE_FORMS.singlePack, 'rate')).toBe('rate');
    expect(m.basisToStore(m.PRICE_FORMS.cartonPack, 'case')).toBe(null);
    expect(m.basisToStore(m.PRICE_FORMS.cartonPack, 'pack')).toBe('pack');
    expect(m.basisToStore(m.PRICE_FORMS.cartonPieces, 'pack')).toBe('pack');
    expect(m.basisToStore(m.PRICE_FORMS.typed, 'rate')).toBe(null);
  });

  test('«per kg» or «per litre» follows the weight', () => {
    expect(m.rateBaseOf('10 kg')).toBe('kg');
    expect(m.rateBaseOf('500 g')).toBe('kg');
    expect(m.rateBaseOf('0.75 l')).toBe('l');
    expect(m.rateBaseOf('750 ml')).toBe('l');
    expect(m.rateBaseOf('a bag')).toBe(null);
  });

  // ── The conversions, every form × basis ────────────────────────────────────
  test('Singola: per kilo × the pack size is the pack price; the pack basis passes through untouched', () => {
    const f = m.PRICE_FORMS.singlePack;
    expect(m.basisToStoredPrice(f, 'pack', 9.6, single, '10 kg')).toBe(9.6);
    expect(m.basisToStoredPrice(f, null, 9.6, single, '10 kg')).toBe(9.6);
    expect(m.basisToStoredPrice(f, 'rate', 0.96, single, '10 kg')).toBe(9.6);
    expect(m.basisToStoredPrice(f, 'rate', 3.37, single, '750 ml')).toBe(2.5275);
    expect(m.basisToStoredPrice(f, 'rate', 12, single, '500 g')).toBe(6);
  });

  test('Cartone with a readable weight: case, pack and per-kilo all land on the case price', () => {
    const f = m.PRICE_FORMS.cartonPack;
    const fmt = carton(6);
    expect(m.basisToStoredPrice(f, 'case', 30, fmt, '500 g')).toBe(30);
    expect(m.basisToStoredPrice(f, 'pack', 5, fmt, '500 g')).toBe(30);
    expect(m.basisToStoredPrice(f, 'rate', 10, fmt, '500 g')).toBe(30);
    expect(m.basisToStoredPrice(f, 'rate', 3.33, fmt, '1 kg')).toBe(19.98);
  });

  test('Cartone with no readable weight: case, or pack × count', () => {
    const f = m.PRICE_FORMS.cartonPieces;
    expect(m.basisToStoredPrice(f, 'case', 30, carton(6), '')).toBe(30);
    expect(m.basisToStoredPrice(f, 'pack', 5, carton(6), '')).toBe(30);
    expect(m.basisToStoredPrice(f, 'rate', 5, carton(6), ''), 'a basis this form lacks is the default: untouched').toBe(5);
  });

  test('an empty, zero or unreadable box behaves exactly as without a basis; a missing count refuses to guess', () => {
    const f = m.PRICE_FORMS.cartonPack;
    expect(m.basisToStoredPrice(f, 'pack', '', carton(6), '1 kg')).toBe('');
    expect(m.basisToStoredPrice(f, 'pack', 0, carton(6), '1 kg')).toBe(0);
    expect(m.basisToStoredPrice(f, 'pack', null, carton(6), '1 kg')).toBe(null);
    expect(m.basisToStoredPrice(f, 'pack', 5, carton(null), '1 kg')).toBe(null);
    expect(m.basisToStoredPrice(f, 'rate', 5, carton(NaN), '1 kg')).toBe(null);
  });

  test('and back: the stored price is shown in the chosen basis', () => {
    expect(m.storedPriceToBasis(m.PRICE_FORMS.singlePack, 'rate', 9.6, single, '10 kg')).toBe(0.96);
    expect(m.storedPriceToBasis(m.PRICE_FORMS.singlePack, 'pack', 9.6, single, '10 kg')).toBe(9.6);
    expect(m.storedPriceToBasis(m.PRICE_FORMS.cartonPack, 'pack', 30, carton(6), '500 g')).toBe(5);
    expect(m.storedPriceToBasis(m.PRICE_FORMS.cartonPack, 'rate', 30, carton(6), '500 g')).toBe(10);
    expect(m.storedPriceToBasis(m.PRICE_FORMS.cartonPack, 'case', 30, carton(6), '500 g')).toBe(30);
    expect(m.storedPriceToBasis(m.PRICE_FORMS.cartonPieces, 'pack', 30, carton(6), '')).toBe(5);
    expect(m.storedPriceToBasis(m.PRICE_FORMS.cartonPack, 'pack', 30, carton(null), '500 g')).toBe(null);
    expect(m.storedPriceToBasis(m.PRICE_FORMS.cartonPack, 'pack', null, carton(6), '500 g')).toBe(null);
  });

  test('switching the segment converts the number so the money does not move', () => {
    const f = m.PRICE_FORMS.cartonPack;
    const fmt = carton(6);
    expect(m.convertBasisPrice(f, 'case', 'pack', 30, fmt, '500 g')).toBe(5);
    expect(m.convertBasisPrice(f, 'case', 'rate', 30, fmt, '500 g')).toBe(10);
    expect(m.convertBasisPrice(f, 'rate', 'pack', 10, fmt, '500 g')).toBe(5);
    expect(m.convertBasisPrice(f, 'pack', 'case', 5, fmt, '500 g')).toBe(30);
    expect(m.convertBasisPrice(m.PRICE_FORMS.singlePack, 'pack', 'rate', 9.6, single, '10 kg')).toBe(0.96);
    expect(m.convertBasisPrice(m.PRICE_FORMS.singlePack, 'rate', 'pack', 0.96, single, '10 kg')).toBe(9.6);
    expect(m.convertBasisPrice(f, 'case', 'case', 30, fmt, '500 g')).toBe(30);
    expect(m.convertBasisPrice(f, 'case', 'pack', '', fmt, '500 g'), 'an empty box stays empty').toBe('');
    expect(m.convertBasisPrice(f, 'case', 'pack', 30, carton(null), '500 g'), 'no count: no guess').toBe(null);
  });

  // ── What is STORED never changes shape ─────────────────────────────────────
  function saved(fmt: ported.PriceFormat, weight: string, typed: number, basis: string | null, vat = 4): ported.PricePatch {
    return m.pricePatch(m.formatPriceInput(fmt, weight, { price: typed, basis, vat }), '2026-10-07T10:00:00.000Z', weight);
  }

  test('a Singola typed per kilo is stored as the same pack price a typed pack price would be', () => {
    const byRate = saved(single, '10 kg', 0.96, 'rate');
    const byPack = saved(single, '10 kg', 9.6, 'pack');
    expect(byRate).toStrictEqual(byPack);
    expect(byRate.priceUnit).toBe('pcs');
    expect(byRate.pricePerUnit).toBe(9.6);
    expect(byRate.unitWeightKg).toBe(10);
  });

  test('a Cartone typed per pack or per kilo is stored as the same case a typed case price would be', () => {
    const byCase = saved(carton(6), '500 g', 30, 'case');
    expect(saved(carton(6), '500 g', 5, 'pack')).toStrictEqual(byCase);
    expect(saved(carton(6), '500 g', 10, 'rate')).toStrictEqual(byCase);
    expect(byCase.casePrice).toBe(30);
    expect(byCase.caseCount).toBe(6);
    expect(byCase.caseItemUnit).toBe('pcs');
    expect(byCase.pricePerUnit).toBe(5);
    const pieces = saved(carton(6), '', 30, 'case');
    expect(saved(carton(6), '', 5, 'pack')).toStrictEqual(pieces);
    expect(pieces.casePrice).toBe(30);
  });

  test('an untouched ingredient (no basis) saves exactly as before', () => {
    const none = m.formatPriceInput(single, '10 kg', { price: 9.6, vat: 4 });
    expect(none).toStrictEqual(m.formatPriceInput(single, '10 kg', { price: 9.6, vat: 4, basis: 'pack' }));
    expect(m.formatPriceInput(carton(6), '500 g', { price: 30, vat: 4 }))
      .toStrictEqual(m.formatPriceInput(carton(6), '500 g', { price: 30, vat: 4, basis: 'case' }));
  });

  test('the typed form ignores a basis completely', () => {
    const box = { rate: 7.2, unit: 'kg', vat: 4 };
    expect(m.formatPriceInput(single, 'loose', { ...box, basis: 'rate' })).toStrictEqual(m.formatPriceInput(single, 'loose', box));
    expect(m.priceFormOf(single, 'loose')).toBe(m.PRICE_FORMS.typed);
  });

  // ── Round trip: type, save, reopen ─────────────────────────────────────────
  test('0.96 per kilo, saved, reopens as 0.96 per kilo (and as 9.6 per pack)', () => {
    const patch = saved(single, '10 kg', 0.96, 'rate');
    const item = { ...patch, priceBasis: 'rate' };
    const form = m.priceFormOf(single, '10 kg', false);
    const start = m.priceBoxStart(item, single, '10 kg', false);
    expect(m.storedPriceToBasis(form, m.basisOf(form, item.priceBasis), start.value, single, '10 kg')).toBe(0.96);
    expect(m.storedPriceToBasis(form, 'pack', start.value, single, '10 kg')).toBe(9.6);
  });

  test('round trip for a Cartone, in every basis it offers', () => {
    const fmt = carton(6);
    const form = m.priceFormOf(fmt, '500 g', false);
    for (const [basis, typed] of [['case', 30], ['pack', 5], ['rate', 10]] as const) {
      const patch = saved(fmt, '500 g', typed, basis);
      const start = m.priceBoxStart({ ...patch, priceBasis: basis }, fmt, '500 g', false);
      expect(m.storedPriceToBasis(form, basis, start.value, fmt, '500 g'), basis).toBe(typed);
    }
  });

  test('a rate typed with two decimals reads back unchanged for typical pack sizes', () => {
    const form = m.PRICE_FORMS.singlePack;
    for (const weight of ['10 kg', '2,5 kg', '500 g', '1 kg', '750 ml', '25 kg', '5 l']) {
      for (const typed of [0.96, 1.2, 3.37, 7.2, 12.5]) {
        const stored = m.basisToStoredPrice(form, 'rate', typed, single, weight);
        expect(m.storedPriceToBasis(form, 'rate', stored, single, weight), `${typed} per kg of ${weight}`).toBe(typed);
      }
    }
  });

  // ── History ────────────────────────────────────────────────────────────────
  test('a basis-only change keeps the stored money, so priceChanged is false and no history row is written', () => {
    const stored = saved(single, '10 kg', 9.6, 'pack');
    // Not dirty: the card feeds pricePatch the STORED price, whatever the segment says.
    const untouched = m.pricePatch(m.storedPriceInput(stored, 4), '2026-10-08T10:00:00.000Z', '10 kg');
    expect(m.priceChanged(stored, untouched)).toBe(false);
    // Re-typing the same money in another basis is the same money too.
    expect(m.priceChanged(stored, saved(single, '10 kg', 0.96, 'rate'))).toBe(false);
    // A different number is a change.
    expect(m.priceChanged(stored, saved(single, '10 kg', 0.97, 'rate'))).toBe(true);
  });

  // ── Where the choice lives ─────────────────────────────────────────────────
  test('priceBasis goes to the price document only, never the ingredient', () => {
    const { ingredient, price } = m.splitPriceFields({ name: 'Flour', pricePerUnit: 9.6, priceUnit: 'pcs', priceBasis: 'rate' });
    expect(price.priceBasis).toBe('rate');
    expect('priceBasis' in ingredient).toBe(false);
    expect('priceBasis' in m.splitPriceFields({ name: 'Flour' }).ingredient).toBe(false);
  });

  // His choice (7 Oct 2026): the box shows two decimals — three significant figures below one unit of money,
  // so packaging bought by the thousand is not distorted (review, 8 Oct 2026). Only the shown text is
  // rounded: the card keeps the exact figure behind it.
  test('the price box shows two decimals, three significant figures below 1, never a positive price as 0', () => {
    expect(m.shownPrice(m.convertBasisPrice(m.PRICE_FORMS.singlePack, 'pack', 'rate', 10, single, '2.27 kg'))).toBe(4.41);
    expect(m.shownPrice(9.6)).toBe(9.6);
    expect(m.shownPrice(1.005)).toBe(1.01);
    expect(m.shownPrice(3.333333)).toBe(3.33);
    expect(m.shownPrice(1)).toBe(1);
    expect(m.shownPrice(0.96)).toBe(0.96);
    expect(m.shownPrice(0.125), 'not 0.13').toBe(0.125);
    expect(m.shownPrice(0.012), 'not 0.01 (17% out)').toBe(0.012);
    expect(m.shownPrice(0.031293)).toBe(0.0313);
    expect(m.shownPrice(0.0085)).toBe(0.0085);
    expect(m.shownPrice(0.004), 'a real cost too small for pence is not shown as free').toBe(0.004);
    expect(m.shownPrice(0.0000001) as number > 0, 'never a free 0').toBe(true);
    expect(m.shownPrice('')).toBe('');
    expect(m.shownPrice(null)).toBe(null);
  });
});

// (The six tests of tests/pack-format.test.mjs that replay the card's untouched save are in
// pack-format.spec.ts, which runs each implementation's own price-model with its own pack-format.)

// ── keepPriceDate (F4, 20 Oct 2026) — the port ALONE ─────────────────────────
// ⚠️ MUST JOIN THE describe.each ABOVE once main (with PR #380, fix/price-date-only-with-money) is merged into
// this stack: js/price-model.js then exports keepPriceDate, the name check in price-model.spec.ts ('the port
// against the original') fails until its AHEAD list is emptied, and these tests run against both files.
// Until then the original has nothing to compare with, so they pin the port against the tests PR #380 wrote
// (tests/price-model.test.mjs on that branch).
//
// The invoice import keeps an invoice's price only when the invoice is NEWER than the price's date, so a
// rename that re-dated an old price as today would silently stop every older-dated invoice from updating it.

describe('keepPriceDate (F4 — port only until PR #380 reaches this stack)', () => {
  const m = ported;
  const INVOICE_DAY = '2026-09-01T12:00:00.000Z';

  test('a rename keeps the date of the price in force', () => {
    const before = { name: 'Flour', priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null, priceUpdatedAt: INVOICE_DAY };
    const patch = m.keepPriceDate(before, m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT));
    expect(patch.priceUpdatedAt).toBe(INVOICE_DAY);
    expect(patch.pricePerUnit).toBe(7.2);
  });

  test('the same money written another way keeps the date', () => {
    // «7.20 a kilo» re-typed as a 25 kg sack at 180: the same cost per kilo, no history entry, no new date.
    const before = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null, priceUpdatedAt: INVOICE_DAY };
    const patch = m.keepPriceDate(before,
      m.pricePatch({ priceUnit: 'case', casePrice: 180, caseCount: 1, caseItemSize: 25, caseItemUnit: 'kg' }, AT));
    expect(m.priceChanged(before, patch)).toBe(false);
    expect(patch.priceUpdatedAt).toBe(INVOICE_DAY);
  });

  test('a new price takes today as its date', () => {
    const before = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null, priceUpdatedAt: INVOICE_DAY };
    expect(m.keepPriceDate(before, m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.6 }, AT)).priceUpdatedAt).toBe(AT);
  });

  test('a changed piece weight is a new price, with a new date', () => {
    const before = { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06, priceUpdatedAt: INVOICE_DAY };
    expect(m.keepPriceDate(before, m.pricePatch({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.07 }, AT)).priceUpdatedAt).toBe(AT);
  });

  test('a first price, or a stored price with no date, takes today', () => {
    const first = m.pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
    expect(m.keepPriceDate(null, first).priceUpdatedAt).toBe(AT);
    expect(m.keepPriceDate({ name: 'Flour' }, first).priceUpdatedAt).toBe(AT);
    expect(m.keepPriceDate({ name: 'Flour', priceUpdatedAt: INVOICE_DAY }, first).priceUpdatedAt).toBe(AT);
    const undated = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null, priceUpdatedAt: null };
    expect(m.keepPriceDate(undated, first).priceUpdatedAt).toBe(AT);
  });

  test('a removed price still clears its date', () => {
    const before = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null, priceUpdatedAt: INVOICE_DAY };
    const patch = m.keepPriceDate(before, m.pricePatch({ priceUnit: null, pricePerUnit: null }, AT));
    expect(patch.pricePerUnit).toBe(null);
    expect(patch.priceUpdatedAt).toBe(null);
  });

  test('an employee save (no price keys) is left as it is', () => {
    expect(m.keepPriceDate({ priceUpdatedAt: INVOICE_DAY }, {})).toStrictEqual({});
  });
});
