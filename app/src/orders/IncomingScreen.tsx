import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { recordDate } from '@mise/shared/archive';
import { dayLabel, spellDay } from '@mise/shared/day';
import { pendingDeliveries } from '@mise/shared/deliveries';
import type { PendingEntry } from '@mise/shared/deliveries';
import { indexById } from '@mise/shared/order-text';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useOrders, useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import { INCOMING_DOOR, arrivalOpener, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { ORDERS_PATH } from './ordersPath';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';
import { useDeliveryView } from './useDeliveryView';
import { useKeepFocus } from './useKeepFocus';
import styles from './IncomingScreen.module.css';

type Props = {
  // The screen for one order is open over it: Incoming stays mounted, hidden, so Back finds it as it was left.
  hidden: boolean;
  onOpenMissing: (record: StoredDoc) => void;
};

// The marks a record already carries («did not arrive»): a same-day order added to a delivery that was answered re-opens it with
// them (js/orders/archive.js mergeArchives).
export function carriedMissingIds(record: StoredDoc): string[] {
  const missing = record.missing;
  if (typeof missing !== 'object' || missing === null) return [];
  return Object.entries(missing).filter(([, flag]) => flag === true).map(([id]) => id);
}

type Entry = PendingEntry<StoredDoc, StoredDoc>;
type Row = { entry: Entry; tone: 'late' | 'due' | 'coming' | 'owed' };

// «Incoming» (parity V1–V6), at /orders/incoming, one level below the list: what was ordered and has not been answered.
//
// ⚠️ AN ORDER LEAVES THIS SCREEN ONLY WHEN SOMEBODY SAYS IT ARRIVED. Nothing here deduces a delivery from the supplier's delivery
// days: that would drop an order off the list the day it was due, so the one that NEVER came would be the only one nobody sees, on
// a screen that looks perfectly healthy because it is empty.
//
// The debt (orders from before this week) is a group of its own, first, oldest first, answered one row at a time — the current app
// asked about them in one dialog after another; here each is a row like any other, so none is answered by tapping through.
//
// ⚠️ TWO STRAIGHT ANSWERS, NOT A LIST TO TICK: «Everything arrived» is one tap for the normal case, and «Something is missing» is
// the only path that opens the rows. Escape or the dialog's close answers NOTHING (the current app took Cancel for «missing»).
// ⚠️ THE ANSWER IS NOT AWAITED (local-first): offline the promise waits for the connection, and the row is already answered on
// this phone; only a refusal is said.
export function IncomingScreen({ hidden, onOpenMissing }: Props) {
  const { t } = useT();
  const { state } = useLocation();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const { history, suppliers } = useOrders();
  const { today, weekStartsOn, records, owed } = useDeliveryView();
  const dt = dayTranslate(t);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<StoredDoc | null>(null);
  // Back goes to the list and the focus to the door (the banner's press opens it with the door as its opener too).
  const leave = useLeave(ORDERS_PATH, useCallback(() => { handBack.expect(INCOMING_DOOR); }, [handBack]));

  const suppliersById = useMemo(() => indexById(suppliers), [suppliers]);
  const groups = useMemo(
    () => pendingDeliveries<StoredDoc, StoredDoc>(records, suppliersById, today, { weekStartsOn }),
    [records, suppliersById, today, weekStartsOn],
  );
  const sections: Array<{ key: string; heading: string; rows: Row[] }> = [
    {
      key: 'owed',
      heading: t('ord.incoming.before'),
      rows: owed.map(order => ({ entry: { order, supplier: suppliersById[String(order.supplierId)] ?? null, expected: '' }, tone: 'owed' as const })),
    },
    { key: 'late', heading: t('ord.incoming.late'), rows: groups.late.map(entry => ({ entry, tone: 'late' as const })) },
    { key: 'due', heading: t('ord.incoming.dueToday'), rows: groups.dueToday.map(entry => ({ entry, tone: 'due' as const })) },
    { key: 'coming', heading: t('ord.incoming.coming'), rows: groups.coming.map(entry => ({ entry, tone: 'coming' as const })) },
  ].filter(section => section.rows.length > 0);
  const total = sections.reduce((n, section) => n + section.rows.length, 0);

  const keepFocus = useKeepFocus(body, title, sections.flatMap(section => section.rows.map(row => row.entry.order.id)).join('|'));

  useEffect(() => {
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once. ⚠️ NOT when Back from the
    // screen for one order has just given it to the row: the hand-back runs before this effect.
    if (!hidden && cameFromList(state) && !body.current?.contains(document.activeElement)) title.current?.focus();
  }, []);

  // Back from «What arrived?»: the section hands the focus to the row that opened it. When that row is gone (the order was
  // answered) the focus would drop on the page: this title takes it instead.
  useEffect(() => {
    if (hidden) return undefined;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) title.current?.focus();
    });
    return () => { cancelAnimationFrame(frame); };
  }, [hidden]);

  const nameOf = (entry: Entry): string =>
    supplierLabel(entry.supplier) || (typeof entry.order.supplierName === 'string' ? entry.order.supplierName : '') || t('ord.incoming.unknownSupplier');

  // The write is not awaited: the row is already answered here (local-first). Only a refusal or a failure is said.
  function answer(record: StoredDoc): void {
    const said = () => { say(t('ord.incoming.couldNotSave'), LONG_MS); };
    store.confirmDelivery(record, []).then(outcome => { if (outcome !== 'saved') said(); }, said);
  }

  function pick(entry: Entry): void {
    // ⚠️ AN ORDER THAT ALREADY CARRIES «DID NOT ARRIVE» MARKS goes straight to the rows: «everything arrived» would also tick the
    // lines already known to be missing — one tap erasing what somebody said earlier.
    if (carriedMissingIds(entry.order).length > 0) onOpenMissing(entry.order);
    else setAsking(entry.order);
  }

  const askedEntry = asking === null ? null : sections.flatMap(section => section.rows).find(row => row.entry.order.id === asking.id)?.entry ?? null;

  // The order the question is about left the list (answered on another phone): forget it, or the question would come back by
  // itself if the order re-opened.
  useEffect(() => {
    if (asking !== null && askedEntry === null) setAsking(null);
  }, [asking, askedEntry]);

  // ⚠️ «Everything arrived» answers for the order AS IT IS NOW (askedEntry is read from the live data, not from the row that was
  // tapped): a same-day second order may have merged into it while the question was open, bringing «did not arrive» marks that
  // `missing: {}` would erase. Then it goes to the rows instead, as an order that carried them at the start does.
  function everythingArrived(): void {
    setAsking(null);
    if (askedEntry === null) return;
    if (carriedMissingIds(askedEntry.order).length > 0) onOpenMissing(askedEntry.order);
    else answer(askedEntry.order);
  }

  return (
    <section className={styles.screen} aria-labelledby={titleId} hidden={hidden}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.incoming.title')} titleId={titleId} titleRef={title} />
      <div ref={body} className={styles.body} onFocusCapture={keepFocus}>
        {total === 0 ? (
          <p className={styles.empty}>{history.length > 0 ? t('ord.incoming.allArrived') : t('ord.incoming.noneYet')}</p>
        ) : sections.map(section => (
          <div key={section.key} className={styles.group}>
            <h3 className={styles.groupTitle}>{section.heading}</h3>
            <ul className={styles.rows}>
              {section.rows.map(({ entry, tone }) => {
                const { order, expected } = entry;
                const rowId = order.id;
                return (
                  <li key={rowId} className={styles.item} data-keep={rowId} data-tone={tone}>
                    <ArrivalRow
                      id={rowId}
                      name={nameOf(entry)}
                      // ⚠️ AN ORDER WITH NO EXPECTED DATE SAYS SO, rather than a blank where a date belongs: «we do not know» is an
                      // answer, an empty gap is a bug people report. (A debt row has no expected day at all: only the ordered line.)
                      when={tone === 'owed' ? '' : expected !== ''
                        ? t('ord.incoming.expectedOn', { day: dayLabel(expected, new Date(`${today}T12:00:00`), dt) })
                        : t('ord.incoming.noExpectedDay')}
                      // ⚠️ `n` AS A NUMBER: Intl.PluralRules picks the form from it, and '1' is not 1.
                      ordered={t('ord.incoming.orderedOn', { day: spellDay(recordDate(order), dt), n: Object.keys((order.quantities ?? {}) as object).length })}
                      onPress={() => { pick(entry); }}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {askedEntry === null ? null : (
        <Dialog
          isOpen
          role="alertdialog"
          title={t('ord.incoming.arrivedTitle', { supplier: nameOf(askedEntry) })}
          message={t('ord.incoming.arrivedMessage', { day: spellDay(recordDate(askedEntry.order), dt) })}
          onClose={() => { setAsking(null); }}
          actions={(
            <>
              <Button onPress={() => { setAsking(null); onOpenMissing(askedEntry.order); }}>{t('ord.incoming.somethingMissing')}</Button>
              <Button variant="primary" autoFocus onPress={everythingArrived}>
                {t('ord.incoming.allArrivedBtn')}
              </Button>
            </>
          )}
        />
      )}
    </section>
  );
}

function ArrivalRow({ id, name, when, ordered, onPress }: { id: string; name: string; when: string; ordered: string; onPress: () => void }) {
  const handBack = useHandBack();
  const node = useCallback((button: HTMLButtonElement | null) => { handBack.register(arrivalOpener(id), button); }, [handBack, id]);
  return (
    <Button ref={node} variant="bare" className={styles.row} onPress={onPress}>
      <span className={styles.main}>
        <span className={styles.name}>{name}</span>
        {when === '' ? null : <span className={styles.meta}>{when}</span>}
        <span className={styles.meta}>{ordered}</span>
      </span>
      <ChevronRight aria-hidden="true" className={styles.chevron} />
    </Button>
  );
}
