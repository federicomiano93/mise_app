import { useId } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useT } from '../../i18n/useT';
import { pastImports, summarizeLog } from './importLog';
import type { ImportRecord } from './importLog';
import { dayWord, entryWord, missingWord } from './logWords';
import styles from './InvoiceImportScreen.module.css';

// What the screen knows of the import log: still being read, could not be read, or the records.
export type LogState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'loaded'; readonly records: readonly ImportRecord[] };

// «Invoices already loaded» — the top of step 1: the range of invoice dates imported so far, the months that are missing between
// them, and the past imports newest first. ⚠️ EVERY WORD IS ASKED INSIDE THE DRAWING (the language changes when a venue opens).
export function LogBlock({ log }: { log: LogState }) {
  const { t, locale } = useT();
  const titleId = useId();
  const records = log.status === 'loaded' ? log.records : [];
  const summary = summarizeLog(records);
  return (
    <section className={styles.log} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.subheading}>{t('sup.imp.log.title')}</h3>
      {/* Present before it speaks: the reading line is the live region while the list is on its way. */}
      <p role="status" className={styles.note}>{log.status === 'loading' ? t('sup.imp.log.loading') : null}</p>
      {log.status === 'failed' ? <p className={styles.note}>{t('sup.imp.log.failed')}</p> : null}
      {log.status === 'loaded' && !summary ? <p className={styles.note}>{t('sup.imp.log.empty')}</p> : null}
      {summary ? (
        <>
          <p className={styles.logRange}>
            {t('sup.imp.log.range', { from: dayWord(locale, summary.firstDate), to: dayWord(locale, summary.lastDate) })}
          </p>
          {summary.gaps.length > 0 ? (
            <p className={styles.logMissing}>
              <TriangleAlert aria-hidden="true" />
              <span>{missingWord(t, locale, summary.gaps)}</span>
            </p>
          ) : null}
          <ul className={`${styles.rows} ${styles.group} ${styles.list}`}>
            {pastImports(records).map(record => (
              <li key={record.id} className={styles.row}><span className={styles.meta}>{entryWord(t, locale, record)}</span></li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
