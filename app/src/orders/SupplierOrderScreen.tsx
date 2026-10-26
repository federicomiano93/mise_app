import { useEffect, useId, useRef } from 'react';
import { useLocation } from 'react-router';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { FormBar } from '../ui/FormBar';
import { OrderLine } from './OrderLine';
import { useOrders, useOrdersStore } from './OrdersContext';
import { supplierOpener, useHandBack } from './handBack';
import { ORDERS_PATH } from './ordersPath';
import { cameFromList, useLeave } from './ordersNav';
import type { OrderRow, OrdersLens } from './ordersLens';
import styles from './SupplierOrderScreen.module.css';

// One supplier's order: the quantities to type, A→Z, and under them the lines switched off.
//
// Back is one level up (P20): the browser's Back when the list is the entry behind, else it replaces itself with the list.
export function SupplierOrderScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const store = useOrdersStore();
  const snapshot = useOrders();
  const handBack = useHandBack();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const leave = useLeave(ORDERS_PATH, () => { handBack.expect(supplierOpener(id)); });

  const supplier = lens.supplierById(id);
  const rows = lens.rowsFor(id);
  const entries = snapshot.draft.entries;
  const hasQty = (row: OrderRow): boolean => !row.elsewhere && Number(entries[row.ingredient.id]?.qty) > 0;
  // ⚠️ «NOT IN USE» IS CLOSED, BUT OPEN WHEN ONE OF ITS ROWS HAS A QUANTITY: a line switched off with a quantity is in the
  // order (decision T10) and must not hide.
  const group = useFoldedOpen(rows.inactive.some(hasQty), id);

  // Opened from the list the page does not move the focus (FROM_LIST): it goes to this title, once, when the screen first
  // shows a supplier. Another supplier picked beside it (the split) keeps the focus on the row that was pressed.
  const shown = supplier !== undefined;
  useEffect(() => {
    if (shown && cameFromList(state)) title.current?.focus();
  }, [shown]);

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
      onEdit={(edited, edit) => { store.editLine(supplier, edited.ingredient, edit); }}
    />
  );
  const empty = rows.active.length === 0 && rows.inactive.length === 0;

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      {/* The bar and the column names stick together: the names stay over the boxes while the rows scroll. */}
      <div className={styles.sticky}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={label} titleId={titleId} titleRef={title} />
        {empty ? null : (
          <div className={styles.columns} data-stock={showStock}>
            <span />
            <span className={styles.columnName}>{t('ord.field.order')}</span>
            {showStock ? <span className={styles.columnName}>{t('ord.field.stock')}</span> : null}
          </div>
        )}
      </div>
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
        </>
      )}
    </section>
  );
}
