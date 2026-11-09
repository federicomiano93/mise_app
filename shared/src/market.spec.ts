// Unit tests for the country of a venue: the language a label is printed in, and what the money is
// counted in (P15 — the owner cannot read code, so these tests are the safety net), run against BOTH
// implementations: the TypeScript port in shared/ and js/market.js, which the live app uses today.
// Ported from tests/market.test.mjs; the two must stay equal until the switch to Mise 2.
//
// market.ts is a FULL port, so parity.spec.ts pairs it with js/market.js (names, constants, frozen-ness,
// function shapes). odd-inputs.spec.ts feeds both files the same strange locations, codes and languages.
//
// PORTED: every test of tests/market.test.mjs that calls the country, the output language, the money or the
// label vocabulary (labelWord, allergenWordIt, nutrientWordIt, allergenGroupName, allergenGroupCodes).
//
// NOT PORTED (they read the dictionary or source text, which belong to the app and the guards):
//   * 'and it says what to do about it rather than what is wrong', 'the screen admits it cannot
//     translate the ingredient names', 'the label screen still explains itself, from the dictionary,
//     in both languages', 'both country phrases exist in both dictionaries' — the dictionary: the app
//     slice of step 3d-2 checks its own typed messages.
//   * 'the server refuses to create a business without a country', 'the screen asks for it…', 'no
//     country is pre-selected on the form', 'the label screen refuses when the country is unknown…',
//     'the copied text is in the same language as the label on screen', 'the sentence names the
//     label's OWN language…', 'the three buttons above the label carry keys, not words' — they read
//     functions/ and js/ files as text. The two about the label MODEL's own text are in
//     recipe-label-model.spec.ts and label-separation.spec.ts.
//   * 'js/market.js holds words, never sentences' and 'that check can actually see a sentence in a
//     file' — they read js/market.js as text (label-separation.spec.ts holds the same guard for market.ts).
//   * 'no label file uses a group heading' — label-separation.spec.ts, for the TypeScript files.

import { describe, expect, test } from 'vitest';
import * as ported from './market';
import { ALLERGEN_CODES, ALLERGEN_GROUPS, NUTRIENT_KEYS, NUTRIENTS, allergenLabel } from './allergen-model';
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

  // ── The words ──────────────────────────────────────────────────────────────

  test('the label vocabulary exists in both languages', () => {
    const WORDS = ['contains', 'mayContain', 'ingredients', 'nutrition', 'typicalValues', 'per100g'] as const;
    for (const key of WORDS) {
      expect(m.labelWord(key, 'en'), `en ${key} is missing`).toBeTruthy();
      expect(m.labelWord(key, 'it'), `it ${key} is missing`).toBeTruthy();
    }
    expect(m.labelWord('contains', 'it')).toBe('Contiene');
    expect(m.labelWord('mayContain', 'it')).toBe('Può contenere');
    expect(m.labelWord('nutrition', 'it')).toBe('Valori nutrizionali');

    // Everything except the unit must actually differ — an untranslated heading is
    // the same silent failure as an untranslated allergen, one line higher up.
    const untranslated = WORDS
      .filter(k => k !== 'per100g')
      .filter(k => m.labelWord(k, 'en') === m.labelWord(k, 'it'));
    expect(untranslated).toStrictEqual([]);
    // ⚠️ And the unit is deliberately identical: "per 100 g" is written the same
    // way in both, so a test demanding a difference would force an invention.
    expect(m.labelWord('per100g', 'it')).toBe(m.labelWord('per100g', 'en'));
  });

  test('an unknown language falls back to English rather than to nothing', () => {
    // ⚠️ A DIFFERENT DIRECTION FROM THE COUNTRY, on purpose. The country decides
    // whether a label may be printed AT ALL, so doubt there must stop everything.
    // By the time a word is being looked up the country has already been checked,
    // and an empty heading on an otherwise correct label helps nobody.
    expect(m.labelWord('contains', 'de')).toBe('Contains');
    expect(m.labelWord('contains', undefined)).toBe('Contains');
    expect(m.labelWord('nonsense', 'en')).toBe('');
  });

  // ── The fourteen, in Italian ───────────────────────────────────────────────

  // ⚠️ EVERY CODE MUST HAVE AN ITALIAN WORD. A missing one prints an empty name in
  // a list of allergens — the single most dangerous blank in this app, because the
  // line still LOOKS like a complete declaration.
  test('every allergen code has an Italian name', () => {
    const missing = ALLERGEN_CODES.filter(code => !m.allergenWordIt(code));
    expect(missing, 'these codes would print blank on an Italian label').toStrictEqual([]);
  });

  // ⚠️ THE EXCEPTION IS NAMED, NOT THE RULE LOOSENED. This check went red on
  // 'gluten-kamut' and the code was right: KAMUT is a registered trademark for
  // khorasan wheat and is the same word on an Italian label. Widening the test to
  // "some may be identical" would have let a genuinely forgotten translation
  // through; listing the one word that does not translate keeps every other code
  // honest.
  test('the Italian names are not the English ones left untranslated', () => {
    const SAME_IN_BOTH = ['gluten-kamut'];
    const same = ALLERGEN_CODES
      .filter(code => m.allergenWordIt(code) === allergenLabel(code))
      .filter(code => !SAME_IN_BOTH.includes(code));
    expect(same, 'these look copied rather than translated').toStrictEqual([]);
  });

  // ⚠️ THE SPECIFIC CEREAL AND THE SPECIFIC NUT, in Italian too. A label reading
  // "Contiene: frutta a guscio" is not compliant and is useless to somebody who can
  // eat mandorle but not nocciole.
  test('the cereal and the nut are named, not the category', () => {
    expect(m.allergenWordIt('gluten-wheat')).toBe('Grano');
    expect(m.allergenWordIt('nuts-hazelnut')).toBe('Nocciole');
    expect(m.allergenWordIt('nuts-almond')).toBe('Mandorle');
    // Peanuts are a legume and their own group, in both languages.
    expect(m.allergenWordIt('peanuts')).toBe('Arachidi');
  });

  test('a code nobody recognises has no Italian word, rather than a guessed one', () => {
    for (const bad of ['gluten', 'nuts', 'unknown', '', null, undefined]) {
      expect(m.allergenWordIt(bad), String(bad)).toBe('');
    }
  });

  // ── The nutrition table, in Italian ────────────────────────────────────────

  test('every nutrient row has an Italian name', () => {
    const missing = NUTRIENT_KEYS.filter(key => !m.nutrientWordIt(key));
    expect(missing, 'these rows would print blank on an Italian label').toStrictEqual([]);
  });

  test('salt is salt, and saturates say what they are of', () => {
    // ⚠️ SALE, NOT SODIO — the regulation asks for salt, and the two differ by 2.5x.
    expect(m.nutrientWordIt('salt')).toBe('Sale');
    expect(m.nutrientWordIt('saturates')).toBe('di cui acidi grassi saturi');
    expect(m.nutrientWordIt('sugars')).toBe('di cui zuccheri');
    // Energy is one word for two rows, as in English: kJ and kcal are both printed.
    expect(m.nutrientWordIt('kj')).toBe(m.nutrientWordIt('kcal'));
  });

  // ── The fourteen groups, for the law card on the allergen sheet ────────────

  test('every group the law names answers in both languages', () => {
    for (const group of ALLERGEN_GROUPS) {
      for (const lang of ['en', 'it']) {
        const name = m.allergenGroupName(group, lang);
        expect(name && name.length > 1, `${group} has no ${lang} name`).toBe(true);
      }
    }
    // Fourteen groups, not twenty-six: this is the list the law asks about, and the
    // specific cereals and nuts sit INSIDE two of them.
    expect(ALLERGEN_GROUPS.length).toBe(14);
  });

  // ⚠️ THE TWELVE UNSUBDIVIDED GROUPS ARE NAMED BY THEIR OWN ALLERGEN WORD, DERIVED.
  // Writing all fourteen headings out by hand would be the second list market.js
  // exists to avoid, and the thing the two copies would disagree about is what is in
  // somebody's food. A code added to allergen-model must need nothing here.
  test('a group of one is named by its own word, in the country language', () => {
    expect(m.allergenGroupName('milk', 'en')).toBe('Milk');
    expect(m.allergenGroupName('milk', 'it')).toBe('Latte');
    expect(m.allergenGroupName('celery', 'it')).toBe('Sedano');
    // Only the two collections carry a written heading.
    expect(m.allergenGroupName('gluten', 'en')).toBe('Cereals containing gluten');
    expect(m.allergenGroupName('gluten', 'it')).toBe('Cereali contenenti glutine');
    expect(m.allergenGroupName('nuts', 'it')).toBe('Frutta a guscio');
    // An unknown group answers empty rather than inventing a heading.
    expect(m.allergenGroupName('nonsense', 'en')).toBe('');
  });

  test('only the two collections list their specific codes', () => {
    expect(m.allergenGroupCodes('milk', 'en')).toStrictEqual([]);
    expect(m.allergenGroupCodes('celery', 'it')).toStrictEqual([]);
    expect(m.allergenGroupCodes('gluten', 'en').length).toBe(6);
    expect(m.allergenGroupCodes('nuts', 'en').length).toBe(8);
    expect(m.allergenGroupCodes('gluten', 'it')).toContain('Grano');
    expect(m.allergenGroupCodes('nuts', 'it')).toContain('Nocciole');
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/market.test.mjs: allergenName and nutrientName (the two functions every label calls),
  // the fallbacks that keep a name from ever being blank, the frozen tables.

  // ⚠️ THE FALLBACK IS THE ENGLISH WORD, NOT A BLANK.
  test('allergenName: the country’s word, and the English one when there is no other', () => {
    expect(m.allergenName('nuts-hazelnut', 'it')).toBe('Nocciole');
    expect(m.allergenName('nuts-hazelnut', 'en')).toBe('Hazelnut');
    expect(m.allergenName('gluten-kamut', 'it')).toBe('Kamut');
    for (const lang of ['de', undefined, null, 'IT', '']) {
      expect(m.allergenName('milk', lang), String(lang)).toBe('Milk');
    }
    // A code nobody recognises is blank (and the label model drops such codes before they get here).
    expect(m.allergenName('unicorn', 'it')).toBe('');
    expect(m.allergenName('unicorn', 'en')).toBe('');
    for (const code of ALLERGEN_CODES) {
      expect(m.allergenName(code, 'it'), `${code} would print blank on an Italian label`).not.toBe('');
      expect(m.allergenName(code, 'en'), `${code} would print blank on an English label`).toBe(allergenLabel(code));
    }
  });

  test('nutrientName: the country’s word, the English label otherwise, blank only for no nutrient at all', () => {
    const salt = NUTRIENTS.find(n => n.key === 'salt');
    const kj = NUTRIENTS.find(n => n.key === 'kj');
    expect(m.nutrientName(salt, 'it')).toBe('Sale');
    expect(m.nutrientName(salt, 'en')).toBe('Salt');
    expect(m.nutrientName(kj, 'it')).toBe('Energia');
    expect(m.nutrientName(kj, 'de')).toBe('Energy');
    expect(m.nutrientName({ key: 'zinc', label: 'Zinc' }, 'it'), 'no Italian word: the English label').toBe('Zinc');
    for (const none of [null, undefined]) expect(m.nutrientName(none, 'it')).toBe('');
  });

  test('the label words for the full label and the supplier message exist in both languages', () => {
    for (const key of ['noneOfThe14', 'netWeight', 'useBy', 'bestBefore', 'storage', 'orderTitle', 'orderFileWord',
      'deletedIngredient', 'emailSubject'] as const) {
      expect(m.labelWord(key, 'en'), `en ${key}`).toBeTruthy();
      expect(m.labelWord(key, 'it'), `it ${key}`).toBeTruthy();
      expect(m.labelWord(key, 'en'), `${key} must be translated`).not.toBe(m.labelWord(key, 'it'));
    }
    // «Use by» and «best before» are two statements in each language, never one.
    expect(m.labelWord('useBy', 'it')).not.toBe(m.labelWord('bestBefore', 'it'));
    expect(m.labelWord('emailSubject', 'it')).toContain('{name}');
  });

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
