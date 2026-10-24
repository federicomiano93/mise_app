import type { Ref } from 'react';
import { useT } from '../../i18n/useT';
import type { ImportRun } from './importRun';
import styles from './InvoiceImportScreen.module.css';

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  // The state step 2 hands over (see ImportRun in importRun.ts).
  run: ImportRun;
  // The id of the supplier each file supplier stands for: the existing ones, the ones step 2 linked to, and the ones it created.
  // A file supplier the person skipped has no entry, and neither has its ingredient (parity I87).
  supplierIdByKey: Readonly<Record<string, string>>;
};

// Step 3 of 3: the ingredients — ⚠️ PART B3b HAND-OVER POINT. Part B3a ends here: the door, the route, the frame, choosing the
// file and the suppliers are built and specced; the ingredients' questions, the write row by row, the remembered decisions
// (written BEFORE the rows, parity I24) and the summary are B3b's. It draws only its heading, so that the frame's step count, the
// focus after a step and Back are already exercised end to end.
//
// What B3b receives: `run` (what was read, what the venue remembered, what was ticked, and the selection made of them) and
// `supplierIdByKey`; the source, the store's snapshot and the frame's busy/leave state are the screen's (InvoiceImportScreen.tsx).
export function IngredientsStep({ headingRef }: Props) {
  const { t } = useT();
  return <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>{t('sup.imp.step.ingredients')}</h3>;
}
