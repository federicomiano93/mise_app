import type { ReactNode } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { CATALOGUE_UNITS, unitOf, unitTextKey } from '@mise/shared/catalogue-model';
import type { CatalogueUnit } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import type { EditRow, Row } from './editorModel';
import styles from './IngredientRow.module.css';

type Props = {
  item: EditRow;
  nameInvalid: boolean;
  amountInvalid: boolean;
  // The boxes under the editor's hand, so a refused save can put the cursor in the first one that is wrong.
  register: (key: number, box: 'name' | 'amount', node: HTMLInputElement | null) => void;
  onChange: (key: number, fields: Row) => void;
  onRemove: (key: number) => void;
  // Under the row's line, at the row's full width: the place for the suggestion list and the link line (the next slice).
  below?: ReactNode;
};

// One ingredient: name · amount · unit · remove, all on ONE line down to a 296px phone.
//
// ⚠️ A ROW TYPED IN NEVER REBUILDS: the editor keys it by the row's own number, so the box under the finger is the same
// box after every letter.
//
// ⚠️ «TO TASTE» IS THE ONE UNIT THAT CARRIES NO NUMBER, so its amount box is not drawn — but the number stays in the
// editor's copy: switching back to a weight gives it back, and nothing counts it meanwhile (a non-weighable unit is 0
// grams to every total, cost and label).
export function IngredientRow({ item, nameInvalid, amountInvalid, register, onChange, onRemove, below }: Props) {
  const { t } = useT();
  const { key, row } = item;
  const unit = unitOf(row);
  const noQty = unit === 'to taste';
  const grams = row.grams === '' || row.grams === undefined || row.grams === null ? '' : String(row.grams);

  return (
    <li className={styles.item}>
      <div className={styles.line}>
        <input
          ref={node => { register(key, 'name', node); }}
          type="text"
          autoComplete="off"
          className={styles.name}
          placeholder={t('cat.ingredient')}
          aria-label={t('cat.ingredientName')}
          aria-invalid={nameInvalid ? true : undefined}
          value={String(row.label ?? '')}
          onChange={event => { onChange(key, { label: event.target.value }); }}
        />
        <div className={styles.amount} data-invalid={amountInvalid}>
          {noQty ? null : (
            <input
              ref={node => { register(key, 'amount', node); }}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              className={styles.grams}
              placeholder="0"
              aria-label={t('cat.amount')}
              aria-invalid={amountInvalid ? true : undefined}
              value={grams}
              onChange={event => { onChange(key, { grams: event.target.value }); }}
            />
          )}
          {/* ⚠️ THE CHEVRON IS A SIBLING OF THE SELECT inside its own cell, not a child: a <select> draws only its options.
              `appearance: none` gives back the width the browser's own arrow takes, and the chevron says it is a menu. */}
          <span className={styles.unitCell}>
            <select
              className={styles.unit}
              aria-label={t('cat.unit')}
              value={unit}
              onChange={event => { onChange(key, { unit: event.target.value }); }}
            >
              {CATALOGUE_UNITS.map(option => <option key={option} value={option}>{unitWord(option, t)}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className={styles.chevron} />
          </span>
        </div>
        <button type="button" className={styles.remove} aria-label={t('cat.removeIngredient')} onClick={() => { onRemove(key); }}>
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      {below}
    </li>
  );
}

// A symbol (g, kg, ml…) is written as it is; a word (pieces, tsp, «to taste») is the interface language's.
function unitWord(unit: CatalogueUnit, t: ReturnType<typeof useT>['t']): string {
  const key = unitTextKey(unit);
  return key === null ? unit : t(key);
}
