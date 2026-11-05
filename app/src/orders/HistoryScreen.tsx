import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Share } from 'lucide-react';
import { countRecords, groupHistoryByDay, splitHistoryByAge } from '@mise/shared/archive';
import type { HistoryDay } from '@mise/shared/archive';
import { dayLabel } from '@mise/shared/day';
import { HISTORY_LIVE_MONTHS, historyFooter, mergeHistory, olderFooterState } from '@mise/shared/history-window';
import { outputLanguage } from '@mise/shared/market';
import { resolveSuppliers } from '@mise/shared/no-supplier';
import { indexById } from '@mise/shared/order-text';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { HistoryCard } from './HistoryCard';
import { joinList } from './orderWords';
import { useOrders, useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import { HISTORY_DOOR, sendDayOpener, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { SETTINGS_PATH } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import { recordSendRows } from './sendFlow';
import { LONG_MS } from './useClearQuantities';
import { useSendOrder } from './useSendOrder';
import styles from './HistoryScreen.module.css';

type Props = {
  lens: OrdersLens;
  // The editor or the day screen is open over it: History stays mounted (the cards that were opened, the older days that were
  // asked for) but is not drawn, and Back finds it as it was left.
  hidden: boolean;
  onOpenEdit: (record: StoredDoc) => void;
  onOpenDay: (date: string) => void;
};

// «Past orders» (parity H1–H8), at /orders/history, one level below the settings: one section per DAY, newest first, and in it
// one collapsible card per supplier. The records are the live window (the last two months) plus the older pages the person asked
// for from the server; the days beyond `historyDays` are parked behind «Show older orders».
//
// ⚠️ `showingOlder` IS KEPT FOR THE LIFE OF THIS SCREEN (it is redrawn on every snapshot — another phone recording an order must
// not fold the old orders away under the finger of whoever is reading them), AND PUT BACK when the number of days changes:
// changing the setting is a statement about how much to show and must win over an earlier «show me everything».
//
// «Send again» takes the same road chooser as the send arrow (his decision F8) and records nothing.
export function HistoryScreen({ lens, hidden, onOpenEdit, onOpenDay }: Props) {
  const { t } = useT();
  const session = useSession();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const snapshot = useOrders();
  const { config, older: paging } = snapshot;
  const leave = useLeave(SETTINGS_PATH, () => { handBack.expect(HISTORY_DOOR); });
  const [send, sendDialogs] = useSendOrder(lens);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const loadButton = useRef<HTMLButtonElement>(null);
  const { state } = useLocation();

  const [showingOlder, setShowingOlder] = useState(false);
  const [windowDays, setWindowDays] = useState(config.historyDays);
  if (windowDays !== config.historyDays) {
    setWindowDays(config.historyDays);
    setShowingOlder(false);
  }

  const records = useMemo(() => mergeHistory(snapshot.history, snapshot.olderHistory), [snapshot.history, snapshot.olderHistory]);
  const days = useMemo(() => groupHistoryByDay(records), [records]);
  const { recent, older } = useMemo(() => splitHistoryByAge(days, config.historyDays), [days, config.historyDays]);
  const foot = historyFooter({ recentCount: recent.length, olderInMemory: older.length, showingOlder, older: paging });
  const loadState = olderFooterState(paging);

  // The ingredients as the order lists them now (a line sent to another supplier this time included), and the suppliers, by id.
  const ingredientsById = useMemo(
    () => indexById(resolveSuppliers(snapshot.ingredients, snapshot.suppliers, snapshot.suppliersLoaded, snapshot.draft.entries)),
    [snapshot.ingredients, snapshot.suppliers, snapshot.suppliersLoaded, snapshot.draft.entries],
  );
  const suppliersById = useMemo(() => indexById(snapshot.suppliers), [snapshot.suppliers]);

  useEffect(() => {
    // Opened from the settings the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (!hidden && cameFromList(state)) title.current?.focus();
  }, []);

  // Back from the editor or the day screen: the section hands the focus to the button that opened it. When that button is gone
  // (its order was just deleted, or deleted by another phone) the focus would drop on the page: this title takes it instead.
  useEffect(() => {
    if (hidden) return undefined;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) title.current?.focus();
    });
    return () => { cancelAnimationFrame(frame); };
  }, [hidden]);

  // «Load older orders» keeps the focus: the button is disabled while the page is on its way (a disabled button drops the focus
  // on the page), so the wish waits until it is back, or — when it is gone for good — the list takes the focus.
  const wantsLoadFocus = useRef(false);
  useEffect(() => {
    if (!wantsLoadFocus.current) return;
    const button = loadButton.current;
    if (foot.load) {
      if (button && !button.disabled) {
        button.focus();
        wantsLoadFocus.current = false;
      }
      return;
    }
    wantsLoadFocus.current = false;
    list.current?.focus();
  });

  // «Show older orders» removes the button that held the focus: it goes to the first card that was revealed.
  const wantsRevealFocus = useRef(false);
  useEffect(() => {
    if (!wantsRevealFocus.current || !showingOlder) return;
    wantsRevealFocus.current = false;
    list.current?.querySelector<HTMLElement>('[data-first-older]')?.focus();
  }, [showingOlder]);

  const loadOlder = () => {
    // The loaded page is entirely older than historyDays: without this it would be parked behind «Show older orders» and the
    // person would see nothing happen. ⚠️ THE LOAD STARTS FIRST, so the render that follows already reads «Loading…».
    void store.loadOlderHistory();
    wantsLoadFocus.current = true;
    setShowingOlder(true);
  };

  // «Send again»: ONE road chooser, the same as the send arrow's. ⚠️ `send` IS CALLED STRAIGHT FROM THE PRESS, with nothing
  // awaited first (a window opened later is blocked as a pop-up). A second press while one is pending is ignored; a send that
  // throws or rejects frees the button and says a friendly line. Nothing is recorded after it. ⚠️ A SEND THAT REACHED NOBODY IS
  // SAID, never silent (X17): every window blocked → «Non si è aperto niente»; the road had no phone or email → the supplier named.
  const pending = useRef(false);
  const sendAgain = (record: StoredDoc) => {
    if (pending.current) return;
    const rows = recordSendRows([record], snapshot.ingredients, outputLanguage(session.location));
    if (rows.length === 0) {
      say(t('ord.history.sendEmpty'), 4000);
      return;
    }
    pending.current = true;
    const failed = (err: unknown) => {
      console.error('Sending the order again failed:', err);
      pending.current = false;
      say(t('ord.send.failed'), LONG_MS);
    };
    let sending: ReturnType<typeof send>;
    try {
      sending = send({ rows, grouped: true, supplierRoadsOnly: false, resend: true });
    } catch (err) {
      failed(err);
      return;
    }
    void sending.then(result => {
      pending.current = false;
      if (result?.kind !== 'sent' || result.ids.length > 0) return;
      say(result.blocked ? t('ord.send.nothingOpened') : t('ord.sentCheck.notReached', { names: joinList(t, rows.map(row => row.name)) }), LONG_MS);
    }).catch(failed);
  };

  const dt = dayTranslate(t);
  const now = new Date();
  const shownDays = foot.days === 'all' ? days : recent;
  const firstOlderDate = foot.days === 'all' ? older[0]?.date : undefined;

  const loadFoot = (
    <div className={styles.foot}>
      {/* ⚠️ THE LIVE REGION IS THERE BEFORE IT SPEAKS: only its text comes and goes. */}
      <div role="status">
        {loadState.failed ? <p className={styles.problem}>{t('ord.history.olderFailed')}</p> : null}
      </div>
      <Button ref={loadButton} isDisabled={loadState.disabled} onPress={loadOlder}>
        {loadState.disabled ? t('session.loading') : t('ord.history.loadOlder')}
      </Button>
    </div>
  );

  return (
    <section className={styles.screen} aria-labelledby={titleId} hidden={hidden}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.history.title')} titleId={titleId} titleRef={title} />
      <div ref={list} tabIndex={-1} className={styles.body}>
        {!snapshot.historyLoaded ? (
          <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        ) : foot.empty ? (
          <>
            {/* Nothing live, but older orders may exist: never say there are none until they were looked at. */}
            <p className={styles.empty}>
              {foot.empty === 'none' ? t('ord.history.none') : t('ord.history.noneRecent', { n: HISTORY_LIVE_MONTHS })}
            </p>
            {foot.load ? loadFoot : null}
          </>
        ) : (
          <>
            {shownDays.map(day => (
              <DaySection
                key={day.date}
                day={day}
                label={dayLabel(day.date, now, dt)}
                firstOlderDate={firstOlderDate}
                ingredientsById={ingredientsById}
                suppliersById={suppliersById}
                onSendAgain={sendAgain}
                onCorrect={onOpenEdit}
                onOpenDay={onOpenDay}
              />
            ))}
            {foot.parkedFoot ? (
              <div className={styles.foot}>
                {/* The note and the button go together: revealing the old orders takes the note with it. */}
                {foot.note ? <p className={styles.empty}>{t('ord.history.noneInDays', { n: Number(config.historyDays) })}</p> : null}
                <Button
                  onPress={() => {
                    wantsRevealFocus.current = true;
                    setShowingOlder(true);
                  }}
                >
                  {t('ord.history.showOlder', { n: countRecords(older) })}
                </Button>
              </div>
            ) : foot.load ? loadFoot : null}
          </>
        )}
      </div>
      {sendDialogs}
    </section>
  );
}

type DayProps = {
  day: HistoryDay<StoredDoc>;
  label: string;
  firstOlderDate: string | undefined;
  ingredientsById: Readonly<Record<string, StoredDoc>>;
  suppliersById: Readonly<Record<string, StoredDoc>>;
  onSendAgain: (record: StoredDoc) => void;
  onCorrect: (record: StoredDoc) => void;
  onOpenDay: (date: string) => void;
};

function DaySection({ day, label, firstOlderDate, ingredientsById, suppliersById, onSendAgain, onCorrect, onOpenDay }: DayProps) {
  const { t } = useT();
  const handBack = useHandBack();
  const sendAll = useCallback((node: HTMLButtonElement | null) => { handBack.register(sendDayOpener(day.date), node); }, [handBack, day.date]);
  return (
    <section className={styles.day}>
      <div className={styles.dayHead}>
        <h3 className={styles.dayTitle}>{label}</h3>
        {/* Recording an order clears its rows from the draft, so the records are the only place the message can still be built
            from: a day of several orders can go out again as one message or as the ones still needed. */}
        {day.records.length >= 2 ? (
          <Button ref={sendAll} variant="quiet" onPress={() => { onOpenDay(day.date); }}>
            <Share aria-hidden="true" />
            {t('ord.history.sendAll')}
          </Button>
        ) : null}
      </div>
      {day.records.map((record, index) => (
        <HistoryCard
          key={record.id}
          record={record}
          ingredientsById={ingredientsById}
          suppliersById={suppliersById}
          firstOlder={firstOlderDate === day.date && index === 0}
          onSendAgain={onSendAgain}
          onCorrect={onCorrect}
        />
      ))}
    </section>
  );
}
