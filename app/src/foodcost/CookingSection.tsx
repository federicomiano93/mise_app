import { useId, useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import { TriangleAlert } from 'lucide-react';
import { fcMoney, fcNumber } from '@mise/shared/fc-number';
import { productCooking } from '@mise/shared/foodcost-model';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { costPerKg } from '@mise/shared/per-kg-model';
import type { PerKgResult } from '@mise/shared/per-kg-model';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { gramsText } from './readText';
import styles from './CookingSection.module.css';

type Props = {
  // The product as typed (normalised), and the tables its answers are worked out from.
  product: Product;
  tables: CostTables;
  // What the two boxes show right now. ⚠️ A box under the finger is never rewritten: these are the text typed, or — for the raw box
  // while nothing is typed apart — the lines' total, which follows the lines live.
  rawText: string;
  cookedText: string;
  // The lines' raw total, in grams, and whether the raw weight is typed apart from it («use the total» is offered then).
  // ⚠️ rawApart is never true while the lines weigh nothing: there is no total to go back to.
  totalGrams: number;
  rawApart: boolean;
  // A weight Save refused (not above 0, or past ten tonnes): the box stays red until it is typed in again.
  invalid: { raw: boolean; cooked: boolean };
  // A recipe of the lines that loses weight while no cooked weight is typed: named in a line, so a no-loss cost is never silent.
  hint: { name: string; pct: number } | null;
  // How many OTHER products (saved before the switch) are still costed through the recipe's loss this Save is about to change.
  sharedWith: number;
  onRaw: (text: string) => void;
  onCooked: (text: string) => void;
  onRawBlur: () => void;
  onUseTotal: () => void;
  // The boxes, for Save to point at and for «use the total» to give the focus back to.
  rawRef: RefObject<HTMLInputElement | null>;
  cookedRef: RefObject<HTMLInputElement | null>;
};

// The product's own «Cottura»: the dough weighed raw and cooked (Federico, 10 Nov 2026: «il calo è del prodotto»). The raw box
// follows the lines' total until a weight is typed apart from it; the cooked box empty means no loss.
//
// ⚠️ THE BOX UNDER THE FINGER IS NEVER REWRITTEN: «12.» is a number half-typed, and putting the parsed 12 back would eat the decimal
// point. The form hands these boxes the text typed.
// ⚠️ ONE LIVE REGION, ALWAYS MOUNTED: text added to a region that was already on the page is announced; a region mounted together with
// its text is not. It holds the heavier-than-raw warning or, failing that, the hint.
export function CookingSection({
  product, tables, rawText, cookedText, totalGrams, rawApart, invalid, hint, sharedWith,
  onRaw, onCooked, onRawBlur, onUseTotal, rawRef, cookedRef,
}: Props) {
  const { t } = useT();
  const money = useMoney();
  const ids = useId();
  const cooking = productCooking(product, tables);
  // ⚠️ A FAULT HERE MUST NOT TAKE THE FORM DOWN (P17), as in PerKgBlock: no cost per kilo simply means no sentence about it.
  const perKg = useMemo((): PerKgResult | null => {
    try {
      const result = costPerKg(product, tables);
      return result.total === null ? null : result;
    } catch {
      return null;
    }
  }, [product, tables]);

  // ⚠️ THE COOKED BOX STAYS RED FOR AS LONG AS ITS WARNING STANDS (owner, Nov 2026: «deve restare rosso»).
  const cookedInvalid = cooking.heavier || invalid.cooked;
  const warnId = `${ids}-warn`;

  let result: ReactNode = null;
  if (perKg !== null && perKg.total !== null && !cooking.heavier) {
    const cost = fcMoney(perKg.total, money);
    const shown = perKg.partial ? t('fc.cooking.moreThan', { cost }) : cost;
    result = cooking.lossPct === null
      ? <>{t('fc.cooking.noLossCost')} <strong>{shown}</strong></>
      : <>{t('fc.cooking.lossLabel')} <strong>{fcNumber(cooking.lossPct, money)}%</strong> · {t('fc.cooking.cookedKgCost')} <strong>{shown}</strong></>;
  }

  return (
    <div className={styles.cooking}>
      <div className={styles.pair}>
        <div className={styles.cell}>
          <label htmlFor={`${ids}-raw`} className={styles.label}>{t('fc.rawDough')}</label>
          <span className={styles.box}>
            <input
              id={`${ids}-raw`}
              ref={rawRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={styles.input}
              placeholder="0"
              aria-invalid={invalid.raw ? true : undefined}
              data-invalid={invalid.raw}
              value={rawText}
              onChange={event => { onRaw(event.target.value); }}
              onBlur={onRawBlur}
            />
            <span className={styles.unit}>g</span>
          </span>
          {rawApart ? (
            <Button variant="bare" className={styles.useTotal} onPress={onUseTotal}>
              {t('fc.cooking.useTotal', { grams: gramsText(money, totalGrams) ?? '' })}
            </Button>
          ) : null}
        </div>
        <div className={styles.cell}>
          <label htmlFor={`${ids}-cooked`} className={styles.label}>{t('fc.cookedDough')}</label>
          <span className={styles.box}>
            <input
              id={`${ids}-cooked`}
              ref={cookedRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={styles.input}
              placeholder="—"
              aria-invalid={cookedInvalid ? true : undefined}
              aria-describedby={cooking.heavier ? warnId : undefined}
              data-invalid={cookedInvalid}
              value={cookedText}
              onChange={event => { onCooked(event.target.value); }}
            />
            <span className={styles.unit}>g</span>
          </span>
        </div>
      </div>
      <p className={styles.out} aria-live="polite">{result}</p>
      <div className={styles.live} aria-live="polite">
        {cooking.heavier ? (
          <p id={warnId} className={styles.warn}>
            <TriangleAlert aria-hidden="true" />
            <span>{t('fc.cooking.heavier')}</span>
          </p>
        ) : hint !== null ? (
          <p className={styles.hint}>
            {t('fc.cooking.recipeLosesHint', { name: hint.name, pct: fcNumber(hint.pct, money) })}
          </p>
        ) : null}
        {/* ⚠️ SAID THE MOMENT IT BECOMES TRUE: a product made of one recipe writes its weighing onto that recipe, and a product saved
            before the switch is still costed through the recipe's loss — nobody opening it would know why its cost moved. */}
        {sharedWith > 0 ? <p className={styles.shared}>{t('fc.lossSharedWith', { n: sharedWith })}</p> : null}
      </div>
    </div>
  );
}
