import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { useCalculator } from './CalculatorContext';
import { CalculatorSettings } from './CalculatorSettings';
import { SETTINGS_PATH } from './calculatorPath';
import type { DrawnSettingsView } from './calculatorPath';
import { DivisorChooser, DivisorProducts } from './DivisorSettings';
import { ExtraSettings } from './ExtraSettings';
import { LogSettings } from './LogSettings';
import { SettingsPage } from './SettingsPage';
import { Empty } from './SettingsParts';

// The screen of Settings an address names (calculatorPath.ts; the Clients and Recipes screens are not drawn yet).
export function SettingsScreens({ view }: { view: DrawnSettingsView }) {
  switch (view.kind) {
    case 'hub':
      return <CalculatorSettings />;
    case 'extra':
      return <SettingsGate><ExtraSettings /></SettingsGate>;
    case 'log':
      return <SettingsGate><LogSettings /></SettingsGate>;
    case 'divisor':
      return view.recipeId === null
        ? <DivisorChooser />
        : <SettingsGate><DivisorProducts recipeId={view.recipeId} /></SettingsGate>;
  }
}

// ⚠️ AN EDITOR THAT COPIES THE CONFIGURATION WHEN IT OPENS WAITS FOR THE CONFIGURATION. Opened by its address, the
// store may still hold only the empty default (or a copy from this phone); a screen opened now would work on that,
// and a Save after the venue's real data arrived would write the old copy's parts over it.
function SettingsGate({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { configAnswered, configFailed } = useCalculator();
  if (configAnswered) return children;
  return (
    <SettingsPage title={t('ui.settings')} fallback={SETTINGS_PATH}>
      <Empty>{configFailed ? t('calc.couldNotLoad') : t('calc.loading')}</Empty>
    </SettingsPage>
  );
}
