import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { FROM_PARENT, cameFromParent } from './calculatorNav';
import { useClientOrders } from './CalculatorContext';
import { useClientsPaths } from './clientsPaths';
import { OrderCard } from './ClientOrderCard';
import { stillComing } from './clientOrdersStore';
import type { ClientOrder } from './clientOrdersStore';
import { OrdersHistory } from './OrdersHistory';
import { SettingsPage } from './SettingsPage';
import { SkipBoundary } from './SkipBoundary';
import { useApplyOrder } from './useApplyOrder';
import { useTodayISO } from './useTodayISO';
import styles from './ClientOrders.module.css';

// Orders received: what the clients ordered through their own links, one level below the work view. Two views, each its
// own address so Back and a reload land on the same one: the orders still to come (the screen about today's work) and
// the history (a record, read on demand).
//
// ⚠️ `readOnly` IS THE CLIENTS SECTION'S (the owner of the sales side): the cards have no «put in the Calculator» button and
// nothing here touches the Calculator's logs or recipes. The Calculator draws it without.
export function OrdersReceived({ view, readOnly = false }: { view: 'coming' | 'history'; readOnly?: boolean }) {
  const { t } = useT();
  const paths = useClientsPaths();
  return (
    <SettingsPage title={t('ui.ordersReceived')} fallback={paths.ordersBack}>
      <ViewSwitch view={view} />
      {/* The history is its own part: a failing card of the one must not take the other down. */}
      <PartBoundary resetKey={view}>{view === 'coming' ? <StillComing readOnly={readOnly} /> : <OrdersHistory />}</PartBoundary>
    </SettingsPage>
  );
}

// The two views, chosen above the list.
//
// ⚠️ THE HISTORY LIVES HERE AND NOT BEHIND A FOURTH DOOR. It also belongs here on merit: the empty state below used to
// apologise for the history not existing, and that apology is now the way in.
//
// Two links, each the address of its view, so a reload and a shared link land on the same one. Choosing one REPLACES the
// entry (a lateral move, like picking a tab): Back still leaves Orders received, not the view you were on a moment ago.
function ViewSwitch({ view }: { view: 'coming' | 'history' }) {
  const { t } = useT();
  const { state } = useLocation();
  const paths = useClientsPaths();
  // The move keeps what the entry knew of how it was opened, so Back keeps meaning the same thing; the focus stays on
  // the link pressed.
  const carried = cameFromParent(state) ? FROM_PARENT : KEEP_FOCUS;
  return (
    <nav className={styles.switch} aria-label={t('ui.ordersReceived')}>
      <Link
        to={paths.orders}
        replace
        state={carried}
        className={styles.switchLink}
        aria-current={view === 'coming' ? 'page' : undefined}
      >
        {t('calc.stillComing')}
      </Link>
      <Link
        to={paths.ordersHistory}
        replace
        state={carried}
        className={styles.switchLink}
        aria-current={view === 'history' ? 'page' : undefined}
      >
        {t('ui.history')}
      </Link>
    </nav>
  );
}

// ⚠️ THE HOOK THAT PUTS AN ORDER INTO THE CALCULATOR IS CALLED ONLY BY THE VARIANT THAT NEEDS IT: it writes dough logs and
// stamps recipes, which the rules refuse the owner of the sales side, so the read-only list never mounts it.
function StillComing({ readOnly }: { readOnly: boolean }) {
  return readOnly ? <ComingOrders /> : <ComingOrdersToApply />;
}

function ComingOrdersToApply() {
  const [apply, dialogs] = useApplyOrder();
  return <ComingOrders onApply={next => { void apply(next); }} dialogs={dialogs} />;
}

function ComingOrders({ onApply, dialogs }: { onApply?: (order: ClientOrder) => void; dialogs?: ReactNode }) {
  const { t } = useT();
  const snapshot = useClientOrders();
  const today = useTodayISO();
  const orders = stillComing(snapshot.orders, today);

  // ⚠️ THE SENTENCE SAYS WHAT IS MISSING AND WHY. "No orders" has three very different meanings here: the stream died,
  // the server has not answered yet (an empty list may only be this phone's old copy), or nobody sent one. A screen that
  // cannot tell them apart leaves you to guess whether something was lost.
  if (snapshot.ordersFailed) return <p className={styles.none}>{t('calc.clientOrders.failed')}</p>;
  if (!snapshot.ordersLoaded) return <p className={styles.none}>{t('calc.loading')}</p>;
  if (orders.length === 0) {
    return (
      <p className={styles.none}>
        {snapshot.ordersFromServer ? t('calc.clientOrders.empty') : t('calc.clientOrders.notArrived')}
      </p>
    );
  }
  return (
    <div className={styles.list}>
      {orders.map(order => (
        // One bad order never takes the screen down; it comes back if the order is replaced.
        <SkipBoundary key={order.id} resetKey={`${String(order.updatedAt)}:${String(order.appliedFor)}`}>
          <OrderCard order={order} {...(onApply ? { onApply } : {})} />
        </SkipBoundary>
      ))}
      {dialogs}
    </div>
  );
}
