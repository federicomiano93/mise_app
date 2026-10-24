import { useCallback } from 'react';
import type { CostResult } from '@mise/shared/foodcost-model';
import type { Money } from '@mise/shared/currency';
import { useT } from '../i18n/useT';
import { productOpener, useHandBack } from './handBack';
import { figureText, subLine } from './productRowModel';
import styles from './ProductRow.module.css';

type Props = {
  id: string;
  name: string;
  result: CostResult;
  money: Money;
  // This product's own screen is the one open on the right (the tablet's split).
  isOpen: boolean;
  onOpen: () => void;
};

// One product on the list: its name, ONE line under it (what it earns, or the first thing still
// missing), the food cost and the traffic light.
//
// ⚠️ THE LIGHT IS A DOT AND A WORD, NEVER COLOUR ALONE (P18): the word is the first thing in the
// line under the name («On target · £0.35 cost · £1.15 margin»), and the dot is hidden from a
// screen reader because that word already says it. A product that cannot be costed has no dot
// colour and no figure («—»): the line says what is missing instead.
export function ProductRow({ id, name, result, money, isOpen, onOpen }: Props) {
  const { t, locale } = useT();
  const handBack = useHandBack();
  // Back from this product's screen hands the focus back to this button.
  const opener = useCallback((node: HTMLButtonElement | null) => {
    handBack.register(productOpener(id), node);
  }, [handBack, id]);
  const costed = result.foodCostPct !== null;

  return (
    <li className={styles.item}>
      <button
        ref={opener}
        type="button"
        className={styles.row}
        aria-current={isOpen ? 'true' : undefined}
        data-open={isOpen}
        onClick={onOpen}
      >
        <span className={styles.main}>
          <span className={styles.name}>{name === '' ? t('fc.untitledProduct') : name}</span>
          <span className={styles.sub} data-todo={!costed}>{subLine(t, result, money)}</span>
        </span>
        <span className={styles.figure}>
          <span className={styles.dot} data-status={result.status ?? 'none'} aria-hidden="true" />
          <span className={styles.pct} data-costed={costed}>{figureText(result, locale)}</span>
        </span>
      </button>
    </li>
  );
}
