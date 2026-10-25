import { formatRate, isPriceUnit, positiveNumber } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
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
