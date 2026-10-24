import type { Ref } from 'react';
import { useT } from '../../i18n/useT';
import styles from './InvoiceImportScreen.module.css';

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  // The rows looked at so far, out of `total` (0 = nothing to count: no bar).
  done: number;
  total: number;
};

// The rows are being written: just the heading and a bar. The sentence «Importing n of total…» is said by the screen's live
// region, so a screen reader hears it without the focus moving.
export function RunningStep({ headingRef, done, total }: Props) {
  const { t } = useT();
  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>{t('sup.imp.working')}</h3>
      {total > 0 ? <progress className={styles.progress} max={total} value={done} aria-label={t('sup.imp.working')} /> : null}
    </>
  );
}
