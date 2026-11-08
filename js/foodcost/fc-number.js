// fc-number.js — how the Food cost screens print a number: ALWAYS exactly two decimals.
//
// Federico, 8 Nov 2026: every figure on the Food cost screens (weights, pieces, percentages,
// prices, costs) reads with two decimals, «500,00 g», «1,25 kg», «32,50%», «0,04 €».
// ONLY THE TEXT CHANGES: stored data, the model's sums and the boxes a person types in are
// untouched, and totals keep being computed from exact values.
//
// ⚠️ FOOD COST ONLY. js/price-model.js formatRate/formatMoney/formatPricePerUnit are NOT changed:
// Fornitori and Magazzino keep up to six decimals on purpose (a price per gram is a tenth of a
// cent), and the Food cost files no longer import them.
//
// ⚠️ A REAL AMOUNT NEVER READS AS NOTHING. A positive value whose two-decimal text is «0.00»
// (a 2 g pinch of salt costing 0.004) shows «< 0,01», never «0,00». Decided on the rounded TEXT,
// not on a threshold, so whatever toFixed says wins. Zero stays «0,00»; a value that rounds to
// minus zero shows «0,00» (never «-0,00»); a real negative (a margin of -1.50) keeps its sign.
//
// PURE: no DOM, no t(). The layout (decimal mark, grouping, symbol position) is the venue's,
// read from js/currency.js at the moment of the call — call these inside the drawing function.

import { localNumber, moneyText } from '../currency.js';

const NBSP = ' ';

// null, undefined, '' and anything that is not a finite number → null ("unknown").
// ⚠️ Number(null) and Number('') are 0: they are tested explicitly, or an unknown would read «0,00».
function known(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// n → '12.50' with no minus zero; null when unknown. `tiny` says the positive-rounds-to-zero case.
function fixed2(value) {
  const n = known(value);
  if (n === null) return null;
  let text = n.toFixed(2);
  if (text === '-0.00') text = '0.00';
  return { text, tiny: n > 0 && text === '0.00' };
}

// A plain number (weight figure, pieces, percentage): «1.234,50», «< 0,01».
export function fcNumber(value) {
  const f = fixed2(value);
  if (!f) return '';
  return f.tiny ? `<${NBSP}${localNumber('0.01')}` : localNumber(f.text);
}

// An amount of money in the venue's currency layout: «0,04 €», «£0.04», «< 0,01 €».
export function fcMoney(value) {
  const f = fixed2(value);
  if (!f) return '';
  return f.tiny ? `<${NBSP}${moneyText('0.01')}` : moneyText(f.text);
}

// A weight stored in KILOS: under 1 kg in grams («12,50 g»), from 1 kg in kilos («1,25 kg»).
// The switch is decided on the ROUNDED grams, so 999.996 g reads «1,00 kg», never «1000,00 g».
export function fcWeight(kg) {
  const n = known(kg);
  if (n === null) return '';
  const grams = n * 1000;
  const roundedGrams = Number(grams.toFixed(2));
  if (Math.abs(roundedGrams) < 1000) return `${fcNumber(grams)} g`;
  return `${fcNumber(n)} kg`;
}

// The params of a weighing sentence ({ pct } or { max }, stored as plain text by
// foodcost-weighing.js, which stays pure) → the same params with the percentages in two
// decimals. Called where the sentence is DRAWN, so «Weight lost: 12%» reads «12,00%».
export function weighingParams(params) {
  const out = { ...(params || {}) };
  for (const key of ['pct', 'max']) {
    if (key in out) out[key] = fcNumber(Number(out[key]));
  }
  return out;
}
