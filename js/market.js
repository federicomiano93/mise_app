// market.js — which country a venue sells in, and therefore what language the app
// must PRODUCE in. PURE: no DOM, no Firestore, so every rule below is asserted in
// a unit test rather than read back out of rendered markup (P15).
//
// ⚠️⚠️ THIS IS NOT THE INTERFACE LANGUAGE, AND CONFUSING THE TWO IS THE WHOLE
// REASON THIS FILE EXISTS. There are two languages in this app and they answer
// different questions:
//
//   the INTERFACE language   what the staff READ on screen   a preference
//   the OUTPUT language      what the app PRINTS on a label  the LAW
//
// Federico is Italian and his bakeries are in England. He wants the app in
// Italian for himself and the people who work with him — and his allergen labels
// MUST stay in English, because that food is sold in the United Kingdom.
// Retained Reg. (EU) 1169/2011 Art. 15 requires food information to be in a
// language easily understood by consumers in the country where the food is
// marketed. So the output language is not a setting anybody may pick: it follows
// the country, and this file is the only place that decides it.
//
// ⚠️ NOBODY HERE IS A LAWYER. The design makes the compliant thing the thing that
// happens by itself; it is not legal advice, and it wants a professional's eye
// before the first Italian customer.
//
// 📌 UK AND ITALY ONLY, and that is a deliberate limit (Federico, 13 Aug 2026).
// The two share the SAME fourteen allergens and the SAME nutrition declaration —
// Italy applies Reg. 1169/2011 and the UK the retained version of the same text —
// so between them only the WORDS change, never the rules. ⚠️ Outside the UK and
// the EU the list of allergens itself is different (the United States names nine
// and treats sesame separately; Canada differs again), so adding a third country
// is not a translation job. It is a new piece of work, and this file should
// refuse rather than guess when it arrives.

// ⚠️ IMPORTED FOR THE ENGLISH WORDS, WHICH STAY WHERE THEY ARE. js/allergen-model.js
// remains the one place the fourteen are defined — their codes, their groups and
// their English names. This file adds a second COLUMN beside that, never a second
// list: a copy of the fourteen would be the copy that quietly drifts, and the
// thing it would disagree about is what is in somebody's food.
import { ALLERGENS, allergenLabel } from './allergen-model.js';

export const COUNTRIES = Object.freeze(['GB', 'IT']);

// The language a label is printed in, per country. One entry per country, so a
// country cannot be added without somebody deciding this.
const OUTPUT_LANGUAGE = Object.freeze({ GB: 'en', IT: 'it' });

// ⚠️ AN UNKNOWN COUNTRY ANSWERS null, NEVER 'GB'. Falling back to English is
// tempting — every venue in production today is in the UK — and it is exactly the
// wrong direction: in an Italian bakery an English allergen label is not "a bit
// off", it is non-compliant, and it would be produced silently and confidently.
// The same reasoning as canLabel() refusing an undeclared recipe: this app would
// rather say "I do not know" than print something that LOOKS complete.
export function countryOf(location) {
  const value = location && location.country;
  return COUNTRIES.includes(value) ? value : null;
}

export function outputLanguage(location) {
  const country = countryOf(location);
  return country ? OUTPUT_LANGUAGE[country] : null;
}

// The one question every label screen must ask before it draws anything.
export function canPrintLabel(location) {
  return countryOf(location) !== null;
}

// ── What the money is counted in ─────────────────────────────────────────────
//
// ⚠️⚠️ THE CURRENCY FOLLOWS THE COUNTRY, NOT THE INTERFACE LANGUAGE, and that is
// Federico's decision of 23 Aug 2026 — his own rule from the day before, applied to
// money: a fact about the world follows the country, a preference follows the screen.
// What a sack of flour costs does not change because somebody switches the app to
// English, so an English-speaking employee at an Italian bakery must still read «€».
//
// ⚠️ IT IS A LABEL FOR A NUMBER, NEVER A CONVERSION. Nothing anywhere multiplies by
// a rate: 6.50 stays 6.50 and only the symbol in front of it changes. A venue's
// prices are typed in the money of the place it buys in, which is the money of the
// country it sells in.
//
// One entry per country, and a test asserts that COUNTRIES and this table hold the
// same keys — so a third country cannot be added and quietly print pounds.
const CURRENCY_BY_COUNTRY = Object.freeze({ GB: '£', IT: '€' });

// ⚠️ null FOR AN UNKNOWN COUNTRY, exactly like outputLanguage() — but what the app
// then DOES with the null points the other way, and the difference is worth stating.
// A label in the wrong language is non-compliant, so there the answer is to print
// nothing. A price in the wrong SYMBOL is only mislabelled: the number is stored and
// used unchanged, so no cost, margin or order is wrong because of it. js/currency.js
// therefore falls back to the app's historical '£' rather than showing a bare number,
// which would read as a broken screen.
export function currencyOf(location) {
  const country = countryOf(location);
  return country ? CURRENCY_BY_COUNTRY[country] : null;
}

// Exported for the test that pins the two lists together. Not for drawing with:
// a screen wants currencyOf(location), which answers for the venue that is open.
export const CURRENCY_COUNTRIES = Object.freeze(Object.keys(CURRENCY_BY_COUNTRY));

// ── The label's own vocabulary ───────────────────────────────────────────────
//
// ⚠️ ONLY WHAT GOES ON A LABEL LIVES HERE. This is not the app's translation
// dictionary — that is a separate piece of work with a separate setting. These
// words are chosen by the country and can never be switched by a person, so
// keeping them apart is what stops somebody's screen preference reaching a label.

const LABEL_WORDS = Object.freeze({
  en: {
    contains: 'Contains',
    mayContain: 'May contain',
    ingredients: 'Ingredients',
    nutrition: 'Nutrition',
    typicalValues: 'Typical values',
    per100g: 'per 100 g',
    noneOfThe14: 'None of the 14',
    // ⚠️ THE FULL-LABEL PARTICULARS. «Use by» is a SAFETY statement and «best
    // before» a quality one, and the two are not interchangeable in either language
    // — which is exactly why they are two entries here rather than one with a
    // qualifier somebody could translate away.
    netWeight: 'Net weight',
    useBy: 'Use by',
    bestBefore: 'Best before',
    storage: 'Storage',
  },
  it: {
    contains: 'Contiene',
    mayContain: 'Può contenere',
    ingredients: 'Ingredienti',
    nutrition: 'Valori nutrizionali',
    typicalValues: 'Valori medi',
    per100g: 'per 100 g',
    noneOfThe14: 'Nessuno dei 14',
    netWeight: 'Peso netto',
    useBy: 'Da consumarsi entro il',
    bestBefore: 'Da consumarsi preferibilmente entro il',
    storage: 'Conservazione',
  },
});

export function labelWord(key, lang) {
  const table = LABEL_WORDS[lang] || LABEL_WORDS.en;
  return table[key] !== undefined ? table[key] : (LABEL_WORDS.en[key] || '');
}

// ⚠️ THE ALLERGEN NAMES, AND THE SPECIFIC CEREAL AND NUT ARE STILL NAMED. The
// regulation asks for "grano", not "cereali contenenti glutine"; "nocciole", not
// "frutta a guscio". The codes are unchanged — they are data, and they are what
// every ingredient document stores — so this is a second column beside them,
// never a second list. js/allergen-model.js keeps the English.
const ALLERGEN_IT = Object.freeze({
  'gluten-wheat': 'Grano',
  'gluten-rye': 'Segale',
  'gluten-barley': 'Orzo',
  'gluten-oats': 'Avena',
  'gluten-spelt': 'Farro',
  'gluten-kamut': 'Kamut',
  'nuts-almond': 'Mandorle',
  'nuts-hazelnut': 'Nocciole',
  'nuts-walnut': 'Noci',
  'nuts-cashew': 'Anacardi',
  'nuts-pecan': 'Noci pecan',
  'nuts-brazil': 'Noci del Brasile',
  'nuts-pistachio': 'Pistacchi',
  'nuts-macadamia': 'Noci macadamia',
  celery: 'Sedano',
  crustaceans: 'Crostacei',
  eggs: 'Uova',
  fish: 'Pesce',
  lupin: 'Lupini',
  milk: 'Latte',
  molluscs: 'Molluschi',
  mustard: 'Senape',
  peanuts: 'Arachidi',
  sesame: 'Sesamo',
  soybeans: 'Soia',
  sulphites: 'Solfiti',
});

// The nutrient rows, in the order the regulation prints them. Keyed by the same
// keys as NUTRIENTS in js/allergen-model.js — a name missing here would print an
// empty row, so a test pins that every key has one.
const NUTRIENT_IT = Object.freeze({
  kj: 'Energia',
  kcal: 'Energia',
  fat: 'Grassi',
  saturates: 'di cui acidi grassi saturi',
  carbs: 'Carboidrati',
  sugars: 'di cui zuccheri',
  protein: 'Proteine',
  salt: 'Sale',
});

// The Italian word for an allergen code, or '' when the language is not Italian —
// the caller then keeps the English from js/allergen-model.js. Returning '' rather
// than the English avoids this file holding a second copy of the English names,
// which is the copy that would drift.
export function allergenWordIt(code) {
  return ALLERGEN_IT[code] || '';
}

export function nutrientWordIt(key) {
  return NUTRIENT_IT[key] || '';
}

// ── The one place a label word is chosen ─────────────────────────────────────
//
// ⚠️ THE BRANCH LIVES HERE AND NOWHERE ELSE. Every screen that prints an
// allergen would otherwise carry its own `lang === 'it' ? … : …`, and the day a
// third language arrives one of them is forgotten — printing an English allergen
// on an Italian label, silently, on the one screen nobody re-read.
//
// ⚠️ AND THE FALLBACK IS THE ENGLISH WORD, NOT A BLANK. A test pins that every
// one of the fourteen has an Italian name, so this cannot be reached — but if it
// ever were, "Hazelnut" on an Italian label still tells somebody with a nut
// allergy what is in the food. An empty name in a list of allergens is the most
// dangerous blank this app could print, because the line still LOOKS complete.
export function allergenName(code, lang) {
  if (lang === 'it') return allergenWordIt(code) || allergenLabel(code);
  return allergenLabel(code);
}

// ── The fourteen, as the law groups them ─────────────────────────────────────
//
// ⚠️ TWO ENTRIES, NOT FOURTEEN, AND THAT IS THE POINT. Only `gluten` and `nuts`
// are collections the law names as a category; the other twelve ARE their single
// code, so their heading is simply that code's own word. Writing all fourteen out
// here would be the second list this file exists to avoid — and the thing the two
// copies would disagree about is what is in somebody's food.
//
// ⚠️ THESE HEADINGS ARE FOR READING, NEVER FOR A LABEL. A label must name the
// specific cereal and the specific nut ("Wheat", not "cereals containing
// gluten"); this pair is only ever used to tell somebody which fourteen groups
// the law asks about. Nothing in recipe-label-model.js may call it.
const GROUP_HEADING = Object.freeze({
  en: { gluten: 'Cereals containing gluten', nuts: 'Nuts' },
  it: { gluten: 'Cereali contenenti glutine', nuts: 'Frutta a guscio' },
});

export function allergenGroupName(group, lang) {
  const table = GROUP_HEADING[lang] || GROUP_HEADING.en;
  if (table[group] !== undefined) return table[group];
  // Not a named collection: the group is one allergen, so it is named by its own
  // word — derived, so a code added to allergen-model.js needs nothing here.
  const codes = ALLERGENS.filter(a => a.group === group);
  return codes.length === 1 ? allergenName(codes[0].code, lang) : '';
}

// Every code the law names inside one group, in the country's language. Used for
// the "the specific cereals and nuts" detail — empty for the twelve that have no
// subdivision, so a caller can simply skip them.
export function allergenGroupCodes(group, lang) {
  const codes = ALLERGENS.filter(a => a.group === group);
  return codes.length > 1 ? codes.map(a => allergenName(a.code, lang)) : [];
}

// The same, for a row of the nutrition table. `nutrient` is an entry of NUTRIENTS.
export function nutrientName(nutrient, lang) {
  if (!nutrient) return '';
  if (lang === 'it') return nutrientWordIt(nutrient.key) || nutrient.label;
  return nutrient.label;
}

// ── What the label screen SAYS ABOUT ITSELF LIVES IN THE DICTIONARY ──────────
//
// ⚠️⚠️ THREE SENTENCES USED TO BE WRITTEN OUT HERE, IN ENGLISH, AND THEY WERE THE
// WHOLE REASON THIS FILE HELD ANY PROSE AT ALL. They left on 23 Aug 2026:
//
//   labelLanguageNote()   "This label is produced in Italian because this
//                          business sells in Italy."
//   INGREDIENT_NAMES_NOTE "The ingredient names are the ones you typed…"
//   noCountryReason()     "No label can be made yet: nobody has said which
//                          country this business sells in…"
//
// ⚠️ EVERY ONE OF THEM IS INTERFACE TEXT — the file said so itself, in the comment
// above the second one — and interface text belongs to the READER, so on an
// Italian venue all three were the wrong language. They are now
// `label.languageNote` / `label.ingredientNamesNote` / `label.blocked.noCountry`
// in js/i18n.js, built by js/catalogue/label-view.js, which may hold both halves.
//
// ⚠️ AND THE REASON THEY COULD NOT SIMPLY BE WRAPPED IN t() WHERE THEY STOOD:
// tests/i18n-label-separation.test.mjs forbids this file from importing the
// dictionary AT ALL, and correctly — it builds what a label SAYS and nothing
// else, so it has no reason to know what is on screen. A file with no prose in it
// cannot leak the interface into a label by accident.
//
// COUNTRY_NAMES and countryName() went with them: their only caller was
// labelLanguageNote(), and the interface keeps its own copy of a country's name
// (`country.GB` / `country.GB.in` in js/i18n.js) precisely so the two cannot drift
// into each other.
