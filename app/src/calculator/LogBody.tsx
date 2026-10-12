import { CalendarDays } from 'lucide-react';
import type { LogVersion } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import { LogOrder } from './LogOrder';
import { LogSheet } from './LogSheet';
import styles from './LogBody.module.css';

// «Monday 09 June — 2:05 PM». The text is stored as the author's app wrote it (English: log-time.ts), and shown as it
// was written, as the current app does.
export function stamp(version: LogVersion | null): string {
  const at = version?.at;
  return `${at?.date ?? ''} — ${at?.time ?? ''}`;
}

// When a version was made, who made it, the order, and the sheet (a log from before the sheet existed has the text
// alone). Shared by one log and by one version of it.
export function LogBody({ version, showBy = true }: { version: LogVersion | null; showBy?: boolean }) {
  const { t } = useT();
  const by = version?.calculatedBy ? String(version.calculatedBy) : '';
  return (
    <div className={styles.body}>
      <div className={styles.meta}>
        <p className={styles.stamp}><CalendarDays aria-hidden="true" />{stamp(version)}</p>
        {showBy && by ? <p className={styles.by}>{t('calc.calculatedByName', { name: by })}</p> : null}
      </div>
      <LogOrder version={version} />
      {version && !version.legacy ? <LogSheet sheet={version.sheet} /> : null}
    </div>
  );
}
