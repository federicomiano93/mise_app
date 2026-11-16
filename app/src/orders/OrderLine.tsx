import { useCallback, useId, useRef } from 'react';
import type { MouseEvent } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { ingredientDisplayLabel, wholeNumber } from '@mise/shared/archive';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { entryUnit, sameUnit, unitChoices } from '@mise/shared/order-unit';
import { useT } from '../i18n/useT';
import { NumberBox } from './NumberBox';
import { cardDoor, useHandBack } from './handBack';
import type { BoxHandle } from './NumberBox';
import type { DraftEntry } from './draftSync';
import type { OrderRow } from './ordersLens';
import type { LineEdit } from './ordersStore';
import type { RowHint } from './suggester';
import styles from './OrderLine.module.css';

type Props = {
  row: OrderRow;
  // What the draft holds for this ingredient (undefined: nothing typed yet).
  entry: DraftEntry | undefined;
  showStock: boolean;
  // The line under the name: the suggested quantity, or the warning that the typed one is far above the usual.
  hint: RowHint;
  // Changes this line, local-first (the store stamps the day, claims the line and saves after its pause).
  onEdit: (row: OrderRow, edit: LineEdit) => void;
  // The flat view («by ingredient»): the name of the supplier the line is ordered from, on a small line under the name.
  supplierName?: string;
  // The name becomes a button that opens the ingredient's card in «Ingredients & suppliers» (step 3f-8b). Given only where the person may
  // edit records; everybody else keeps plain text. Not given on History's editor or the confirm screen.
  onOpenCard?: (row: OrderRow) => void;
  // Where the line is drawn, which names its door for the hand-back (the flat view, or a supplier's screen).
  doorIn?: 'flat' | 'supplier';
  // Leaving the quantity or the stock box: what waits for the autosave's pause is sent at once (the iPad order of 14 Nov 2026,
  // when the last number typed on a frozen page never left the device).
  onLeaveBox?: () => void;
  // The open supplier's row since 16 Nov 2026: name (weight under it) · unit · `[−] qty [+]` as ONE block · stock, on one ~60px row on
  // the split and on two levels on a phone; the inner controls grey with no border; a quantity tints only its block, not the row.
  // No × (the − and the box clear it). The flat view keeps the full line.
  compact?: boolean;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// One ingredient of a supplier's order: its name, the Order box with its − / + and ×, and the Stock box.
//
// ⚠️ A ROW MARKED `elsewhere` SHOWS AN EMPTY ORDER BOX whatever the draft says: that number belongs to the other supplier's
// order. Typing there (or + ) takes the line back — the store does it in the same write (ordersStore.ts editLine).
export function OrderLine({ row, entry, showStock, hint, onEdit, supplierName, onOpenCard, doorIn = 'supplier', onLeaveBox, compact = false }: Props) {
  const { t } = useT();
  const handBack = useHandBack();
  const id = row.ingredient.id;
  // Back from the card hands the focus back to this button (cardTrip.ts).
  const doorNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(cardDoor(id, doorIn), node); }, [handBack, id, doorIn]);
  const { ingredient } = row;
  const orderBox = useRef<BoxHandle>(null);
  const hintId = useId();
  const hintText = hint.kind === 'suggested' ? t('ord.suggestedN', { n: hint.n })
    : hint.kind === 'unusual' ? t('ord.muchMoreThanUsual', { n: hint.usual }) : '';
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

  // ⚠️ IN A COMPACT ROW THE WEIGHT IS INSIDE THE NAME'S BOX (its door, or the plain name): one 44px target for both lines, so the row stays
  // about 60px tall instead of stacking a finger-high name over a caption.
  const weightLine = weight !== '' ? <span className={styles.weight}>{weight}</span> : null;
  const nameCell = compact ? (
    <>
      {onOpenCard ? (
        <button ref={doorNode} type="button" className={styles.door} aria-label={t('ord.editIngredientFor', { name: label })} onClick={() => { onOpenCard(row); }}>
          <span className={styles.name}>{name}</span>
          {weightLine}
        </button>
      ) : (
        <span className={styles.plain}>
          <span className={styles.name}>{name}</span>
          {weightLine}
        </span>
      )}
      {supplierName !== undefined && supplierName !== '' ? <span className={styles.supplier}>{supplierName}</span> : null}
      {note !== '' ? <span className={styles.note}>{note}</span> : null}
      {hintText !== '' ? <span id={hintId} className={styles.hint} data-unusual={hint.kind === 'unusual'}>{hintText}</span> : null}
    </>
  ) : (
    <>
      {onOpenCard ? (
        // ⚠️ A REAL BUTTON DRAWN LIKE THE NAME IT REPLACES, with its hit area grown by padding and a matching negative margin, so the
        // row does not move between a button and plain text. The boxes and the × are SIBLINGS of it, never inside it.
        <button ref={doorNode} type="button" className={styles.door} aria-label={t('ord.editIngredientFor', { name: label })} onClick={() => { onOpenCard(row); }}>
          <span className={styles.name}>{name}</span>
        </button>
      ) : <span className={`${styles.name} ${styles.plain}`}>{name}</span>}
      {supplierName !== undefined && supplierName !== '' ? <span className={styles.supplier}>{supplierName}</span> : null}
      {weightLine}
      {note !== '' ? <span className={styles.note}>{note}</span> : null}
      {hintText !== '' ? <span id={hintId} className={styles.hint} data-unusual={hint.kind === 'unusual'}>{hintText}</span> : null}
    </>
  );
  const unitSelect = choices.length >= 2 ? (
    <select
      className={styles.unitSelect}
      aria-label={t('ord.unitToOrderFor', { name: label })}
      value={selected}
      onChange={event => { onEdit(row, { unit: event.target.value }); }}
    >
      {choices.map(unit => <option key={unit} value={unit}>{unit}</option>)}
    </select>
  ) : null;
  const minus = (
    <button
      type="button"
      className={styles.step}
      aria-label={t('ord.qtyOneFewerFor', { name: label })}
      disabled={qty === 0}
      onClick={event => { step(-1, event); }}
    >
      <Minus aria-hidden="true" />
    </button>
  );
  const plus = (
    <button
      type="button"
      className={styles.step}
      aria-label={t('ord.qtyOneMoreFor', { name: label })}
      onClick={event => { step(1, event); }}
    >
      <Plus aria-hidden="true" />
    </button>
  );
  const qtyBox = (
    <NumberBox
      handle={orderBox}
      value={qty}
      className={styles.box}
      ariaLabel={t('ord.qtyToOrderFor', { name: label })}
      describedBy={hintText !== '' ? hintId : undefined}
      onChange={n => { onEdit(row, { qty: n }); }}
      onLeave={onLeaveBox}
    />
  );
  const stockCell = showStock ? (
    <div className={styles.stock}>
      <NumberBox
        value={stock}
        className={styles.box}
        ariaLabel={t('ord.stockOnHandFor', { name: label })}
        onChange={n => { onEdit(row, { stock: n }); }}
        onLeave={onLeaveBox}
      />
    </div>
  ) : null;

  if (compact) {
    return (
      <li className={`${styles.line} ${styles.compact}`} data-ingredient={id} data-filled={qty > 0} data-elsewhere={row.elsewhere} data-stock={showStock}>
        <div className={styles.main}>{nameCell}</div>
        <div className={styles.unitCell}>
          {unitSelect ?? (text(ingredient.unit) !== '' ? <span className={styles.unit}>{text(ingredient.unit)}</span> : null)}
        </div>
        {/* ⚠️ − / box / + IN THIS ORDER, as one block: the Tab order follows what is drawn. */}
        <div className={styles.stepper}>{minus}{qtyBox}{plus}</div>
        {stockCell}
      </li>
    );
  }

  return (
    <li className={styles.line} data-ingredient={id} data-filled={qty > 0} data-elsewhere={row.elsewhere} data-stock={showStock}>
      <div className={styles.main}>
        {nameCell}
        {unitSelect}
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
        {qtyBox}
        <div className={styles.steps}>
          {minus}
          {plus}
        </div>
        {choices.length < 2 && text(ingredient.unit) !== '' ? <span className={styles.unit}>{text(ingredient.unit)}</span> : null}
      </div>
      {stockCell}
    </li>
  );
}
