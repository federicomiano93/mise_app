// Which country a venue sells in, and therefore what language its labels must be
// printed in.
//
// ⚠️⚠️ THIS IS THE ONE PART OF THE LANGUAGE WORK THAT CAN HURT SOMEBODY. Getting
// the interface wrong is an annoyance; getting a label wrong is a person in
// hospital and, in both the UK and Italy, an offence. So almost every test below
// is the same assertion from a different direction: an answer this module is not
// sure of must come out as "I do not know", never as English.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRIES,
  countryOf,
  outputLanguage,
  canPrintLabel,
  labelWord,
  allergenWordIt,
  nutrientWordIt,
  allergenGroupName,
  allergenGroupCodes,
} from '../js/market.js';
import { ALLERGEN_CODES, ALLERGEN_GROUPS, NUTRIENT_KEYS, allergenLabel } from '../js/allergen-model.js';
import { _dictionaries } from '../js/i18n.js';
import { stringsIn } from './helpers/strings-in.mjs';

// ── The unknown country ─────────────────────────────────────────────────────

// ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. Falling back to English is the
// tempting default — every venue in production today is in the UK — and it is
// exactly the wrong direction: in an Italian bakery an English allergen label is
// not "a bit off", it is non-compliant, and it would be produced silently.
test('an unknown country produces NO label, and never quietly an English one', () => {
  for (const bad of [null, undefined, {}, { country: '' }, { country: 'FR' },
    { country: 'gb' }, { country: ' GB' }, { country: 'GB ' }, { country: 42 }, { country: true }]) {
    assert.equal(countryOf(bad), null, JSON.stringify(bad));
    assert.equal(outputLanguage(bad), null, JSON.stringify(bad));
    assert.equal(canPrintLabel(bad), false, JSON.stringify(bad));
  }
});

// ⚠️ THE SENTENCE MOVED, THE PROPERTY DID NOT. It used to be noCountryReason() in
// js/market.js, in fixed English; it is `label.blocked.noCountry` in the dictionary
// since 23 Aug 2026, because it is addressed to whoever is holding the phone. What
// it must SAY is unchanged and is still asserted — in both languages, which the
// English-only version could not be.
test('and it says what to do about it rather than what is broken', () => {
  const dict = _dictionaries();
  const en = dict.en['label.blocked.noCountry'];
  assert.match(en, /which country/, 'it names the missing fact');
  assert.match(en, /owner/, 'and who can supply it');
  for (const lang of ['en', 'it']) {
    const reason = dict[lang]['label.blocked.noCountry'];
    assert.ok(reason && reason.length > 40, `${lang} has no reason to show`);
    assert.doesNotMatch(reason, /error|invalid|failed|errore|non valido/i,
      'a missing setting is not a fault');
  }
});


// ── The two countries ───────────────────────────────────────────────────────

test('only the United Kingdom and Italy, for now', () => {
  assert.deepEqual([...COUNTRIES], ['GB', 'IT']);
});

test('the country decides the language, and there is one answer each', () => {
  assert.equal(outputLanguage({ country: 'GB' }), 'en');
  assert.equal(outputLanguage({ country: 'IT' }), 'it');
  assert.equal(canPrintLabel({ country: 'GB' }), true);
  assert.equal(canPrintLabel({ country: 'IT' }), true);
});

// ⚠️ FEDERICO'S OWN CASE, AND THE REASON THE TWO LANGUAGES ARE SEPARATE. He is
// Italian, his bakeries are in England. Nothing in this module takes a person's
// preference — it only ever reads the location — so an Italian interface cannot
// reach an English label.
test('the language comes from the LOCATION and from nothing else', () => {
  const uk = { country: 'GB', language: 'it', name: 'The Italian Club Bakery' };
  assert.equal(outputLanguage(uk), 'en',
    'an Italian interface must not change what the label prints');
  assert.equal(countryOf(uk), 'GB');

  const italy = { country: 'IT', language: 'en' };
  assert.equal(outputLanguage(italy), 'it');
  assert.equal(countryOf(italy), 'IT');
});

// ── The words ───────────────────────────────────────────────────────────────

test('the label vocabulary exists in both languages', () => {
  const WORDS = ['contains', 'mayContain', 'ingredients', 'nutrition', 'typicalValues', 'per100g'];
  for (const key of WORDS) {
    assert.ok(labelWord(key, 'en'), `en ${key} is missing`);
    assert.ok(labelWord(key, 'it'), `it ${key} is missing`);
  }
  assert.equal(labelWord('contains', 'it'), 'Contiene');
  assert.equal(labelWord('mayContain', 'it'), 'Può contenere');
  assert.equal(labelWord('nutrition', 'it'), 'Valori nutrizionali');

  // Everything except the unit must actually differ — an untranslated heading is
  // the same silent failure as an untranslated allergen, one line higher up.
  const untranslated = WORDS
    .filter(k => k !== 'per100g')
    .filter(k => labelWord(k, 'en') === labelWord(k, 'it'));
  assert.deepEqual(untranslated, []);
  // ⚠️ And the unit is deliberately identical: "per 100 g" is written the same
  // way in both, so a test demanding a difference would force an invention.
  assert.equal(labelWord('per100g', 'it'), labelWord('per100g', 'en'));
});

test('an unknown language falls back to English rather than to nothing', () => {
  // ⚠️ A DIFFERENT DIRECTION FROM THE COUNTRY, on purpose. The country decides
  // whether a label may be printed AT ALL, so doubt there must stop everything.
  // By the time a word is being looked up the country has already been checked,
  // and an empty heading on an otherwise correct label helps nobody.
  assert.equal(labelWord('contains', 'de'), 'Contains');
  assert.equal(labelWord('contains', undefined), 'Contains');
  assert.equal(labelWord('nonsense', 'en'), '');
});

// ── The fourteen, in Italian ────────────────────────────────────────────────

// ⚠️ EVERY CODE MUST HAVE AN ITALIAN WORD. A missing one prints an empty name in
// a list of allergens — the single most dangerous blank in this app, because the
// line still LOOKS like a complete declaration.
test('every allergen code has an Italian name', () => {
  const missing = ALLERGEN_CODES.filter(code => !allergenWordIt(code));
  assert.deepEqual(missing, [], 'these codes would print blank on an Italian label');
});

// ⚠️ THE EXCEPTION IS NAMED, NOT THE RULE LOOSENED. This check went red on
// 'gluten-kamut' and the code was right: KAMUT is a registered trademark for
// khorasan wheat and is the same word on an Italian label. Widening the test to
// "some may be identical" would have let a genuinely forgotten translation
// through; listing the one word that does not translate keeps every other code
// honest.
const SAME_IN_BOTH = ['gluten-kamut'];

test('the Italian names are not the English ones left untranslated', () => {
  const same = ALLERGEN_CODES
    .filter(code => allergenWordIt(code) === allergenLabel(code))
    .filter(code => !SAME_IN_BOTH.includes(code));
  assert.deepEqual(same, [], 'these look copied rather than translated');
});

// ⚠️ THE SPECIFIC CEREAL AND THE SPECIFIC NUT, in Italian too. A label reading
// "Contiene: frutta a guscio" is not compliant and is useless to somebody who can
// eat mandorle but not nocciole.
test('the cereal and the nut are named, not the category', () => {
  assert.equal(allergenWordIt('gluten-wheat'), 'Grano');
  assert.equal(allergenWordIt('nuts-hazelnut'), 'Nocciole');
  assert.equal(allergenWordIt('nuts-almond'), 'Mandorle');
  // Peanuts are a legume and their own group, in both languages.
  assert.equal(allergenWordIt('peanuts'), 'Arachidi');
});

test('a code nobody recognises has no Italian word, rather than a guessed one', () => {
  for (const bad of ['gluten', 'nuts', 'unknown', '', null, undefined]) {
    assert.equal(allergenWordIt(bad), '', String(bad));
  }
});

// ── The nutrition table, in Italian ─────────────────────────────────────────

test('every nutrient row has an Italian name', () => {
  const missing = NUTRIENT_KEYS.filter(key => !nutrientWordIt(key));
  assert.deepEqual(missing, [], 'these rows would print blank on an Italian label');
});

test('salt is salt, and saturates say what they are of', () => {
  // ⚠️ SALE, NOT SODIO — the regulation asks for salt, and the two differ by 2.5x.
  assert.equal(nutrientWordIt('salt'), 'Sale');
  assert.equal(nutrientWordIt('saturates'), 'di cui acidi grassi saturi');
  assert.equal(nutrientWordIt('sugars'), 'di cui zuccheri');
  // Energy is one word for two rows, as in English: kJ and kcal are both printed.
  assert.equal(nutrientWordIt('kj'), nutrientWordIt('kcal'));
});

// ── What the app admits it cannot do ────────────────────────────────────────

// ⚠️ THE INGREDIENT NAMES ARE TYPED BY HAND AND THE APP DOES NOT TRANSLATE THEM.
// An Italian venue must type Italian ingredient names, or the label reads
// "Contiene: Wheat" — half translated, which is worse than either language alone.
// Saying so on the screen is the only honest option available.
test('the screen admits it cannot translate the ingredient names', () => {
  const dict = _dictionaries();
  assert.match(dict.en['label.ingredientNamesNote'], /does not translate/);
  assert.match(dict.it['label.ingredientNamesNote'], /non li traduce/);
});

// ── The two halves have to agree ────────────────────────────────────────────
//
// The lesson of 12 Aug 2026: a server half that is correct and that nothing calls
// is a feature that does not exist, and every test stays green while it does not.
// These are source checks, like tests/create-own-business.test.mjs beside them.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, ...p.split('/')), 'utf8');

test('the server refuses to create a business without a country', () => {
  const server = read('functions/onboarding.js');
  const start = server.indexOf('export const createWorkspace');
  const body = server.slice(start, server.indexOf('\n});', start));
  assert.match(body, /\['GB', 'IT'\]\.includes\(country\)/,
    'the country must be validated against the two we support');
  assert.match(body, /throw new HttpsError\('invalid-argument'/,
    'and a missing one must be refused, not defaulted');
  // ⚠️ BOTH writes — a customer's business and one of your own — must store it.
  // One of them forgetting is a business whose labels can never be produced.
  const writes = body.match(/name, sections, country, createdAt: now, createdBy: uid/g) || [];
  assert.equal(writes.length, 2, 'both location writes must carry the country');
});

test('the screen asks for it, and passes it through the data layer', () => {
  const screen = read('js/staff/new-customer.js');
  const client = read('js/staff/firebase-staff.js');
  assert.match(screen, /nc-country/, 'the form must offer the choice');
  assert.match(screen, /if \(!country\) return \[/, 'and refuse before the network');
  assert.match(screen, /createWorkspace\(typed, sections, \{ forSelf, country \}\)/,
    'and pass it at the call site');
  assert.match(client, /country: opts\.country \|\| ''/, 'the data layer must forward it');
});

// ⚠️ NOTHING IS PRE-SELECTED, and this is the sharper version of the sections
// rule. Pre-ticking a section sells part of the app by accident; pre-selecting
// "United Kingdom" would make a business created in a hurry print ENGLISH
// allergen labels — right for every venue that exists today, and silently
// non-compliant for the first Italian customer.
test('no country is pre-selected on the form', () => {
  const screen = read('js/staff/new-customer.js');
  const start = screen.indexOf("name: 'nc-country'");
  const nearby = screen.slice(start - 400, start + 400);
  assert.doesNotMatch(nearby, /radio\.checked = /,
    'a pre-selected country is a label language nobody chose');
});

test('the label screen refuses when the country is unknown, and follows it when known', () => {
  const view = read('js/catalogue/label-view.js');
  assert.match(view, /if \(!canPrintLabel\(location\)\)/,
    'no country, no label — never a quiet fallback to English');
  assert.match(view, /const lang = outputLanguage\(location\)/);
  // Every word that reaches a label goes through market.js.
  for (const call of [/labelWord\('ingredients', lang\)/, /allergenName\(c, lang\)/,
    /nutrientName\(n, lang\)/, /containsLine\(label, lang\)/]) {
    assert.match(view, call, String(call));
  }
});

// ⚠️ THE COPIED TEXT IS THE LABEL. Whatever is printed in the end comes from the
// clipboard, so an English copy pasted onto Italian packaging is the whole defect
// this release prevents, arriving through the one door nobody thought of.
test('the copied text is in the same language as the label on screen', () => {
  const view = read('js/catalogue/label-view.js');
  const start = view.indexOf('const lines = [label.name');
  const copy = view.slice(start, start + 700);
  assert.match(copy, /labelWord\('ingredients', lang\)/);
  assert.match(copy, /containsLine\(label, lang\)/);
  assert.match(copy, /nutrientName\(n, lang\)/);
  assert.doesNotMatch(copy, /'Ingredients: '|'Typical values|'May contain:/,
    'no English left hard-coded in the copied label');
});

// ── The screen AROUND the label follows the reader ───────────────────────────
//
// ⚠️⚠️ THREE SENTENCES AND THREE BUTTONS SAT IN FIXED ENGLISH UNTIL 23 Aug 2026,
// on the one screen a venue in Italy uses to produce a legal document. They were
// in js/market.js — which may not import the dictionary — so nothing could have
// translated them where they stood. These tests pin the new arrangement, because
// the obvious "fix" is to move a word back and nothing would go red.

// ⚠️⚠️ THE FIRST VERSION OF THIS CHECK GUARDED NOTHING, and it is worth recording
// because it looked exactly right. It used `/['"`]([^'"`]{25,})['"`]/` to find long
// string literals — which instead pairs the CLOSING quote of one string with the
// OPENING quote of the next, so every "match" was the CODE in between. It reported
// sixteen hits on this file, fifteen of them fragments like «},\n});\n\nexport
// function labelWord(key, lang) {», and never once looked at a real string. A
// deliberate English sentence added to js/market.js sailed straight past it.
//
// Caught by mutation-testing the file that owns the guard — the v1.60.1 rule, which
// is the only reason it was found at all.
test('js/market.js holds words, never sentences', () => {
  const sentences = [];
  read('js/market.js').split(/\r?\n/).forEach((line, i) => {
    for (const literal of stringsIn(line)) {
      if (literal.length < 25) continue;
      if (/\b(the|this|that|because|and|is|are|not|you|which|when)\b/i.test(literal)) {
        sentences.push(`js/market.js:${i + 1}  ${literal.slice(0, 80)}`);
      }
    }
  });
  assert.deepEqual(sentences, [],
    'these are read by a person and cannot be translated from here — market.js may not '
    + 'import the dictionary, so a sentence in it is a sentence stuck in English');
});

// ⚠️ AND THE CHECK ITSELF IS PROVED TO FIRE, because the version it replaces could not.
test('that check can actually see a sentence in a file', () => {
  const line = "export const NOTE = 'This label is produced in the language of the country.';";
  const hits = stringsIn(line).filter(s => s.length >= 25
    && /\b(the|this|that|because|and|is|are|not|you|which|when)\b/i.test(s));
  assert.equal(hits.length, 1, 'the scan must see a real string literal');
  // …and must NOT see the code between two strings, which is how it failed before.
  const twoStrings = "  const a = 'GB'; const somethingVeryLongIndeed = 'IT';";
  assert.deepEqual(stringsIn(twoStrings), ['GB', 'IT'],
    'a quote must pair with its own closing quote, never with the next string’s opening one');
});

// ⚠️ AND THE HALF A "no sentences" CHECK CANNOT SEE: the sentences must exist
// SOMEWHERE. Deleting them satisfies the test above perfectly — the same hole that
// let four food-word mutations through on 23 Aug 2026. Both are still shown, both
// still come from the dictionary, and both exist in both languages.
test('the label screen still explains itself, from the dictionary, in both languages', () => {
  const view = read('js/catalogue/label-view.js');
  assert.match(view, /text: t\('label\.languageNote', \{/,
    'the sentence saying which language the label is in must still be drawn');
  assert.match(view, /text: t\('label\.ingredientNamesNote'\)/,
    'and the one admitting the app does not translate ingredient names');
  const dict = _dictionaries();
  for (const key of ['label.languageNote', 'label.ingredientNamesNote', 'label.blocked.noCountry',
    'label.shows.allergens', 'label.shows.nutrition', 'label.shows.both', 'label.untitled']) {
    for (const lang of ['en', 'it']) {
      assert.ok(dict[lang][key] && dict[lang][key].length > 1, `${key} is missing from ${lang}`);
    }
    assert.notEqual(dict.en[key], dict.it[key], `${key} looks copied rather than translated`);
  }
});

// ⚠️⚠️ THE SLOT THAT COULD RE-WIRE THE TWO LANGUAGES. The sentence names the label's
// language inside interface prose, so it interpolates `lang` — which is
// outputLanguage(location), the COUNTRY. Filling it from currentLanguage() would make
// the screen claim, in Italian, that an English label is in Italian: a false statement
// about a legal document, printed next to it.
test('the sentence names the label’s OWN language, taken from the country', () => {
  const view = read('js/catalogue/label-view.js');
  const start = view.indexOf("t('label.languageNote'");
  const call = view.slice(start, start + 240);
  assert.match(call, /language: t\(`language\.\$\{lang\}\.inSentence`\)/,
    'the language named is the LABEL’s — `lang` comes from outputLanguage()');
  assert.match(call, /country: t\(`country\.\$\{countryOf\(location\)\}\.in`\)/,
    'and the country is the venue’s, phrased by the interface');
});

// ⚠️ THE BUTTONS CARRY KEYS BECAUSE THE CONSTANT IS EVALUATED AT MODULE LOAD — the
// v1.57.0 rule. tests/frozen-phrases.test.mjs would catch a t() put back up there;
// this catches the other direction, a plain English word put back.
test('the three buttons above the label carry keys, not words', () => {
  const view = read('js/catalogue/label-view.js');
  const start = view.indexOf('const SHOW_KEYS');
  const block = view.slice(start, view.indexOf('});', start));
  assert.ok(start !== -1 && block.length > 40, 'SHOW_KEYS must exist and be non-empty');
  for (const shows of ['allergens', 'nutrition', 'both']) {
    assert.match(block, new RegExp(`${shows}: 'label\\.shows\\.${shows}'`),
      `${shows} must be a key — a word here is frozen in the language the page loaded in`);
  }
  assert.match(view, /btn\.textContent = t\(SHOW_KEYS\[key\]\)/,
    'and the lookup happens when the switch is painted, not when the module loads');
});

// ── The fourteen groups, for the law card on the allergen sheet ──────────────

test('every group the law names answers in both languages', () => {
  for (const group of ALLERGEN_GROUPS) {
    for (const lang of ['en', 'it']) {
      const name = allergenGroupName(group, lang);
      assert.ok(name && name.length > 1, `${group} has no ${lang} name`);
    }
  }
  // Fourteen groups, not twenty-six: this is the list the law asks about, and the
  // specific cereals and nuts sit INSIDE two of them.
  assert.equal(ALLERGEN_GROUPS.length, 14);
});

// ⚠️ THE TWELVE UNSUBDIVIDED GROUPS ARE NAMED BY THEIR OWN ALLERGEN WORD, DERIVED.
// Writing all fourteen headings out by hand would be the second list market.js
// exists to avoid, and the thing the two copies would disagree about is what is in
// somebody's food. A code added to allergen-model.js must need nothing here.
test('a group of one is named by its own word, in the country language', () => {
  assert.equal(allergenGroupName('milk', 'en'), 'Milk');
  assert.equal(allergenGroupName('milk', 'it'), 'Latte');
  assert.equal(allergenGroupName('celery', 'it'), 'Sedano');
  // Only the two collections carry a written heading.
  assert.equal(allergenGroupName('gluten', 'en'), 'Cereals containing gluten');
  assert.equal(allergenGroupName('gluten', 'it'), 'Cereali contenenti glutine');
  assert.equal(allergenGroupName('nuts', 'it'), 'Frutta a guscio');
  // An unknown group answers empty rather than inventing a heading.
  assert.equal(allergenGroupName('nonsense', 'en'), '');
});

test('only the two collections list their specific codes', () => {
  assert.deepEqual(allergenGroupCodes('milk', 'en'), []);
  assert.deepEqual(allergenGroupCodes('celery', 'it'), []);
  assert.equal(allergenGroupCodes('gluten', 'en').length, 6);
  assert.equal(allergenGroupCodes('nuts', 'en').length, 8);
  assert.ok(allergenGroupCodes('gluten', 'it').includes('Grano'));
  assert.ok(allergenGroupCodes('nuts', 'it').includes('Nocciole'));
});

// ⚠️ A GROUP HEADING IS FOR READING, NEVER FOR A LABEL. A label must name the
// specific cereal and nut — "Wheat", not "cereals containing gluten" — so the two
// files that build a label may not reach for this.
test('no label file uses a group heading', () => {
  for (const file of ['js/catalogue/recipe-label-model.js', 'js/catalogue/label-view.js']) {
    const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /allergenGroupName|allergenGroupCodes/,
      `${file} must name the specific allergen, never its group`);
  }
});

// ⚠️ A COMPUTED KEY IS ONE tests/i18n-keys-exist.test.mjs CANNOT SEE. Two screens
// build `country.${countryOf(location)}.in` from a template literal — the allergen
// sheet's law card and js/staff/language.js — so the scanner walks past both. This
// is what it would have done.
test('both country phrases exist in both dictionaries', () => {
  const dict = _dictionaries();
  for (const country of COUNTRIES) {
    for (const lang of ['en', 'it']) {
      const key = `country.${country}.in`;
      const phrase = dict[lang][key];
      assert.ok(typeof phrase === 'string' && phrase.length > 1,
        `${key} is missing from ${lang} — a screen would print the key itself`);
    }
  }
});
