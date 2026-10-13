import { useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { useClientOrders } from './CalculatorContext';
import { FROM_PARENT } from './calculatorNav';
import { ORDERS_PATH } from './calculatorPath';
import { stillComing } from './clientOrdersStore';
import { bannerCounts } from './clientOrdersView';
import { ORDERS_BANNER_OPENER, useHandBack } from './handBack';
import { useTodayISO } from './useTodayISO';
import styles from './OrdersBanner.module.css';

// The line above the tabs that says clients' orders are waiting, and the way into them.
//
// ⚠️ IT IS AN ALARM THAT GOES QUIET AT THE END OF THE JOB: lit only for an order still to come that was never put into
// the Calculator or CHANGED since it was (and «changed» is louder, in red). A banner still lit after the work is done is
// one people learn to ignore. The door that is always there is the «Orders» button beside Log and Settings — so this
// banner follows no switch: the venue's «show the Orders button» setting hides the door, never the alarm.
export function OrdersBanner() {
  const { t } = useT();
  const { orders } = useClientOrders();
  const today = useTodayISO();
  const handBack = useHandBack();
  const register = useCallback((node: HTMLAnchorElement | null) => { handBack.register(ORDERS_BANNER_OPENER, node); }, [handBack]);
  const { waiting, changed } = bannerCounts(stillComing(orders, today));
  if (waiting === 0) return null;

  return (
    <Link
      ref={register}
      to={ORDERS_PATH}
      state={FROM_PARENT}
      className={styles.banner}
      data-tone={changed > 0 ? 'danger' : 'info'}
      onClick={() => { handBack.expect(ORDERS_BANNER_OPENER); }}
    >
      <span className={styles.text}>
        {changed > 0 ? t('calc.co.ordersChanged', { n: changed }) : t('calc.co.ordersReceived', { n: waiting })}
      </span>
      <ChevronRight aria-hidden="true" />
    </Link>
  );
}
