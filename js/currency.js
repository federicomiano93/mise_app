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

// How the amount is written when no venue says otherwise: the layout every screen used
// before the country decided it (js/market.js moneyLayoutOf) — «£1234.56».
const FALLBACK_LAYOUT = Object.freeze({ decimal: '.', group: '', symbolAfter: false });

let current = FALLBACK;
let layout = FALLBACK_LAYOUT;

// Set when the session opens a venue. Anything that is not a non-empty string puts
// the fallback back, so a corrupt or missing country can never blank the price line;
// a layout that is not the expected shape puts the historical layout back.
export function setCurrency(symbol, moneyLayout) {
  current = typeof symbol === 'string' && symbol ? symbol : FALLBACK;
  layout = moneyLayout
    && typeof moneyLayout.decimal === 'string' && moneyLayout.decimal
    && typeof moneyLayout.group === 'string'
    && typeof moneyLayout.symbolAfter === 'boolean'
    ? moneyLayout : FALLBACK_LAYOUT;
}

// An amount ALREADY ROUNDED to text («-1234.56», from toFixed in js/price-model.js) →
// what a person reads: «£-1234.56» in Britain, «-1.234,56 €» in Italy. TEXT ONLY — it
// moves the separators and the symbol and never reads the value (see the note at the
// top: nothing here may restate a number). The space before a trailing symbol is a
// no-break space, so «€» never wraps onto a line of its own.
export function moneyText(fixed) {
  const number = localNumber(fixed);
  return layout.symbolAfter ? `${number} ${current}` : `${current}${number}`;
}

// A plain number's text («2.5», «1234.5») in the SAME layout as the money, without a symbol:
// for a quantity or a weight printed on the same line as a price, so one line never mixes
// «2.5 × 6,50 €» (4 Oct 2026). `grouped: false` for the value of a box a person edits —
// a thousands dot typed back would not read as a number. Text it cannot read is returned as is.
export function localNumber(text, grouped = true) {
  const raw = String(text);
  const parts = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!parts) return raw;
  const [, sign, whole, fraction] = parts;
  const groups = grouped && layout.group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, layout.group) : whole;
  return sign + groups + (fraction === undefined ? '' : layout.decimal + fraction);
}

// What a person typed in a price box → the text the price model reads: «12,5» and «12.5»
// both mean twelve and a half, whatever the venue or the phone (the box is a text field
// with the decimal keyboard, so the phone's own keyboard decides which mark it offers).
// Only ONE mark is accepted: «1.234,5» comes back unreadable and is refused downstream,
// never guessed at. Text handling only — the value is never read here.
export function typedDecimal(text) {
  return String(text ?? '').trim().replace(',', '.');
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
