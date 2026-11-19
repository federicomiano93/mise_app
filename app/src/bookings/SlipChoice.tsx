import { useId, useState } from 'react';
import type { RefObject } from 'react';
import { useT } from '../i18n/useT';
import type { LabSlipMode } from './labSlips';
import styles from './SlipChoice.module.css';

// The body of «Biglietti per il laboratorio» (bookings rebuild step 4, the owner's mockup): two radio rows, «Uno per pezzo» first
// and already chosen, then «Tutto insieme». ⚠️ NO EXPLANATION TEXT, the owner asked for none: no intro line, no sub-lines. Each row
// is one label, so the whole row is the target of a tap. The dialog's buttons live outside this body, so the choice is written into
// the ref on every change and read once Stampa is pressed (the Pastries' «Copy day» way, CopyDayPicker).
export function SlipChoice({ choice }: { choice: RefObject<LabSlipMode> }) {
  const { t } = useT();
  const name = useId();
  const [chosen, setChosen] = useState<LabSlipMode>(choice.current);
  const options: readonly { readonly mode: LabSlipMode; readonly label: string }[] = [
    { mode: 'perPiece', label: t('bookings.slipChoice.perPiece') },
    { mode: 'together', label: t('bookings.slipChoice.together') },
  ];
  return (
    <div role="radiogroup" aria-label={t('bookings.slipChoice.title')} className={styles.choices}>
      {options.map(option => (
        <label key={option.mode} className={styles.choice} data-checked={option.mode === chosen}>
          <input
            type="radio"
            name={name}
            value={option.mode}
            checked={option.mode === chosen}
            className={styles.radio}
            onChange={() => {
              choice.current = option.mode;
              setChosen(option.mode);
            }}
          />
          <span className={styles.label}>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
