import type { KeyboardEvent } from 'react';
import { CalendarClock, ChevronRight, X } from 'lucide-react';
import { dayPhrase, daySpoken, spellShortDate, todayISO } from '@mise/shared/day';
import { nextOrderOffer } from '@mise/shared/order-day';
import type { PendingSupplier } from '@mise/shared/reminders';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useNotices } from './NoticesContext';
import { useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';
import styles from './NoticesPanel.module.css';

type Props = {
  onOpenSupplier: (id: string) => void;
  // «Placed yesterday»: the supplier's confirm screen, recording under that day.
  onOpenPending: (id: string, day: string) => void;
};

// What the bell opens (step 3f-6, parity R3–R11), under the list's head: NOT a dialog and not an overlay, so it pushes the list down
// and the list stays usable. In order: the orders typed on an earlier day and never placed, what was added that nobody was told about,
// the calendar notices (or, once all are put away, the pill that brings them back); with nothing at all, one line that says so.
//
// ⚠️ ONLY THE CALENDAR NOTICES CAN BE CLOSED (Federico, 24 Aug 2026): the rest is WORK, and a closeable piece of work is one somebody
// can close by mistake and never see again.
export function NoticesPanel({ onOpenSupplier, onOpenPending }: Props) {
  const { t } = useT();
  const { open, setOpen, panelId, bellRef, pending, untold, calendar, closed, close, reopen } = useNotices();
  const { canManage } = useSession();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const dt = dayTranslate(t);
  const today = todayISO();
  const now = new Date();

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.stopPropagation();
    setOpen(false);
    bellRef.current?.focus();
  }

  async function discard(row: PendingSupplier<StoredDoc>) {
    const name = supplierLabel(row.supplier);
    const sure = await confirm({
      title: t('ord.pending.discardTitle', { name }),
      message: t('ord.pending.discardConfirm', { name }),
      okLabel: t('ui.discard'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!sure) return;
    const outcome = await store.clearQuantities([row.supplier.id], t('ord.noSupplier'));
    if (outcome === 'cleared') say(t('ord.pending.discarded', { name }), 4000);
    else say(outcome === 'offline' ? t('ord.offline.clear') : t('ord.pending.discardFailed'), LONG_MS);
  }

  if (!open) return null;
  const nothing = pending.length === 0 && untold.length === 0 && calendar.length === 0 && closed === 0;
  return (
    <>
      <section id={panelId} role="region" aria-label={t('ord.notices.title')} className={styles.panel} onKeyDown={onKeyDown}>
        {pending.map(row => {
          const id = row.supplier.id;
          const name = supplierLabel(row.supplier);
          const next = nextOrderOffer(row.supplier, today);
          return (
            <div key={id} className={styles.pending}>
              <p className={styles.title}>{t('ord.pending.title', { supplier: name })}</p>
              <p className={styles.sub}>{t('ord.pending.items', { n: row.itemCount, when: dayPhrase(row.day, now, dt) })}</p>
              <div className={styles.actions}>
                <Button variant="primary" onPress={() => { onOpenPending(id, row.day); }}>
                  {t('ord.pending.placed', { when: daySpoken(row.day, now, dt) })}
                </Button>
                <Button onPress={() => { void store.setDay(row.supplier, today); }}>{t('ord.pending.today')}</Button>
                {next === null ? null : (
                  <Button onPress={() => { void store.setDay(row.supplier, next); }}>
                    {t('ord.pending.next', { day: spellShortDate(next, dt) })}
                  </Button>
                )}
                <Button variant="danger" onPress={() => { void discard(row); }}>{t('ui.discard')}</Button>
              </div>
            </div>
          );
        })}

        {untold.map(group => (
          <div key={group.supplierId} className={styles.group}>
            {group.added.length > 0 ? (
              canManage ? (
                <Button variant="bare" className={styles.untold} onPress={() => { onOpenSupplier(group.supplierId); }}>
                  <span className={styles.text}>{t('ord.untold.changed', { supplier: group.supplierName, n: group.added.length })}</span>
                  <ChevronRight aria-hidden="true" />
                </Button>
              ) : (
                <p className={styles.untold}>
                  <span className={styles.text}>{t('ord.untold.changed', { supplier: group.supplierName, n: group.added.length })}</span>
                </p>
              )
            ) : null}
            {group.afterOrdering.length > 0 ? (
              <div className={styles.already}>
                <p className={styles.title}>{t('ord.untold.alreadyTitle')}</p>
                {group.afterOrdering.map(line => (
                  <p key={line.id}>{t('ord.untold.alreadyLine', { name: line.name, ordered: line.ordered, live: line.live })}</p>
                ))}
                <p className={styles.sub}>{t('ord.untold.callSupplier')}</p>
              </div>
            ) : null}
          </div>
        ))}

        {calendar.map(notice => (
          <div key={notice.key} className={styles.calendar}>
            <p className={styles.text}>{notice.text}</p>
            {/* ⚠️ A SIBLING OF THE TEXT, never inside it: a button inside the words would be read as part of them. */}
            <Button variant="bare" className={styles.close} aria-label={t('ord.notice.close')} onPress={() => { close(notice.key); }}>
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
        {/* ⚠️ ONLY WHEN NOTHING IS LEFT OPEN: a pill beside a banner would be two controls for one fact. */}
        {calendar.length === 0 && closed > 0 ? (
          <Button variant="bare" className={styles.pill} aria-label={t('ord.notice.reopen')} onPress={reopen}>
            <CalendarClock aria-hidden="true" />
            <span aria-hidden="true">{closed}</span>
          </Button>
        ) : null}

        {nothing ? <p className={styles.empty}>{t('ord.notices.empty')}</p> : null}
      </section>
      {confirmDialog}
    </>
  );
}
