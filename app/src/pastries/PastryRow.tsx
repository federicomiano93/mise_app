import { useId } from 'react';
import type { Ref } from 'react';
import { Check } from 'lucide-react';
import { MAX_QTY } from '@mise/shared/pastries-model';
import type { PastryItem } from '@mise/shared/pastries-model';
import { useT } from '../i18n/useT';
import { checkQuantity, proposedQuantity } from './quantityEdit';
import styles from './PastryRow.module.css';

type Props = {
  item: PastryItem;
  open: boolean;
  // What this phone has typed for the row, '' when nothing.
  typed: string;
  // Given to the open row only: the day panel moves the focus into its box when it opens.
  inputRef: Ref<HTMLInputElement> | undefined;
  onToggle: () => void;
  onType: (value: string) => void;
  onCommit: () => void;
};

// One pastry on a day's list: the name on the left, the quantity on the right in same-width digits,
// so a column of numbers can be read down at a glance. NOTHING IS A FIELD UNTIL THE ROW IS TAPPED.
//
// The box under an open row starts EMPTY and the standing quantity stays plain text: typing is a
// proposal, written only by the tick or Enter. The tick is ALWAYS there while the box is, hidden
// until the number is usable — built and torn down on typing, it would flicker with every change
// another phone makes.
export function PastryRow({ item, open, typed, inputRef, onToggle, onType, onCommit }: Props) {
  const { t } = useT();
  const hintId = useId();
  const check = checkQuantity(proposedQuantity(typed), item.qty);

  return (
    <li className={styles.row} data-open={open}>
      <button type="button" className={styles.main} aria-expanded={open} onClick={onToggle}>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.qty}>{item.qty}</span>
      </button>
      {open ? (
        <div className={styles.edit}>
          <span className={styles.arrow} aria-hidden="true">{item.qty} →</span>
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_QTY}
            step={1}
            placeholder="0"
            value={typed}
            aria-label={t('past.newQuantityFor', { name: item.name })}
            aria-describedby={hintId}
            className={styles.input}
            onChange={event => onType(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              onCommit();
            }}
          />
          <button
            type="button"
            hidden={!check.usable}
            aria-label={t('past.confirmNewQuantityFor', { name: item.name })}
            className={styles.tick}
            onClick={onCommit}
          >
            <Check aria-hidden="true" />
          </button>
          <p id={hintId} className={styles.hint}>{check.hint === null ? '' : t(check.hint)}</p>
        </div>
      ) : null}
    </li>
  );
}
