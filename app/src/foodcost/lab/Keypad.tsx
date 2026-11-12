import { Delete } from 'lucide-react';
import { useT } from '../../i18n/useT';
import { KEYPAD_KEYS } from './keypadRules';
import styles from './Keypad.module.css';

type Props = {
  onKey: (key: string) => void;
  // A whole number (pieces, minutes): the comma is drawn but does nothing, so the pad keeps its shape.
  allowComma: boolean;
};

// The lab's numeric keypad: 7 8 9 / 4 5 6 / 1 2 3 / , 0 ⌫. Real buttons — the tablet's own keyboard must never open over the work,
// which is why the fields are buttons too. ⌫ is named «Cancella una cifra», never just an icon. The comma uses `aria-disabled`, not
// `disabled`, so the focus is not dropped when a whole-number field is selected.
export function Keypad({ onKey, allowComma }: Props) {
  const { t } = useT();
  return (
    <div className={styles.pad} role="group" aria-label={t('lab.keypad')}>
      {KEYPAD_KEYS.map(key => {
        const comma = key === ',';
        const back = key === 'back';
        return (
          <button
            key={key}
            type="button"
            className={styles.key}
            aria-label={back ? t('lab.key.erase') : comma ? t('lab.key.comma') : undefined}
            aria-disabled={comma && !allowComma ? true : undefined}
            data-key={key}
            onClick={() => { onKey(key); }}
          >
            {back ? <Delete aria-hidden="true" /> : <span aria-hidden={comma ? 'true' : undefined}>{key}</span>}
          </button>
        );
      })}
    </div>
  );
}
