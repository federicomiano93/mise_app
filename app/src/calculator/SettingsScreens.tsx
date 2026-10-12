import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { useCalculator } from './CalculatorContext';
import { CalculatorSettings } from './CalculatorSettings';
import { ClientsEditor } from './ClientsEditor';
import { SETTINGS_PATH } from './calculatorPath';
import type { DrawnSettingsView } from './calculatorPath';
import { DivisorChooser, DivisorProducts } from './DivisorSettings';
import { ExtraSettings } from './ExtraSettings';
import { LogSettings } from './LogSettings';
import { RecipesEditor } from './RecipesEditor';
import { SettingsPage } from './SettingsPage';
import { Empty } from './SettingsParts';

// The screen of Settings an address names (calculatorPath.ts).
export function SettingsScreens({ view }: { view: DrawnSettingsView }) {
  switch (view.kind) {
    case 'hub':
      return <CalculatorSettings />;
    case 'clients':
      return <SettingsGate><ClientsEditor target={view.target} /></SettingsGate>;
    case 'recipes':
      return <SettingsGate><RecipesEditor target={view.target} /></SettingsGate>;
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

// ⚠️ AN EDITOR THAT COPIES THE CONFIGURATION WHEN IT OPENS WAITS FOR THE SERVER'S ANSWER. Opened by its address, the
// store may still hold only the empty default, or the copy this phone's own database answered in milliseconds
// (yesterday's clients): a screen opened now would work on that, and a Save would write it over what other phones
// added since. The store sends nothing before the server has answered either (`configFromServer`).
function SettingsGate({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { configFromServer, configFailed } = useCalculator();
  if (configFromServer) return children;
  return (
    <SettingsPage title={t('ui.settings')} fallback={SETTINGS_PATH}>
      <Empty>{configFailed ? t('calc.couldNotLoad') : t('calc.loading')}</Empty>
    </SettingsPage>
  );
}
