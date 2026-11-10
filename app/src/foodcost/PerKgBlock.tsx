import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { fcMoney, fcNumber, fcWeight } from '@mise/shared/fc-number';
import type { CostTables } from '@mise/shared/foodcost-model';
import { costPerKg } from '@mise/shared/per-kg-model';
import type { PerKgReason, PerKgResult, PerKgRow } from '@mise/shared/per-kg-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import styles from './PerKgBlock.module.css';

// Why a row is shown but not counted: keys, resolved when the block is drawn (a `t()` here at module load would
// freeze the language the page booted in).
const REASON_TEXT = {
  'no-price': 'fc.perKg.noPrice',
  'not-weighed': 'fc.perKg.notWeighed',
  'no-recipe': 'fc.perKg.noRecipe',
  'no-piece-weight': 'fc.perKg.noPieceWeight',
  'no-piece-price': 'fc.perKg.noPiecePrice',
} as const satisfies Record<PerKgReason, MessageKey>;

type Props = {
  // The product as typed (normalised), and the tables its answers are worked out from — the stored recipes with the
  // weighings typed on this product laid over them, so the block moves with the boxes, before Save.
  product: unknown;
  tables: CostTables;
};

// The cost of ONE kilo of the finished product, line by line, the recipes on it opened into their own ingredients
// (the current app's «Cost per 1 kg»; Federico, 4 Nov 2026).
//
// ⚠️ ONE ELEMENT, ALWAYS MOUNTED: it keeps open/closed through every repaint, and a tapped summary keeps the focus while
// the data listeners redraw the figures. With nothing to show it is `hidden`, not removed — removing it would forget
// whether it was open.
// ⚠️ A FAULT HERE MUST NOT TAKE THE CARD DOWN (P17): the block is a reading aid, and the answer and the form are drawn
// beside it.
// ⚠️ DRAWN APART FROM «MADE OF», on purpose: that section shows each line's own rate and cost; this block is the whole
// product's cost per kilo cut into parts. The total is the card's own cost, never a second sum (per-kg-model).
export function PerKgBlock({ product, tables }: Props) {
  const { t } = useT();
  const money = useMoney();
  const res = useMemo((): PerKgResult | null => {
    try {
      const result = costPerKg(product, tables);
      return result.total === null ? null : result;
    } catch {
      return null;
    }
  }, [product, tables]);

  const rowDetail = (row: PerKgRow): string => {
    const parts: string[] = [];
    const hasKg = row.kg !== null;
    const hasPcs = row.pcs !== null;
    if (hasKg && !(row.kind === 'piece' && hasPcs)) parts.push(fcWeight(row.kg, money));
    else if (hasPcs) parts.push(t('fc.perKg.pieces', { n: fcNumber(row.pcs, money) }));
    if (row.reason) parts.push(t(REASON_TEXT[row.reason]));
    else if (row.pricePerKg !== null) parts.push(`${fcMoney(row.pricePerKg, money)} / kg`);
    else if (row.priceEach !== null) parts.push(t('sup.perEach', { rate: fcMoney(row.priceEach, money) }));
    return parts.join(' · ');
  };

  return (
    <details className={styles.block} hidden={res === null}>
      <summary className={styles.summary}>
        <span>{t('fc.perKg.title')}</span>
        <span className={styles.sum}>
          <span className={styles.num}>{res === null ? '' : fcMoney(res.total, money)}</span>
          <ChevronDown aria-hidden="true" className={styles.chevron} />
        </span>
      </summary>
      {res === null ? null : (
        <div className={styles.body}>
          <ul className={styles.list}>
            {res.rows.map(row => (
              <li key={row.key} className={styles.row}>
                <span className={styles.name}>{row.name}</span>
                {/* Both the rows and the total are shown in cents: the total is worked out from the exact values, so the
                    rows may differ from it by a cent; that is accepted (the owner, 8 Nov 2026). */}
                {row.reason ? null : <span className={styles.cost}>{fcMoney(row.cost, money)}</span>}
                <span className={styles.detail}>{rowDetail(row)}</span>
              </li>
            ))}
          </ul>
          <div className={styles.total}>
            <span>{t('fc.perKg.total')}</span>
            <span className={styles.num}>{fcMoney(res.total, money)}</span>
          </div>
          {/* ⚠️ NEUTRAL, NOT «IT COSTS MORE»: a row with no price adds neither cost nor weight in the cost model, so the
              figure can be too high (water not linked) as well as too low. */}
          {res.partial ? <p className={styles.partial}>{t('fc.perKg.partial')}</p> : null}
          {res.packagingLeftOut ? <p className={styles.note}>{t('fc.perKg.packagingLeftOut')}</p> : null}
          {res.lossy ? <p className={styles.note}>{t('fc.perKg.lossNote')}</p> : null}
        </div>
      )}
    </details>
  );
}
