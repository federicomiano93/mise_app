import { useId, useState } from 'react';
import { scaleFromRow, unitDecimals } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe, CatalogueUnit, RowScaleResult } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import styles from './FromRowDialog.module.css';

// The ceiling of a batch worked out from one ingredient: ten tonnes, the bound the database puts on a weighing (firestore.rules,
// `rawGrams`). Far past the batch box's louder question (100 kg, or 50 times the recipe), which still comes first for anything
// above that; this only keeps an absurd typing (a stray row of zeros) from becoming a number nobody can read.
export const MAX_FROM_ROW_TARGET_G = 10_000_000;

type Props = {
  recipe: CatalogueRecipe;
  index: number;
  // The ingredient's name and its unit as a person reads them («Sugar», «g» / «pcs»).
  name: string;
  unit: CatalogueUnit;
  unitWord: string;
  onCancel: () => void;
  // A valid amount: the recipe scaled from it (shared scaleFromRow).
  onCalculate: (result: RowScaleResult) => void;
};

type Problem = 'tooSmall' | 'tooBig' | null;

// «Calculate from this ingredient» (Mise 2 only, 14 Nov 2026): «How much {name} do you want?», one number box in the row's OWN
// unit (grams, pieces, ml, kg…), Calculate and Cancel. The box takes the focus when the dialog opens (Dialog's modal gives it back
// to the page when it closes; the row's own menu button is then focused by the caller, since the menu item that opened this is
// gone). A wrong amount is said under the box, in a live region that is there (empty) before it speaks, tied to the box by
// aria-describedby and marked aria-invalid; nothing is calculated.
export function FromRowDialog({ recipe, index, name, unit, unitWord, onCancel, onCalculate }: Props) {
  const { t } = useT();
  const inputId = useId();
  const problemId = useId();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const decimals = unitDecimals(unit);

  function calculate(): void {
    // A comma is the Italian decimal mark; the box may hand either.
    const typed = Number(text.trim().replace(',', '.'));
    const result = text.trim() === '' || !Number.isFinite(typed) ? null : scaleFromRow(recipe, index, typed);
    if (result === null) { setProblem('tooSmall'); return; }
    if (result.target > MAX_FROM_ROW_TARGET_G) { setProblem('tooBig'); return; }
    onCalculate(result);
  }

  return (
    <Dialog
      isOpen
      title={t('cat.fromRow.title', { name })}
      onClose={onCancel}
      actions={
        <>
          <Button key="cancel" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button key="calculate" variant="primary" onPress={calculate}>{t('cat.calculate')}</Button>
        </>
      }
    >
      <form
        className={styles.field}
        // Enter in the box calculates, as the button does.
        onSubmit={event => { event.preventDefault(); calculate(); }}
      >
        <label htmlFor={inputId} className={styles.label}>{t('cat.fromRow.label', { unit: unitWord })}</label>
        <div className={styles.box} data-invalid={problem !== null ? 'true' : undefined}>
          <input
            id={inputId}
            // The dialog exists to ask for this one number: the focus goes straight into it.
            autoFocus
            type="number"
            min="0"
            step={decimals === 0 ? '1' : String(10 ** -decimals)}
            inputMode={decimals === 0 ? 'numeric' : 'decimal'}
            className={styles.input}
            placeholder="0"
            value={text}
            aria-invalid={problem !== null || undefined}
            aria-describedby={problemId}
            onChange={event => { setText(event.target.value); setProblem(null); }}
          />
          <span className={styles.unit} aria-hidden="true">{unitWord}</span>
        </div>
        <p id={problemId} role="status" className={styles.problem}>
          {problem === 'tooSmall' ? t('cat.fromRow.tooSmall') : problem === 'tooBig' ? t('cat.fromRow.tooBig') : ''}
        </p>
      </form>
    </Dialog>
  );
}
