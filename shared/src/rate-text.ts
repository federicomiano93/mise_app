// rate-text.ts — how a price per unit is WRITTEN for the eye (Federico, 28 Nov 2026: «arrotondiamo tutti i prezzi a due
// decimali»). PURE, display only: nothing here is ever saved, compared or summed.
//
// A rate shows exactly two decimals («3,36 € / l»). One exception: a non-zero rate that would read «0,00» shows just enough
// decimals to reach its first significant digit («0,004 €»), six at most (the stored precision), so a real cost never reads as free.
// A second: two NEIGHBOURS (the old and the new price of a change, the rows of a price history) that would print the same text while
// the stored numbers differ both get the fewest extra decimals that tell them apart: «0,710 → 0,714».
//
// Lives apart from price-model.ts on purpose: price-model.ts is paired export-for-export with the frozen js/ copy
// (price-model.spec.ts), and this behaviour has no counterpart there. price-model.ts formatRate is written with these helpers.

import { moneyText } from './currency';
import type { Money } from './currency';

const MONEY_DECIMALS = 2;
const MAX_DECIMALS = 6;

// How many decimals a rate needs when read alone: two, or enough to reach its first significant digit.
export function rateDecimals(n: number): number {
  const abs = Math.abs(n);
  if (abs > 0 && abs.toFixed(MONEY_DECIMALS) === '0.00') return Math.min(MAX_DECIMALS, Math.ceil(-Math.log10(abs)));
  return MONEY_DECIMALS;
}

// n written with `decimals` decimals; a minus zero («-0.00») is written without its sign.
export function rateDigits(n: number, decimals: number): string {
  const text = n.toFixed(decimals);
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

// The digits of each entry of a run of neighbours (null when the entry has no finite number); only neighbours with the same
// `group` (the price unit) are told apart.
export function rateRunDigits(entries: readonly { value: unknown; group: string }[]): (string | null)[] {
  const numbers = entries.map(entry => {
    if (entry.value === null || entry.value === undefined || entry.value === '') return null;
    const n = Number(entry.value);
    return Number.isFinite(n) ? n : null;
  });
  const decimals = numbers.map(n => (n === null ? 0 : rateDecimals(n)));
  for (let i = 0; i + 1 < numbers.length; i++) {
    const x = numbers[i];
    const y = numbers[i + 1];
    if (x === null || y === null || x === undefined || y === undefined || x === y || entries[i]?.group !== entries[i + 1]?.group) continue;
    const dx = decimals[i] as number;
    const dy = decimals[i + 1] as number;
    if (rateDigits(x, dx) !== rateDigits(y, dy)) continue;
    let need = Math.max(dx, dy) + 1;
    while (need < MAX_DECIMALS && rateDigits(x, need) === rateDigits(y, need)) need++;
    decimals[i] = Math.max(dx, need);
    decimals[i + 1] = Math.max(dy, need);
  }
  return numbers.map((n, i) => (n === null ? null : rateDigits(n, decimals[i] as number)));
}

// The rates of a run of neighbours, each as formatRate writes it, except that two neighbours that would print alike while the
// stored numbers differ («0,71 → 0,71» for 0.71 and 0.714) are written «0,710 → 0,714». A value that is not a finite number gives ''.
export function formatRateRun(values: readonly unknown[], money: Money): string[] {
  return rateRunDigits(values.map(value => ({ value, group: '' }))).map(text => (text === null ? '' : moneyText(text, money)));
}

// Two rates: the pair form of formatRateRun.
export function formatRatePair(a: unknown, b: unknown, money: Money): [string, string] {
  const [first = '', second = ''] = formatRateRun([a, b], money);
  return [first, second];
}
