// rate-items.ts — the rate text of each item of a run of ingredients or price-history entries, for the eye only (see rate-text.ts).
// Apart from price-model.ts because that file is paired export-for-export with the frozen js/ copy.

import { moneyText } from './currency';
import type { Money } from './currency';
import { isPriceUnit, positiveNumber } from './price-model';
import { rateRunDigits } from './rate-text';

// What comes before «/ kg» for each item: '' for one with no usable price or unit. Neighbours of the same unit that would
// print alike while the stored numbers differ are told apart with more decimals («0,710» and «0,714»).
export function itemRates(items: readonly Readonly<Record<string, unknown>>[], money: Money): string[] {
  const entries = items.map(item => {
    const rate = positiveNumber(item.pricePerUnit);
    return { value: rate !== null && isPriceUnit(item.priceUnit) ? rate : null, group: String(item.priceUnit) };
  });
  return rateRunDigits(entries).map(text => (text === null ? '' : moneyText(text, money)));
}
