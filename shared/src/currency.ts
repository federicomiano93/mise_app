// currency.ts — what the money is counted in, and how an amount is WRITTEN.
//
// ADAPTED port of js/currency.js for Mise 2, and the one port that is deliberately NOT the same
// shape as its original. The original remembers the venue's money in two module variables
// (`setCurrency()` writes them when the session opens a venue, `currentCurrency()` and `moneyText()`
// read them). Mise 2 never keeps a venue fact in a module variable: it is read from the session,
// and a function that needs the money is HANDED it. So there is no `setCurrency` and no
// `currentCurrency` here, and `moneyText` and `localNumber` take the venue's `Money` as an
// argument. `moneyOf(symbol, layout)` is what `setCurrency` did with its arguments — exactly the
// same validation — except that it returns the answer instead of storing it.
//
// ⚠️ THAT ALSO MAKES THE v1.57.0 DEFECT IMPOSSIBLE HERE. The original has to warn «CALL THIS INSIDE
// THE FUNCTION THAT DRAWS, NEVER AT MODULE LOAD», because a `const CURRENCY = currentCurrency()` at
// the top of a file freezes the fallback for the life of the page (pounds on an Italian bakery
// while every test passes: it was in fourteen places on 21 Aug 2026). With no module state there
// is nothing to read too early: the money is an argument, and an argument cannot be older than
// the call. The venue's money comes from `moneyOf(currencyOf(location), moneyLayoutOf(location))`
// (market.ts), once, where the session is read.
//
// PARTIAL, SO parity.spec.ts DOES NOT PAIR IT. currency.spec.ts runs each case against the js/
// module after `setCurrency(symbol, layout)` and against this one with `moneyOf(symbol, layout)`,
// and demands the same text (`typedDecimal` is the one function that is the same in both).
//
// PURE, AND ZERO RUNTIME IMPORTS: nothing here reads a document, a clock or the DOM.
//
// ⚠️⚠️ IT IS A SYMBOL, NEVER A RATE. Nothing in this app converts money. A price
// typed as 6.50 is stored as 6.50 and read back as 6.50; all that changes is what is
// printed in front of it. The moment anybody adds a conversion here, every stored
// number silently means something different from what the person who typed it meant.
//
// ⚠️ WHICH symbol is not decided here — that is market.ts currencyOf(), which
// reads the venue's COUNTRY. This file only holds the answer's shape and writes amounts with it.

// How an amount is written: `group` goes between thousands ('' = none), `decimal` is the decimal
// mark, `symbolAfter` writes «12,50 €» instead of «£12.50».
export type MoneyLayout = { readonly decimal: string; readonly group: string; readonly symbolAfter: boolean };

// The venue's money: the symbol and the layout.
export type Money = { readonly symbol: string; readonly layout: MoneyLayout };

// What the app showed before it knew any better, and what it still shows when no
// venue is open — the sign-in screen, a location document that failed to load.
//
// ⚠️ IT FALLS BACK, WHERE A LABEL WOULD REFUSE, and the asymmetry is deliberate: a
// label in the wrong language is non-compliant, but a price under the wrong symbol is
// only mislabelled. The number itself is stored, costed and ordered unchanged, so
// nothing computes wrongly — whereas a bare "6.50 / kg" with no symbol reads as a
// half-drawn screen. See the note beside currencyOf() in market.ts.
const FALLBACK = '£';

// How the amount is written when no venue says otherwise: the layout every screen used
// before the country decided it (market.ts moneyLayoutOf) — «£1234.56».
const FALLBACK_LAYOUT: MoneyLayout = Object.freeze({ decimal: '.', group: '', symbolAfter: false });

export const FALLBACK_MONEY: Money = Object.freeze({ symbol: FALLBACK, layout: FALLBACK_LAYOUT });

// A venue's symbol and layout → the money its screens write. Anything that is not a non-empty
// string puts the fallback symbol back, so a corrupt or missing country can never blank the price
// line; a layout that is not the expected shape puts the historical layout back. A layout of the
// expected shape is kept as it was given (the original stored the very same object), and the
// answer is frozen so nobody downstream can change a venue's money.
export function moneyOf(symbol: unknown, layout: unknown): Money {
  const given = layout as Partial<MoneyLayout> | null | undefined;
  return Object.freeze({
    symbol: typeof symbol === 'string' && symbol ? symbol : FALLBACK,
    layout: given
      && typeof given.decimal === 'string' && given.decimal
      && typeof given.group === 'string'
      && typeof given.symbolAfter === 'boolean'
      ? given as MoneyLayout : FALLBACK_LAYOUT,
  });
}

// An amount ALREADY ROUNDED to text («-1234.56», from toFixed in price-model.ts) →
// what a person reads: «£-1234.56» in Britain, «-1.234,56 €» in Italy. TEXT ONLY — it
// moves the separators and the symbol and never reads the value (see the note at the
// top: nothing here may restate a number). The space before a trailing symbol is a
// no-break space, so «€» never wraps onto a line of its own.
export function moneyText(fixed: string, money: Money): string {
  const number = localNumber(fixed, money);
  return money.layout.symbolAfter ? `${number} ${money.symbol}` : `${money.symbol}${number}`;
}

// A plain number's text («2.5», «1234.5») in the SAME layout as the money, without a symbol:
// for a quantity or a weight printed on the same line as a price, so one line never mixes
// «2.5 × 6,50 €» (4 Oct 2026). `grouped: false` for the value of a box a person edits —
// a thousands dot typed back would not read as a number. Text it cannot read is returned as is.
export function localNumber(text: unknown, money: Money, grouped = true): string {
  const raw = String(text);
  const parts = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!parts) return raw;
  const [, sign, whole, fraction] = parts;
  // ⚠️ A QUIRK OF THE ORIGINAL, KEPT ON PURPOSE: `group` is the replacement STRING of replace(),
  // so a layout whose group held «$&» or «$1» would have it expanded instead of written. The two
  // layouts that exist use «.» and «», so no real input reaches it; a fix belongs in BOTH files at
  // once (currency.spec.ts feeds both such a layout and fails until they agree).
  const groups = grouped && money.layout.group
    ? (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, money.layout.group)
    : whole ?? '';
  return (sign ?? '') + groups + (fraction === undefined ? '' : money.layout.decimal + fraction);
}

// What a person typed in a price box → the text the price model reads: «12,5» and «12.5»
// both mean twelve and a half, whatever the venue or the phone (the box is a text field
// with the decimal keyboard, so the phone's own keyboard decides which mark it offers).
// Only ONE mark is accepted: «1.234,5» comes back unreadable and is refused downstream,
// never guessed at. Text handling only — the value is never read here.
export function typedDecimal(text: unknown): string {
  return String(text ?? '').trim().replace(',', '.');
}
