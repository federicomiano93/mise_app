import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Trash2 } from 'lucide-react';
import { historyDocId, wholeNumber } from '@mise/shared/archive';
import { dayLabel } from '@mise/shared/day';
import { groupRequest, isRequestDone, liveDifference, remainingIds, supplierIdsOf } from '@mise/shared/order-request-model';
import { indexById } from '@mise/shared/order-text';
import { entryUnit, qtyWithUnit, recordUnit, sameUnit } from '@mise/shared/order-unit';
import { orderedToday } from '@mise/shared/untold-changes';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { senderOf } from './OrderListsScreen';
import { useOrders, useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import { listOpener, useHandBack } from './handBack';
import { FROM_LIST, cameFromList, useLeave } from './ordersNav';
import { LISTS_PATH, supplierConfirmPath } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';
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
  const left = useRef(false);
  // ⚠️ A DELETE IN THE AIR MAKES THE LIST «GONE» AT ONCE (the database tells its own change before the server answers) and puts it
  // back if the server refuses: stepping back then would leave a list that is still there, with «not deleted» said to nobody.
  const deleting = useRef(false);
  useEffect(() => {
    if (!gone || left.current || deleting.current) return;
    left.current = true;
    leave();
  }, [gone, leave]);

  if (request === undefined) {
    return (
      <section className={styles.screen} aria-labelledby={titleId}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.request.oneTitle')} titleId={titleId} />
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      </section>
    );
  }
  return <Open request={request} lens={lens} leave={leave} left={left} deleting={deleting} titleId={titleId} />;
}

type OpenProps = {
  request: StoredDoc;
  lens: OrdersLens;
  leave: () => void;
  left: { current: boolean };
  deleting: { current: boolean };
  titleId: string;
};

function Open({ request, lens, leave, left, deleting, titleId }: OpenProps) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const { canManage } = useSession();
  const { history, draft } = useOrders();
  const [confirm, confirmDialog] = useConfirm();
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
  const { orderedById, orderedUnits } = useMemo(() => {
    const quantities: Record<string, unknown> = {};
    const units: Record<string, unknown> = {};
    supplierIdsOf(request).forEach(supplierId => {
      Object.assign(quantities, orderedToday(history, supplierId, date));
      Object.assign(units, history.find(record => record.id === historyDocId(date, supplierId))?.units ?? {});
    });
    return { orderedById: quantities, orderedUnits: units };
  }, [history, request, date]);
  const differences = useMemo(
    () => Object.fromEntries(
      Object.entries(liveDifference(request, draft.entries, ingredientsById)).filter(([lineId]) => orderedById[lineId] === undefined),
    ),
    [request, draft.entries, ingredientsById, orderedById],
  );

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
    let outcome: 'saved' | 'refused' | 'failed';
    deleting.current = true;
    try {
      outcome = await store.deleteRequest(requestId);
    } catch {
      outcome = 'failed';
    } finally {
      deleting.current = false;
    }
    if (outcome !== 'saved') {
      say(t('ord.request.deleteFailed'), LONG_MS);
      return;
    }
    if (!left.current) {
      left.current = true;
      leave();
    }
  }

  // ⚠️ THE HAND-OFF TO THE ROAD EVERYBODY ALREADY WALKS: recording the order is the app's own per-supplier confirm screen. A second way
  // to record an order here would be a second answer to «what was ordered». `toList: 1` brings a recorded order back to THIS list.
  const place = (supplierId: string) => { void navigate(supplierConfirmPath(supplierId), { state: { ...FROM_LIST, toList: 1 } }); };

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
                        <span className={styles.lineQty}>{qtyWithUnit(item.qty, item.unit)}</span>
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
    </section>
  );
}
