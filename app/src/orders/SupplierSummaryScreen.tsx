import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { todayISO } from '@mise/shared/day';
import { qtyWithUnit } from '@mise/shared/order-unit';
import { closeOffer } from '@mise/shared/reminders';
import type { PlacedRecord } from '@mise/shared/reminders';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useMoney } from '../session/useMoney';
import { OrderTotals } from './OrderTotals';
import { useOrders, useOrdersStore } from './OrdersContext';
import { SUMMARY_DOOR, SUMMARY_PLACE_DOOR, summaryOpener, supplierOpener, useHandBack } from './handBack';
import { cameFromList, cameFromSupplier, confirmFromSummaryState, useLeave, useSummaryToList } from './ordersNav';
import { supplierConfirmPath, supplierPath } from './ordersPath';
import { LONG_MS } from './useClearQuantities';
import type { OrdersLens } from './ordersLens';
import { lineCostText, summaryFor } from './orderMoney';
import styles from './SupplierSummaryScreen.module.css';

// The order summary: one supplier's CURRENT order, to LOOK AT. Opening it writes nothing, which is why it can be opened in the middle of
// an order without a thought (parity L19).
//
// ⚠️ THE SAME LINES AS THE MESSAGE: summaryFor() takes the lens's lines through the selection the send screen uses, so this can never
// show what the supplier will not receive. The money (a cost line under each line, the totals box) is drawn ONLY when the store says
// the prices are readable (the read of ingredient-prices succeeded): never from an empty map, never for somebody the rules refuse.
//
// ⚠️ THE ONLY BUTTONS ON IT ACT ON TODAY'S ORDER (checklist item 3, 8 Nov 2026; the current app's v1.143.0, Federico's tablet notes of
// 2–3 Nov 2026), under the lines, and each writes only behind its own tap:
//   • «Order placed…» — with something typed: the supplier's own confirm screen, exactly as its green button opens it (the corrections,
//     «Did you send the order?», the record in History). Nothing new. Pushed on top of this screen, so Back comes back here.
//   • «Close as not ordered» — nothing typed and its order day is today: nothing needed, so it leaves «Order today» and the kiosk
//     (drafts/current.skipped). Asked first (Mise 2's own dialog), then local-first (ordersStore.closeToday) and back to the list.
//   • «Reopen» — the undo, shown while it is closed, with no question; the summary stays, now offering the close again.
// What it offers is asked of @mise/shared/reminders closeOffer on every render, so a close or an order made on another phone shows here
// at once. Nothing is offered until the records and the draft have arrived: before them a supplier placed or closed this morning would
// be offered the close again.
export function SupplierSummaryScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const money = useMoney();
  const { state } = useLocation();
  const navigate = useNavigate();
  const store = useOrdersStore();
  const { draft, draftLoaded, history, historyLoaded, prices, pricesReadable, placing } = useOrders();
  const handBack = useHandBack();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  // Back is the browser's Back when the supplier's screen or the list is the entry behind; an address typed in goes up one level, to
  // the supplier's order.
  const leave = useLeave(supplierPath(id), () => { handBack.expect(cameFromSupplier(state) ? SUMMARY_DOOR : summaryOpener(id)); });
  // After a close, the list, where «Order today» now says «not ordered»: the supplier's row takes the focus.
  const toList = useSummaryToList(useCallback(() => { handBack.expect(supplierOpener(id)); }, [handBack, id]));
  // «Order placed…» one level down: Back from the confirm screen hands the focus back to it.
  const placeNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SUMMARY_PLACE_DOOR, node); }, [handBack]);

  const supplier = lens.supplierById(id);
  const shown = supplier !== undefined;
  // ⚠️ NOT WHEN THE FOCUS IS ALREADY ON THIS SCREEN: back from the confirm screen the section has just handed it to «Order placed…» (a
  // layout effect, so before this one), and the title must not take it away.
  useEffect(() => {
    if (shown && cameFromList(state) && !screen.current?.contains(document.activeElement)) title.current?.focus();
  }, [shown]);

  const summary = supplier === undefined ? null : summaryFor(lens, id, draft, prices, pricesReadable);
  const lines = summary?.costLines ?? [];
  const offer = supplier === undefined || !historyLoaded || !draftLoaded ? '' : closeOffer({
    supplier, history: history as readonly PlacedRecord[], today: todayISO(), skipped: draft.skipped,
  });

  // ⚠️ THE FOCUS NEVER FALLS TO THE PAGE WHEN THE BUTTONS CHANGE (the current app's paintActions): «Reopen» pressed, or a close made on
  // another phone, swaps the buttons under a finger; the focus that was on the old ones moves to the first new one. Read while the old
  // buttons are still in the page (this render), moved once the new ones are.
  const actionsKey = `${lines.length > 0}|${offer}`;
  const lastKey = useRef(actionsKey);
  const moveFocus = useRef(false);
  if (lastKey.current !== actionsKey) {
    lastKey.current = actionsKey;
    moveFocus.current = actions.current?.contains(document.activeElement) === true;
  }
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    actions.current?.querySelector('button')?.focus();
  }, [actionsKey]);

  if (supplier === undefined || summary === null) {
    return (
      <section className={styles.screen} aria-label={t('section.orders')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('section.orders')} titleRef={title} />
        <p className={styles.nothing}>{t('ord.supplierGone')}</p>
      </section>
    );
  }

  const label = supplierLabel(supplier);
  const busy = placing.includes(id);

  const place = () => {
    // Refused offline, as on the supplier's screen: the record and the clear would land at two different moments (parity X3).
    if (navigator.onLine === false) {
      say(t('ord.offline.place'), LONG_MS);
      return;
    }
    handBack.expect(SUMMARY_PLACE_DOOR);
    void navigate(supplierConfirmPath(id), { state: confirmFromSummaryState(state) });
  };

  const closeAsNotOrdered = async () => {
    const ok = await confirm({
      title: t('ord.close.title', { supplier: label }),
      message: t('ord.close.message'),
      okLabel: t('ord.close.ok'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    // Local-first and never awaited: the list shows it at once, signal or not; a refusal comes back as a status message.
    store.closeToday(id);
    toList();
    say(t('ord.close.done', { supplier: label }));
  };

  const reopen = () => {
    store.reopenToday(id);
    say(t('ord.close.reopened', { supplier: label }));
  };

  const hasActions = offer === 'reopen' || lines.length > 0 || offer === 'skip';

  return (
    <section ref={screen} className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={label}
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
        {hasActions ? (
          <div ref={actions} className={styles.actions}>
            {offer === 'reopen' ? (
              // Plain text, not a live region: drawn with its words already inside, a live region is either never read or read again on
              // every render. The status message says what just happened.
              <div className={styles.closed}>
                <p className={styles.closedText}>{t('ord.close.closedToday')}</p>
                <Button variant="secondary" onPress={reopen}>{t('ord.close.reopen')}</Button>
              </div>
            ) : null}
            {lines.length > 0 ? (
              <Button ref={placeNode} variant="primary" isDisabled={busy} onPress={place}>
                <Check aria-hidden="true" />
                {t('ord.placeAction')}
              </Button>
            ) : null}
            {/* ⚠️ ONLY WITH NOTHING TYPED («non mi serve niente»): with quantities on the summary the honest choices are «Order placed…»
                or clearing them on the supplier's screen first. */}
            {lines.length === 0 && offer === 'skip' ? (
              <>
                <p className={styles.hint}>{t('ord.close.hint')}</p>
                <Button variant="secondary" onPress={() => { void closeAsNotOrdered(); }}>{t('ord.close.action')}</Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {confirmDialog}
    </section>
  );
}
