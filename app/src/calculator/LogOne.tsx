import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { History, Trash2 } from 'lucide-react';
import { latestVersion } from '@mise/shared/log-model';
import type { Log } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/useConfirm';
import { useCalculatorStore } from './CalculatorContext';
import { LOG_PATH, logEditPath, logHistoryPath } from './calculatorPath';
import { useLeave } from './calculatorNav';
import { DayBadgeUnderTitle } from './DayBadge';
import { EDIT_LOG_OPENER, LOG_HISTORY_OPENER, LOG_LIST_TITLE, useHandBack } from './handBack';
import { LogBody } from './LogBody';
import { LogMissing } from './LogMissing';
import { OpenButton } from './OpenButton';
import { SettingsPage } from './SettingsPage';
import { useLog } from './useLog';
import styles from './LogOne.module.css';

// One log, read-only: its day, when it was made and by whom, the order and the sheet it was saved with — and, one
// level down, its history. Edit only for a log made by hand (a calculator log is edited from the work view, by
// Confirm); Delete is a small icon, asked about first.
export function LogOne({ id }: { id: string }) {
  const lookup = useLog(id);
  // ⚠️ A LOG BEING DELETED HERE STAYS ON SCREEN UNTIL THE SCREEN IS LEFT. The store drops it at once, and a «not
  // found» drawn for that moment would be a new screen appearing over the one the focus is owed to.
  const removing = useRef<Log | null>(null);
  if (removing.current && removing.current.id === id) return <LogOneFound log={removing.current} removing={removing} />;
  if (lookup.status !== 'found') return <LogMissing lookup={lookup} />;
  return <LogOneFound log={lookup.log} removing={removing} />;
}

function LogOneFound({ log, removing }: { log: Log; removing: MutableRefObject<Log | null> }) {
  const { t } = useT();
  const store = useCalculatorStore();
  const handBack = useHandBack();
  const leave = useLeave(LOG_PATH);
  const [confirm, confirmDialog] = useConfirm();

  const remove = async () => {
    const sure = await confirm({
      title: t('calc.deleteLog'),
      message: log.dough ? t('calc.deleteDoughConfirm', { name: log.dough }) : t('calc.deleteThisDough'),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!sure) return;
    // The list is where this lands, and its title takes the focus: the row that opened the log is about to be gone.
    removing.current = log;
    handBack.replaceTop(LOG_LIST_TITLE);
    leave();
    store.deleteLog(log.id);
  };

  return (
    <SettingsPage title={log.dough} sub={<DayBadgeUnderTitle log={log} />} fallback={LOG_PATH}>
      <LogBody version={latestVersion(log)} />
      <div className={styles.actions}>
        <OpenButton opener={LOG_HISTORY_OPENER} to={logHistoryPath(log.id)}>
          <History aria-hidden="true" />
          {t('ui.history')}
        </OpenButton>
        {log.origin === 'manual' ? (
          <OpenButton opener={EDIT_LOG_OPENER} to={logEditPath(log.id)}>{t('ui.edit')}</OpenButton>
        ) : null}
        <Button variant="bare" className={styles.delete} aria-label={t('calc.deleteLog')} onPress={() => { void remove(); }}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      {confirmDialog}
    </SettingsPage>
  );
}
