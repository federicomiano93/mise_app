import { useId } from 'react';
import { formatGrams, normalizeTrays, settledTraysText, traysGrams } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { NumberField } from './NumberField';
import styles from './RecipePanel.module.css';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

type TraysProps = {
  // The recipe (or just its tray weight: Edit counts at the weight the dough was MADE with).
  weight: { readonly trayWeight?: unknown };
  trays: number;
  onChange: (trays: number) => void;
};

// Whole trays, with «= N g» under the label. The sentence sits BESIDE the label, not inside it: inside, the box's name
// would change on every keystroke; aria-describedby links it. A fraction is replaced by the whole number used when the
// box is left.
export function LogTraysField({ weight, trays, onChange }: TraysProps) {
  const { t, locale } = useT();
  const uid = useId();
  const gramsId = `${uid}-grams`;
  return (
    <div className={styles.param}>
      <div className={styles.paramStack}>
        <label htmlFor={`${uid}-trays`} className={styles.paramLabel}>{t('calc.trayCount')}</label>
        <span id={gramsId} className={styles.traysGrams} aria-live="polite">
          {t('calc.traysEquals', { g: formatGrams(traysGrams(weight, trays), locale) })}
        </span>
      </div>
      <NumberField
        id={`${uid}-trays`}
        value={String(trays)}
        inputMode="numeric"
        min={0}
        step={1}
        describedBy={gramsId}
        settle={settledTraysText}
        onChange={text => { onChange(normalizeTrays(text)); }}
        onBlank={() => { onChange(0); }}
      />
    </div>
  );
}

type TotalProps = { total: number; onChange: (grams: number) => void };

// The grams typed for the whole dough («total», «both», and «trays + total» on top of the trays).
export function LogTotalField({ total, onChange }: TotalProps) {
  const { t } = useT();
  const uid = useId();
  return (
    <div className={styles.param}>
      <label htmlFor={`${uid}-total`} className={styles.paramLabel}>{t('calc.totalDoughG')}</label>
      <NumberField
        id={`${uid}-total`}
        value={String(total)}
        inputMode="numeric"
        min={0}
        step={1}
        onChange={text => { onChange(Math.max(0, num(text))); }}
        onBlank={() => { onChange(0); }}
      />
    </div>
  );
}
