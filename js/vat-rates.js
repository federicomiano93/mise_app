// vat-rates.js — the VAT rates a venue's country offers, as CHOICES.
//
// PURE: no DOM, no Firestore (P15). Moved out of js/foodcost/foodcost-model.js
// (29 Sep 2026) because a second feature now needs the same menu — the
// ingredient price form's PURCHASE VAT field (js/ingredient-record-form.js) —
// and a calculation shared by more than one feature belongs in js/ root, not
// inside one feature's folder (CLAUDE.md "Modular by feature"). Food cost's
// own selling-price VAT and the purchase VAT stored beside an ingredient's
// price are two DIFFERENT numbers on two different documents; they simply
// draw from the same national menu, which is what lives here.
//
// ⚠️ THE COUNTRY IS THE VENUE'S (js/market.js countryOf), NEVER THE INTERFACE
// LANGUAGE: an Italian bakery run in English still charges Italian IVA — the
// same rule the currency follows.
// ⚠️ ZERO IS A REAL, COMMON ANSWER IN THE UK, not a missing one. Most bread
// and cakes sold to take away are zero-rated there, while the same thing
// eaten in is standard-rated. Anything that treats 0 as "not filled in" will
// refuse to cost — or price — the bakery's main line.

// The VAT rates offered as CHOICES, per country. Federico, 13 Sep 2026: «dammi
// aliquota iva per quelle italiane». Not a closed list where it is used for a
// SELLING price — a free field sits beside the choices there, because the
// rate that applies to a bakery product is a question for an accountant, not
// for this file. (The ingredient PURCHASE VAT is different: firestore.rules
// closes it to the union of every rate below, [0, 4, 5, 10, 20, 22] — see
// js/order-cost.js and js/ingredient-record-form.js.)
export const VAT_RATES_BY_COUNTRY = Object.freeze({
  GB: Object.freeze([
    Object.freeze({ rate: 20, key: 'fc.vat.standard' }),
    Object.freeze({ rate: 5, key: 'fc.vat.reduced' }),
    Object.freeze({ rate: 0, key: 'fc.vat.zero' }),
  ]),
  IT: Object.freeze([
    Object.freeze({ rate: 22, key: 'fc.vat.standard' }),
    Object.freeze({ rate: 10, key: 'fc.vat.reduced' }),
    Object.freeze({ rate: 4, key: 'fc.vat.minimum' }),
  ]),
});

// The choices for a venue's country. ⚠️ An unknown country gets the UK's — the
// app's historical default, and the direction js/currency.js falls back in.
export function vatRatesFor(country) {
  return Object.prototype.hasOwnProperty.call(VAT_RATES_BY_COUNTRY, country)
    ? VAT_RATES_BY_COUNTRY[country]
    : VAT_RATES_BY_COUNTRY.GB;
}
