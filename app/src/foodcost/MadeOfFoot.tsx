import { fcMoney, fcWeight } from '@mise/shared/fc-number';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { madeOfFoot } from './madeOfFootModel';
import styles from './MadeOfFoot.module.css';

// The last row of «Made of», in the form and in the read view alike: what the lines weigh raw and what they cost (madeOfFootModel.ts).
// Drawn only with at least one line; plain text, never a control.
export function MadeOfFoot({ product, tables }: { product: Product; tables: CostTables }) {
  const { t } = useT();
  const money = useMoney();
  if (product.components.length === 0) return null;
  const foot = madeOfFoot(product, tables);
  if (foot === null) return null;
  const cost = foot.cost === null
    ? '—'
    : foot.partial ? t('fc.preview.moreThan', { value: fcMoney(foot.cost, money) }) : fcMoney(foot.cost, money);
  return (
    <p className={styles.foot}>
      <span>{t('fc.rawDough')}</span>
      <span className={styles.value}>{`${fcWeight(foot.rawKg, money)} · ${cost}`}</span>
    </p>
  );
}
