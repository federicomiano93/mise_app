import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { BLOCKER_TEXT, costProduct, productionCost, suggestedGrossPrice } from '@mise/shared/foodcost-model';
import type { CostTables, FoodCostStatus, Product, SaleUnit, SellingMode } from '@mise/shared/foodcost-model';
import { formatMoney, formatRate } from '@mise/shared/price-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { percentText } from './productRowModel';
import { plainNumber } from './productEditorModel';
import styles from './ProductAnswer.module.css';

// Keys, resolved when the answer is drawn: a `t()` here at module load would freeze the language the
// page booted in.
const STATUS_TEXT = {
  green: 'fc.onTarget',
  amber: 'fc.slightlyOverTarget',
  red: 'fc.overTarget',
} as const satisfies Record<FoodCostStatus, MessageKey>;

const UNIT_TEXT = {
  piece: 'fc.perPiece',
  kg: 'fc.perKg',
  pack: 'fc.perPack',
} as const satisfies Record<SaleUnit, MessageKey>;

// The unit word of a way of selling's figures: «per piece», «per kg», «per pack».
function unitWord(mode: SellingMode | null): MessageKey {
  return UNIT_TEXT[mode === 'weight' ? 'kg' : mode === 'pack' ? 'pack' : 'piece'];
}

type Figures = {
  // The product as typed (normalised), and the tables its answers are worked out from — the stored
  // recipes with the weighings typed on this product laid over them.
  product: Product;
  tables: CostTables;
};

// NOT A LIVE REGION: it holds every figure, and a screen reader would read them all again at each
// keystroke. Only the suggested price speaks (SuggestedPrice below), as in the current app.
//
// What it costs to make (no price needed) over the food cost it answers to (a price and a VAT rate
// needed). Together they are the top of the page.
export function ProductAnswer({ product, tables }: Figures) {
  const { t, locale } = useT();
  const money = useMoney();
  const cost = productionCost(product, tables);
  const result = costProduct(product, tables);

  return (
    <div className={styles.answers}>
      {/* Nothing costed yet: no box at all, never «£0.00», which reads as free. */}
      {cost.batchCost === null ? null : (
        <div className={styles.cost} role="group" aria-label={t('fc.productionCost')}>
          <div className={styles.head}>
            <span className={styles.label}>{t('fc.productionCost')}</span>
            <span className={styles.value}>
              <span className={styles.num}>
                {cost.unitCost !== null ? formatRate(cost.unitCost, money) : formatMoney(cost.batchCost, money)}
              </span>
              <span className={styles.unit}>
                {cost.unit !== null ? t(UNIT_TEXT[cost.unit]) : t('fc.wholeBatchWord')}
              </span>
            </span>
          </div>
          {cost.unitCost === null ? null : (
            <p className={styles.basis}>{t('fc.wholeBatch', { cost: formatMoney(cost.batchCost, money) })}</p>
          )}
          {/* The work, beside the materials — only when there is a figure, which needs the hourly
              rate, which only whoever runs the place is ever sent. */}
          {cost.labourUnitCost === null || cost.unit === null ? null : (
            <>
              <p className={styles.basis}>
                {t('fc.costSplit', { materials: formatRate(cost.unitCost, money), labour: formatRate(cost.labourUnitCost, money) })}
              </p>
              <p className={styles.basis}>
                {t('fc.costTotal', { total: formatRate(cost.totalUnitCost, money), unit: t(UNIT_TEXT[cost.unit]) })}
              </p>
            </>
          )}
          {/* ⚠️ THE SAME RULE AS THE ANSWER BELOW: a partial cost is always too LOW, so it may never be
              shown without saying so. */}
          {cost.partial ? <p className={styles.partial}>{t('fc.costPartial')}</p> : null}
        </div>
      )}

      {result.foodCostPct === null ? (
        <div className={styles.answer} role="group" aria-label={t('fc.foodCost')} data-status="none">
          <p className={styles.none}>{t('fc.notCostedYet')}</p>
          {/* Everything still missing, in the order a person would fill it in — a checklist, not a
              drip-feed. */}
          <ul className={styles.blockers}>
            {result.blockers.map(blocker => <li key={blocker}>{t(BLOCKER_TEXT[blocker])}</li>)}
          </ul>
        </div>
      ) : (
        <div className={styles.answer} role="group" aria-label={t('fc.foodCost')} data-status={result.status ?? 'none'}>
          <div className={styles.head}>
            <span className={styles.label}>{t('fc.foodCost')}</span>
            <span className={styles.figure}>{percentText(result.foodCostPct, locale)}</span>
          </div>
          <p className={styles.basis}>
            {t('fc.answerBasis', {
              cost: formatRate(result.unitCost, money),
              unit: t(unitWord(product.sellingMode)),
              net: formatMoney(result.netUnitPrice, money),
              margin: formatMoney(result.margin, money),
            })}
          </p>
          {result.status === null ? null : <p className={styles.status}>{t(STATUS_TEXT[result.status])}</p>}
          {/* ⚠️ BESIDE THE FOOD COST, NEVER INSIDE IT: the percentage above stays what the ingredients
              and packaging take; this says what the work takes, and everything. */}
          {result.labourPct === null || result.totalCostPct === null ? null : (
            <p className={styles.basis}>
              {t('fc.labourPctLine', {
                labour: plainNumber(result.labourPct, locale),
                total: plainNumber(result.totalCostPct, locale),
              })}
            </p>
          )}
          {/* ⚠️ A PARTIAL COST MUST NEVER LOOK COMPLETE: the percentage is real but too LOW — the one
              direction a food cost must not be wrong in. */}
          {result.partial ? <p className={styles.partial}>{t('fc.partOfThisProduct')}</p> : null}
        </div>
      )}
    </div>
  );
}

type SuggestionProps = Figures & {
  // The price typed now, or null: «This is the selling price» when it already equals the suggestion.
  sellingPrice: number | null;
  onUse: (price: number) => void;
};

// The price to sell it at, from the cost per unit, the VAT rate and the target: on the SAME screen as
// the food cost of the price typed (his choice, 13 Sep 2026, over a switch between two modes).
export function SuggestedPrice({ product, tables, sellingPrice, onUse }: SuggestionProps) {
  const { t, locale } = useT();
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
              <span className={styles.num}>{formatMoney(price, money)}</span>
              <span className={styles.unit}>{cost.unit === null ? '' : t(UNIT_TEXT[cost.unit])}</span>
            </span>
          </div>
          <p className={styles.basis}>
            {t('fc.suggestedPriceBasis', {
              vat: plainNumber(Number(product.vatRate), locale),
              target: plainNumber(Number(product.foodCostTarget), locale),
            })}
          </p>
          {/* ⚠️ THE SAME RULE AS THE COST ABOVE: a partly priced product costs more than it says, so the
              price that would hit the target is HIGHER than this one — say so. */}
          {cost.partial ? <p className={styles.partial}>{t('fc.suggestedPricePartial')}</p> : null}
          {inUse ? (
            <p className={styles.note}>{t('fc.suggestedPriceInUse')}</p>
          ) : (
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
