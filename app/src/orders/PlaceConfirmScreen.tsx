import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker, useLocation } from 'react-router';
import { Check } from 'lucide-react';
import { ingredientDisplayLabel } from '@mise/shared/archive';
import { dayPhrase, spellLongDate, todayISO } from '@mise/shared/day';
import { sendOffers } from '@mise/shared/send-chooser';
import { sentCheckPhrases, suppliersToRecord } from '@mise/shared/sent-check';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { NumberBox } from './NumberBox';
import { useOrders, useOrdersStore } from './OrdersContext';
import { buildConfirmGroups, confirmedItems } from './confirmCopy';
import type { ConfirmGroup } from './confirmCopy';
import { dayTranslate } from './dayWords';
import { PLACE_ALL_OPENER, PLACE_DOOR, SEND_OPENER, supplierOpener, useHandBack } from './handBack';
import { useLeave, useLeaveToList } from './ordersNav';
import { PLACE_ALL_PATH, supplierPath } from './ordersPath';
import { recordDateFor } from './orderDay';
import { joinList } from './orderWords';
import type { OrdersLens } from './ordersLens';
import type { PlaceOutcome, RecordCheck } from './ordersStore';
import { confirmedSendRows, sendTranslate } from './sendFlow';
import { unitConflictOfLines, unitConflictText } from './unitConflictText';
import { LONG_MS } from './useClearQuantities';
import { useSendOrder } from './useSendOrder';
import { useSentCheck } from './useSentCheck';
import styles from './PlaceConfirmScreen.module.css';

// «This is what will be recorded»: one screen for ONE supplier («Order placed…» on its screen) and for SEVERAL (the picker's
// «Order placed…»), parity X2, X8 (decision F3 for the future stamp). Opened at /orders/supplier/<id>/confirm and
// /orders/place-all/confirm.
//
//   1. the day's record of each supplier is read (store.checkRecords) and a unit clash is refused BEFORE the screen opens;
//   2. the rows are copied ONCE into a working copy that can be corrected and is never re-read from the live order;
//   3. «Order placed» asks «Did you send the order?» and only a Yes records, one supplier after the other (store.place).
//
// «Did you send the order?» has a third answer, «Send it now» (parity X4): the CONFIRMED numbers go out by a road that reaches
// the supplier (useSendOrder) and only the suppliers it reached are recorded. Opened by the send screen (`afterSend` in the
// navigation state, parity X10) the same screen says «Order sent» and «Mark as placed» and still asks: opening WhatsApp is not
// sending.
//
// Back is one level up (P20); a recorded order goes back to the LIST. Leaving with a corrected number asks first.

const SENT_KEY: Readonly<Record<string, MessageKey>> = {
  'orders.sentCheck.one': 'ord.sentCheck.one',
  'orders.sentCheck.many': 'ord.sentCheck.many',
  'orders.sentCheck.yes': 'ord.sentCheck.yes',
  'orders.sentCheck.yesMany': 'ord.sentCheck.yesMany',
  'orders.sentCheck.sendNow': 'ord.sentCheck.sendNow',
  'orders.sentCheck.sendNowMany': 'ord.sentCheck.sendNowMany',
};

const nothing = () => undefined;

// One supplier, at /orders/supplier/<id>/confirm.
export function SupplierConfirmScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const handBack = useHandBack();
  const leave = useLeave(supplierPath(id), () => { handBack.expect(PLACE_DOOR); });
  const toList = useLeaveToList(useCallback(() => { handBack.expect(supplierOpener(id)); }, [handBack, id]));
  const ids = useMemo(() => [id], [id]);
  return <PlaceConfirmScreen key={id} ids={ids} lens={lens} leave={leave} toList={toList} />;
}

// The ticked suppliers, at /orders/place-all/confirm; their ids travel in the navigation state. Opened without them (a reload
// clears the state) it replaces itself with the picker.
export function PlaceAllConfirmScreen({ lens }: { lens: OrdersLens }) {
  const { state, key } = useLocation();
  const ids = useMemo(() => idsIn(state), [state]);
  const afterSend = afterSendIn(state);
  const leaveToPicker = useLeave(PLACE_ALL_PATH, nothing);
  const handBack = useHandBack();
  const toList = useLeaveToList(useCallback(() => { handBack.expect(afterSend ? SEND_OPENER : PLACE_ALL_OPENER); }, [handBack, afterSend]));
  // ⚠️ AFTER A SEND, BACK IS THE LIST: behind this screen lies the send screen, which has nothing left to say, and the picker
  // was never visited.
  const leave = afterSend ? toList : leaveToPicker;
  const sent = useRef(false);
  useEffect(() => {
    if (ids.length === 0 && !sent.current) {
      sent.current = true;
      leave();
    }
  }, [ids.length, leave]);
  if (ids.length === 0) return null;
  return <PlaceConfirmScreen key={key} ids={ids} lens={lens} leave={leave} toList={toList} />;
}

// Opened by the send screen, after windows were opened for these suppliers.
function afterSendIn(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { afterSend?: unknown }).afterSend === true;
}

// A pending banner's «Placed yesterday» (step 3f-6, parity X9): the day the order really went out, as the banner showed it. Only a real
// day that has come counts: a day written into the state by hand, or one in the future, is ignored and the screen is the usual one.
export function pendingDayIn(state: unknown, today: string): string | null {
  const day = typeof state === 'object' && state !== null ? (state as { pendingDay?: unknown }).pendingDay : undefined;
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today ? day : null;
}

function idsIn(state: unknown): string[] {
  const ids = typeof state === 'object' && state !== null ? (state as { ids?: unknown }).ids : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id !== '') : [];
}

type Props = { ids: readonly string[]; lens: OrdersLens; leave: () => void; toList: () => void };

type Ready = { readonly groups: readonly ConfirmGroup[]; readonly checks: readonly RecordCheck[] };

// Step 1: read the records, refuse a clash, take the working copy. Nothing is drawn but «Loading…» until then.
function PlaceConfirmScreen({ ids, lens, leave, toList }: Props) {
  const { t } = useT();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const [alert, alertDialog] = useAlert();
  const [ready, setReady] = useState<Ready | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const { state } = useLocation();
  const loadingTitle = afterSendIn(state) ? t('ord.orderSent') : t('ord.orderPlaced');

  // The latest of everything the one-time check reads, so it never closes over an old render.
  const latest = useRef({ t, lens, leave, alert, say });
  latest.current = { t, lens, leave, alert, say };

  useEffect(() => {
    let live = true;
    void (async () => {
      const now = latest.current;
      const today = todayISO();
      const draft = store.getSnapshot().draft;
      const pinned = ids.length === 1 ? pendingDayIn(state, today) : null;
      // ⚠️ FROM A PENDING BANNER the record goes under the day the banner showed, not under the draft's stamp (which touching any row
      // of that supplier restamps): «Placed yesterday» must file the order under yesterday.
      const items = ids.map(supplierId => ({ supplierId, date: pinned ?? recordDateFor(draft, supplierId, today) }));
      const checks = await store.checkRecords(items, now.t('ord.noSupplier'));
      if (!live) return;
      const { t: tt, lens: current, leave: back, alert: tell, say: speak } = latest.current;

      // ⚠️ A CLASH WITH TODAY'S RECORD IS REFUSED HERE, BEFORE THE SCREEN OPENS.
      const clashes = checks.filter(check => check.conflicts.length > 0);
      if (clashes.length > 0) {
        const text = unitConflictText({
          groups: clashes.map(check => ({
            supplierName: supplierLabel(current.supplierById(check.supplierId)) || check.supplierId,
            date: check.date,
            conflicts: check.conflicts,
          })),
          several: ids.length > 1, recording: true, now: new Date(), t: tt,
        });
        await tell({ message: text, okLabel: tt('common.ok') });
        if (live) back();
        return;
      }

      // The working copy, once.
      const groups = buildConfirmGroups({ ids, checks, lens: current, draft: store.getSnapshot().draft, today, pinnedDay: pinned });
      if (groups.length === 0) {
        // Everything selected has since lost its rows — another phone placed the order, or it was cleared. Said, not ignored.
        speak(tt('ord.nothingLeft'), 5000);
        back();
        return;
      }
      setReady({ groups, checks });
    })();
    return () => { live = false; };
  }, [ids, store]);

  if (ready === null) {
    return (
      <section className={styles.screen} aria-label={loadingTitle}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={loadingTitle} titleRef={title} />
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        {alertDialog}
      </section>
    );
  }
  return <ConfirmBody ids={ids} ready={ready} lens={lens} leave={leave} toList={toList} alertDialog={alertDialog} alert={alert} />;
}

type BodyProps = {
  ids: readonly string[];
  ready: Ready;
  lens: OrdersLens;
  leave: () => void;
  toList: () => void;
  alert: ReturnType<typeof useAlert>[0];
  alertDialog: ReactNode;
};

// Steps 2 and 3: the working copy on screen, and the recording.
function ConfirmBody({ ids, ready, lens, leave, toList, alert, alertDialog }: BodyProps) {
  const { t } = useT();
  const { state } = useLocation();
  const store = useOrdersStore();
  const { placing, suggester, config } = useOrders();
  const { canManage } = useSession();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const [askSent, sentDialog] = useSentCheck();
  const [send, sendDialogs] = useSendOrder(lens);
  const afterSend = afterSendIn(state);
  // From a pending banner's «Placed yesterday»: it WAS sent (that is what the button says), so it is not asked again (parity X9).
  const alreadySent = ids.length === 1 && pendingDayIn(state, todayISO()) !== null;
  const titleId = useId();
  const usualIdBase = useId();
  // ⚠️ THE «EXTRA DIGIT» LINE IS WRITTEN ONLY AFTER THE FIRST PAINT: its status region must be on the page before it speaks,
  // or a row already unusual when the screen opens is never announced (review of 3f-2b).
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => { setSpeaking(true); }, []);
  const title = useRef<HTMLHeadingElement>(null);
  const dt = dayTranslate(t);
  const today = todayISO();
  const now = new Date();

  // ⚠️ RULE 2 OF EVERY SCREEN: the working copy is open, so a self-started reload must wait.
  useEffect(() => markBusy(), []);

  // Opened from the screen above: the focus goes to this title, once.
  useEffect(() => {
    if (typeof state === 'object' && state !== null && 'fromList' in state) title.current?.focus();
  }, []);

  const [typed, setTyped] = useState<Record<string, Record<string, number>>>(() => Object.fromEntries(
    ready.groups.map(group => [group.supplierId, Object.fromEntries(group.rows.map(row => [row.id, row.qty]))]),
  ));
  // Suppliers already recorded from this screen (a later one failed): they leave the screen and are never recorded twice.
  const [recorded, setRecorded] = useState<readonly string[]>([]);
  // ⚠️ A REF, NOT A DISABLED BUTTON: «Did you send it?» hands the focus back to this button on Cancel, and a disabled one
  // drops it on the page (found in the review of 3f-2). While the order is being recorded `placing` disables it.
  const submittingRef = useRef(false);

  const groups = ready.groups.filter(group => !recorded.includes(group.supplierId));
  const dirty = groups.some(group => group.rows.some(row => (typed[group.supplierId]?.[row.id] ?? 0) !== row.qty));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leaving = useRef(false);

  // ⚠️ EVERY WAY OUT asks while a number was corrected: Back, the browser's Back, the rail, a day picked in a list. And
  // none leaves while the order is being recorded: the section's message area would go with the screen, and «NOT
  // recorded» would never be read. The result itself goes back to the list.
  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const blocker = useBlocker(useCallback(() => (dirtyRef.current || submittingRef.current) && !leaving.current, []));
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (asking.current) return;
    if (submittingRef.current) {
      blocker.reset();
      return;
    }
    asking.current = true;
    void (async () => {
      const discard = await confirm({
        title: t('ord.discard.title'),
        message: t('ord.discard.text'),
        okLabel: t('ui.discard'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      asking.current = false;
      if (!mounted.current) return;
      const current = latestBlocker.current;
      if (current.state !== 'blocked') return;
      if (discard) {
        leaving.current = true;
        current.proceed();
      } else {
        current.reset();
      }
    })();
  });

  const several = ids.length > 1;
  const first = groups[0];
  const exists = !several && first?.exists === true;
  const heading = afterSend ? t('ord.orderSent')
    : several ? t('ord.confirm.titleMany') : exists ? t('ord.confirm.titleAdd') : t('ord.orderPlaced');
  const action = afterSend ? t('ord.markAsPlaced') : !several && exists ? t('ord.confirm.addToIt') : t('ord.orderPlaced');

  // The usual amount of each row whose typed quantity looks like a typing mistake, asked again on every keystroke of the
  // CURRENT history (not frozen with the working copy).
  const usualOf = (supplierId: string, row: { id: string; unit: string }): number | null =>
    suggester.usualFor({ id: row.id }, row.unit, typed[supplierId]?.[row.id] ?? 0);
  const anyUnusual = groups.some(group => group.rows.some(row => usualOf(group.supplierId, row) !== null));

  const nameOfLine = (supplierId: string, ingredientId: string): string => {
    const line = lens.linesOf(supplierId).find(candidate => candidate.id === ingredientId);
    return (line && ingredientDisplayLabel(line)) || ingredientId;
  };

  // Records what was confirmed. The summary leads with what went wrong: a failure is never buried under a success.
  // `notReached`: after «Send it now», the sentence naming the suppliers the road did not reach; it follows the summary and keeps
  // it on screen long enough to read (the current app shows it as a warning for 8 seconds).
  async function record(items: ReturnType<typeof confirmedItems>, notReached = '') {
    const speak = (text: string, ms: number) => {
      say(notReached === '' ? text : `${text} ${notReached}`, notReached === '' ? ms : LONG_MS);
    };
    const report = await store.place(items, t('ord.noSupplier'));
    if (report.offline) {
      speak(t('ord.offline.place'), LONG_MS);
      return;
    }
    const outcomes = report.outcomes;
    const of = (kind: PlaceOutcome['kind']) => outcomes.filter(outcome => outcome.kind === kind);
    const nameOf = (supplierId: string) => ready.groups.find(group => group.supplierId === supplierId)?.name ?? supplierId;
    const names = (list: readonly PlaceOutcome[]) => list.map(outcome => nameOf(outcome.supplierId));

    const saved = of('saved');
    const notCleared = of('not-cleared');
    const failed = of('failed');
    const clashes = of('unit-conflict');
    // These are in the record now: off the screen, and never recorded twice.
    const done = [...saved, ...notCleared].map(outcome => outcome.supplierId);
    if (done.length > 0) setRecorded(before => [...before, ...done]);

    for (const outcome of clashes) {
      if (outcome.kind !== 'unit-conflict') continue;
      const date = ready.groups.find(group => group.supplierId === outcome.supplierId)?.date ?? today;
      await alert({
        message: unitConflictOfLines({ date, names: outcome.ids.map(line => nameOfLine(outcome.supplierId, line)), now: new Date(), t }),
        okLabel: t('common.ok'),
      });
    }
    if (failed.length > 0) {
      const savedNames = names([...saved, ...notCleared]);
      speak(`${t('ord.notRecorded', { names: joinList(t, names(failed)) })} ${
        savedNames.length > 0 ? t('ord.andSaved', { names: joinList(t, savedNames) }) : t('ord.tryAgain')}`, LONG_MS);
      return;
    }
    // ⚠️ THESE TWO RETURNS SAY NOTHING OF THEIR OWN, but the suppliers a send did not reach are still named (X17).
    if (clashes.length > 0) {
      if (notReached !== '') say(notReached, LONG_MS);
      return;
    }
    if (notCleared.length > 0) {
      speak(t('ord.savedNotCleared', { name: joinList(t, names(notCleared)) }), LONG_MS);
    } else if (saved.length > 0) {
      speak(t('ord.savedToHistory', { names: joinList(t, names(saved)) }), 5000);
    } else if (of('busy').length > 0) {
      if (notReached !== '') say(notReached, LONG_MS);
      return;
    } else {
      speak(t('ord.nothingLeft'), 5000);
    }
    // P20: after a save, back to the list — ⚠️ only from THIS screen. toList steps back through the history, so fired after the
    // screen has gone (left by a way the blocker cannot hold: an address typed, a slow save) it would land on whatever lies two
    // steps behind the screen the person is on now.
    if (!mounted.current) return;
    leaving.current = true;
    toList();
  }

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const items = confirmedItems(groups, typed);
      if (items.length === 0) {
        await alert({ title: t('ord.nothingLeft'), message: t('ord.confirm.allZero'), okLabel: t('common.ok') });
        return;
      }
      // From a pending banner's «Placed …»: recorded as it is, with nothing asked.
      if (alreadySent) {
        await record(items);
        return;
      }
      // ⚠️ «DID YOU SEND IT?» COMES BEFORE ANYTHING IS RECORDED: opening WhatsApp is not sending. Only suppliers with
      // something confirmed are asked about.
      const asked = items.map(item => groups.find(group => group.supplierId === item.supplierId)?.name ?? item.supplierId);
      const phrases = sentCheckPhrases(asked.length, joinList(t, asked));
      const sentTitle = SENT_KEY[phrases.titleKey];
      const sentYes = SENT_KEY[phrases.yesKey];
      if (!sentTitle || !sentYes) return;
      const sendNowKey = SENT_KEY[phrases.sendNowKey];
      const askedIds = items.map(item => item.supplierId);
      // «Send it now» only where a road puts the order in a SUPPLIER's hands for these suppliers (not the in-app list, which
      // arrives with slice 3f-7): otherwise it would promise a send that cannot happen.
      const canSendNow = sendNowKey !== undefined && sendOffers({
        settings: config.sendSettings,
        canManage,
        suppliers: askedIds.map(id => lens.supplierById(id)).filter(supplier => supplier !== undefined),
        supplierRoadsOnly: true,
        t: sendTranslate(t),
      }).some(offer => offer.route !== 'manager');
      const answer = await askSent({
        title: t(sentTitle, Object.fromEntries(Object.entries(phrases.titleVars).map(([key, value]) => [key, String(value)]))),
        yesLabel: t(sentYes),
        sendNowLabel: canSendNow ? t(sendNowKey) : undefined,
        cancelLabel: t('common.cancel'),
      });
      // Cancel: nothing is recorded, and the screen stays with the corrections kept.
      if (answer === 'cancel') return;
      if (answer === 'yes') {
        await record(items);
        return;
      }
      // «Send it now»: the CONFIRMED numbers (never the live draft) go out first, and only the suppliers the road reached are
      // recorded: a supplier it could not reach was not sent, whatever the screen shows.
      const rows = confirmedSendRows(lens, items, Object.fromEntries(groups.map(group => [group.supplierId, group.name])));
      const result = await send({ rows, grouped: true, supplierRoadsOnly: true });
      const reached = suppliersToRecord(askedIds, result?.kind === 'sent' ? result.ids : []);
      const missed = askedIds.filter(id => !reached.includes(id))
        .map(id => groups.find(group => group.supplierId === id)?.name ?? id);
      const notReached = missed.length > 0 ? t('ord.sentCheck.notReached', { names: joinList(t, missed) }) : '';
      // Nothing reached: nothing is recorded and the screen stays, corrections kept.
      if (reached.length === 0) {
        if (notReached !== '') say(notReached, LONG_MS);
        return;
      }
      await record(items.filter(item => reached.includes(item.supplierId)), notReached);
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={heading} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        <p className={styles.lead}>{t('ord.confirm.aboutToRecord')}</p>
        {/* ⚠️ THE CONTAINER IS THERE FROM THE START and only its text changes: a live region inserted already filled is not
            announced. */}
        <div role="status" aria-live="polite">
          {speaking && anyUnusual ? <p className={styles.check}>{t('ord.checkExtraDigit')}</p> : null}
        </div>
        {groups.map(group => (
          <div key={group.supplierId} className={styles.group}>
            <div className={styles.groupHead}>
              <h3 className={styles.supplier}>{group.name}</h3>
              <span className={styles.when}>{dayPhrase(group.date, now, dt)}</span>
            </div>
            {group.exists ? (
              <p className={styles.note}>{t('ord.confirm.addsToExisting', { supplier: group.name, when: dayPhrase(group.date, now, dt) })}</p>
            ) : null}
            {group.later ? (
              <p className={styles.note}>{t('ord.confirm.recordedAsToday', { day: spellLongDate(today, dt) })}</p>
            ) : null}
            <ul className={styles.rows}>
              {group.rows.map(row => {
                const usual = usualOf(group.supplierId, row);
                const usualId = `${usualIdBase}-${group.supplierId}-${row.id}`;
                return (
                <li key={row.id} className={styles.row} data-unusual={usual !== null}>
                  <span className={styles.name}>{row.name}</span>
                  {usual !== null ? <span id={usualId} className={styles.usual}>{t('ord.confirm.usually', { n: usual })}</span> : null}
                  <NumberBox
                    describedBy={usual !== null ? usualId : undefined}
                    value={typed[group.supplierId]?.[row.id] ?? 0}
                    className={styles.box}
                    ariaLabel={t('ord.confirm.qtyFor', { name: row.name })}
                    onChange={n => {
                      setTyped(before => ({ ...before, [group.supplierId]: { ...before[group.supplierId], [row.id]: n } }));
                    }}
                  />
                  <span className={styles.unit}>{row.unit}</span>
                </li>
                );
              })}
            </ul>
          </div>
        ))}
        <p className={styles.hint}>{t('ord.confirm.zeroHint')}</p>
        <p className={styles.hint}>{t('ord.confirm.sendFirst')}</p>
        <div className={styles.actions}>
          <Button variant="primary" isDisabled={groups.some(group => placing.includes(group.supplierId))} onPress={() => { void submit(); }}>
            <Check aria-hidden="true" />
            {action}
          </Button>
        </div>
      </div>
      {confirmDialog}
      {sentDialog}
      {sendDialogs}
      {alertDialog}
    </section>
  );
}
