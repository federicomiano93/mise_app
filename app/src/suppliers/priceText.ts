import { formatRate, isPriceUnit, positiveNumber } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import { itemRates } from '@mise/shared/rate-items';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

// «£7.20 / kg» — the headline price on an ingredient row; empty when the item carries none. A port of
// formatPricePerUnit (js/price-model.js:399), with the dictionary and the money handed in instead of read from
// module variables. The price is on the item only for whoever may read prices (the store lays them on).
//
// «each» is an interface word, one phrase with a hole: Italian has no «/ al pezzo».
export function pricePerUnitText(
  item: Readonly<Record<string, unknown>>,
  money: Money,
  t: (key: MessageKey, params?: MessageParams) => string,
): string {
  const rate = positiveNumber(item.pricePerUnit);
  const unit = item.priceUnit;
  if (rate === null || !isPriceUnit(unit)) return '';
  if (unit === 'pcs') return t('sup.perEach', { rate: formatRate(rate, money) });
  return `${formatRate(rate, money)} / ${unit}`;
}

// pricePerUnitText for a run of neighbours — the old and the new price of a change, the rows of a history. The same texts, except
// that two neighbours of the same unit that would read alike while the stored numbers differ («0,71 / kg → 0,71 / kg» for 0.71 and
// 0.714) are written with the fewest extra decimals that tell them apart: «0,710 / kg → 0,714 / kg». Display only.
export function pricePerUnitRunText(
  items: readonly Readonly<Record<string, unknown>>[],
  money: Money,
  t: (key: MessageKey, params?: MessageParams) => string,
): string[] {
  const rates = itemRates(items, money);
  return items.map((item, index) => {
    const rate = rates[index] as string;
    if (rate === '') return '';
    return item.priceUnit === 'pcs' ? t('sup.perEach', { rate }) : `${rate} / ${String(item.priceUnit)}`;
  });
}
