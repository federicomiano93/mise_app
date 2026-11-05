import { Trash2 } from 'lucide-react';
import { LINE_UNITS } from '@mise/shared/foodcost-model';
import type { LineUnit } from '@mise/shared/foodcost-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import type { LineName } from './lineNotes';
import styles from './LineRow.module.css';

export type LineKind = 'recipe' | 'ingredient' | 'packaging';

type Props = {
  // The line's own id: what keeps this row standing while its quantity is typed.
  rowKey: string;
  kind: LineKind;
  name: LineName;
  note: string;
  qty: string;
  // Ingredient lines only.
  unit?: LineUnit;
  registerQty: (key: string, node: HTMLInputElement | null) => void;
  onPick: () => void;
  onQty: (text: string) => void;
  onUnit: (unit: LineUnit) => void;
  onRemove: () => void;
};

const QTY_LABEL = {
  recipe: 'fc.aria.kilos',
  ingredient: 'fc.aria.quantity',
  packaging: 'fc.aria.pieces',
} as const satisfies Record<LineKind, MessageKey>;

const REMOVE_LABEL = {
  recipe: 'fc.removeRecipe',
  ingredient: 'fc.removeIngredient',
  packaging: 'fc.removePackagingItem',
} as const satisfies Record<LineKind, MessageKey>;

// One line of «Made of» or of the packaging: its name (a button that opens the chooser again, to
// point the line at something else of its kind), what it is made of in a box, and a bin.
//
// ⚠️ A QUANTITY TYPED IN IT NEVER REBUILDS THE ROW: the row is keyed by its own id, so the box under
// the finger is the same box after every digit.
export function LineRow({ rowKey, kind, name, note, qty, unit, registerQty, onPick, onQty, onUnit, onRemove }: Props) {
  const { t } = useT();

  return (
    <li className={styles.line}>
      <div className={styles.top}>
        <button
          type="button"
          className={styles.name}
          data-missing={name.missing}
          aria-label={t('fc.aria.changeLine', { name: name.text })}
          onClick={onPick}
        >
          <span>{name.text}</span>
        </button>
        <button type="button" className={styles.remove} aria-label={t(REMOVE_LABEL[kind])} onClick={onRemove}>
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      <div className={styles.amount}>
        <input
          ref={node => { registerQty(rowKey, node); }}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={styles.qty}
          placeholder="0"
          aria-label={t(QTY_LABEL[kind])}
          value={qty}
          onChange={event => { onQty(event.target.value); }}
        />
        {/* A recipe is always kilos, packaging always pieces per unit sold; an ingredient is added in
            grams, kilos or pieces. */}
        {kind === 'ingredient' && unit !== undefined ? (
          <select
            className={styles.unit}
            aria-label={t('fc.aria.unit')}
            value={unit}
            onChange={event => { onUnit(event.target.value as LineUnit); }}
          >
            {LINE_UNITS.map(option => (
              <option key={option} value={option}>{option === 'pcs' ? t('fc.unit.pieces') : option}</option>
            ))}
          </select>
        ) : (
          <span className={styles.fixedUnit}>{kind === 'recipe' ? 'kg' : t('fc.unit.pieces')}</span>
        )}
      </div>
      {note === '' ? null : <p className={styles.note} data-kind={kind}>{note}</p>}
    </li>
  );
}
