import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { canStep, scaleOf, stepBy } from '@mise/shared/zoom-steps';
import { useT } from '../i18n/useT';
import { readZoomStep, saveZoomStep } from './zoomStorage';
import styles from './RecipeFullScreen.module.css';

type Props = {
  name: string;
  // Each row's label and its amount ALREADY WRITTEN («250 g», «3 pcs»): the caller knows its units.
  rows: readonly { name: string; amount: string }[];
  // The closing line («Total dough», «Total»).
  total: { name: string; amount: string };
  // The localStorage key the text size is remembered under (ui/zoomStorage.ts).
  storageKey: string;
  // Closing hands the focus back to whatever opened the view (it may have been replaced meanwhile).
  onClose: () => void;
};

// A recipe, full screen (the Calculator's confirmed dough, the catalogue's recipe): only the rows and the total, large, for a tablet propped up in the
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
export function RecipeFullScreen({ name, rows, total, storageKey, onClose }: Props) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [step, setStep] = useState(() => readZoomStep(storageKey));

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);

  // ⚠️ CLOSE THE DIALOG FIRST, THEN SAY SO: the page behind a modal dialog is inert, so whoever takes the focus
  // back (ResultCard) must find it already closed. × and Escape take this one road.
  const close = () => {
    if (dialog.current?.open) dialog.current.close();
    onClose();
  };

  const change = (delta: number) => {
    if (!canStep(step, delta)) return;
    const next = stepBy(step, delta);
    setStep(next);
    saveZoomStep(storageKey, next);
  };

  return (
    <dialog
      ref={dialog}
      className={styles.view}
      aria-labelledby={titleId}
      style={{ fontSize: `calc(var(--fs-2xl) * ${scaleOf(step)})` }}
      // The browser's own Escape would close it without telling us; this way there is one road out.
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }}
    >
      <div className={styles.top}>
        <h2 id={titleId} className={styles.name}>{name}</h2>
        <button type="button" className={styles.close} autoFocus aria-label={t('calc.exitFullScreen')} onClick={close}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className={styles.scroll}>
        <ul className={styles.rows}>
          {rows.map((row, index) => (
            <li key={index} className={styles.row}>
              <span className={styles.rowName}>{row.name}</span>
              <span className={styles.figure}>{row.amount}</span>
            </li>
          ))}
        </ul>
        <div className={`${styles.row} ${styles.total}`}>
          <span className={styles.rowName}>{total.name}</span>
          <span className={styles.figure}>{total.amount}</span>
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
