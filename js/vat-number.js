// vat-number.js — the ONE canonical form of a supplier's VAT number, shared by the supplier card and the
// invoice import so the two can never drift (a number typed one way on the card and read another way
// from an invoice would never match, and the import would create the same supplier twice).
// PURE: no imports, no DOM.
//
// Canonical = upper case, every whitespace and dot removed; eleven digits with no country letters are
// an Italian number and get «IT» (the country prefix is what an e-invoice carries, and what people omit
// when they type it by hand). Anything else — a foreign prefix, a short or odd number — is kept as typed
// in canonical case, never guessed at. A key that only says «no VAT» (`NOVAT:<hash>`, from the import
// script) is not a number: ''.

const NO_VAT_PREFIX = 'NOVAT:';
const ITALIAN_VAT_DIGITS = /^\d{11}$/;

export function normalizeVat(value) {
  const text = typeof value === 'string' ? value.toUpperCase().replace(/[\s.]+/g, '') : '';
  if (text.startsWith(NO_VAT_PREFIX)) return '';
  return ITALIAN_VAT_DIGITS.test(text) ? `IT${text}` : text;
}
