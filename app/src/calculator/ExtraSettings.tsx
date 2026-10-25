import { useState } from 'react';
import { getRecipes } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { useCalculator } from './CalculatorContext';
import { applyExtra, changedKeys, extraOpening } from './settingsModel';
import { SettingsEditor } from './SettingsEditor';
import { Help, Rows, SwitchRow } from './SettingsParts';
import { SETTINGS_PATH } from './calculatorPath';

// Extra dough: one switch per recipe saying whether its tab shows the extra-dough box (a port of the screen in
// js/calculator-settings.js). A form: the switches change a working copy, Save asks and commits, and Save stays
// disabled until something differs from what the screen opened with.
//
// Opened by SettingsGate, which waits for the venue's real configuration: the copy below is made ONCE, when
// the screen opens, so it must not be made from the empty default.
export function ExtraSettings() {
  const { t } = useT();
  const { config } = useCalculator();
  const [recipes] = useState(() => getRecipes(config));
  const [opening] = useState(() => extraOpening(config));
  const [now, setNow] = useState(opening);

  return (
    <SettingsEditor
      title={t('calc.extraDough2')}
      fallback={SETTINGS_PATH}
      dirty={changedKeys(opening, now).length > 0}
      build={latest => applyExtra(latest, opening, now)}
      saveQuestion={t('calc.saveTheseChanges')}
    >
      <Help>{t('ui.showTheExtraDough')}</Help>
      <Rows>
        {recipes.map(recipe => (
          <SwitchRow
            key={recipe.id}
            name={recipe.name}
            selected={now[recipe.id] !== false}
            onChange={selected => { setNow(known => ({ ...known, [recipe.id]: selected })); }}
          />
        ))}
      </Rows>
    </SettingsEditor>
  );
}
