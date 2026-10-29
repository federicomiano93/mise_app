import type { Ref } from 'react';
import type { RunTotals } from '@mise/shared/invoice-import-plan';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/useT';
import styles from './InvoiceImportScreen.module.css';

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  summary: RunTotals;
  // How many remembered decisions the run wrote or deleted, and whether that write failed.
  decisionsWritten: number;
  decisionsFailed: boolean;
};

// The end of the import: what was done, in plain counts. Part of the current app's summary that belongs to the .json file path
// (the workbook advice, the «remember with unisci con» hints) is not here: an invoice zip has no workbook (decision F6).
export function SummaryStep({ headingRef, summary, decisionsWritten, decisionsFailed }: Props) {
  const { t } = useT();
  const lines: [MessageKey, number][] = [
    ['sup.imp.summary.created', summary.created],
    ['sup.imp.summary.updated', summary.updated],
    ['sup.imp.summary.prices', summary.pricesAdded],
  ];
  if (summary.namesSaved > 0) lines.push(['sup.imp.summary.names', summary.namesSaved]);
  lines.push(
    ['sup.imp.summary.changes', summary.changesAdded],
    ['sup.imp.summary.unchanged', summary.unchanged],
    ['sup.imp.summary.skipped', summary.skipped],
  );
  if (summary.namesLost > 0) lines.push(['sup.imp.summary.namesLost', summary.namesLost]);
  if (decisionsWritten > 0) lines.push(['sup.imp.summary.decisions', decisionsWritten]);
  if (summary.codesFull > 0) lines.push(['sup.imp.summary.codesFull', summary.codesFull]);

  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>{t('sup.imp.step.summary')}</h3>
      {summary.stopped ? (
        <p role="alert" className={`${styles.status} ${styles.error}`}>
          {t(summary.stopped === 'permission' ? 'sup.imp.stop.permission' : 'sup.imp.stop.offline')}
          {summary.notRun > 0 ? ` ${t('sup.imp.summary.notRun', { n: summary.notRun })}` : ''}
        </p>
      ) : null}
      <ul className={`${styles.rows} ${styles.group} ${styles.list}`}>
        {lines.map(([key, n]) => (
          <li key={key} className={styles.row}><span className={styles.name}>{t(key, { n })}</span></li>
        ))}
      </ul>
      {summary.changesFailed > 0 ? (
        <p role="alert" className={`${styles.status} ${styles.error}`}>{t('sup.imp.summary.changesFailed', { n: summary.changesFailed })}</p>
      ) : null}
      {decisionsFailed ? <p role="alert" className={`${styles.status} ${styles.error}`}>{t('sup.imp.decisions.failed')}</p> : null}
      {summary.failed.length > 0 ? (
        <>
          <h3 className={styles.subheading}>{t('sup.imp.summary.failed', { n: summary.failed.length })}</h3>
          <ul className={`${styles.rows} ${styles.group} ${styles.list}`}>
            {summary.failed.map(failure => (
              <li key={failure.key} className={styles.row}>
                <span className={styles.name}>{failure.name}</span>
                <p className={styles.reason}>{failure.reason}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {/* ⚠️ «LOAD THE SAME FILE AGAIN» ONLY WHEN A SECOND LOAD CAN HELP: a write that failed, a timeout, a catalogue that changed.
          An entry that is invalid in the file stays invalid however often it is loaded. */}
      {summary.retryable > 0 || summary.stopped ? <p className={styles.note}>{t('sup.imp.summary.again')}</p> : null}
    </>
  );
}
