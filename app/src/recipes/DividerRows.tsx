import { useEffect, useRef } from 'react';
import { hasDividerAfter, unitOf } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import type { EditRow } from './editorModel';
import { unitWord } from './IngredientRow';
import styles from './DividerRows.module.css';

type Props = {
  rows: readonly EditRow[];
  // The heading that names the list (the ingredients heading).
  labelledBy: string;
  // The paragraph that tells what a tap does; every row button is described by it.
  hintId: string;
  // A row was tapped: its line goes on or off.
  onToggle: (key: number) => void;
  // The row button that is owed the focus (on entering the mode). An object, so asking twice asks twice.
  focusRow: { key: number } | null;
};

// The rows of a recipe in DIVIDER MODE: the same look as reorder mode (name and amount, nothing to type in), but each row
// except the last is a button that puts a line under the row, or takes it away (the current app's mode, PR #458). The last
// row has nothing under it to divide, so it is plain text and not a tab stop.
//
// ⚠️ THE ROWS ARE KEYED BY THEIR OWN NUMBER and the button stays the same node when it is pressed, so the focus stays on
// the row that was tapped.
export function DividerRows({ rows, labelledBy, hintId, onToggle, focusRow }: Props) {
  const { t } = useT();
  const buttons = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    if (focusRow !== null) buttons.current.get(focusRow.key)?.focus();
  }, [focusRow]);

  const plain = rows.map(item => item.row);

  return (
    <ul className={styles.list} aria-labelledby={labelledBy}>
      {rows.map((item, index) => {
        const label = String(item.row.label ?? '').trim();
        const name = label === '' ? t('cat.unnamedRow') : label;
        const unit = unitOf(item.row);
        const grams = item.row.grams;
        const empty = grams === '' || grams === undefined || grams === null;
        const number = unit === 'to taste' || empty ? '' : String(grams);
        const last = index === rows.length - 1;
        const divided = hasDividerAfter(plain, index);
        const below = index > 0 && hasDividerAfter(plain, index - 1);
        const cells = (
          <>
            <span className={styles.name}>{name}</span>
            <span className={styles.amount}>
              {/* «to taste» has no number: the word takes the whole cell, or «to taste» is cut to «to tas». */}
              {unit === 'to taste' ? null : <span className={styles.number}>{number}</span>}
              <span className={styles.unit}>{unitWord(unit, t)}</span>
            </span>
          </>
        );
        const itemClass = [styles.item, divided ? styles.divided : '', below ? styles.belowDivided : ''].filter(Boolean).join(' ');
        return (
          <li key={item.key} className={itemClass}>
            {last ? (
              <div className={styles.row}>{cells}</div>
            ) : (
              <button
                type="button"
                ref={node => {
                  if (node) buttons.current.set(item.key, node);
                  else buttons.current.delete(item.key);
                }}
                className={styles.row}
                aria-pressed={divided}
                aria-label={t('cat.dividerUnder', { name })}
                aria-describedby={hintId}
                onClick={() => { onToggle(item.key); }}
              >
                {cells}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
