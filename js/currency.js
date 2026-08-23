// currency.js — the symbol the app is currently counting money in.
//
// PURE, AND ZERO IMPORTS ON PURPOSE, for two reasons. It sits below both halves of
// the app — js/price-model.js formats every price with it, js/firebase.js sets it
// when a venue opens — and js/firebase.js is loaded by every page before anything
// else, so pulling price-model.js (which imports the dictionary) up into it would
// put the whole money model on the critical path of the sign-in screen.
//
// ⚠️⚠️ IT IS A SYMBOL, NEVER A RATE. Nothing in this app converts money. A price
// typed as 6.50 is stored as 6.50 and read back as 6.50; all that changes is what is
// printed in front of it. The moment anybody adds a conversion here, every stored
// number silently means something different from what the person who typed it meant.
//
// ⚠️ WHICH symbol is not decided here — that is js/market.js currencyOf(), which
// reads the venue's COUNTRY. This file only remembers the answer. Splitting it that
// way is what lets price-model.js format money without knowing what a location is.
//
// The same shape as setLanguage/currentLanguage in js/i18n.js, and for the same
// reason: the value arrives with the session, a moment AFTER every module has been
// evaluated.

// What the app showed before it knew any better, and what it still shows when no
// venue is open — the sign-in screen, a location document that failed to load.
//
// ⚠️ IT FALLS BACK, WHERE A LABEL WOULD REFUSE, and the asymmetry is deliberate: a
// label in the wrong language is non-compliant, but a price under the wrong symbol is
// only mislabelled. The number itself is stored, costed and ordered unchanged, so
// nothing computes wrongly — whereas a bare "6.50 / kg" with no symbol reads as a
// half-drawn screen. See the note beside currencyOf() in js/market.js.
const FALLBACK = '£';

let current = FALLBACK;

// Set when the session opens a venue. Anything that is not a non-empty string puts
// the fallback back, so a corrupt or missing country can never blank the price line.
export function setCurrency(symbol) {
  current = typeof symbol === 'string' && symbol ? symbol : FALLBACK;
}

// ⚠️⚠️ CALL THIS INSIDE THE FUNCTION THAT DRAWS, NEVER AT MODULE LOAD. A module is
// evaluated once, at first import, and that happens before any venue is open — so a
// `const CURRENCY = currentCurrency()` at the top of a file would freeze the fallback
// into that file for the life of the page. It is the v1.57.0 defect exactly, and it
// was in fourteen places on 21 Aug; here it would print pounds on an Italian bakery
// while every test passed.
export function currentCurrency() {
  return current;
}
