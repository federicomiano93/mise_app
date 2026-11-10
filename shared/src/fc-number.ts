// fc-number.ts — how the Food cost screens print a number: ALWAYS exactly two decimals, «12,50 g», «1,25 kg», «32,50%», «0,04 €».
//
// FULL, ADAPTED port of js/foodcost/fc-number.js (current app 151ea191, 8 Nov 2026; item 28 of docs/mise2-port-owed.md):
// `fcNumber`, `fcMoney`, `fcWeight` and `weighingParams`. ADAPTED like currency.ts: the original reads the venue's layout from
// js/currency.js module state; here the `Money` is handed in as the last argument. So parity.spec.ts cannot pair it (every
// arity differs by that one argument); fc-number.spec.ts runs every export against both files after
// `setCurrency(symbol, layout)` / `moneyOf(symbol, layout)` and demands the same text.
//
// ONLY THE TEXT CHANGES: stored data, the model's sums and the boxes a person types in are untouched, and totals keep being
// computed from exact values. ⚠️ FOOD COST ONLY: price-model.ts formatRate / formatMoney keep their decimals for the Suppliers
// and the Stocktake on purpose (a price per gram is a tenth of a cent).
//
// ⚠️ A REAL AMOUNT NEVER READS AS NOTHING: a positive value whose two-decimal text is «0.00» shows «< 0,01», never «0,00».
// Zero stays «0,00»; a value that rounds to minus zero shows «0,00»; a real negative keeps its sign.
//
// PURE: no DOM, no t().

import { localNumber, moneyText } from './currency';
import type { Money } from './currency';

const NBSP = ' ';

// null, undefined, '' and anything that is not a finite number → null ("unknown").
// ⚠️ Number(null) and Number('') are 0: they are tested explicitly, or an unknown would read «0,00».
function known(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// n → '12.50' with no minus zero; null when unknown. `tiny` says the positive-rounds-to-zero case.
function fixed2(value: unknown): { text: string; tiny: boolean } | null {
  const n = known(value);
  if (n === null) return null;
  let text = n.toFixed(2);
  if (text === '-0.00') text = '0.00';
  return { text, tiny: n > 0 && text === '0.00' };
}

// A plain number (weight figure, pieces, percentage): «1.234,50», «< 0,01».
export function fcNumber(value: unknown, money: Money): string {
  const f = fixed2(value);
  if (!f) return '';
  return f.tiny ? `<${NBSP}${localNumber('0.01', money)}` : localNumber(f.text, money);
}

// An amount of money in the venue's currency layout: «0,04 €», «£0.04», «< 0,01 €».
export function fcMoney(value: unknown, money: Money): string {
  const f = fixed2(value);
  if (!f) return '';
  return f.tiny ? `<${NBSP}${moneyText('0.01', money)}` : moneyText(f.text, money);
}

// A weight stored in KILOS: under 1 kg in grams («12,50 g»), from 1 kg in kilos («1,25 kg»). The switch is decided on the
// ROUNDED grams, so 999.996 g reads «1,00 kg», never «1000,00 g».
export function fcWeight(kg: unknown, money: Money): string {
  const n = known(kg);
  if (n === null) return '';
  const grams = n * 1000;
  const roundedGrams = Number(grams.toFixed(2));
  if (Math.abs(roundedGrams) < 1000) return `${fcNumber(grams, money)} g`;
  return `${fcNumber(n, money)} kg`;
}

// The params of a weighing sentence ({ pct } or { max }, stored as plain text by foodcost-weighing.ts, which stays pure) → the
// same params with the percentages in two decimals. Called where the sentence is DRAWN, so «Weight lost: 12%» reads «12,00%».
export function weighingParams(params: Readonly<Record<string, string>> | null | undefined, money: Money): Record<string, string> {
  const out: Record<string, string> = { ...(params || {}) };
  for (const key of ['pct', 'max']) {
    if (key in out) out[key] = fcNumber(Number(out[key]), money);
  }
  return out;
}
