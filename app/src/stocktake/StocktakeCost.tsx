import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { Navigate, useLocation } from 'react-router';
import { consumption, isClosed, productsOfMonth } from '@mise/shared/inventory-model';
import { monthCost } from '@mise/shared/inventory-value';
import { formatMoney } from '@mise/shared/price-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { KEEP_FOCUS } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import type { Product } from './countListModel';
import { COST_OPENER, useHandBack } from './handBack';
import { blockerText } from './productValue';
import { useStocktake } from './StocktakeContext';
import { displayNumber, monthName } from './stocktakeFormat';
import { productLabel } from './stocktakeModel';
import { cameFromList, useLeave } from './stocktakeNav';
import { monthPath } from './stocktakePath';
import styles from './StocktakeCost.module.css';

// «What the month cost»: where the month's money went, most expensive first.
//
// ⚠️ WHOEVER RUNS THE PLACE ONLY. It is all money: an employee who opens the address is sent back
// to the month's list, and nothing of it is drawn for them.
//
// ⚠️ IT NEVER HIDES THE ROWS IT COULD NOT VALUE. They sit at the bottom, with the quantity that WAS
// counted and the reason there is no money beside it — a total that silently leaves things out is a
// total somebody will believe.
//
// An open month is valued at today's prices and a closed one only at what it froze (monthCost with
// `closed`): never today's price, never the live pack text.
export function StocktakeCost({ month: monthId }: { month: string }) {
  const { t, locale } = useT();
  const { canManage } = useSession();
  const money = useMoney();
  const { state } = useLocation();
  const snapshot = useStocktake();
  const handBack = useHandBack();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const { ingredients, ingredientsLoaded } = snapshot;
  // The store answers one render late after the address changes (see StocktakeProduct).
  const month = snapshot.monthId === monthId ? snapshot.month : null;
  const ready = canManage && month !== null && ingredientsLoaded;

  const onLeaving = useCallback(() => { handBack.expect(COST_OPENER); }, [handBack]);
  const leave = useLeave(monthPath(monthId), onLeaving);

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title.
  useEffect(() => {
    if (ready && cameFromList(state)) title.current?.focus();
  }, [ready]);

  const closed = month !== null && isClosed(month);
  const cost = useMemo(() => {
    if (month === null) return null;
    const products = productsOfMonth<Product>(month, ingredients);
    return monthCost({
      month,
      ingredients: products,
      consumptionOf: product => consumption(month, product.id).used,
      closed,
    });
  }, [month, ingredients, closed]);

  if (!canManage) return <Navigate to={monthPath(monthId)} replace state={KEEP_FOCUS} />;

  if (month === null || cost === null || !ingredientsLoaded) {
    return (
      <section className={styles.cost} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }

  return (
    <section className={styles.cost} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('stock.costTitle')}
        titleId={titleId}
        titleRef={title}
        sub={<p className={styles.month}>{monthName(monthId, locale)}</p>}
      />

      <div className={styles.body}>
        <div className={styles.summary}>
          <p className={styles.summaryLabel}>{t('stock.costThisMonth')}</p>
          <p className={styles.summaryValue}>{formatMoney(cost.total, money)}</p>
          {/* ⚠️ `n` IS WHAT INFLECTS THE SENTENCE, and the one that belongs in it differs between
              the two. The partial one ends on «of which {n} have no value», so its number is the
              unvalued rows; the plain one has only `counted` to agree with. */}
          <p className={styles.summaryNote}>
            {cost.withoutValue > 0
              ? t('stock.costBasisPartial', { counted: cost.counted, n: cost.withoutValue })
              : t('stock.costBasis', { counted: cost.counted, n: cost.counted })}
          </p>
        </div>

        {cost.lines.length === 0 ? (
          <p className={styles.empty}>{t('stock.costEmpty')}</p>
        ) : (
          <ul className={styles.rows}>
            {cost.lines.map(({ ingredient, used, value, blocker }) => {
              const name = productLabel(ingredient) || month.names[ingredient.id] || t('stock.unnamedProduct');
              const unit = typeof ingredient.unit === 'string' && ingredient.unit !== ''
                ? ingredient.unit
                : t('stock.packsShort');
              const quantity = `${displayNumber(used, locale)} ${unit}`;
              return (
                <li key={ingredient.id} className={styles.row} data-unvalued={value === null}>
                  <div className={styles.main}>
                    <span className={styles.name}>{name}</span>
                    <span className={styles.sub}>
                      {value === null ? `${quantity} · ${blockerText(t, blocker)}` : quantity}
                    </span>
                  </div>
                  <span className={styles.value}>{value === null ? '—' : formatMoney(value, money)}</span>
                </li>
              );
            })}
          </ul>
        )}

        {/* ⚠️ SAID OUT LOUD, because nothing on the screen can show it: every figure rests on prices
            somebody typed by hand and on a count made standing in a storeroom. */}
        <p className={styles.caveat}>{t('stock.costCaveat')}</p>
      </div>
    </section>
  );
}
