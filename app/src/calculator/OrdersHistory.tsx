import { useEffect, useId, useState } from 'react';
import { HISTORY_WINDOW_DAYS, emptyWords, groupByDay, pastWindow } from '@mise/shared/client-order-history';
import type { HistoryDay } from '@mise/shared/client-order-history';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useClientOrdersStore } from './CalculatorContext';
import { PastOrderCard } from './ClientOrderCard';
import type { ClientOrder } from './clientOrdersStore';
import { dayLabel } from './clientOrdersView';
import { SkipBoundary } from './SkipBoundary';
import styles from './ClientOrders.module.css';

type Read =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly orders: readonly ClientOrder[]; readonly everReceived: boolean; readonly days: number };

// The history of the clients' orders: the days before today, read on demand when this address opens and never watched
// (a past order does not change). The window starts at the last 15 days and widens by 15 each time «Show older» is
// pressed; it lives in this component, so it is back at 15 whenever the screen is left.
//
// ⚠️ NOTHING HERE DELETES ANYTHING, AND THE ORDERS BEYOND THE WINDOW ARE STILL IN THE DATABASE: the window is what the
// screen draws, and «Show older» widens it.
export function OrdersHistory() {
  const { t, locale } = useT();
  const store = useClientOrdersStore();
  const [windows, setWindows] = useState(1);
  const [read, setRead] = useState<Read>({ status: 'loading' });
  // The orders on screen stay while a wider window is being read, and say so: the button the person just pressed must
  // not vanish under their finger.
  const [reading, setReading] = useState(false);

  useEffect(() => {
    let current = true;
    setReading(true);
    void (async () => {
      try {
        const orders = await store.readPast(pastWindow(Date.now(), windows));
        // Only asked when the window came back empty: it decides between two sentences that mean opposite things.
        const everReceived = orders.length > 0 || await store.hasAnyOrder();
        if (current) setRead({ status: 'ready', orders, everReceived, days: HISTORY_WINDOW_DAYS * windows });
      } catch {
        if (current) setRead({ status: 'failed' });
      }
      if (current) setReading(false);
    })();
    return () => { current = false; };
  }, [store, windows]);

  // ⚠️ SAYS WHAT WENT WRONG rather than showing an empty list: an empty list and a failed read look identical, and one
  // means «nothing was ordered» while the other means «ask again in a minute».
  if (read.status === 'loading') return <p className={styles.none}>{t('calc.loading')}</p>;
  if (read.status === 'failed') return <p className={styles.none}>{t('calc.couldNotLoadThe')}</p>;

  const days = groupByDay<ClientOrder>(read.orders);
  const now = Date.now();
  return (
    <div className={styles.list} aria-busy={reading}>
      {days.length === 0 ? (
        <p className={styles.none}>
          {emptyWords(read.days, read.everReceived, (key, params) => t(key as MessageKey, params))}
        </p>
      ) : days.map(day => (
        <Day key={day.date} day={day} heading={dayLabel(t, locale, day.date, now)} />
      ))}
      {/* ⚠️ ALWAYS OFFERED, even on an empty window: the whole point of the sentence above is that older orders are
          still there, and a promise with no way to act on it is worse than no promise. Widening is one more read of at
          most 200 documents. */}
      <Button className={styles.older} isDisabled={reading} onPress={() => { setWindows(known => known + 1); }}>
        {t('calc.co.showOlder', { n: HISTORY_WINDOW_DAYS * windows })}
      </Button>
    </div>
  );
}

function Day({ day, heading }: { day: HistoryDay<ClientOrder>; heading: string }) {
  const id = useId();
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.dayHeading}>{heading}</h3>
      {day.orders.map(order => (
        <SkipBoundary key={order.id} resetKey={String(order.updatedAt)}>
          <PastOrderCard order={order} />
        </SkipBoundary>
      ))}
    </section>
  );
}
