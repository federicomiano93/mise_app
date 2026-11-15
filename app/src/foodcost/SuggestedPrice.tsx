import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { productionCost, suggestedGrossPrice } from '@mise/shared/foodcost-model';
import type { CostTables, Product, SaleUnit } from '@mise/shared/foodcost-model';
import { fcMoney, fcNumber } from '@mise/shared/fc-number';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import styles from './SuggestedPrice.module.css';

// Keys, resolved when the box is drawn: a `t()` here at module load would freeze the language the
// page booted in.
const UNIT_TEXT = {
  piece: 'fc.perPiece',
  kg: 'fc.perKg',
  pack: 'fc.perPack',
} as const satisfies Record<SaleUnit, MessageKey>;

type Props = {
  // The product as typed (normalised), and the tables its answers are worked out from — the stored
  // recipes with the weighings typed on this product laid over them.
  product: Product;
  tables: CostTables;
  // The price typed now, or null: «This is the selling price» when it already equals the suggestion.
  sellingPrice: number | null;
  // Null in the read view: nothing there can be changed, so there is no «Use this price» (the note that it is already the selling
  // price stays).
  onUse: ((price: number) => void) | null;
};

// The price to sell it at, from the cost per unit, the VAT rate and the target: on the SAME screen as
// the food cost of the price typed (his choice, 13 Sep 2026, over a switch between two modes).
//
// The cost and the food cost that used to sit beside it in a «Calculated costs» box are the summary's now (11 Nov 2026).
export function SuggestedPrice({ product, tables, sellingPrice, onUse }: Props) {
  const { t } = useT();
  const money = useMoney();
  const box = useRef<HTMLDivElement>(null);
  const cost = productionCost(product, tables);
  const price = cost.unitCost === null
    ? null
    : suggestedGrossPrice({ unitCost: cost.unitCost, vatRate: product.vatRate, targetPct: product.foodCostTarget });
  const inUse = price !== null && sellingPrice !== null && Math.abs(sellingPrice - price) < 0.005;
  return (
    // Focusable (not in the tab order) and live: the button below goes away the moment it is used,
    // and the focus must stay in the box that says so, not be lost to the page.
    <div ref={box} tabIndex={-1} aria-live="polite" className={styles.suggestionWrap}>
      {/* Nothing to suggest until the product has a cost per piece, kilo or pack. */}
      {cost.unitCost === null ? null : price === null ? (
        <div className={styles.suggestion} role="group" aria-label={t('fc.suggestedPrice')}>
          <p className={styles.note}>{t('fc.suggestedPriceNeeds')}</p>
        </div>
      ) : (
        <div className={styles.suggestion} role="group" aria-label={t('fc.suggestedPrice')}>
          <div className={styles.head}>
            <span className={styles.label}>{t('fc.suggestedPrice')}</span>
            <span className={styles.value}>
              <span className={styles.num}>{fcMoney(price, money)}</span>
              <span className={styles.unit}>{cost.unit === null ? '' : t(UNIT_TEXT[cost.unit])}</span>
            </span>
          </div>
          <p className={styles.basis}>
            {t('fc.suggestedPriceBasis', {
              vat: fcNumber(Number(product.vatRate), money),
              target: fcNumber(Number(product.foodCostTarget), money),
            })}
          </p>
          {/* ⚠️ A PARTLY PRICED PRODUCT COSTS MORE THAN IT SAYS, so the price that would hit the target is HIGHER than this one
              — say so. */}
          {cost.partial ? <p className={styles.partial}>{t('fc.suggestedPricePartial')}</p> : null}
          {inUse ? (
            <p className={styles.note}>{t('fc.suggestedPriceInUse')}</p>
          ) : onUse === null ? null : (
            <Button
              className={styles.use}
              onPress={() => {
                flushSync(() => { onUse(price); });
                box.current?.focus({ preventScroll: true });
              }}
            >
              {t('fc.useThisPrice')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
