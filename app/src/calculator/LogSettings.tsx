import { useId, useState } from 'react';
import { LOG_RETENTION_DEFAULT, LOG_RETENTION_OPTIONS, getRecipes, getTabProducts } from '@mise/shared/calculator-config';
import type { CalculatorConfig, Recipe } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { useCalculator } from './CalculatorContext';
import { SETTINGS_PATH } from './calculatorPath';
import { applyLog, logChanged, logOpening } from './settingsModel';
import type { LogSettings as LogValues } from './settingsModel';
import { SettingSwitch } from './SettingSwitch';
import { SettingsEditor } from './SettingsEditor';
import { Help } from './SettingsParts';
import styles from './LogSettings.module.css';

// Dough history settings: one card per recipe, naming its products, with whether that recipe's doughs appear in
// the Dough history and for how long (24 or 48 hours) — a port of js/log-settings.js.
//
// DISPLAY ONLY: every confirmed dough is always kept in the database; these decide only what the list in the app
// shows. A form: the controls change a working copy, Save asks and commits.
// A recipe's products by name, each once: the same product ordered by two clients is two rows of the tab.
function productNamesOf(config: CalculatorConfig, recipeId: string): string[] {
  return [...new Set(getTabProducts(config, recipeId).map(product => product.name))];
}

export function LogSettings() {
  const { t } = useT();
  const { config } = useCalculator();
  // Made ONCE, when the screen opens (see SettingsGate).
  const [recipes] = useState(() => getRecipes(config));
  const [productNames] = useState(() => Object.fromEntries(
    recipes.map(recipe => [recipe.id, productNamesOf(config, recipe.id)]),
  ));
  const [opening] = useState(() => logOpening(config));
  const [now, setNow] = useState<LogValues>(opening);

  return (
    <SettingsEditor
      title={t('ui.log')}
      fallback={SETTINGS_PATH}
      dirty={logChanged(opening, now)}
      build={latest => applyLog(latest, opening, now)}
      saveQuestion={t('calc.saveTheseLogSettings')}
    >
      <div>
        <Help>{t('calc.forEachRecipeChoose')}</Help>
        <Help>{t('calc.logsAreAlwaysKept')}</Help>
      </div>
      {recipes.map(recipe => (
        <RecipeCard
          key={recipe.id}
          recipe={recipe}
          products={productNames[recipe.id] ?? []}
          visible={now.visibility[recipe.id] !== false}
          hours={now.retention[recipe.id] ?? opening.retention[recipe.id] ?? LOG_RETENTION_DEFAULT}
          onVisible={visible => { setNow(known => ({ ...known, visibility: { ...known.visibility, [recipe.id]: visible } })); }}
          onHours={hours => { setNow(known => ({ ...known, retention: { ...known.retention, [recipe.id]: hours } })); }}
        />
      ))}
    </SettingsEditor>
  );
}

function RecipeCard({ recipe, products, visible, hours, onVisible, onHours }: {
  recipe: Recipe;
  products: readonly string[];
  visible: boolean;
  hours: number;
  onVisible: (visible: boolean) => void;
  onHours: (hours: number) => void;
}) {
  const { t } = useT();
  const ids = useId();
  const titleId = `${ids}-title`;
  const switchId = `${ids}-switch`;
  const selectId = `${ids}-select`;
  const labelId = `${ids}-label`;
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h3 id={titleId} className={styles.title}>{recipe.name}</h3>
        <p className={styles.products}>{products.length > 0 ? products.join(', ') : t('calc.noProducts')}</p>
      </div>
      <div className={styles.row}>
        <span id={switchId} className={styles.label}>{t('calc.keepLogsVisible')}</span>
        <SettingSwitch selected={visible} onChange={onVisible} labelledBy={`${switchId} ${titleId}`} />
      </div>
      <div className={styles.row}>
        <label id={labelId} htmlFor={selectId} className={styles.label}>{t('calc.keepVisibleFor')}</label>
        <select
          id={selectId}
          className={styles.select}
          aria-labelledby={`${labelId} ${titleId}`}
          value={String(hours)}
          onChange={event => { onHours(Number(event.target.value)); }}
        >
          {LOG_RETENTION_OPTIONS.map(option => (
            <option key={option} value={String(option)}>{t('calc.logKeepHours', { n: option })}</option>
          ))}
        </select>
      </div>
    </section>
  );
}
