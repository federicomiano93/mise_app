import { useT } from '../i18n/useT';
import { LOG_PATH } from './calculatorPath';
import { SettingsPage } from './SettingsPage';
import { Empty } from './SettingsParts';
import type { LogLookup } from './useLog';

// A log that is not on screen: still coming, or gone (deleted on another phone while it was open, or an address
// with an id nobody has). Back is the way out. ⚠️ NEVER A CRASH: a log that disappears under an open screen is an
// everyday event with two phones.
export function LogMissing({ lookup, fallback = LOG_PATH }: { lookup: LogLookup; fallback?: string }) {
  const { t } = useT();
  return (
    <SettingsPage title={t('ui.log')} fallback={fallback}>
      <Empty>{lookup.status === 'loading' ? t('calc.loading') : t('calc.logNotFound')}</Empty>
    </SettingsPage>
  );
}
