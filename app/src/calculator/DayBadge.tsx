import { dayLabelParts } from '@mise/shared/log-model';
import type { Log } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import { dayText } from './logDay';
import styles from './DayBadge.module.css';

// The day a log is FOR, in words («Today», «Yesterday for today»), coloured by that day: green for today, amber for
// tomorrow, muted once it has passed. Counted from the moment it is drawn, so it is right the next morning.
export function DayBadge({ log }: { log: Log }) {
  const { t } = useT();
  const parts = dayLabelParts(log, Date.now());
  return <span className={styles.badge} data-tone={parts.tone}>{dayText(t, parts)}</span>;
}

// The badge under a screen's title (the bar's `sub`), a little apart from it.
export function DayBadgeUnderTitle({ log }: { log: Log }) {
  return <div className={styles.under}><DayBadge log={log} /></div>;
}
