import { useCallback } from 'react';
import { Plus } from 'lucide-react';
import type { Log } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useCalculator } from './CalculatorContext';
import { ADD_LOG_OPENER, LOG_LIST_TITLE, useHandBack } from './handBack';
import { CALCULATOR_PATH } from './calculatorPath';
import { LogCard } from './LogCard';
import { visibleLogs } from './logsModel';
import { SettingsPage } from './SettingsPage';
import { Empty } from './SettingsParts';
import { SkipBoundary } from './SkipBoundary';
import styles from './LogList.module.css';

type Props = {
  // The log open beside the list (the tablet's split), or null.
  openId: string | null;
  onOpen: (log: Log) => void;
  onAdd: () => void;
};

// The Dough history: the logs the venue chose to show, newest first, each a card that opens the log. «Add dough» is
// at the top, where a new item always is (P20).
export function LogList({ openId, onOpen, onAdd }: Props) {
  const { t } = useT();
  const handBack = useHandBack();
  const { config, configAnswered, configFailed, logs, logsLoaded } = useCalculator();
  const register = useCallback(
    (node: HTMLButtonElement | null) => { handBack.register(ADD_LOG_OPENER, node); },
    [handBack],
  );

  // Until the logs (and the settings that filter them) have arrived there is nothing to say: «nothing saved yet»
  // over logs that are on their way would be a lie.
  const waiting = !logsLoaded || (!configAnswered && !configFailed);
  const shown = visibleLogs(config, logs, Date.now());

  return (
    <SettingsPage title={t('ui.log')} fallback={CALCULATOR_PATH} titleOpener={LOG_LIST_TITLE}>
      <div className={styles.add}>
        <Button ref={register} variant="primary" onPress={onAdd}>
          <Plus aria-hidden="true" />
          {t('calc.addLog')}
        </Button>
      </div>
      {shown.length > 0 ? (
        <ul className={styles.list}>
          {shown.map(log => (
            <SkipBoundary key={log.id}>
              <LogCard log={log} open={log.id === openId} onOpen={onOpen} />
            </SkipBoundary>
          ))}
        </ul>
      ) : (
        // Distinguish «nothing saved yet» from «everything is hidden or past its window by the Dough history
        // settings», so the empty state is never misleading.
        <Empty>{waiting ? t('calc.loading') : logs.length > 0 ? t('calc.noLogsToShow') : t('calc.noLogsYetCalculate')}</Empty>
      )}
    </SettingsPage>
  );
}
