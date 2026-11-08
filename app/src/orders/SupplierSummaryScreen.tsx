import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { todayISO } from '@mise/shared/day';
import { qtyWithUnit } from '@mise/shared/order-unit';
import { closeOffer } from '@mise/shared/reminders';
import type { PlacedRecord } from '@mise/shared/reminders';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useMoney } from '../session/useMoney';
import { OrderTotals } from './OrderTotals';
import { useOrders, useOrdersStore } from './OrdersContext';
import { PLACE_DOOR, SUMMARY_DOOR, summaryOpener, todayOpener, useHandBack } from './handBack';
import { FROM_LIST, cameFromChip, cameFromList, cameFromSupplier, columnPart, listDistanceOf, useLeave } from './ordersNav';
import { ORDERS_PATH, supplierConfirmPath, supplierPath } from './ordersPath';
import { LONG_MS } from './useClearQuantities';
import type { OrdersLens } from './ordersLens';
import { lineCostText, summaryFor } from './orderMoney';
import styles from './SupplierSummaryScreen.module.css';

// The order summary: one supplier's CURRENT order, to LOOK AT. Opening it writes nothing, which is why it can be opened in the
// middle of an order without a thought (parity L19).
//
// ⚠️ THE ONLY BUTTONS ACT ON TODAY'S ORDER (the current app's PR #470, his tablet notes of 2–3 Nov 2026), each writing only
// behind its own tap:
//   • «Order placed…» — with something written: the SAME confirm screen as the supplier's own green button (its question, the
//     «did you send it?», the record in History). Nothing new.
//   • «Close as not ordered» — NOTHING written and its order day today: nothing needed, so it leaves «Order today» and the kiosk
//     (drafts/current.skipped), after a question. Then back to the list, where the strip says «not ordered».
//   • «Reopen» — the undo, shown with «Closed as not ordered today» while it is closed, with or without quantities (a close is
//     never invisible). No question: it only puts back what the screen showed before the close.
// What is offered is asked of the data on every draw (reminders closeOffer), so a close made on another phone shows at once; and
// only once the records AND the draft have arrived, over live streams: before them, or over a dead one, a supplier placed or closed
// this morning would offer the close — and over a dead draft, one with quantities typed would look like «nothing needed».
//
// ⚠️ THE SAME LINES AS THE MESSAGE: summaryFor() takes the lens's lines through the selection the send screen uses, so this can never
// show what the supplier will not receive. The money (a cost line under each line, the totals box) is drawn ONLY when the store says
// the prices are readable (the read of ingredient-prices succeeded): never from an empty map, never for somebody the rules refuse.
export function SupplierSummaryScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const money = useMoney();
  const { state } = useLocation();
  const { draft, prices, pricesReadable, history, historyLoaded, historyBroken, draftLoaded, draftBroken, placing } = useOrders();
  const store = useOrdersStore();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const handBack = useHandBack();
  const askingToClose = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const placeButton = useRef<HTMLButtonElement | null>(null);
  // «Order placed…» is also where Cancel on its confirm screen hands the focus back, as on the supplier's screen (PLACE_DOOR):
  // the two are never on screen together, both being the detail of the same supplier.
  const placeNode = useCallback((node: HTMLButtonElement | null) => {
    placeButton.current = node;
    handBack.register(PLACE_DOOR, node);
  }, [handBack]);
  // After «Reopen» its own button goes: the focus is handed to what takes its place, once drawn. ⚠️ ONCE THE SCREEN NO LONGER
  // OFFERS «Reopen», not at the next draw: Firestore reports the reopen a moment later, and focused before it the title took it.
  const [refocus, setRefocus] = useState(false);
  // What the screen offers NOW, for the question below, which is answered later (code review, 8 Nov 2026).
  const latest = useRef({ offer: '', lines: 0 });
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLElement>(null);
  // Back is the browser's Back when the supplier's screen or the list is the entry behind; an address typed in goes up one level, to
  // the supplier's order. Opened by a closed supplier's chip in «Order today», the focus goes back to that chip.
  const leave = useLeave(supplierPath(id), () => {
    handBack.expect(cameFromSupplier(state) ? SUMMARY_DOOR : cameFromChip(state) ? todayOpener(id) : summaryOpener(id));
  });

  const supplier = lens.supplierById(id);
  const shown = supplier !== undefined;
  useEffect(() => {
    // ⚠️ NOT OVER A FOCUS ALREADY HANDED BACK INSIDE IT (Back from the confirm screen: its «Order placed…»), as the supplier's screen.
    if (shown && cameFromList(state) && !screen.current?.contains(document.activeElement)) title.current?.focus();
  }, [shown]);

  useEffect(() => {
    if (!refocus || latest.current.offer === 'reopen') return;
    setRefocus(false);
    (closeButton.current ?? placeButton.current ?? title.current)?.focus();
  });

  if (supplier === undefined) {
    return (
      <section className={styles.screen} aria-label={t('section.orders')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('section.orders')} titleRef={title} />
        <p className={styles.nothing}>{t('ord.supplierGone')}</p>
      </section>
    );
  }

  const summary = summaryFor(lens, id, draft, prices, pricesReadable);
  const lines = summary.costLines;
  const name = supplierLabel(supplier);
  const today = todayISO();
  const offer = historyLoaded && !historyBroken && draftLoaded && !draftBroken
    ? closeOffer({ supplier, history: history as readonly PlacedRecord[], today, skipped: draft.skipped })
    : '';
  latest.current = { offer, lines: lines.length };

  // The way to the list after a close: walked back when the list is in the history, else this screen replaces itself with it.
  const toList = listDistanceOf(state);
  const leaveToList = () => {
    handBack.expect(summaryOpener(id));
    if (toList !== undefined) void navigate(-toList);
    else void navigate(ORDERS_PATH, { replace: true, state: KEEP_FOCUS });
  };

  // The supplier screen's own «Order placed…»: refused offline (parity X3), otherwise its confirm screen, which goes back to the
  // list once the order is recorded.
  const place = () => {
    if (navigator.onLine === false) {
      say(t('ord.offline.place'), LONG_MS);
      return;
    }
    handBack.expect(PLACE_DOOR);
    void navigate(supplierConfirmPath(id), {
      state: { ...FROM_LIST, ...(toList === undefined ? {} : { toList: toList + 1 }), ...columnPart(state) },
    });
  };

  const closeAsNotOrdered = async () => {
    if (askingToClose.current) return;
    askingToClose.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: t('ord.summary.closeTitle', { supplier: name }),
        message: t('ord.summary.closeMessage'),
        okLabel: t('ord.summary.closeOk'),
        cancelLabel: t('common.cancel'),
      });
    } finally {
      askingToClose.current = false;
    }
    if (!ok) return;
    // ⚠️ ASKED AGAIN AFTER THE ANSWER, a DIFFERENCE from the current app: quantities typed by a colleague (or the order placed)
    // while the question was open would otherwise be closed as «not ordered», and the strip and the kiosk would stay silent
    // about an order that is typed. Nothing is said: the screen now shows what changed.
    if (latest.current.offer !== 'skip' || latest.current.lines > 0) return;
    // LOCAL-FIRST: Firestore shows the close at once (offline too); a refusal is said by the section and taken back.
    void store.closeNotOrdered(id);
    say(t('ord.summary.closedDone', { supplier: name }));
    leaveToList();
  };

  const reopen = () => {
    setRefocus(true);
    // Refused: «Reopen» stays, and nothing is owed the focus any more.
    void store.reopenToday(id).then(saved => { if (!saved) setRefocus(false); });
    say(t('ord.summary.reopened', { supplier: name }));
  };

  const actions = (
    <div className={styles.actions}>
      {offer === 'reopen' ? (
        <div className={styles.closed}>
          <p className={styles.closedText}>{t('ord.summary.closedToday')}</p>
          <Button onPress={reopen}>{t('ord.summary.reopen')}</Button>
        </div>
      ) : null}
      {lines.length > 0 ? (
        <Button ref={placeNode} variant="primary" isDisabled={placing.includes(id)} onPress={place}>
          <Check aria-hidden="true" />
          {t('ord.placeAction')}
        </Button>
      ) : null}
      {/* ⚠️ ONLY WITH NOTHING WRITTEN: «nothing needed». With quantities on the sheet the honest choices are «Order placed…» or
          clearing them on the supplier's screen first. */}
      {lines.length === 0 && offer === 'skip' ? (
        <>
          <p className={styles.hint}>{t('ord.summary.closeHint')}</p>
          <Button ref={closeButton} onPress={() => { void closeAsNotOrdered(); }}>{t('ord.summary.closeNotOrdered')}</Button>
        </>
      ) : null}
    </div>
  );
  const hasActions = offer !== '' || lines.length > 0;

  return (
    <section ref={screen} className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={supplierLabel(supplier)}
        titleId={titleId}
        titleRef={title}
        sub={lines.length > 0 ? <p className={styles.sub}>{t('ord.summaryCount', { n: lines.length })}</p> : undefined}
      />
      <div className={styles.body}>
        {lines.length === 0 ? (
          <p className={styles.nothing}>{t('ord.summaryEmpty')}</p>
        ) : (
          <>
            <ul className={styles.list}>
              {lines.map((line, index) => {
                const cost = pricesReadable ? lineCostText(t, money, line) : null;
                return (
                  <li key={`${line.label}:${index}`} className={styles.row}>
                    <span className={styles.label}>{line.label}</span>
                    <span className={styles.qty}>{qtyWithUnit(line.qty, line.unit)}</span>
                    {cost ? <span className={cost.warn ? `${styles.cost} ${styles.warn}` : styles.cost}>{cost.text}</span> : null}
                  </li>
                );
              })}
            </ul>
            {pricesReadable ? <OrderTotals totals={summary.totals} /> : null}
          </>
        )}
        {hasActions ? actions : null}
      </div>
      {confirmDialog}
    </section>
  );
}
