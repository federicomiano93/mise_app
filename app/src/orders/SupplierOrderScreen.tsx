import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ClipboardList, Share, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { draftQuantities } from '@mise/shared/awaiting-sent';
import { fromOrdersList, fromOrdersSupplier, ingredientCardAddress, supplierScreenAddress } from '@mise/shared/records-link';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { tabOfLine, useCardDoors } from './CardDoors';
import { DayLine } from './DayLine';
import { OrderLine } from './OrderLine';
import { OrderTotals } from './OrderTotals';
import { SaveStateLine } from './SaveStateLine';
import { useOrders, useOrdersStore } from './OrdersContext';
import { PLACE_DOOR, SUMMARY_DOOR, SUPPLIER_DOOR, SUPPLIER_TITLE, supplierOpener, useHandBack } from './handBack';
import { ORDERS_PATH, supplierConfirmPath, supplierSummaryPath } from './ordersPath';
import { cameFromList, confirmState, fromSupplierState, useLeave } from './ordersNav';
import { recipeOriginOf, useBackToRecipe } from './recipeOrigin';
import { LONG_MS, useClearQuantities } from './useClearQuantities';
import { NO_SUPPLIER_ID } from './ordersLens';
import { summaryFor } from './orderMoney';
import { sayListOutcome } from './sayListOutcome';
import { draftSendRows } from './sendFlow';
import { useSendOrder } from './useSendOrder';
import type { OrderRow, OrdersLens } from './ordersLens';
import styles from './SupplierOrderScreen.module.css';

// One supplier's order: the quantities to type, A→Z, and under them the lines switched off.
//
// The redesign of 16 Nov 2026 (item 5): the head is `[X] NAME ›` … `[send]` on the split (X closes the supplier — Back to the list,
// nothing is lost — and › is the door to its card), `[←] NAME ›` … «Summary (N)» `[send]` on a phone, where the rows have no summary
// button. «What they sell» and «+» are gone from it (the row's list icon is the first, and an item is added from the card behind ›).
// Under the head one slim bar, «Order for [Today ▾]» … «Saved ✓», ONE line, the column names, and each item on one row on the split
// (OrderLine `compact`), on two levels on a phone. The whole card is one colour; its inner controls are grey with no border.
//
// Back is one level up (P20): the browser's Back when the list is the entry behind, else it replaces itself with the list.
//
// ⚠️ OPENED FROM A RECIPE ROW'S «Order» (item 32; the address names the recipe and the ingredient, recipeOrigin.ts) it is the same screen with
// two differences: the ingredient's quantity box takes the focus once, nothing prefilled, and Back returns to THAT RECIPE (the
// history entry behind it). It never waits for a typed quantity to be sent first, as the current app's Back does (its 8ed7a0ad): this
// draft is local-first, and leaving Orders sends what waits at once (ordersStore `stop()`), see docs/parity/orders.md.
export function SupplierOrderScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const { state, search, pathname } = useLocation();
  const navigate = useNavigate();
  const origin = useMemo(() => recipeOriginOf(search), [search]);
  const store = useOrdersStore();
  const snapshot = useOrders();
  const handBack = useHandBack();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement | null>(null);
  // The title is also where the focus falls back to when the door it was returned to is gone (cardTrip.ts).
  const titleNode = useCallback((node: HTMLHeadingElement | null) => {
    title.current = node;
    handBack.register(SUPPLIER_TITLE, node);
  }, [handBack]);
  const leaveToList = useLeave(ORDERS_PATH, () => { handBack.expect(supplierOpener(id)); });
  const leaveToRecipe = useBackToRecipe(origin);
  const leave = origin === null ? leaveToList : leaveToRecipe;
  const say = useStatusMessage();
  const [clearQuantities, clearDialog] = useClearQuantities(lens);
  const [send, sendDialogs] = useSendOrder(lens);
  // One send at a time: a second press while the road chooser or an editor is up does nothing.
  const sending = useRef(false);
  // Closing the screen sends what waits for the autosave's pause at once (the iPad order of 14 Nov 2026).
  useEffect(() => () => { store.sendWaitingDraft(); }, [store]);
  // The totals box above «Order placed» is for the split only (his choice C4, 6 Nov 2026).
  const split = useMediaQuery(SPLIT_QUERY);

  // The summary one level down (a phone's head only): Back from it hands the focus back to this button.
  const summaryNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SUMMARY_DOOR, node); }, [handBack]);
  // «Order placed…» one level down: Back from the confirm screen hands the focus back to this button.
  const placeNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(PLACE_DOOR, node); }, [handBack]);
  // The doors to the cards (step 3f-8b), where the person may edit records. Back from a card hands the focus back to its door.
  const doors = useCardDoors();
  const supplierDoorNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SUPPLIER_DOOR, node); }, [handBack]);
  // ⚠️ THE PSEUDO-SUPPLIER HAS NO SCREEN OF ITS OWN IN «Ingredients & suppliers»: its name is no door.
  const pseudo = id === NO_SUPPLIER_ID;

  const supplier = lens.supplierById(id);
  const rows = lens.rowsFor(id);
  const entries = snapshot.draft.entries;
  const hasQty = (row: OrderRow): boolean => !row.elsewhere && Number(entries[row.ingredient.id]?.qty) > 0;
  // ⚠️ «NOT IN USE» IS CLOSED, BUT OPEN WHEN ONE OF ITS ROWS HAS A QUANTITY: a line switched off with a quantity is in the
  // order (decision T10) and must not hide.
  const group = useFoldedOpen(rows.inactive.some(hasQty), id);

  // Opened from the list the page does not move the focus (FROM_LIST): it goes to this title, once, when the screen first
  // shows a supplier. Another supplier picked beside it (the split) keeps the focus on the row that was pressed.
  // ⚠️ NOT WHEN THE FOCUS IS ALREADY ON THIS SCREEN: coming back from «What they sell» the section has just handed it to the
  // «What they sell» button (a layout effect, so before this one), and the title must not take it away.
  const screen = useRef<HTMLElement>(null);
  const shown = supplier !== undefined;
  // ⚠️ NOT WHILE «QUANTITY NOT SAVED» IS ON SCREEN (refusedEarlier): the alert's modal holds the focus and gives it back to the
  // body when it closes, which would undo this one-time move. It waits for the alert to be settled, then takes the focus.
  const alertUp = snapshot.refusedEarlier;
  useEffect(() => {
    if (shown && !alertUp && cameFromList(state) && !screen.current?.contains(document.activeElement)) title.current?.focus();
  }, [shown, alertUp]);

  // The ingredient a recipe row asked for: its quantity box takes the focus, once, when the supplier first shows.
  // ⚠️ Looked for in the rows as drawn: a line switched off and folded away (a closed «Not in use» group) is not found, and neither is
  // an ingredient that is on no list. The screen then says so and puts the focus on its title, so the sentence and the title are announced
  // (the recipe navigated here with KEEP_FOCUS, which would leave the focus on the body).
  // ⚠️ ONCE PER TRIP, NOT PER MOUNT: a sub-screen («What they sell», the summary, «Order placed…», a card) unmounts this one, and coming
  // back is a POP to the same address, ?recipe=…&ingredient=… still in it. The trip is marked done in this entry's own state (a REPLACE,
  // so no entry is added), and the section has by then handed the focus back to the door that was pressed.
  const wanted = origin?.ingredientId ?? null;
  const asked = useRef(false);
  const tripDone = typeof state === 'object' && state !== null && 'recipeFocusDone' in state;
  useEffect(() => {
    if (origin === null || wanted === null || asked.current || tripDone || alertUp) return;
    asked.current = true;
    const markDone = () => { void navigate({ pathname, search }, { replace: true, state: { ...(typeof state === 'object' && state !== null ? state : {}), ...KEEP_FOCUS, recipeFocusDone: true } }); };
    if (!shown) {
      title.current?.focus();
      markDone();
      return;
    }
    const line = [...(screen.current?.querySelectorAll('li[data-ingredient]') ?? [])].find(node => node.getAttribute('data-ingredient') === wanted);
    const box = line?.querySelector('input');
    if (box === null || box === undefined || box.closest('details:not([open])') !== null) {
      say(t('ord.fromRecipe.notFound'), LONG_MS);
      title.current?.focus();
    } else {
      if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'center' });
      box.focus({ preventScroll: true });
    }
    markDone();
  }, [shown, alertUp]);

  // The column names stick right under the head, whose height changes with the width.
  const barHeight = useHeight();

  if (supplier === undefined) {
    return (
      <section className={styles.screen} aria-label={t('section.orders')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('section.orders')} titleRef={titleNode} />
        <p className={styles.nothing}>{t('ord.supplierGone')}</p>
        {sendDialogs}
      </section>
    );
  }

  const label = supplierLabel(supplier);
  const showStock = snapshot.config.showStock;
  const openCard = (row: OrderRow) => {
    doors.open({
      address: ingredientCardAddress(row.ingredient.id),
      state: pseudo ? fromOrdersList(tabOfLine(row.ingredient)) : fromOrdersSupplier(id),
      target: { kind: 'name', ingredientId: row.ingredient.id, in: 'supplier' },
    });
  };
  const lineOf = (row: OrderRow) => (
    <OrderLine
      key={row.ingredient.id}
      row={row}
      entry={entries[row.ingredient.id]}
      showStock={showStock}
      compact
      hint={row.elsewhere ? { kind: 'none' } : snapshot.suggester.hint(row.ingredient, entries[row.ingredient.id])}
      onEdit={(edited, edit) => { store.editLine(supplier, edited.ingredient, edit); }}
      onOpenCard={doors.may ? openCard : undefined}
      onLeaveBox={() => { store.sendWaitingDraft(); }}
    />
  );
  const empty = rows.active.length === 0 && rows.inactive.length === 0;
  // What is typed for this supplier: «Order placed…» needs some, «Clear quantities…» is offered only when there is some.
  const filled = lens.filledFor(id);
  const placing = snapshot.placing.includes(id);
  // «Send» on this supplier's own screen: ITS lines only, through the same roads and the same editor as the send screen.
  // ⚠️ CALLED FROM THE PRESS, with nothing awaited first (the unit check runs in that tick), and freed again whatever happens: a send
  // that throws or rejects must not leave the button dead. The log carries the error, never the order.
  const sendOrder = () => {
    if (sending.current || filled === 0) return;
    sending.current = true;
    const failed = (err: unknown) => {
      console.error('Sending the order failed:', err);
      sending.current = false;
      say(t('ord.send.failed'), LONG_MS);
    };
    // ⚠️ WHAT GOES IS TAKEN AT THE PRESS, with the message: «did it go?» asks about exactly these numbers, whatever is typed meanwhile.
    const went = draftQuantities(lens.linesOf(id), snapshot.draft.entries);
    let going: ReturnType<typeof send>;
    try {
      going = send({ rows: draftSendRows(lens, snapshot.draft, [id]), grouped: true, supplierRoadsOnly: false });
    } catch (err) {
      failed(err);
      return;
    }
    void going.then(result => {
      sending.current = false;
      // Handed over, whether or not this screen is still the one on show: the question is the only thing that gets it recorded.
      if (result?.kind === 'sent' && result.ids.includes(id)) {
        store.waitForAnswer([{ supplierId: id, quantities: went.quantities, units: went.units }], result.handOff);
      }
      if (result?.kind === 'list') sayListOutcome(say, t, result.outcome);
      else if (result?.kind === 'sent' && result.blocked) say(t('ord.send.nothingOpened'), LONG_MS);
    }).catch(failed);
  };
  const place = () => {
    // Refused offline: the record and the clear would land at two different moments of connectivity (parity X3).
    if (navigator.onLine === false) {
      say(t('ord.offline.place'), LONG_MS);
      return;
    }
    handBack.expect(PLACE_DOOR);
    void navigate(supplierConfirmPath(id), { state: confirmState(state) });
  };

  const cardDoor = doors.may && !pseudo
    ? () => { doors.open({ address: supplierScreenAddress(id), state: fromOrdersList('suppliers'), target: { kind: 'supplier' } }); }
    : undefined;

  return (
    <section ref={screen} className={styles.screen} aria-labelledby={titleId}>
      {/* The head sticks, and the column names stick under it while the rows scroll; the slim bar between them scrolls away. */}
      <div ref={barHeight.ref} className={styles.sticky}>
        <header className={styles.head}>
          {/* ⚠️ X ON THE SPLIT, AN ARROW ON A PHONE: beside the list the supplier is closed, on a phone the person goes back. Either way it is
              the same one level up (useLeave), and nothing typed is lost. */}
          <Button variant="bare" className={styles.icon} aria-label={split ? t('ord.supplier.close', { supplier: label }) : t('ui.back')} onPress={leave}>
            {split ? <X aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
          </Button>
          {cardDoor ? (
            <h2 ref={titleNode} tabIndex={-1} className={styles.title} aria-labelledby={titleId}>
              <button ref={supplierDoorNode} type="button" className={styles.door} aria-label={t('ord.supplierDoor', { supplier: label })} onClick={cardDoor}>
                <span id={titleId} className={styles.name}>{label}</span>
                <ChevronRight aria-hidden="true" />
              </button>
            </h2>
          ) : (
            <h2 ref={titleNode} id={titleId} tabIndex={-1} className={styles.title}><span className={styles.name}>{label}</span></h2>
          )}
          {/* A phone keeps «Summary (N)» here: its rows have no summary button. Always drawn there, also at 0 (3 Oct 2026). */}
          {split ? null : (
            <Button
              ref={summaryNode}
              variant="bare"
              className={styles.summary}
              onPress={() => {
                handBack.expect(SUMMARY_DOOR);
                void navigate(supplierSummaryPath(id), { state: fromSupplierState(state) });
              }}
            >
              <ClipboardList aria-hidden="true" />
              {t('ord.summaryDoor', { n: filled })}
            </Button>
          )}
          {/* ⚠️ AN ARROW OUT OF A TRAY: the roads are chosen next. Only this supplier's lines go. */}
          <Button
            variant="bare"
            className={styles.icon}
            aria-label={t('ord.supplierSendAria', { supplier: label })}
            isDisabled={filled === 0}
            onPress={sendOrder}
          >
            <Share aria-hidden="true" />
          </Button>
        </header>
      </div>
      <div className={styles.bar}>
        <DayLine supplier={supplier} lens={lens} slim />
        <SaveStateLine inBar />
      </div>
      {empty ? null : (
        <div
          className={styles.columns}
          data-stock={showStock}
          style={{ top: barHeight.px }}
        >
          <span className={styles.columnItem}>{t('ord.field.item')}</span>
          <span className={`${styles.columnName} ${styles.columnUnit}`}>{t('ord.field.unit')}</span>
          <span className={styles.columnName}>{t('ord.field.order')}</span>
          {showStock ? <span className={styles.columnName}>{t('ord.field.stock')}</span> : null}
        </div>
      )}
      {empty ? (
        <p className={styles.nothing}>{t('ord.noIngredientsYet')}</p>
      ) : (
        <>
          {rows.active.length > 0 ? <ul className={styles.rows}>{rows.active.map(lineOf)}</ul> : null}
          {rows.inactive.length > 0 ? (
            <div className={styles.folded}>
              <FoldedGroup title={t('ord.notInUseGroup', { n: rows.inactive.length })} open={group.open} onToggle={group.onToggle}>
                <ul className={styles.rows}>{rows.inactive.map(lineOf)}</ul>
              </FoldedGroup>
            </div>
          ) : null}
          {/* After the rows and NOT stuck: a bar stuck to the bottom of a phone would take the rows' room. */}
          <div className={styles.actions}>
            {/* The order's total, nothing else of the money (his words, 28 Sep 2026: «devo vedere solo il totale alla fine»): on the
                split, for whoever may read prices — the same numbers as the summary (choice C4). */}
            {split && snapshot.pricesReadable ? <OrderTotals totals={summaryFor(lens, id, snapshot.draft, snapshot.prices, true).totals} /> : null}
            <Button ref={placeNode} variant="primary" isDisabled={filled === 0 || placing} onPress={place}>
              <Check aria-hidden="true" />
              {t('ord.placeAction')}
            </Button>
            {filled > 0 ? (
              <Button variant="quiet" onPress={() => { void clearQuantities([id]).then(cleared => { if (cleared) leave(); }); }}>
                {t('ord.clearAction')}
              </Button>
            ) : null}
          </div>
        </>
      )}
      {clearDialog}
      {sendDialogs}
    </section>
  );
}

// A box's height in CSS pixels, kept current as it changes.
function useHeight(): { ref: (node: HTMLElement | null) => void; px: number } {
  const [px, setPx] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (node === null) return;
    const measure = () => { setPx(node.getBoundingClientRect().height); };
    measure();
    if (typeof ResizeObserver === 'function') {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    }
  }, []);
  return { ref, px };
}
