import { useEffect, useId, useRef } from 'react';
import { useLocation } from 'react-router';
import { qtyWithUnit } from '@mise/shared/order-unit';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useMoney } from '../session/useMoney';
import { OrderTotals } from './OrderTotals';
import { useOrders } from './OrdersContext';
import { SUMMARY_DOOR, summaryOpener, useHandBack } from './handBack';
import { cameFromList, cameFromSupplier, useLeave } from './ordersNav';
import { supplierPath } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import { lineCostText, summaryFor } from './orderMoney';
import styles from './SupplierSummaryScreen.module.css';

// The order summary: one supplier's CURRENT order, to LOOK AT. It writes nothing, which is why it can be opened in the middle of an
// order without a thought (parity L19).
//
// ⚠️ THE SAME LINES AS THE MESSAGE: summaryFor() takes the lens's lines through the selection the send screen uses, so this can never
// show what the supplier will not receive. The money (a cost line under each line, the totals box) is drawn ONLY when the store says
// the prices are readable (the read of ingredient-prices succeeded): never from an empty map, never for somebody the rules refuse.
export function SupplierSummaryScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const money = useMoney();
  const { state } = useLocation();
  const { draft, prices, pricesReadable } = useOrders();
  const handBack = useHandBack();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // Back is the browser's Back when the supplier's screen or the list is the entry behind; an address typed in goes up one level, to
  // the supplier's order.
  const leave = useLeave(supplierPath(id), () => { handBack.expect(cameFromSupplier(state) ? SUMMARY_DOOR : summaryOpener(id)); });

  const supplier = lens.supplierById(id);
  const shown = supplier !== undefined;
  useEffect(() => {
    if (shown && cameFromList(state)) title.current?.focus();
  }, [shown]);

  if (supplier === undefined) {
    return (
      <section className={styles.screen} aria-label={t('section.orders')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('section.orders')} titleRef={title} />
        <p className={styles.nothing}>{t('ord.supplierGone')}</p>
      </section>
    );
  }

  const summary = summaryFor(lens, id, draft, prices, pricesReadable);
  const lines = summary.costLines;

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={supplierLabel(supplier)}
        titleId={titleId}
        titleRef={title}
        sub={lines.length > 0 ? <p className={styles.sub}>{t('ord.summaryCount', { n: lines.length })}</p> : undefined}
      />
      <div className={styles.body}>
        {lines.length === 0 ? (
          <p className={styles.nothing}>{t('ord.summaryEmpty')}</p>
        ) : (
          <>
            <ul className={styles.list}>
              {lines.map((line, index) => {
                const cost = pricesReadable ? lineCostText(t, money, line) : null;
                return (
                  <li key={`${line.label}:${index}`} className={styles.row}>
                    <span className={styles.label}>{line.label}</span>
                    <span className={styles.qty}>{qtyWithUnit(line.qty, line.unit)}</span>
                    {cost ? <span className={cost.warn ? `${styles.cost} ${styles.warn}` : styles.cost}>{cost.text}</span> : null}
                  </li>
                );
              })}
            </ul>
            {pricesReadable ? <OrderTotals totals={summary.totals} /> : null}
          </>
        )}
      </div>
    </section>
  );
}
