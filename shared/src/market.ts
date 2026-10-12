// market.ts — which country a venue sells in, and therefore what language the app
// must PRODUCE in, and what its money is counted in. PURE: no DOM, no Firestore, so every rule
// below is asserted in a unit test rather than read back out of rendered markup (P15).
//
// TypeScript port of js/market.js for Mise 2. Behaviour is identical, input for input: market.spec.ts
// runs every test against BOTH files. The comments below are the ones the original paid for in bugs.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. Only the COUNTRY and the MONEY half is
// here: COUNTRIES, countryOf, outputLanguage, canPrintLabel, currencyOf, CURRENCY_COUNTRIES,
// moneyLayoutOf and MONEY_LAYOUT_COUNTRIES, with the private tables they read. NOT PORTED, because
// nothing before the labels (step 3d of the plan) needs them: the label vocabulary — labelWord,
// allergenWordIt, nutrientWordIt, allergenName, allergenGroupName, allergenGroupCodes and
// nutrientName, with the private tables only they use (LABEL_WORDS, ALLERGEN_IT, NUTRIENT_IT,
// GROUP_HEADING) and the import of the allergen model. That half comes WITH the labels, and so do
// its comments (the allergen names, the «sentences live in the dictionary» history of 23 Aug 2026).
// market.spec.ts pins that the ported names, constants, frozen-ness and function shapes are the
// original's.
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
