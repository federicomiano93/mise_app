import { useRef } from 'react';
import type { MouseEvent } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { ingredientDisplayLabel, wholeNumber } from '@mise/shared/archive';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { entryUnit, sameUnit, unitChoices } from '@mise/shared/order-unit';
import { useT } from '../i18n/useT';
import { NumberBox } from './NumberBox';
import type { BoxHandle } from './NumberBox';
import type { DraftEntry } from './draftSync';
import type { OrderRow } from './ordersLens';
import type { LineEdit } from './ordersStore';
import styles from './OrderLine.module.css';

type Props = {
  row: OrderRow;
  // What the draft holds for this ingredient (undefined: nothing typed yet).
  entry: DraftEntry | undefined;
  showStock: boolean;
  // Changes this line, local-first (the store stamps the day, claims the line and saves after its pause).
  onEdit: (row: OrderRow, edit: LineEdit) => void;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// One ingredient of a supplier's order: its name, the Order box with its − / + and ×, and the Stock box.
//
// ⚠️ A ROW MARKED `elsewhere` SHOWS AN EMPTY ORDER BOX whatever the draft says: that number belongs to the other supplier's
// order. Typing there (or + ) takes the line back — the store does it in the same write (ordersStore.ts editLine).
export function OrderLine({ row, entry, showStock, onEdit }: Props) {
  const { t } = useT();
  const { ingredient } = row;
  const orderBox = useRef<BoxHandle>(null);
  const qty = row.elsewhere ? 0 : wholeNumber(entry?.qty);
  const stock = wholeNumber(entry?.stock);
  const name = ingredientDisplayName(ingredient) || t('ord.unnamedProduct');
  // Name AND weight: «Flour 1kg» and «Flour 25kg» must not both read «Flour».
  const label = ingredientDisplayLabel(ingredient) || t('ord.unnamedProduct');
  const weight = text(ingredient.weight);
  const note = row.elsewhere
    ? t('ord.line.thisTimeFrom', { supplier: row.elsewhereLabel })
    : row.usualLabel !== '' ? t('ord.line.usuallyFrom', { supplier: row.usualLabel }) : '';

  // ⚠️ A MENU ONLY WHEN THE CARD OFFERS A CHOICE («cartone» or «busta»); any other row keeps the unit as a caption. The options
  // are the card's own words — venue data, never translated.
  const choices = unitChoices(ingredient, entry?.unit);
  const current = entryUnit(entry, ingredient);
  const selected = choices.find(unit => sameUnit(unit, current)) ?? current;

  // The steppers start from what the BOX shows and go through the same path as typing, so a row ordered elsewhere behaves like
  // typing into its empty box: «+» gives 1 and takes the line back. Never below 0.
  // ⚠️ A KEYBOARD «−» THAT REACHES 0 DISABLES ITSELF, and a disabled button drops the focus to the page: it goes to the box
  // instead, as the × does. After a tap nothing moves — the phone's keyboard must not pop up over the list.
  function step(delta: number, event: MouseEvent<HTMLButtonElement>) {
    const next = wholeNumber((orderBox.current?.read() ?? 0) + delta);
    orderBox.current?.show(next);
    onEdit(row, { qty: next });
    if (next === 0 && event.detail === 0) orderBox.current?.focus();
  }

  return (
    <li className={styles.line} data-filled={qty > 0} data-elsewhere={row.elsewhere} data-stock={showStock}>
      <div className={styles.main}>
        <span className={styles.name}>{name}</span>
        {weight !== '' ? <span className={styles.weight}>{weight}</span> : null}
        {note !== '' ? <span className={styles.note}>{note}</span> : null}
        {choices.length >= 2 ? (
          <select
            className={styles.unitSelect}
            aria-label={t('ord.unitToOrderFor', { name: label })}
            value={selected}
            onChange={event => { onEdit(row, { unit: event.target.value }); }}
          >
            {choices.map(unit => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        ) : null}
        {/* In the name column on purpose: it holds nothing tappable beside it, so a 48px target here steals no tap from the
            boxes. Shown only while there is a quantity. */}
        {qty > 0 ? (
          <button
            type="button"
            className={styles.clear}
            aria-label={t('ord.clearQtyFor', { name: label })}
            onClick={event => {
              onEdit(row, { clear: true });
              orderBox.current?.show(0);
              // Only a keyboard activation goes back to the box: after a tap the phone's keyboard would pop up for nothing.
              if (event.detail === 0) orderBox.current?.focus();
            }}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={styles.order}>
        <NumberBox
          handle={orderBox}
          value={qty}
          className={styles.box}
          ariaLabel={t('ord.qtyToOrderFor', { name })}
          onChange={n => { onEdit(row, { qty: n }); }}
        />
        <div className={styles.steps}>
          <button
            type="button"
            className={styles.step}
            aria-label={t('ord.qtyOneFewerFor', { name: label })}
            disabled={qty === 0}
            onClick={event => { step(-1, event); }}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.step}
            aria-label={t('ord.qtyOneMoreFor', { name: label })}
            onClick={event => { step(1, event); }}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        {choices.length < 2 && text(ingredient.unit) !== '' ? <span className={styles.unit}>{text(ingredient.unit)}</span> : null}
      </div>
      {showStock ? (
        <div className={styles.stock}>
          <NumberBox
            value={stock}
            className={styles.box}
            ariaLabel={t('ord.stockOnHandFor', { name })}
            onChange={n => { onEdit(row, { stock: n }); }}
          />
        </div>
      ) : null}
    </li>
  );
}
