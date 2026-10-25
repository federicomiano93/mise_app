import { useCallback, useId } from 'react';
import { CalendarDays } from 'lucide-react';
import { latestVersion } from '@mise/shared/log-model';
import type { Log } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { DayBadge } from './DayBadge';
import { useHandBack, logOpener } from './handBack';
import { stamp } from './LogBody';
import { LogOrder } from './LogOrder';
import { versionsOf } from './logsModel';
import styles from './LogCard.module.css';

type Props = {
  log: Log;
  // The log whose screen is open beside the list (the tablet's split).
  open: boolean;
  onOpen: (log: Log) => void;
};

// One log on the list: the dough and the day it is for, when it was made and by whom, how many versions it has and
// what was ordered. The whole card is ONE button that opens the log; the actions (History, Edit, Delete) live on the
// log's own screen, one level down.
//
// ⚠️ THE BUTTON IS NAMED BY THE DOUGH ALONE and stretched over the whole card (the Stocktake's row does the same):
// the day badge and the rest of the card are its description, so a screen reader hears «Focaccia» and then who, when and what, and
// two logs of the same dough are told apart.
export function LogCard({ log, open, onOpen }: Props) {
  const { t, lang } = useT();
  const handBack = useHandBack();
  const base = useId();
  const detailId = `${base}-detail`;
  const badgeId = `${base}-day`;
  const version = latestVersion(log);
  const by = version?.calculatedBy ? String(version.calculatedBy) : '';
  const register = useCallback(
    (node: HTMLButtonElement | null) => { handBack.register(logOpener(log.id), node); },
    [handBack, log.id],
  );

  return (
    <li className={styles.card} data-open={open}>
      <div className={styles.top}>
        <Button
          ref={register}
          variant="bare"
          className={styles.open}
          aria-describedby={`${badgeId} ${detailId}`}
          aria-current={open ? 'true' : undefined}
          onPress={() => { onOpen(log); }}
        >
          {String(log.dough)}
        </Button>
        <DayBadge log={log} id={badgeId} />
      </div>
      <div id={detailId} className={styles.detail}>
        <p className={styles.stamp}><CalendarDays aria-hidden="true" />{stamp(version, lang)}</p>
        {by ? <p className={styles.by}>{t('calc.byName', { name: by })}</p> : null}
        {versionsOf(log).length > 1 ? <p className={styles.count}>{t('calc.logVersionCount', { n: versionsOf(log).length })}</p> : null}
        <LogOrder version={version} />
      </div>
    </li>
  );
}
