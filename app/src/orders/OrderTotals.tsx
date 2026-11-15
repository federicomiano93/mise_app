import { useId } from 'react';
import type { OrderCostResult } from '@mise/shared/order-cost';
import { formatMoney } from '@mise/shared/price-model';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import styles from './OrderTotals.module.css';

// The box under an order's lines: Net, one line per VAT rate, then the bold Order total — and, only when something could not be
// counted, a warning that the total is therefore lower than the real one (port of js/orders/order-cost-view.js buildTotalsBox).
// Nothing at all when nothing is ordered.
//
// ⚠️ NEVER DRAWN FOR SOMEBODY WHO MAY NOT READ PRICES: the caller draws it only when the store says `pricesReadable` (the read of
// ingredient-prices SUCCEEDED). An empty price map alone is not enough: a refused read gives one too.
export function OrderTotals({ totals }: { totals: OrderCostResult }) {
  const { t } = useT();
  const money = useMoney();
  const nameId = useId();
  if (totals.net === 0 && totals.missingPrice === 0) return null;

  // ⚠️ NOTHING PRICED IS NOT «0.00»: a bold zero would read as «this order is free»; say what is missing instead.
  if (totals.costed === 0) {
    return (
      <div role="group" aria-labelledby={nameId} className={styles.box}>
        <span id={nameId} className="visually-hidden">{t('ord.cost.orderTotal')}</span>
        <p className={styles.warn}>{t('ord.cost.nothingPriced')}</p>
      </div>
    );
  }

  const rates = Object.keys(totals.vatByRate).map(Number).sort((a, b) => a - b);
  return (
    <div role="group" aria-labelledby={nameId} className={styles.box}>
      <div className={styles.row}>
        <span>{t('ord.cost.net')}</span>
        <span>{formatMoney(totals.net, money)}</span>
      </div>
      {rates.map(rate => (
        <div key={rate} className={styles.row}>
          <span>{t('ord.cost.vatAtRate', { rate })}</span>
          <span>{formatMoney(totals.vatByRate[rate], money)}</span>
        </div>
      ))}
      <div className={`${styles.row} ${styles.total}`}>
        <span id={nameId}>{t('ord.cost.orderTotal')}</span>
        <span>{formatMoney(totals.gross, money)}</span>
      </div>
      {totals.missingPrice > 0 ? <p className={styles.warn}>{t('ord.cost.missingPrice', { n: totals.missingPrice })}</p> : null}
      {totals.missingVat > 0 ? <p className={styles.warn}>{t('ord.cost.missingVat', { n: totals.missingVat })}</p> : null}
    </div>
  );
}
