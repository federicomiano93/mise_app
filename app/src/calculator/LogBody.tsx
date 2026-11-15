import { CalendarDays } from 'lucide-react';
import type { LogVersion } from '@mise/shared/log-model';
import { logStampText } from '@mise/shared/log-time';
import type { Language } from '../i18n/i18n';
import { useT } from '../i18n/useT';
import { LogOrder } from './LogOrder';
import { LogSheet } from './LogSheet';
import styles from './LogBody.module.css';

// «Monday 09 June — 2:05 PM». The text is stored as the author's app wrote it (English: log-time.ts) and said in the
// interface language here (shared/src/log-time.ts `logStampText`: an Italian venue read English dates until 13 Oct 2026).
export function stamp(version: LogVersion | null, lang: Language): string {
  return logStampText(version?.at, lang);
}

// When a version was made, who made it, the order, and the sheet (a log from before the sheet existed has the text
// alone). Shared by one log and by one version of it.
export function LogBody({ version, showBy = true }: { version: LogVersion | null; showBy?: boolean }) {
  const { t, lang } = useT();
  const by = version?.calculatedBy ? String(version.calculatedBy) : '';
  return (
    <div className={styles.body}>
      <div className={styles.meta}>
        <p className={styles.stamp}><CalendarDays aria-hidden="true" />{stamp(version, lang)}</p>
        {showBy && by ? <p className={styles.by}>{t('calc.calculatedByName', { name: by })}</p> : null}
      </div>
      <LogOrder version={version} sheetFollows={!!version && !version.legacy && !!version.sheet} />
      {version && !version.legacy ? <LogSheet sheet={version.sheet} /> : null}
    </div>
  );
}
