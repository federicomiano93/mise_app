import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { dayLabel } from '@mise/shared/day';
import { REQUEST_WINDOW_DAYS, isRequestDone, remainingIds, splitRequestsByAge, waitingRequests } from '@mise/shared/order-request-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useOrders } from './OrdersContext';
import { dayTranslate } from './dayWords';
import { LISTS_DOOR, listOpener, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { ORDERS_PATH } from './ordersPath';
import type { StoredDoc } from './ordersSource';
import styles from './OrderListsScreen.module.css';

type Props = {
  // One list is open over it: this screen stays mounted (the old lists that were asked for) but is not drawn, and Back finds it as
  // it was left.
  hidden: boolean;
  onOpen: (id: string) => void;
};

// What the screens print for the person who sent a list. ⚠️ NEVER AN ADDRESS (his decision of 3 Nov 2026, P13): a list with no name
// on it reads «Someone».
export const senderOf = (request: StoredDoc, someone: string): string =>
  typeof request.fromName === 'string' && request.fromName.trim() !== '' ? request.fromName : someone;

// «Order lists» (parity R1–R4), at /orders/lists, one level below the list: the lists somebody sent, those still to place first.
//
// ⚠️ A WINDOW, NOT A LIFETIME: lists older than 15 days are hidden behind a button that says how many, never deleted. The choice is
// kept for the life of this screen (it is redrawn on every snapshot: a colleague ticking a line must not fold the old lists away).
// ⚠️ TWO DIFFERENT EMPTY STATES: «nobody has sent one» says HOW to send one; «nothing in the last days» is a job finished.
export function OrderListsScreen({ hidden, onOpen }: Props) {
  const { t } = useT();
  const { state } = useLocation();
  const { requests, requestsLoaded, requestsBroken } = useOrders();
  const handBack = useHandBack();
  const leave = useLeave(ORDERS_PATH, useCallback(() => { handBack.expect(LISTS_DOOR); }, [handBack]));
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [showingOlder, setShowingOlder] = useState(false);
  const wantsRevealFocus = useRef(false);

  const { recent, older } = useMemo(() => splitRequestsByAge(requests, REQUEST_WINDOW_DAYS), [requests]);
  const shown = showingOlder ? requests : recent;
  const ordered = useMemo(() => [...waitingRequests(shown), ...shown.filter(request => isRequestDone(request))], [shown]);

  useEffect(() => {
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (!hidden && cameFromList(state)) title.current?.focus();
  }, []);

  // Back from one list: the section hands the focus to its card. When that card is gone (the list was deleted) the title takes it.
  useEffect(() => {
    if (hidden) return undefined;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) title.current?.focus();
    });
    return () => { cancelAnimationFrame(frame); };
  }, [hidden]);

  // «Show older lists» removes the button that held the focus: it goes to the first list that was revealed.
  useEffect(() => {
    if (!wantsRevealFocus.current || !showingOlder) return;
    wantsRevealFocus.current = false;
    list.current?.querySelector<HTMLElement>('[data-first-older]')?.focus();
  }, [showingOlder]);

  const dt = dayTranslate(t);
  const now = new Date();
  const firstOlderId = showingOlder ? older[0]?.id : undefined;

  return (
    <section className={styles.screen} aria-labelledby={titleId} hidden={hidden}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.request.title')} titleId={titleId} titleRef={title} />
      <div ref={list} className={styles.body}>
        {!requestsLoaded ? (
          <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        ) : ordered.length === 0 ? (
          // ⚠️ A DEAD STREAM IS NOT «NOBODY HAS SENT ONE»: the page's status line says what happened.
          requestsBroken && requests.length === 0 ? null : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>
                {requests.length === 0 ? t('ord.request.none') : t('ord.request.noneInWindow', { n: REQUEST_WINDOW_DAYS })}
              </p>
              {requests.length === 0 ? <p className={styles.emptyHint}>{t('ord.request.noneHint')}</p> : null}
            </div>
          )
        ) : (
          <ul className={styles.cards}>
            {ordered.map(request => {
              const done = isRequestDone(request);
              const total = Object.keys((request.quantities ?? {}) as Record<string, unknown>).length;
              return (
                <li key={request.id} className={styles.item}>
                  <button
                    ref={node => { handBack.register(listOpener(request.id), node); }}
                    type="button"
                    className={styles.card}
                    data-done={done ? 'true' : undefined}
                    data-first-older={request.id === firstOlderId ? '' : undefined}
                    onClick={() => { onOpen(request.id); }}
                  >
                    <span className={styles.main}>
                      <span className={styles.from}>{t('ord.request.from', { who: senderOf(request, t('ord.request.someone')) })}</span>
                      <span className={styles.when}>{dayLabel(String(request.date ?? ''), now, dt)}</span>
                    </span>
                    <span className={styles.count} data-done={done ? 'true' : undefined}>
                      {done ? t('ord.request.allOrdered') : t('ord.request.progress', { done: total - remainingIds(request).length, total })}
                    </span>
                    <ChevronRight aria-hidden="true" className={styles.chevron} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {/* ⚠️ IT HIDES, IT NEVER DELETES: the button says how many are behind it, so «nothing here» is never mistaken for «thrown away». */}
        {requestsLoaded && !showingOlder && older.length > 0 ? (
          <Button
            onPress={() => {
              wantsRevealFocus.current = true;
              setShowingOlder(true);
            }}
          >
            {t('ord.request.showOlder', { n: older.length })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
