import { useEffect, useId, useRef } from 'react';
import { useLocation } from 'react-router';
import { ingredientDisplayLabel } from '@mise/shared/archive';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { FormBar } from '../ui/FormBar';
import { useOrders } from './OrdersContext';
import { itemsOpener, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { supplierPath } from './ordersPath';
import type { OrderRow, OrdersLens } from './ordersLens';
import styles from './SupplierItemsScreen.module.css';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// «What they sell»: everything one supplier sells, to LOOK AT. It has no box and no button that saves anything, which is why
// it can be opened in the middle of an order without a thought (parity L23).
//
// What a supplier SELLS is its own catalogue, without the per-order overrides: a line sent here from another supplier is in
// this supplier's ORDER, not on its list, and a line of its own that is ordered elsewhere this time is still on it.
export function SupplierItemsScreen({ id, lens }: { id: string; lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const { draft } = useOrders();
  const handBack = useHandBack();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // Back is the browser's Back when the list is the entry behind (the list icon opened this); an address typed in goes up
  // one level, to the supplier's order.
  const leave = useLeave(supplierPath(id), () => { handBack.expect(itemsOpener(id)); });

  const supplier = lens.supplierById(id);
  const sold = lens.rowsFor(id);
  const own = (rows: readonly OrderRow[]) => rows.filter(row => !row.ingredient.usualSupplierId);
  const active = own(sold.active);
  const inactive = own(sold.inactive);
  const group = useFoldedOpen(inactive.some(row => Number(draft.entries[row.ingredient.id]?.qty) > 0), id);

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

  const rowOf = (row: OrderRow) => (
    <li key={row.ingredient.id} className={styles.item}>
      <span className={styles.name}>{ingredientDisplayLabel(row.ingredient) || t('ord.unnamedProduct')}</span>
      {text(row.ingredient.unit) !== '' ? <span className={styles.unit}>{text(row.ingredient.unit)}</span> : null}
    </li>
  );
  const total = active.length + inactive.length;

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={supplierLabel(supplier)}
        titleId={titleId}
        titleRef={title}
        sub={<p className={styles.sub}>{t('ord.whatTheySell')}</p>}
      />
      <div className={styles.body}>
        {total === 0 ? (
          <p className={styles.nothing}>{t('ord.noIngredientsYet')}</p>
        ) : (
          <>
            <p className={styles.count}>{t('ord.ingredientsCount', { n: total })}</p>
            {active.length > 0 ? <ul className={styles.items}>{active.map(rowOf)}</ul> : null}
            {inactive.length > 0 ? (
              <FoldedGroup title={t('ord.notInUseGroup', { n: inactive.length })} open={group.open} onToggle={group.onToggle}>
                <ul className={styles.items}>{inactive.map(rowOf)}</ul>
              </FoldedGroup>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
