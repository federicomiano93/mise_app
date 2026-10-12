import { Navigate } from 'react-router';
import { latestVersion } from '@mise/shared/log-model';
import type { Log, LogVersion } from '@mise/shared/log-model';
import { logTimestamp } from '@mise/shared/log-time';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/useConfirm';
import { useCalculatorStore } from './CalculatorContext';
import { logHistoryPath, logVersionPath, logViewPath } from './calculatorPath';
import { useLeave } from './calculatorNav';
import { DayBadgeUnderTitle } from './DayBadge';
import { Door } from './Door';
import { LOG_HISTORY_TITLE, useHandBack, versionOpener } from './handBack';
import { LogBody, stamp } from './LogBody';
import { LogMissing } from './LogMissing';
import { versionKind, versionsOf } from './logsModel';
import { SettingsPage } from './SettingsPage';
import { Rows } from './SettingsParts';
import { useLog } from './useLog';
import styles from './LogHistoryScreens.module.css';

// «v3 · Edited · current»: what version `index` (0-based) of a log is.
function useVersionTitle() {
  const { t } = useT();
  return (version: LogVersion, index: number, count: number): string => {
    const kind = versionKind(version, index);
    const what = kind.kind === 'created' ? t('calc.versionCreated')
      : kind.kind === 'edited' ? t('calc.versionEdited')
      : t('calc.restoredFromVersion', { v: kind.from });
    return [`v${index + 1}`, what, index === count - 1 ? t('calc.versionCurrent') : ''].filter(Boolean).join(' · ');
  };
}

// A log's versions, newest first. Every edit is a version and nothing is ever lost: a restore adds a copy on top.
export function LogHistory({ id }: { id: string }) {
  const { t } = useT();
  const title = useVersionTitle();
  const lookup = useLog(id);
  if (lookup.status !== 'found') return <LogMissing lookup={lookup} />;
  const { log } = lookup;
  const versions = versionsOf(log);
  return (
    <SettingsPage
      title={t('calc.logEditHistory', { dough: log.dough })}
      fallback={logViewPath(log.id)}
      titleOpener={LOG_HISTORY_TITLE}
    >
      <Rows>
        {versions.map((version, index) => ({ version, index })).reverse().map(({ version, index }) => {
          const by = version?.calculatedBy ? String(version.calculatedBy) : '';
          const when = version?.at?.date ? stamp(version) : '';
          return (
            <Door
              key={index}
              opener={versionOpener(index + 1)}
              to={logVersionPath(log.id, index + 1)}
              title={title(version ?? {}, index, versions.length)}
              sub={[when, by].filter(Boolean).join(' · ') || undefined}
            />
          );
        })}
      </Rows>
    </SettingsPage>
  );
}

// One version of a log, drawn like the log itself. Any version but the current one can be restored: that adds a copy
// of it on top, as the newest version — the chain is never cut.
export function LogVersionScreen({ id, n }: { id: string; n: number }) {
  const lookup = useLog(id);
  if (lookup.status !== 'found') return <LogMissing lookup={lookup} fallback={logHistoryPath(id)} />;
  const version = versionsOf(lookup.log)[n - 1];
  // A version number the log does not have (a stale link, a chain that is shorter): the list of versions.
  if (!version) return <Navigate to={logHistoryPath(id)} replace state={KEEP_FOCUS} />;
  return <VersionFound log={lookup.log} version={version} n={n} />;
}

function VersionFound({ log, version, n }: { log: Log; version: LogVersion; n: number }) {
  const { t } = useT();
  const title = useVersionTitle();
  const store = useCalculatorStore();
  const handBack = useHandBack();
  const leave = useLeave(logHistoryPath(log.id));
  const [confirm, confirmDialog] = useConfirm();
  const count = versionsOf(log).length;
  const current = latestVersion(log) === version;

  const restore = async () => {
    const sure = await confirm({
      title: t('calc.restoreThisVersion'),
      message: t('calc.restoreThisVersionIt'),
      okLabel: t('ui.restore'),
      cancelLabel: t('common.cancel'),
    });
    if (!sure) return;
    // The author is read NOW, from the version at this place in the log as it is after the question: another phone
    // may have changed the log while it was open.
    const now = store.getSnapshot().logs.find(known => known.id === log.id);
    const restoring = now ? versionsOf(now)[n - 1] : undefined;
    const result = store.restoreLog(log.id, n - 1, { calculatedBy: String(restoring?.calculatedBy || ''), at: logTimestamp() });
    // «full» and «missing» stay on this screen: the store has already said why.
    if (result !== 'saved') return;
    handBack.replaceTop(LOG_HISTORY_TITLE);
    leave();
  };

  return (
    <SettingsPage title={log.dough} sub={<DayBadgeUnderTitle log={log} />} fallback={logHistoryPath(log.id)}>
      <p className={styles.version}>{title(version, n - 1, count)}</p>
      <LogBody version={version} />
      {current ? null : (
        <Button variant="primary" onPress={() => { void restore(); }}>{t('calc.restoreThisVersion')}</Button>
      )}
      {confirmDialog}
    </SettingsPage>
  );
}
