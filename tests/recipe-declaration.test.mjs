// The ingredient declaration on the recipe screen: the list the law asks for, in the
// order the law asks for it, in the language the law asks for.
//
// ⚠️⚠️ THE TEST THAT EARNS THIS FILE IS THE MISMATCHED PAIR. Two settings that AGREE
// would pass even if the code read one of them for both — a UK venue on an English
// phone proves nothing at all. So the declaration is built for an ITALIAN venue with
// the interface in ENGLISH, and for a UK venue with the interface in ITALIAN, and the
// food words have to follow the COUNTRY both times.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildLabel, declarationText, ingredientLine, containsLine, mayContainLine,
} from '../js/catalogue/recipe-label-model.js';
import { setLanguage, currentLanguage, _dictionaries } from '../js/i18n.js';
import { outputLanguage } from '../js/market.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DETAIL = codeOf(read('js/catalogue/catalogue-detail.js'));
const SHARE = codeOf(read('js/share.js'));

// A recipe whose rows are all linked and all declared, so canLabel() lets it through.
const TABLES = {
  ingredients: {
    FLOUR: { name: 'Wheat flour', allergens: ['gluten-wheat'], allergensCheckedAt: 1 },
    WATER: { name: 'Water', allergens: [], allergensCheckedAt: 1 },
    BUTTER: { name: 'Butter', allergens: ['milk'], mayContain: ['nuts-hazelnut'], allergensCheckedAt: 1 },
  },
  recipes: {},
};
const RECIPE = {
  id: 'R1', name: 'Focaccia', lossPct: 0,
  ingredients: [
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
    { label: 'Wheat flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Water', grams: 700, unit: 'g', kind: 'ingredient', refId: 'WATER' },
  ],
};

// ── 1. The list itself ───────────────────────────────────────────────────────

test('⚠️ the list is ordered by weight, heaviest first — the law, not a preference', () => {
  const label = buildLabel(RECIPE, TABLES);
  assert.equal(label.ok, true, 'the fixture must be fully declared, or nothing below means anything');
  assert.deepEqual(label.ingredients.map(i => i.name), ['Wheat flour', 'Water', 'Butter'],
    'written in the recipe as butter, flour, water — printed heaviest first');
});

test('⚠️ the allergen-bearing rows are marked, and the others are not', () => {
  const label = buildLabel(RECIPE, TABLES);
  assert.deepEqual(label.ingredients.map(i => i.emphasise), [true, false, true],
    'the regulation asks for the allergen to be emphasised INSIDE the list, not only '
    + 'summarised underneath');
  assert.match(ingredientLine(label), /WHEAT FLOUR/,
    'and in plain text, where there is no bold, that emphasis is CAPITALS');
});

test('⚠️ «may contain» is never merged into «contains»', () => {
  const label = buildLabel(RECIPE, TABLES);
  assert.match(containsLine(label, 'en'), /Wheat/);
  assert.match(containsLine(label, 'en'), /Milk/);
  assert.doesNotMatch(containsLine(label, 'en'), /Hazelnut/,
    'a warning that something MIGHT be there is a different statement from a '
    + 'declaration that it IS, and the law treats them differently');
  assert.match(mayContainLine(label, 'en'), /Hazelnut/);
});

// ── 2. The language, which is the whole risk of this change ──────────────────

test('⚠️⚠️ the food words follow the COUNTRY even when the screen disagrees', () => {
  const label = buildLabel(RECIPE, TABLES);
  const before = currentLanguage();
  try {
    // An Italian venue, read by somebody whose app is in English.
    setLanguage('en');
    const italian = declarationText(label, outputLanguage({ country: 'IT' }), { withNutrition: false });
    assert.match(italian, /Ingredienti:/, 'the heading is the label\'s, not the screen\'s');
    assert.match(italian, /Contiene: Grano, Latte/, 'and so is every ALLERGEN name');
    assert.match(italian, /Può contenere: Nocciole/);
    assert.doesNotMatch(italian, /Contains:|May contain:/,
      '⚠️ an English summary pasted onto Italian packaging is the defect this rule '
      + 'exists to prevent, and it arrives through whichever door nobody thought of');

    // And the converse, which is the half that actually proves the two are separate.
    setLanguage('it');
    const english = declarationText(label, outputLanguage({ country: 'GB' }), { withNutrition: false });
    assert.match(english, /Ingredients:/);
    assert.match(english, /Contains: Wheat, Milk/);
    assert.doesNotMatch(english, /Contiene:|Può contenere:/,
      'two AGREEING settings would pass even if the code read one of them for both');
  } finally {
    setLanguage(before);
  }
});

test('⚠️⚠️ the INGREDIENT NAMES are the venue\'s own words, and stay untranslated', () => {
  // This surprised the test that found it, and it is correct. «Wheat flour» in the list
  // is the name somebody typed on the product's record in Orders; an Italian bakery
  // types «Farina di grano tenero» and that is what prints. The app translates the
  // ALLERGEN summary, because those fourteen words are a closed legal vocabulary it
  // owns — and it must NEVER machine-translate a venue's own product names onto a legal
  // document, where a plausible wrong word is worse than a foreign right one.
  //
  // ⚠️ THE PRACTICAL CONSEQUENCE, WHICH IS THE VENUE'S TO FIX, NOT THE APP'S: a venue
  // selling in Italy has to have typed its ingredient names in Italian. Nothing here
  // can check that, and nothing here should invent it.
  const label = buildLabel(RECIPE, TABLES);
  const italian = declarationText(label, outputLanguage({ country: 'IT' }), { withNutrition: false });
  assert.match(italian, /WHEAT FLOUR, Water, BUTTER/,
    'the names come from the ingredient records, verbatim, whatever the country');
  const model = codeOf(read('js/catalogue/recipe-label-model.js'));
  assert.ok(!/allergenName\(item|translate|allergenName\(.*\.name/.test(model),
    'nothing may put an ingredient NAME through a translation table');
});

test('⚠️ an unknown country gives no language, and that is answered in English', () => {
  const label = buildLabel(RECIPE, TABLES);
  // ⚠️ NEVER A BLANK. An empty name in a list of ingredients is the most dangerous
  // thing this screen could draw, because the row still LOOKS complete.
  const text = declarationText(label, outputLanguage({ country: 'ZZ' }), { withNutrition: false });
  assert.match(text, /Ingredients:/);
  assert.match(text, /WHEAT FLOUR/);
});

// ── 3. What is SENT, and what is not ─────────────────────────────────────────

test('⚠️ a message leaves the nutrition table out', () => {
  const withTable = { ...buildLabel(RECIPE, TABLES), nutrition: { kj: 1, kcal: 1, fat: 1, saturates: 1, carbs: 1, sugars: 1, protein: 1, salt: 1 } };
  const message = declarationText(withTable, 'en', { withNutrition: false });
  const full = declarationText(withTable, 'en');
  assert.doesNotMatch(message, /Typical values/,
    'some mail clients silently drop a body past about 2000 characters, and the table '
    + 'is most of the length');
  assert.match(full, /Typical values/, 'the label screen\'s own copy still carries it');
  assert.ok(full.length > message.length);
});

test('an undeclared recipe produces no text at all', () => {
  const holes = { ...RECIPE, ingredients: [{ label: 'Mystery', grams: 100, unit: 'g' }] };
  const label = buildLabel(holes, TABLES);
  assert.equal(label.ok, false);
  assert.equal(declarationText(label, 'en'), '',
    '⚠️ a list that silently omits the rows nobody has declared is worse than no list, '
    + 'because it looks complete');
});

// ── 4. The card on the screen ────────────────────────────────────────────────

test('⚠️⚠️ a recipe that cannot be labelled offers no way to send one', () => {
  const start = DETAIL.indexOf('function declarationPanel(');
  assert.notEqual(start, -1, 'the panel must exist to be guarded');
  const body = DETAIL.slice(start, DETAIL.indexOf('\nfunction allergenPanel(', start));
  assert.ok(body.length > 500, 'the slice must actually contain the panel');

  const blocked = body.indexOf("if (!label.ok) {");
  assert.notEqual(blocked, -1, 'it must have a refusal branch');
  const branch = body.slice(blocked, body.indexOf('return panel;', blocked));
  assert.ok(branch.length > 20, 'the refusal branch must not be empty');
  assert.ok(!/cat-decl-send|sendOnWhatsApp|sendByEmail|copyToClipboard/.test(branch),
    'a half declaration must never be sendable');
  // And the refusal returns BEFORE the buttons are ever built.
  assert.ok(body.indexOf('return panel;', blocked) < body.indexOf('cat-decl-send'),
    'the refusal must return before the send row exists');
});

test('⚠️ allergens switched off means no declaration card at all', () => {
  const start = DETAIL.indexOf('function declarationPanel(');
  const body = DETAIL.slice(start, DETAIL.indexOf('\nfunction allergenPanel(', start));
  const guard = body.indexOf('if (!allergensOn(location))');
  assert.notEqual(guard, -1, 'the switch must be consulted');
  assert.ok(guard < body.indexOf('buildLabel('),
    '⚠️ asked BEFORE anything is computed: a venue that switched allergens off must not '
    + 'be offered a declaration about data it can no longer reach');
});

test('⚠️ the declaration is rebuilt with the cost and allergen cards, not once', () => {
  assert.match(DETAIL, /costHostChildren = \(r\) => \[[^\]]*declarationPanel\(r, app\)\]/,
    'left outside the host, a recipe whose last ingredient was declared on another '
    + 'phone would keep saying it cannot be labelled until the screen was reopened');
});

test('⚠️⚠️ the card asks the COUNTRY for its language, and cannot be given one', () => {
  // Found by a mutation: `const lang = 'en'` inside the panel passed every check in
  // this repo. tests/i18n-label-separation.test.mjs forbids this file from touching
  // currentLanguage — and a hardcoded literal is not currentLanguage, so nothing saw it.
  // The consequence is an English declaration printed onto Italian packaging.
  const start = DETAIL.indexOf('function declarationPanel(');
  const body = DETAIL.slice(start, DETAIL.indexOf('\nfunction allergenPanel(', start));
  assert.ok(body.length > 500, 'the slice must actually contain the panel');
  assert.match(body, /const lang = outputLanguage\(location\);/,
    'the output language comes from the venue\'s country and from nowhere else');
  assert.ok(!/lang = '[a-z]{2}'|lang = "[a-z]{2}"/.test(body),
    'and it may never be a literal');
});

test('⚠️ a message leaves the nutrition table out, at the call site too', () => {
  // The model can do both; which one this screen asks for is the part that decides
  // whether a mail client silently drops the end of somebody's allergen list.
  const start = DETAIL.indexOf('function declarationPanel(');
  const body = DETAIL.slice(start, DETAIL.indexOf('\nfunction allergenPanel(', start));
  assert.match(body, /declarationText\(label, lang, \{ withNutrition: false \}\)/,
    'some mail clients drop a body past about 2000 characters, and the table is most '
    + 'of the length — the allergen half must not be what gets cut');
});

test('⚠️ the cost per kilo prints exactly two decimals', () => {
  // Federico asked for it by name: «solo il costo al kg con due numeri decimali dopo
  // il punto». Nothing pinned it, and a mutation put formatRate — two to FOUR — back.
  assert.match(DETAIL, /text: `\$\{formatMoney\(result\.pricePerKg\)\} \/ kg`/,
    'formatMoney is fixed at two; formatRate stretches to four for a rate per PIECE');
  assert.ok(!/formatRate/.test(DETAIL),
    '⚠️ and formatRate must not come back into this file at all — it is untouched '
    + 'elsewhere precisely so this screen could change alone');
});

test('⚠️ mailto opens the mail app and the screen says it does not send', () => {
  assert.match(SHARE, /mailto:\?subject=\$\{encodeURIComponent\(subject\)\}&body=\$\{encodeURIComponent\(body\)\}/,
    'BOTH parts encoded: an ingredient list is full of commas, brackets, percent signs '
    + 'and accents, and a raw & would end the body and start a parameter');
  // ⚠️ THE WARNING MOVED WITH THE CHOICE, 24 Aug 2026. The two named buttons became
  // one arrow, and the sheet behind it says «it opens your mail app — it does not send
  // it» UNDER THE EMAIL ROAD ITSELF, which is where it is read at the moment it matters.
  // A note under the row was read before the choice rather than with it.
  const sheet = readFileSync(new URL('../js/send-sheet.js', import.meta.url), 'utf8');
  assert.match(sheet, /note: 'send\.emailOpensApp'/,
    'the email road must carry the sentence that says it does not send');
  const dicts = _dictionaries();
  for (const lang of ['en', 'it']) {
    assert.ok(dicts[lang]['send.emailOpensApp'],
      `send.emailOpensApp is missing in ${lang}`);
  }
});

test('⚠️ no navigator.share, here or anywhere', () => {
  assert.ok(!/navigator\.share/.test(SHARE) && !/navigator\.share/.test(DETAIL),
    'the whole app sends through wa.me, so a second mechanism would behave differently '
    + 'on the same phone for the same errand — when the app moves, this moves with it');
});
