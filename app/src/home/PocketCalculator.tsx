import { useEffect, useState } from 'react';
import { CALC_START, calcDisplay, calcKeyFor, calcPress } from '@mise/shared/pocket-calc';
import type { CalcKey } from '@mise/shared/pocket-calc';
import { Delete } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/en';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import styles from './PocketCalculator.module.css';

type KeySpec = {
  readonly key: CalcKey;
  // What a screen reader says; a digit says itself.
  readonly name?: MessageKey;
  readonly kind: 'digit' | 'operator' | 'action' | 'equals';
  readonly wide?: boolean;
};

const KEYS: readonly KeySpec[] = [
  { key: 'C', name: 'pocket.key.clear', kind: 'action' },
  { key: 'back', name: 'pocket.key.back', kind: 'action' },
  { key: '%', name: 'pocket.key.percent', kind: 'operator' },
  { key: '÷', name: 'pocket.key.divide', kind: 'operator' },
  { key: '7', kind: 'digit' }, { key: '8', kind: 'digit' }, { key: '9', kind: 'digit' },
  { key: '×', name: 'pocket.key.times', kind: 'operator' },
  { key: '4', kind: 'digit' }, { key: '5', kind: 'digit' }, { key: '6', kind: 'digit' },
  { key: '−', name: 'pocket.key.minus', kind: 'operator' },
  { key: '1', kind: 'digit' }, { key: '2', kind: 'digit' }, { key: '3', kind: 'digit' },
  { key: '+', name: 'pocket.key.plus', kind: 'operator' },
  { key: '0', kind: 'digit', wide: true },
  { key: 'decimal', kind: 'digit' },
  { key: '=', name: 'pocket.key.equals', kind: 'equals' },
];

// The Home's pocket calculator (his request, 28 Nov 2026): a dialog with big keys, the sum small above and the result large. Nothing is saved:
// closing clears it (the state lives only while the dialog is drawn). The maths is `@mise/shared/pocket-calc`, never an eval.
//
// ⚠️ THE DECIMAL MARK FOLLOWS THE VENUE'S NUMBER FORMAT (useMoney: «,» in Italy, «.» in Britain), as a price does, not the interface language.
// ⚠️ THE KEYBOARD: digits, «, .», «+ - * /», «%», Enter or «=», Backspace; Escape closes (the dialog's own). Heard on the document in the
// capture phase, because the dialog itself takes the focus when it opens and a focused key would otherwise press twice on Enter.
export function PocketCalculator({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const mark = useMoney().layout.decimal;
  const [state, setState] = useState(CALC_START);
  const shown = calcDisplay(state, mark, t('pocket.error'));

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = calcKeyFor(event.key);
      if (key === null) return;
      // ⚠️ ENTER ON A FOCUSED BUTTON PRESSES THAT BUTTON (a key, or «Close»), as a keyboard user expects (P18): «=» is for Enter with no
      // button focused.
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (event.key === 'Enter' && target !== null) return;
      event.preventDefault();
      event.stopPropagation();
      setState(current => calcPress(current, key));
    }
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); };
  }, []);

  // The decimal key is named for the mark it SHOWS, in either interface language.
  const label = (spec: KeySpec): string => (spec.key === 'decimal' ? t(mark === ',' ? 'pocket.key.comma' : 'pocket.key.point') : spec.name === undefined ? spec.key : t(spec.name));
  const face = (spec: KeySpec): ReactNode => {
    if (spec.key === 'back') return <Delete aria-hidden="true" />;
    if (spec.key === 'decimal') return mark;
    return spec.key;
  };

  return (
    <Dialog
      isOpen
      title={t('pocket.title')}
      onClose={onClose}
      actions={<Button onPress={onClose}>{t('pocket.close')}</Button>}
    >
      <div className={styles.display}>
        <p className={styles.expression} aria-hidden="true">{shown.expression || ' '}</p>
        {/* Present from the start, only its text changes: a screen reader hears the result as it moves. */}
        <p className={styles.result} aria-live="polite" aria-atomic="true" data-error={shown.error ? 'true' : undefined}>{shown.main}</p>
      </div>
      <div className={styles.keys}>
        {KEYS.map(spec => (
          <Button
            key={spec.key}
            variant="bare"
            className={styles.key}
            data-kind={spec.kind}
            data-wide={spec.wide ? 'true' : undefined}
            aria-label={label(spec)}
            onPress={() => { setState(current => calcPress(current, spec.key)); }}
          >
            {face(spec)}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
