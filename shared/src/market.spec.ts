// Unit tests for the country of a venue: the language a label is printed in, and what the money is
// counted in (P15 — the owner cannot read code, so these tests are the safety net), run against BOTH
// implementations: the TypeScript port in shared/ and js/market.js, which the live app uses today.
// Ported from tests/market.test.mjs; the two must stay equal until the switch to Mise 2.
//
// market.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also holds the label
// vocabulary (labelWord, allergenWordIt, nutrientWordIt, allergenName, allergenGroupName,
// allergenGroupCodes, nutrientName), which comes with the labels (step 3d of the plan). The last
// block of this file stands in for what pairing would have checked: the same names, the same
// constants, the same frozen-ness, the same function shapes.
//
// PORTED: the 9 tests that exercise the country, the output language and the money — everything
// that calls countryOf, outputLanguage, canPrintLabel, currencyOf, moneyLayoutOf, COUNTRIES,
// CURRENCY_COUNTRIES or MONEY_LAYOUT_COUNTRIES and nothing else.
//
// NOT PORTED (they belong to the label vocabulary, or read source as text, or need the dictionary):
//   * 'and it says what to do about it rather than what is wrong', 'the screen admits it cannot
//     translate the ingredient names', 'the label screen still explains itself, from the dictionary,
//     in both languages', 'both country phrases exist in both dictionaries' — the dictionary.
//   * 'the label vocabulary exists in both languages', 'an unknown language falls back to English
//     rather than to nothing', 'every allergen code has an Italian name', 'the Italian names are not
//     the English ones left untranslated', 'the cereal and the nut are named, not the category', 'a
//     code nobody recognises has no Italian word…', 'every nutrient row has an Italian name', 'salt
//     is salt, and saturates say what they are of', 'every group the law names answers in both
//     languages', 'a group of one is named by its own word…', 'only the two collections list their
//     specific codes' — labelWord, allergenWordIt, nutrientWordIt, allergenGroupName and
//     allergenGroupCodes are not here.
//   * 'the server refuses to create a business without a country', 'the screen asks for it…', 'no
//     country is pre-selected on the form', 'the label screen refuses when the country is unknown…',
//     'the copied text is in the same language as the label on screen', 'the sentence names the
//     label's OWN language…', 'the three buttons above the label carry keys, not words', 'no label
//     file uses a group heading' — they read functions/ and js/ files as text.
//   * 'js/market.js holds words, never sentences' and 'that check can actually see a sentence in a
//     file' — they read js/market.js as text.

import { describe, expect, test } from 'vitest';
import * as ported from './market';
import * as legacyJs from '../../js/market.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── The unknown country ────────────────────────────────────────────────────

  // ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. Falling back to English is the
  // tempting default — every venue in production today is in the UK — and it is
  // exactly the wrong direction: in an Italian bakery an English allergen label is
  // not "a bit off", it is non-compliant, and it would be produced silently.
  test('an unknown country produces NO label, and never quietly an English one', () => {
    for (const bad of [null, undefined, {}, { country: '' }, { country: 'FR' },
      { country: 'gb' }, { country: ' GB' }, { country: 'GB ' }, { country: 42 }, { country: true }]) {
      expect(m.countryOf(bad), JSON.stringify(bad)).toBe(null);
      expect(m.outputLanguage(bad), JSON.stringify(bad)).toBe(null);
      expect(m.canPrintLabel(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  // ── The two countries ──────────────────────────────────────────────────────

  test('only the United Kingdom and Italy, for now', () => {
    expect([...m.COUNTRIES]).toStrictEqual(['GB', 'IT']);
  });

  test('the country decides the language, and there is one answer each', () => {
    expect(m.outputLanguage({ country: 'GB' })).toBe('en');
    expect(m.outputLanguage({ country: 'IT' })).toBe('it');
    expect(m.canPrintLabel({ country: 'GB' })).toBe(true);
    expect(m.canPrintLabel({ country: 'IT' })).toBe(true);
  });

  // ⚠️ FEDERICO'S OWN CASE, AND THE REASON THE TWO LANGUAGES ARE SEPARATE. He is
  // Italian, his bakeries are in England. Nothing in this module takes a person's
  // preference — it only ever reads the location — so an Italian interface cannot
  // reach an English label.
  test('the language comes from the LOCATION and from nothing else', () => {
    const uk = { country: 'GB', language: 'it', name: 'The Italian Club Bakery' };
    expect(m.outputLanguage(uk), 'an Italian interface must not change what the label prints').toBe('en');
    expect(m.countryOf(uk)).toBe('GB');

    const italy = { country: 'IT', language: 'en' };
    expect(m.outputLanguage(italy)).toBe('it');
    expect(m.countryOf(italy)).toBe('IT');
  });

  // ── What the money is counted in ───────────────────────────────────────────
  //
  // Federico, 23 Aug 2026, looking at Panificio Miano on his own phone: every price
  // said «£». The venue is in Italy and the ten prices in it were typed in euros, so
  // the app was mislabelling money it had been given correctly.

  test('⚠️ the currency follows the COUNTRY — euros in Italy, pounds in the UK', () => {
    expect(m.currencyOf({ country: 'IT' })).toBe('€');
    expect(m.currencyOf({ country: 'GB' })).toBe('£');
  });

  // ⚠️⚠️ THE INTERFACE LANGUAGE MUST NOT REACH THIS ANSWER. An English-speaking
  // employee at an Italian bakery switches the app to English and the flour still costs
  // euros. The venue's own `language` field is present in all four cases below and must
  // change nothing at all — if it ever does, this fails in both directions at once.
  test('⚠️⚠️ the app’s language cannot move the currency', () => {
    expect(m.currencyOf({ country: 'IT', language: 'en' }),
      'an Italian venue read in English is still counted in euros').toBe('€');
    expect(m.currencyOf({ country: 'IT', language: 'it' })).toBe('€');
    expect(m.currencyOf({ country: 'GB', language: 'it' }),
      'a UK venue read in Italian is still counted in pounds').toBe('£');
    expect(m.currencyOf({ country: 'GB', language: 'en' })).toBe('£');
  });

  // ⚠️ A COUNTRY ADDED WITHOUT A CURRENCY WOULD PRINT POUNDS IN SILENCE, because
  // currency.ts falls back rather than blanking the price line — the right choice
  // for money and the wrong one to rely on. This is the check that makes the fallback
  // unreachable for any country the app actually claims to support.
  test('⚠️ every country the app supports has a currency of its own', () => {
    expect([...m.CURRENCY_COUNTRIES].sort(), 'COUNTRIES and the currency table must hold exactly the same countries')
      .toStrictEqual([...m.COUNTRIES].sort());
    for (const country of m.COUNTRIES) {
      const symbol = m.currencyOf({ country });
      expect(typeof symbol === 'string' && symbol.length > 0,
        `${country} has no currency — it would silently fall back to pounds`).toBe(true);
    }
  });

  // The same direction as outputLanguage(): the model says "I do not know" rather than
  // guessing. What the APP does with that null is a separate decision, written down in
  // currency.ts — and it deliberately differs from the label's, because a mislabelled
  // price computes correctly while a mislabelled allergen does not.
  test('an unknown country has no currency, and says so', () => {
    for (const location of [null, undefined, {}, { country: 'FR' }, { country: '' }]) {
      expect(m.currencyOf(location)).toBe(null);
    }
  });

  // ── How an amount is written (4 Oct 2026: «sistema anche i prezzi in formato italiano») ──
  // Same rule as the symbol: the COUNTRY decides, the screen language never does.
  test('the money layout follows the country, and every country has one', () => {
    expect([...m.MONEY_LAYOUT_COUNTRIES].sort(), 'COUNTRIES and the money layout table must hold exactly the same countries')
      .toStrictEqual([...m.COUNTRIES].sort());
    expect({ ...m.moneyLayoutOf({ country: 'IT', language: 'en' }) },
      'an Italian venue read in English still writes 1.234,56 €')
      .toStrictEqual({ decimal: ',', group: '.', symbolAfter: true });
    expect({ ...m.moneyLayoutOf({ country: 'GB', language: 'it' }) },
      'a UK venue keeps the layout it always had')
      .toStrictEqual({ decimal: '.', group: '', symbolAfter: false });
    expect(m.moneyLayoutOf({})).toBe(null);
    expect(m.moneyLayoutOf(null)).toBe(null);
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/market.test.mjs: the tables are frozen, and a layout is one shared object.

  test('the layouts are frozen, so a screen cannot change a country’s way of writing money', () => {
    for (const country of m.COUNTRIES) {
      const layout = m.moneyLayoutOf({ country });
      expect(Object.isFrozen(layout), country).toBe(true);
      expect(m.moneyLayoutOf({ country }), `${country}: the same object every time`).toBe(layout);
    }
  });

  test('a location that is not an object has no country', () => {
    for (const bad of [0, 1, '', 'GB', 'IT', true, false, NaN, [], ['GB'], () => 'GB']) {
      expect(m.countryOf(bad), String(bad)).toBe(null);
    }
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The label vocabulary, which comes with step 3d (the labels).
  const LEFT_OUT = [
    'labelWord', 'allergenWordIt', 'nutrientWordIt', 'allergenName', 'allergenGroupName', 'allergenGroupCodes',
    'nutrientName',
  ];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports the seven label functions this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the same names, except those seven', () => {
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
