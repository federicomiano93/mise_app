import { useT } from '../i18n/useT';
import { LOG_PATH, logViewPath } from './calculatorPath';
import type { DrawnLogView } from './calculatorPath';
import { SettingsPage } from './SettingsPage';

// ⚠️ A PLACEHOLDER: Add log and Edit log are the next slice (3c-3, slice C2). The addresses and the buttons that lead
// here exist already; the editors replace this component.
export function LogDraft({ view }: { view: Extract<DrawnLogView, { kind: 'new' | 'edit' }> }) {
  const { t } = useT();
  return (
    <SettingsPage
      title={view.kind === 'new' ? t('calc.addLog') : t('ui.edit')}
      fallback={view.kind === 'new' ? LOG_PATH : logViewPath(view.id)}
    >
      <div />
    </SettingsPage>
  );
}
