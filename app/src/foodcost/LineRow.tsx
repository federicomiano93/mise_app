import { useId } from 'react';
import { Trash2 } from 'lucide-react';
import type { LineUnit } from '@mise/shared/foodcost-model';
import { KILO_LINE_UNITS } from '@mise/shared/line-quantity';
import type { KiloLineUnit } from '@mise/shared/line-quantity';
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
  // Whom the ingredient is bought from (supplierOf), under the name. '' — a recipe, packaging, no supplier, not arrived yet —
  // draws nothing.
  supplier?: string;
  // The line's rate and what its amount costs (lineCost.ts), at the right-hand end of the amount row; '' draws nothing.
  cost: string;
  note: string;
  qty: string;
  // Ingredient lines (g, kg, pieces) and recipe lines (g, kg); packaging has none.
  unit?: LineUnit;
  // The units an ingredient line offers (lineUnits.ts: only those its price converts, plus its own). One alone is fixed text.
  units?: readonly LineUnit[];
  registerQty: (key: string, node: HTMLInputElement | null) => void;
  onPick: () => void;
  onQty: (text: string) => void;
  onUnit: (unit: LineUnit) => void;
  onRecipeUnit: (unit: KiloLineUnit) => void;
  onRemove: () => void;
};

const QTY_LABEL = {
  recipe: 'fc.aria.quantity',
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
export function LineRow({ rowKey, kind, name, supplier = '', cost, note, qty, unit, units, registerQty, onPick, onQty, onUnit, onRecipeUnit, onRemove }: Props) {
  const { t } = useT();
  const supplierId = useId();
  // POST-SWITCH (step 4 of the Food cost plan, 11 Nov 2026): only an ingredient line names its supplier. The kind is checked here
  // too, so a caller handing a name to a recipe or packaging line still draws none.
  const supplierShown = kind === 'ingredient' && supplier !== '' ? supplier : '';

  return (
    <li className={styles.line}>
      <div className={styles.top}>
        <button
          type="button"
          className={styles.name}
          data-missing={name.missing}
          aria-label={t('fc.aria.changeLine', { name: name.text })}
          // The supplier is drawn outside the button (the button's name is «Change …», which the words drawn must stay inside), so
          // it is linked as the button's description: a screen reader says it after the name.
          aria-describedby={supplierShown === '' ? undefined : supplierId}
          onClick={onPick}
        >
          <span>{name.text}</span>
        </button>
        <button type="button" className={styles.remove} aria-label={t(REMOVE_LABEL[kind])} onClick={onRemove}>
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      {/* Under the name, small and secondary; one line, cut with «…» at 296px rather than wrapped or pushed sideways. */}
      {supplierShown === '' ? null : <p id={supplierId} className={styles.supplier}>{supplierShown}</p>}
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
        {/* An ingredient is added in the units its price converts to (lineUnits.ts), and a recipe in grams or kilos (stored in kilos
            whatever the select says, and opened in grams: productEditorModel.ts); packaging is always pieces per unit sold. A single
            unit is fixed text, like packaging's: a menu of one is a control that does nothing. */}
        {kind === 'recipe' && unit !== undefined ? (
          <select
            className={styles.unit}
            aria-label={t('fc.aria.unit')}
            value={unit}
            onChange={event => { onRecipeUnit(event.target.value as KiloLineUnit); }}
          >
            {KILO_LINE_UNITS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : kind === 'ingredient' && unit !== undefined && (units ?? [unit]).length > 1 ? (
          <select
            className={styles.unit}
            aria-label={t('fc.aria.unit')}
            value={unit}
            onChange={event => { onUnit(event.target.value as LineUnit); }}
          >
            {(units ?? [unit]).map(option => (
              <option key={option} value={option}>{option === 'pcs' ? t('fc.unit.pieces') : option}</option>
            ))}
          </select>
        ) : (
          <span className={styles.fixedUnit}>{unit === undefined || unit === 'pcs' ? t('fc.unit.pieces') : unit}</span>
        )}
        {/* The money at the row's right-hand end (step 3b, 11 Nov 2026; it was a line of its own under the row): what the amount typed
            costs sits beside the amount. It drops under the box at 296px rather than push the row sideways. */}
        {cost === '' ? null : <span className={styles.cost}>{cost}</span>}
      </div>
      {note === '' ? null : <p className={styles.note}>{note}</p>}
    </li>
  );
}
