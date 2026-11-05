import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, List } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { DayLine } from './DayLine';
import { OrderLine } from './OrderLine';
import { useOrders, useOrdersStore } from './OrdersContext';
import { ITEMS_DOOR, PLACE_DOOR, supplierOpener, useHandBack } from './handBack';
import { ORDERS_PATH, supplierConfirmPath, supplierItemsPath } from './ordersPath';
import { cameFromList, confirmState, fromSupplierState, useLeave } from './ordersNav';
import { LONG_MS, useClearQuantities } from './useClearQuantities';
import type { OrderRow, OrdersLens } from './ordersLens';
import styles from './SupplierOrderScreen.module.css';

// One supplier's order: the quantities to type, A→Z, and under them the lines switched off.
//
// Back is one level up (P20): the browser's Back when the list is the entry behind, else it replaces itself with the list.
export function SupplierOrderScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const store = useOrdersStore();
  const snapshot = useOrders();
  const handBack = useHandBack();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const leave = useLeave(ORDERS_PATH, () => { handBack.expect(supplierOpener(id)); });
  const say = useStatusMessage();
  const [clearQuantities, clearDialog] = useClearQuantities(lens);

  // «What they sell» one level down: Back from it hands the focus back to this button.
  const itemsNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(ITEMS_DOOR, node); }, [handBack]);
  // «Order placed…» one level down: Back from the confirm screen hands the focus back to this button.
  const placeNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(PLACE_DOOR, node); }, [handBack]);

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
  useEffect(() => {
    if (shown && cameFromList(state) && !screen.current?.contains(document.activeElement)) title.current?.focus();
  }, [shown]);

  // The column names stick right under the bar, whose height changes with the title's lines and the width.
  const barHeight = useHeight();

  if (supplier === undefined) {
    return (
      <section className={styles.screen} aria-label={t('section.orders')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('section.orders')} titleRef={title} />
        <p className={styles.nothing}>{t('ord.supplierGone')}</p>
      </section>
    );
  }

  const label = supplierLabel(supplier);
  const showStock = snapshot.config.showStock;
  const lineOf = (row: OrderRow) => (
    <OrderLine
      key={row.ingredient.id}
      row={row}
      entry={entries[row.ingredient.id]}
      showStock={showStock}
      hint={row.elsewhere ? { kind: 'none' } : snapshot.suggester.hint(row.ingredient, entries[row.ingredient.id])}
      onEdit={(edited, edit) => { store.editLine(supplier, edited.ingredient, edit); }}
    />
  );
  const empty = rows.active.length === 0 && rows.inactive.length === 0;
  // What is typed for this supplier: «Order placed…» needs some, «Clear quantities…» is offered only when there is some.
  const filled = lens.filledFor(id);
  const placing = snapshot.placing.includes(id);
  const place = () => {
    // Refused offline: the record and the clear would land at two different moments of connectivity (parity X3).
    if (navigator.onLine === false) {
      say(t('ord.offline.place'), LONG_MS);
      return;
    }
    handBack.expect(PLACE_DOOR);
    void navigate(supplierConfirmPath(id), { state: confirmState(state) });
  };

  return (
    <section ref={screen} className={styles.screen} aria-labelledby={titleId}>
      {/* The bar and the column names stick, the names over the boxes while the rows scroll. The day line between them
          scrolls away: stuck too, on a phone it took half the screen from the rows. */}
      <div ref={barHeight.ref} className={styles.sticky}>
        <FormBar
          backLabel={t('ui.back')}
          onBack={leave}
          title={label}
          titleId={titleId}
          titleRef={title}
          action={(
            <Button
              ref={itemsNode}
              variant="secondary"
              onPress={() => {
                handBack.expect(ITEMS_DOOR);
                void navigate(supplierItemsPath(id), { state: fromSupplierState(state) });
              }}
            >
              <List aria-hidden="true" />
              {t('ord.whatTheySell')}
            </Button>
          )}
        />
      </div>
      <DayLine supplier={supplier} lens={lens} />
      {empty ? null : (
        <div
          className={styles.columns}
          data-stock={showStock}
          style={{ top: barHeight.px }}
        >
          <span />
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
