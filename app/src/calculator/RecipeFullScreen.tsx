import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { formatGrams } from '@mise/shared/calculator-config';
import { canStep, scaleOf, stepBy } from '@mise/shared/zoom-steps';
import { useT } from '../i18n/useT';
import { readZoomStep, saveZoomStep } from './zoomStorage';
import styles from './RecipeFullScreen.module.css';

type Props = {
  name: string;
  rows: readonly { name: string; grams: number }[];
  totalG: number;
  // Closing hands the focus back to whatever opened the view (it may have been replaced meanwhile).
  onClose: () => void;
};

// A confirmed recipe, full screen: only the scaled rows and the total, large, for a tablet propped up in the
// kitchen. A native modal <dialog> (the Fullscreen API is refused by iOS for anything but video): the page
// behind is inert, Tab stays inside, and it is named by the recipe.
//
// Opened by the visible button or a tap on the list or the total — never by Copy or Send (ResultCard). It
// closes with ×, with Escape and when the configuration changes under it (ResultCard unmounts it): it is a copy
// of the grams, and a baker must never keep weighing from numbers that no longer hold.
//
// The text size is six steps (shared/src/zoom-steps.ts), remembered on this device. The pair of buttons use
// `aria-disabled`, never `disabled`: a disabled button drops out of the Tab order, and the focus would be lost
// at the end of the range.
export function RecipeFullScreen({ name, rows, totalG, onClose }: Props) {
  const { t, locale } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [step, setStep] = useState(readZoomStep);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);

  const change = (delta: number) => {
    if (!canStep(step, delta)) return;
    const next = stepBy(step, delta);
    setStep(next);
    saveZoomStep(next);
  };
  const grams = (n: number) => formatGrams(n, locale);

  return (
    <dialog
      ref={dialog}
      className={styles.view}
      aria-labelledby={titleId}
      style={{ fontSize: `calc(var(--fs-2xl) * ${scaleOf(step)})` }}
      // The browser's own Escape would close it without telling us; this way there is one road out.
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
      onCancel={event => { event.preventDefault(); onClose(); }}
    >
      <div className={styles.top}>
        <h2 id={titleId} className={styles.name}>{name}</h2>
        <button type="button" className={styles.close} autoFocus aria-label={t('calc.exitFullScreen')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className={styles.scroll}>
        <ul className={styles.rows}>
          {rows.map((row, index) => (
            <li key={index} className={styles.row}>
              <span className={styles.rowName}>{row.name}</span>
              <span className={styles.figure}>{`${grams(row.grams)} g`}</span>
            </li>
          ))}
        </ul>
        <div className={`${styles.row} ${styles.total}`}>
          <span className={styles.rowName}>{t('calc.totalDough')}</span>
          <span className={styles.figure}>{`${grams(totalG)} g`}</span>
        </div>
      </div>
      <div role="group" aria-label={t('calc.textSize')} className={styles.zoom}>
        <button
          type="button"
          className={styles.step}
          aria-label={t('calc.textSmaller')}
          aria-disabled={!canStep(step, -1)}
          onClick={() => { change(-1); }}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.step}
          aria-label={t('calc.textLarger')}
          aria-disabled={!canStep(step, 1)}
          onClick={() => { change(1); }}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
}
