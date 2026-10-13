import { CalendarDays } from 'lucide-react';
import type { LogVersion } from '@mise/shared/log-model';
import type { Language } from '../i18n/i18n';
import { useT } from '../i18n/useT';
import { localDate, localTime } from './logStamp';
import { LogOrder } from './LogOrder';
import { LogSheet } from './LogSheet';
import styles from './LogBody.module.css';

// «Monday 09 June — 2:05 PM». The text is stored as the author's app wrote it (English: log-time.ts) and said in the
// interface language here (logStamp.ts: an Italian venue read English dates until 14 Oct 2026).
export function stamp(version: LogVersion | null, lang: Language): string {
  const at = version?.at;
  return `${localDate(at?.date ?? '', lang)} — ${localTime(at?.time ?? '', lang)}`;
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
      <LogOrder version={version} />
      {version && !version.legacy ? <LogSheet sheet={version.sheet} /> : null}
    </div>
  );
}
