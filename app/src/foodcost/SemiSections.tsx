import { useMemo } from 'react';
import { fcMoney } from '@mise/shared/fc-number';
import { cardsUsing, productCooking, semiCardCost } from '@mise/shared/foodcost-model';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { fcWeight } from '@mise/shared/fc-number';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { CardSection } from './CardSection';
import { useFoodcost } from './FoodcostContext';
import styles from './SemiSections.module.css';

// The two sections only a SEMI-FINISHED card has (model 4, 20 Nov 2026): «Cost per kg» (what the other cards use when they put this
// one in «Made of») and «Used in» (which cards do). Both are reading aids drawn beside the form and the read view alike.

type CostProps = {
  // The card as typed (normalised) or as stored, and the tables its figures are worked out from.
  product: Product;
  tables: CostTables;
  // The labour-rate sentence the screen decides (only for whoever may set the rate); '' draws nothing.
  labourNote: string;
};

// ⚠️ THE FIGURES ARE semiCardCost'S — the very call a line holding this card is costed by, so the card and the cards that use it can
// never disagree. Unknown is never 0: no price shows the sentence that says what is missing, and labour is left out (never «0») while
// no rate is handed in.
export function SemiCostBlock({ product, tables, labourNote }: CostProps) {
  const { t } = useT();
  const money = useMoney();
  const cost = useMemo(() => semiCardCost(product, tables), [product, tables]);
  const loss = useMemo(() => productCooking(product, tables).lossPct, [product, tables]);
  const name = product.name.trim() || t('fc.untitledProduct');
  const known = cost.materialsPerKg !== null && cost.totalPerKg !== null;

  return (
    <CardSection title={t('fc.semi.costTitle')} help={t('fc.semi.costHelp')}>
      {!known ? <p className={styles.caption}>{t('fc.semi.costNone')}</p> : (
        <>
          <p className={styles.big} data-testid="semi-cost-total">{t('fc.semi.perKg', { amount: fcMoney(cost.totalPerKg, money) })}</p>
          <p className={styles.caption}>
            {loss !== null && loss > 0
              ? t('fc.semi.costCaptionLoss', { name, loss: `${Math.round(loss * 100) / 100}` })
              : t('fc.semi.costCaption', { name })}
          </p>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>{t('fc.semi.materials')}</dt>
              <dd>{t('fc.semi.perKg', { amount: fcMoney(cost.materialsPerKg, money) })}</dd>
            </div>
            {cost.labourPerKg === null ? null : (
              <>
                <div className={styles.row}>
                  <dt>{t('fc.semi.labour')}</dt>
                  <dd>{t('fc.semi.perKg', { amount: fcMoney(cost.labourPerKg, money) })}</dd>
                </div>
                <div className={`${styles.row} ${styles.total}`}>
                  <dt>{t('fc.semi.total')}</dt>
                  <dd>{t('fc.semi.perKg', { amount: fcMoney(cost.totalPerKg, money) })}</dd>
                </div>
              </>
            )}
          </dl>
          {cost.partial ? <p className={styles.note}>{t('fc.perKg.partial')}</p> : null}
        </>
      )}
      {labourNote === '' ? null : <p className={styles.note}>{labourNote}</p>}
    </CardSection>
  );
}

type UsedProps = {
  // The card's id: only a saved card can be used anywhere.
  cardId: string;
  onOpen: (id: string) => void;
};

// «Used in»: the cards that hold this one on a line, each with its kilos, each a button that opens it. Hidden when nothing uses it.
export function UsedInBlock({ cardId, onOpen }: UsedProps) {
  const { t } = useT();
  const money = useMoney();
  const { products } = useFoodcost();
  const uses = useMemo(
    () => cardsUsing(products, cardId).sort((a, b) => a.product.name.localeCompare(b.product.name)),
    [products, cardId],
  );
  if (uses.length === 0) return null;
  return (
    <CardSection title={t('fc.semi.usedIn')} help={t('fc.semi.usedInHelp')}>
      <ul className={styles.used}>
        {uses.map(use => (
          <li key={use.product.id}>
            <button
              type="button"
              className={styles.link}
              aria-label={t('fc.semi.openCard', { name: use.product.name })}
              onClick={() => { onOpen(use.product.id); }}
            >
              {t('fc.semi.usedInRow', { name: use.product.name, kg: fcWeight(use.qtyKg, money) })}
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.caption}>{t('fc.semi.usedInHint')}</p>
    </CardSection>
  );
}
