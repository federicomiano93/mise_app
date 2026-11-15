// market.ts — which country a venue sells in, and therefore what language the app
// must PRODUCE in, and what its money is counted in. PURE: no DOM, no Firestore, so every rule
// below is asserted in a unit test rather than read back out of rendered markup (P15).
//
// TypeScript port of js/market.js for Mise 2. Behaviour is identical, input for input: market.spec.ts
// runs every test against BOTH files. The comments below are the ones the original paid for in bugs.
//
// ⚠️ A FULL PORT: market.ts exports everything js/market.js does — the country and the money half, and
// the label vocabulary (LABEL_WORDS, ALLERGEN_IT, NUTRIENT_IT and GROUP_HEADING are private there too,
// reached through labelWord, allergenWordIt, nutrientWordIt, allergenName, allergenGroupName,
// allergenGroupCodes and nutrientName) — so parity.spec.ts pairs it, export by export.
// Like the original it imports NOTHING from the interface dictionary (label-separation.spec.ts pins it).
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

import type { MoneyLayout } from './currency';

// ⚠️ IMPORTED FOR THE ENGLISH WORDS, WHICH STAY WHERE THEY ARE. allergen-model.ts remains the one place the
// fourteen are defined — their codes, their groups and their English names. This file adds a second COLUMN
// beside that, never a second list: a copy of the fourteen would be the copy that quietly drifts, and the
// thing it would disagree about is what is in somebody's food.
import { ALLERGENS, allergenLabel } from './allergen-model';

export const COUNTRIES = Object.freeze(['GB', 'IT'] as const);

export type Country = (typeof COUNTRIES)[number];

// The language a label is printed in, per country. One entry per country, so a
// country cannot be added without somebody deciding this.
const OUTPUT_LANGUAGE = Object.freeze({ GB: 'en', IT: 'it' } as const);

export type OutputLanguage = (typeof OUTPUT_LANGUAGE)[Country];

// A location document is data, so its `country` may be anything.
function isCountry(value: unknown): value is Country {
  return (COUNTRIES as readonly unknown[]).includes(value);
}

// ⚠️ AN UNKNOWN COUNTRY ANSWERS null, NEVER 'GB'. Falling back to English is
// tempting — every venue in production today is in the UK — and it is exactly the
// wrong direction: in an Italian bakery an English allergen label is not "a bit
// off", it is non-compliant, and it would be produced silently and confidently.
// The same reasoning as canLabel() refusing an undeclared recipe: this app would
// rather say "I do not know" than print something that LOOKS complete.
export function countryOf(location: unknown): Country | null {
  const value = location && (location as { country?: unknown }).country;
  return isCountry(value) ? value : null;
}

export function outputLanguage(location: unknown): OutputLanguage | null {
  const country = countryOf(location);
  return country ? OUTPUT_LANGUAGE[country] : null;
}

// The one question every label screen must ask before it draws anything.
export function canPrintLabel(location: unknown): boolean {
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
const CURRENCY_BY_COUNTRY = Object.freeze({ GB: '£', IT: '€' } as const);

export type CurrencySymbol = (typeof CURRENCY_BY_COUNTRY)[Country];

// ⚠️ null FOR AN UNKNOWN COUNTRY, exactly like outputLanguage() — but what the app
// then DOES with the null points the other way, and the difference is worth stating.
// A label in the wrong language is non-compliant, so there the answer is to print
// nothing. A price in the wrong SYMBOL is only mislabelled: the number is stored and
// used unchanged, so no cost, margin or order is wrong because of it. currency.ts
// therefore falls back to the app's historical '£' rather than showing a bare number,
// which would read as a broken screen.
export function currencyOf(location: unknown): CurrencySymbol | null {
  const country = countryOf(location);
  return country ? CURRENCY_BY_COUNTRY[country] : null;
}

// Exported for the test that pins the two lists together. Not for drawing with:
// a screen wants currencyOf(location), which answers for the venue that is open.
export const CURRENCY_COUNTRIES: readonly string[] = Object.freeze(Object.keys(CURRENCY_BY_COUNTRY));

// ── How an amount is WRITTEN ─────────────────────────────────────────────────
//
// Same rule as the symbol: how money is written is a fact about the country, not a
// screen preference (Federico, 4 Oct 2026: «sistema anche i prezzi in formato italiano»).
// An Italian bakery reads «1.234,56 €» whatever language the screen is in; a British one
// keeps «£1234.56» exactly as it always has — no grouping was ever shown there, and
// changing a customer's screens was not asked for.
//
// `group` is put between thousands ('' = none); `symbolAfter` writes «12,50 €» instead
// of «£12.50». Only the LAYOUT of the text: the number is never touched (currency.ts).
const MONEY_LAYOUT_BY_COUNTRY: Readonly<Record<Country, MoneyLayout>> = Object.freeze({
  GB: Object.freeze({ decimal: '.', group: '', symbolAfter: false }),
  IT: Object.freeze({ decimal: ',', group: '.', symbolAfter: true }),
});

// null for an unknown country, like currencyOf(): currency.ts then keeps its
// historical layout, the same fallback the symbol takes.
export function moneyLayoutOf(location: unknown): MoneyLayout | null {
  const country = countryOf(location);
  return country ? MONEY_LAYOUT_BY_COUNTRY[country] : null;
}

// For the test that pins this table to COUNTRIES, like CURRENCY_COUNTRIES.
export const MONEY_LAYOUT_COUNTRIES: readonly string[] = Object.freeze(Object.keys(MONEY_LAYOUT_BY_COUNTRY));

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
    // The title of the order message a SUPPLIER receives (the order text): it
    // is read in the venue's country, not on the owner's screen.
    orderTitle: 'Order',
    // The word in the picture's file name: lower case and plain letters, so nothing has to
    // reshape a translated word (case is the dictionary's, never the code's).
    orderFileWord: 'order',
    // The other words of that message: the heading of a supplier with no name, the
    // stand-in for an ingredient deleted since the order, and the email subject.
    deletedIngredient: 'Deleted ingredient',
    emailSubject: 'Order from {name}',
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
    orderTitle: 'Ordine',
    orderFileWord: 'ordine',
    deletedIngredient: 'Ingrediente eliminato',
    emailSubject: 'Ordine da {name}',
  },
});

export type LabelWordKey = keyof (typeof LABEL_WORDS)['en'];

// `key` and `lang` come from callers that may hold anything, and the table is looked up exactly as the
// original does (a plain property read), so the answer for an odd value is the original's.
export function labelWord(key: LabelWordKey | (string & {}), lang: unknown): string {
  const tables = LABEL_WORDS as unknown as Record<string, Record<string, string> | undefined>;
  const english = LABEL_WORDS.en as Record<string, string>;
  const table = tables[lang as string] || english;
  return table[key] !== undefined ? table[key] : (english[key] || '');
}

// ⚠️ THE ALLERGEN NAMES, AND THE SPECIFIC CEREAL AND NUT ARE STILL NAMED. The
// regulation asks for "grano", not "cereali contenenti glutine"; "nocciole", not
// "frutta a guscio". The codes are unchanged — they are data, and they are what
// every ingredient document stores — so this is a second column beside them,
// never a second list. allergen-model.ts keeps the English.
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
// keys as NUTRIENTS in allergen-model.ts — a name missing here would print an
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
// the caller then keeps the English from allergen-model.ts. Returning '' rather
// than the English avoids this file holding a second copy of the English names,
// which is the copy that would drift.
export function allergenWordIt(code: unknown): string {
  return (ALLERGEN_IT as Record<string, string>)[code as string] || '';
}

export function nutrientWordIt(key: unknown): string {
  return (NUTRIENT_IT as Record<string, string>)[key as string] || '';
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
export function allergenName(code: unknown, lang: unknown): string {
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
// the law asks about. Nothing in recipe-label-model.ts may call it.
const GROUP_HEADING = Object.freeze({
  en: { gluten: 'Cereals containing gluten', nuts: 'Nuts' },
  it: { gluten: 'Cereali contenenti glutine', nuts: 'Frutta a guscio' },
});

export function allergenGroupName(group: unknown, lang: unknown): string {
  const headings = GROUP_HEADING as unknown as Record<string, Record<string, string> | undefined>;
  const table = headings[lang as string] || (GROUP_HEADING.en as Record<string, string>);
  if (table[group as string] !== undefined) return table[group as string] as string;
  // Not a named collection: the group is one allergen, so it is named by its own
  // word — derived, so a code added to allergen-model.ts needs nothing here.
  const codes = ALLERGENS.filter(a => a.group === group);
  return codes.length === 1 ? allergenName(codes[0]?.code, lang) : '';
}

// Every code the law names inside one group, in the country's language. Used for
// the "the specific cereals and nuts" detail — empty for the twelve that have no
// subdivision, so a caller can simply skip them.
export function allergenGroupCodes(group: unknown, lang: unknown): string[] {
  const codes = ALLERGENS.filter(a => a.group === group);
  return codes.length > 1 ? codes.map(a => allergenName(a.code, lang)) : [];
}

// The same, for a row of the nutrition table. `nutrient` is an entry of NUTRIENTS.
export function nutrientName(nutrient: { readonly key: string; readonly label: string } | null | undefined, lang: unknown): string {
  if (!nutrient) return '';
  if (lang === 'it') return nutrientWordIt(nutrient.key) || nutrient.label;
  return nutrient.label;
}

// ── What the label screen SAYS ABOUT ITSELF LIVES IN THE DICTIONARY ──────────
//
// ⚠️⚠️ THREE SENTENCES USED TO BE WRITTEN OUT IN THE ORIGINAL, IN ENGLISH, AND THEY WERE THE
// WHOLE REASON THE FILE HELD ANY PROSE AT ALL. They left on 23 Aug 2026:
//
//   labelLanguageNote()   "This label is produced in Italian because this
//                          business sells in Italy."
//   INGREDIENT_NAMES_NOTE "The ingredient names are the ones you typed…"
//   noCountryReason()     "No label can be made yet: nobody has said which
//                          country this business sells in…"
//
// ⚠️ EVERY ONE OF THEM IS INTERFACE TEXT, and interface text belongs to the READER, so on an
// Italian venue all three were the wrong language. They are now `label.languageNote` /
// `label.ingredientNamesNote` / `label.blocked.noCountry` in the dictionary, built by the label
// screen, which may hold both halves.
//
// ⚠️ AND THE REASON THEY COULD NOT SIMPLY BE WRAPPED IN t() WHERE THEY STOOD: this file may not
// import the dictionary AT ALL, and correctly — it builds what a label SAYS and nothing else, so it
// has no reason to know what is on screen. A file with no prose in it cannot leak the interface
// into a label by accident (label-separation.spec.ts pins it).
//
// COUNTRY_NAMES and countryName() went with them: their only caller was labelLanguageNote(), and
// the interface keeps its own copy of a country's name (`country.GB` / `country.GB.in`) precisely so
// the two cannot drift into each other.
