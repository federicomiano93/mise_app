import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Share, Trash2 } from 'lucide-react';
import type { Lines } from '@mise/shared/awaiting-sent';
import { historyDocId, wholeNumber } from '@mise/shared/archive';
import { dayLabel } from '@mise/shared/day';
import { mergeHistory } from '@mise/shared/history-window';
import { groupRequest,isRequestDone, liveDifference, remainingIds, supplierIdsOf } from '@mise/shared/order-request-model';
import { indexById, itemsFromQuantities } from '@mise/shared/order-text';
import { outputLanguage } from '@mise/shared/market';
import { entryUnit, qtyWithUnit, recordUnit, sameUnit } from '@mise/shared/order-unit';
import { shownQty } from '@mise/shared/pack-type';
import { sendOffers } from '@mise/shared/send-chooser';
import { orderedToday } from '@mise/shared/untold-changes';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { joinList } from './orderWords';
import { senderOf } from './OrderListsScreen';
import { useOrders, useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import { listOpener, useHandBack } from './handBack';
import { FROM_LIST, cameFromList, columnPart, useLeave } from './ordersNav';
import { LISTS_PATH, supplierConfirmPath } from './ordersPath';
import { sendTranslate } from './sendFlow';
import type { SendRow } from './sendFlow';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';
import { useSendOrder } from './useSendOrder';
import styles from './OrderListScreen.module.css';

// One order list, open (parity R5–R12), at /orders/lists/<id>, one level below the lists: its lines under their suppliers, each with
// a tick for «bought».
//
// ⚠️ THE TICK IS A WORKING NOTE, NOT AN APPROVAL. It takes nothing out of the order. It is saved, not held in the page, so a person
// can be interrupted for twenty minutes and two phones see the same progress. ⚠️ THE TICKS HOLD NO STATE OF THEIR OWN: every box
// reads the snapshot, so a write the database refuses puts the box back by itself, and the person is told.
//
// ⚠️ THE LIST IS A PHOTOGRAPH, and the shared order moves on underneath it: a line says «now in the list: 5» where it differs, and
// «ordered: 4» where what was bought is not what was asked. Both are derived, never stored.
export function OrderListScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const { requests, requestsLoaded, requestsBroken } = useOrders();
  const handBack = useHandBack();
  const leave = useLeave(LISTS_PATH, useCallback(() => { handBack.expect(listOpener(id)); }, [handBack, id]));
  const request = useMemo(() => requests.find(candidate => candidate.id === id), [requests, id]);
  const titleId = useId();

  // ⚠️ A LIST DELETED ELSEWHERE (or an address nobody ever sent) steps back to the lists. Not when the stream died: `requestsLoaded`
  // is then true too, and «gone» would be a lie — the page's status line says the live data was lost.
  const gone = requestsLoaded && !requestsBroken && request === undefined;
  // ⚠️ A DELETE MAKES THE LIST «GONE» AT ONCE (the database tells its own change before the server answers): `remove` has already left
  // by then and set this, so the screen never steps back twice.
  const left = useRef(false);
  useEffect(() => {
    if (!gone || left.current) return;
    left.current = true;
    leave();
  }, [gone, leave]);

  if (request === undefined) {
    // ⚠️ A SCREEN THAT HAS ALREADY LEFT (a delete) draws nothing while the navigation lands: «Loading…» for a frame would be a lie.
    if (left.current) return null;
    return (
      <section className={styles.screen} aria-labelledby={titleId}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.request.oneTitle')} titleId={titleId} />
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      </section>
    );
  }
  return <Open request={request} lens={lens} leave={leave} left={left} titleId={titleId} />;
}

type OpenProps = {
  request: StoredDoc;
  lens: OrdersLens;
  leave: () => void;
  left: { current: boolean };
  titleId: string;
};

function Open({ request, lens, leave, left, titleId }: OpenProps) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const { canManage, location } = useSession();
  const language = outputLanguage(location) ?? 'en';
  const { history, olderHistory, draft, config } = useOrders();
  const [confirm, confirmDialog] = useConfirm();
  const [send, sendDialogs] = useSendOrder(lens);
  // One send at a time: a second press while the road chooser or an editor is up does nothing.
  const sending = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const requestId = request.id;

  useEffect(() => {
    // Opened from the lists the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  // The ingredients as the order lists them NOW (a line sent to another supplier this time included): the live name and unit.
  const ingredientsById = useMemo(() => indexById(lens.lines), [lens]);
  const groups = useMemo(
    () => groupRequest(request, ingredientsById, { noSupplier: t('ord.noSupplier'), deleted: t('ord.deletedIngredient') }),
    [request, ingredientsById, t],
  );

  // ⚠️ A ROW THAT HAS BEEN ORDERED IS NOT ASKED «has the shared order moved?»: recording an order CLEARS the rows it recorded, so on
  // a bought row «now in the list: 0» is literally true and reads as an alarm about a job already done. Filtered here, once, so the
  // sentence above the rows cannot disagree with the marks on them.
  //
  // ⚠️ WHAT WAS BOUGHT is joined to the list by {the list's own day, supplier}, never by a stored link: the day's total, because a
  // second order to the same supplier is merged into the same record.
  const date = String(request.date ?? '');
  //
  // ⚠️ THE OLDER ORDERS ALREADY LOADED COUNT TOO (as in DaySendScreen): a list dated before the live window has its record only in
  // `olderHistory`, and reading `history` alone would show «now in the list» on a line that was in fact bought.
  const { orderedById, orderedUnits } = useMemo(() => {
    const records = mergeHistory(history, olderHistory);
    const quantities: Record<string, unknown> = {};
    const units: Record<string, unknown> = {};
    supplierIdsOf(request).forEach(supplierId => {
      Object.assign(quantities, orderedToday(records, supplierId, date));
      Object.assign(units, records.find(record => record.id === historyDocId(date, supplierId))?.units ?? {});
    });
    return { orderedById: quantities, orderedUnits: units };
  }, [history, olderHistory, request, date]);
  const differences = useMemo(
    () => Object.fromEntries(
      Object.entries(liveDifference(request, draft.entries, ingredientsById)).filter(([lineId]) => orderedById[lineId] === undefined),
    ),
    [request, draft.entries, ingredientsById, orderedById],
  );

  // ⚠️ «SEND TO THE SUPPLIER» SENDS WHAT IS LEFT, WITH THE LIST'S OWN NUMBERS (decision P4 of the v1.145.0 port): per supplier of the list,
  // in the list's order, only the lines not ticked as bought yet, with the quantities, names and units FROZEN in the list — never the
  // shared order, which has moved on underneath it. Built like History's re-send (recordSendRows). Only suppliers the order knows now:
  // a road to a supplier needs its phone or email.
  //
  // ⚠️ THE NAMES ARE THE LIST'S FROZEN ONES, never `item.name` (a deleted ingredient with no frozen name reads as the INTERFACE word
  // there): what the supplier reads follows the venue's country, so a line with no name at all gets the venue-language word (itemsFromQuantities).
  // ⚠️ A LINE WHOSE INGREDIENT NO LONGER EXISTS IS LEFT OUT, of the message and of the question: «Yes» files what went through the
  // ingredients the order knows (sentLinesOf), so it could not record that line, and asking about it would promise a record never made.
  const frozenNames = useMemo(() => {
    const names = request.names;
    return typeof names === 'object' && names !== null ? names as Record<string, unknown> : {};
  }, [request]);
  const toSend = useMemo(() => {
    const rows: SendRow[] = [];
    const lines: Record<string, Lines> = {};
    for (const group of groups) {
      if (group.supplierId === '' || lens.supplierById(group.supplierId) === undefined) continue;
      const open = group.items.filter(item => !item.done && item.qty > 0 && ingredientsById[item.id] !== undefined);
      const quantities = Object.fromEntries(open.map(item => [item.id, item.qty]));
      const units = Object.fromEntries(open.flatMap(item => (item.unit === '' ? [] : [[item.id, item.unit]])));
      const items = itemsFromQuantities(quantities, ingredientsById, frozenNames, units, language);
      if (items.length === 0) continue;
      rows.push({ id: group.supplierId, name: group.supplierName, items });
      lines[group.supplierId] = { quantities, units };
    }
    return { rows, lines };
  }, [groups, lens, ingredientsById, frozenNames, language]);
  // Hidden when nothing is left to send, or no road reaches a supplier for it (the in-app list for the managers is not a road to a
  // supplier): the same rule as «Send it now».
  const canSend = toSend.rows.length > 0 && sendOffers({
    settings: config.sendSettings,
    canManage,
    suppliers: toSend.rows.map(row => lens.supplierById(row.id)).filter(supplier => supplier !== undefined),
    supplierRoadsOnly: true,
    t: sendTranslate(t),
  }).some(offer => offer.route !== 'manager');

  const dt = dayTranslate(t);
  const remaining = remainingIds(request);
  const done = isRequestDone(request);
  const note = typeof request.note === 'string' ? request.note.trim() : '';

  async function tick(ingredientId: string, checked: boolean): Promise<void> {
    let outcome: 'saved' | 'refused' | 'failed';
    try {
      outcome = await store.tickRequestLine(requestId, ingredientId, checked);
    } catch {
      outcome = 'failed';
    }
    if (outcome !== 'saved') say(t('ord.request.tickFailed'), LONG_MS);
  }

  async function finish(): Promise<void> {
    const ids = remainingIds(request);
    const yes = await confirm({
      title: t('ord.request.finishTitle'),
      message: t('ord.request.finishMessage', { n: ids.length }),
      okLabel: t('ord.request.finish'),
      cancelLabel: t('common.cancel'),
    });
    if (!yes) return;
    let outcome: 'saved' | 'refused' | 'failed';
    try {
      outcome = await store.finishRequest(requestId, ids);
    } catch {
      outcome = 'failed';
    }
    if (outcome !== 'saved') say(t('ord.request.tickFailed'), LONG_MS);
    // The button that held the focus is gone with the last line: the title takes it.
    else title.current?.focus();
  }

  async function remove(): Promise<void> {
    const yes = await confirm({
      title: t('ord.request.deleteTitle'),
      message: t('ord.request.deleteMessage'),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!yes) return;
    // ⚠️ THE SCREEN LEAVES AT ONCE, NOT WHEN THE SERVER ANSWERS (P20): the list is already gone from this phone's own view, and a
    // screen that waited would show «Loading…» on a bad connection, then move the person from wherever they had gone. A refused delete
    // brings the list back by itself on the lists screen, and the sentence is said there (the status line outlives this screen).
    left.current = true;
    const going = store.deleteRequest(requestId);
    leave();
    let outcome: 'saved' | 'refused' | 'failed';
    try {
      outcome = await going;
    } catch {
      outcome = 'failed';
    }
    if (outcome !== 'saved') say(t('ord.request.deleteFailed'), LONG_MS);
  }

  // ⚠️ CALLED FROM THE PRESS, with nothing awaited first (the unit check and the first editor run in that tick), and freed again whatever
  // happens. The ticks are not changed by sending: «bought» is the buyer's word, not the sender's.
  const sendToSuppliers = () => {
    if (sending.current || !canSend) return;
    sending.current = true;
    const going = toSend;
    const failed = (err: unknown) => {
      console.error('Sending the order list failed:', err);
      sending.current = false;
      say(t('ord.send.failed'), LONG_MS);
    };
    let pending: ReturnType<typeof send>;
    try {
      pending = send({ rows: going.rows, grouped: true, supplierRoadsOnly: true });
    } catch (err) {
      failed(err);
      return;
    }
    void pending.then(result => {
      sending.current = false;
      if (result?.kind !== 'sent') return;
      // Handed over: «did it go?» with exactly these numbers, and no `draft` (the order is not what this list was sent from):
      // «Yes» clears only draft lines that still read the same.
      store.waitForAnswer(result.ids.flatMap(id => {
        const lines = going.lines[id];
        return lines === undefined ? [] : [{ supplierId: id, quantities: lines.quantities, units: lines.units }];
      }), result.handOff);
      const missed = going.rows.filter(row => !result.ids.includes(row.id)).map(row => row.name);
      if (result.ids.length === 0 && result.blocked) say(t('ord.send.nothingOpened'), LONG_MS);
      else if (missed.length > 0) say(t('ord.sentCheck.notReached', { names: joinList(t, missed) }), LONG_MS);
    }).catch(failed);
  };

  // ⚠️ THE HAND-OFF TO THE ROAD EVERYBODY ALREADY WALKS: recording the order is the app's own per-supplier confirm screen. A second way
  // to record an order here would be a second answer to «what was ordered». `toList: 1` brings a recorded order back to THIS list.
  const place = (supplierId: string) => { void navigate(supplierConfirmPath(supplierId), { state: { ...FROM_LIST, toList: 1, ...columnPart(state) } }); };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('ord.request.oneTitle')}
        titleId={titleId}
        titleRef={title}
        sub={done ? <span className={styles.doneMark}>{t('ord.request.allOrdered')}</span> : undefined}
      />
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.from}>{t('ord.request.from', { who: senderOf(request, t('ord.request.someone')) })}</span>
          <span className={styles.when}>{dayLabel(date, new Date(), dt)}</span>
        </div>

        {note !== '' ? (
          <div className={styles.note}>
            <span className={styles.noteLabel}>{t('ord.request.noteLabel')}</span>
            <span className={styles.noteText}>{note}</span>
          </div>
        ) : null}

        {/* One sentence above the rows when anything has moved, so the marks on the lines are explained once. */}
        {Object.keys(differences).length > 0 ? <p className={styles.changed}>{t('ord.request.changedSince')}</p> : null}

        {groups.map((group, index) => {
          const allDone = group.doneCount === group.total;
          const headingId = `${titleId}-g${index}`;
          return (
            <section key={group.supplierId} className={styles.group} aria-labelledby={headingId}>
              <div className={styles.groupHead}>
                <h3 id={headingId} className={styles.groupName}>{group.supplierName}</h3>
                <span className={styles.groupCount} data-done={allDone ? 'true' : undefined}>
                  {t('ord.request.progress', { done: group.doneCount, total: group.total })}
                </span>
              </div>
              <ul className={styles.lines}>
                {group.items.map(item => {
                  const card = ingredientsById[item.id];
                  const differsTo = differences[item.id];
                  const nowUnit = differsTo !== undefined ? entryUnit(draft.entries[item.id], card) : '';
                  const differsUnit = differsTo !== undefined && !sameUnit(nowUnit, recordUnit(request, item.id, card)) ? nowUnit : '';
                  const boughtRaw = orderedById[item.id];
                  const bought = boughtRaw === undefined ? undefined : wholeNumber(boughtRaw);
                  const boughtUnit = recordUnit({ units: orderedUnits }, item.id, card);
                  // A different unit counts as different even at an equal number («asked 2 cartons, bought 2 packs»).
                  const otherUnit = !sameUnit(boughtUnit, recordUnit(request, item.id, card));
                  return (
                    <li key={item.id}>
                      <label className={styles.line} data-done={item.done ? 'true' : undefined}>
                        <input
                          type="checkbox"
                          className={styles.box}
                          checked={item.done}
                          onChange={event => { void tick(item.id, event.target.checked); }}
                        />
                        <span className={styles.lineMain}>
                          <span className={styles.lineName}>{item.name}</span>
                          {differsTo !== undefined ? (
                            // The unit only when it is not the one the list was sent in; nothing left needs none («now: 0»).
                            <span className={styles.lineChanged}>
                              {t('ord.request.nowInList', { n: differsUnit !== '' && differsTo > 0 ? qtyWithUnit(differsTo, differsUnit) : differsTo })}
                            </span>
                          ) : null}
                          {bought !== undefined && (bought !== item.qty || otherUnit) ? (
                            <span className={styles.lineOrdered}>
                              {t('ord.request.ordered', { n: otherUnit ? qtyWithUnit(bought, boughtUnit) : bought })}
                            </span>
                          ) : null}
                        </span>
                        <span className={styles.lineQty}>{shownQty(item.qty, item.unit, card, language)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {/* ⚠️ AN INSTRUCTION, NOT A STATEMENT: «Order placed — X» under ticked lines reads as a receipt, and nobody taps a receipt. */}
              {allDone && group.supplierId !== '' ? (
                <Button className={styles.place} onPress={() => { place(group.supplierId); }}>
                  {t('ord.request.markPlacedFor', { supplier: group.supplierName })}
                </Button>
              ) : null}
            </section>
          );
        })}

        <div className={styles.foot}>
          {canSend ? (
            <Button block onPress={sendToSuppliers}>
              <Share aria-hidden="true" />
              {t(toSend.rows.length === 1 ? 'ord.request.sendToSupplier' : 'ord.request.sendToSuppliers')}
            </Button>
          ) : null}
          {remaining.length > 0 ? (
            <Button variant="primary" block onPress={() => { void finish(); }}>{t('ord.request.finish')}</Button>
          ) : null}
          {/* ⚠️ LOW-KEY, AND ONLY FOR WHOEVER RUNS THE PLACE (P20 and firestore.rules agree): a button the database refuses teaches people
              the app is broken, not that they lack the permission. */}
          {canManage ? (
            <Button variant="bare" className={styles.delete} onPress={() => { void remove(); }}>
              <Trash2 aria-hidden="true" />
              {t('ord.request.delete')}
            </Button>
          ) : null}
        </div>
      </div>
      {confirmDialog}
      {sendDialogs}
    </section>
  );
}
