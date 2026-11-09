// fc-number.ts — how the Food cost screens print a weight: exactly two decimals, «12,50 g», «1,25 kg».
//
// PARTIAL, ADAPTED port of js/foodcost/fc-number.js: only `fcNumber` and `fcWeight`, which the «too much of a recipe»
// warning under a «Made of» line needs word for word (current app a7f4c75d, its recipeQtyText). The rest of the file —
// `fcMoney`, `weighingParams` and two decimals on every Food cost figure — is item 28 of docs/mise2-port-owed.md, deferred
// until after the switch. ADAPTED like currency.ts: the original reads the venue's layout from js/currency.js module
// state; here the `Money` is handed in. So parity.spec.ts does NOT pair it; fc-number.spec.ts runs both after
// `setCurrency(symbol, layout)` / `moneyOf(symbol, layout)` and demands the same text.
//
// ⚠️ A REAL AMOUNT NEVER READS AS NOTHING: a positive value whose two-decimal text is «0.00» shows «< 0,01», never «0,00».
// Zero stays «0,00»; a value that rounds to minus zero shows «0,00»; a real negative keeps its sign.
//
// PURE: no DOM, no t().

import { localNumber } from './currency';
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
