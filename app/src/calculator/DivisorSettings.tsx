import { useState } from 'react';
import { Navigate } from 'react-router';
import { getRecipeById, getRecipes } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { useCalculator } from './CalculatorContext';
import { SETTINGS_PATH, divisorPath, divisorRecipePath } from './calculatorPath';
import { Door } from './Door';
import { divisorRecipeOpener } from './handBack';
import { applyDivisor, divisorOpening, divisorProducts, sameTicks } from './settingsModel';
import { SettingsEditor } from './SettingsEditor';
import { SettingsPage } from './SettingsPage';
import { Empty, Help, Rows } from './SettingsParts';
import styles from './DivisorSettings.module.css';

// Divisor: first a recipe is picked, then its products are ticked (a port of the screens in
// js/calculator-settings.js). Ticking a product splits it across every client that orders it.

// The recipes to pick from.
export function DivisorChooser() {
  const { t } = useT();
  const { config } = useCalculator();
  return (
    <SettingsPage title={t('ui.divisor')} fallback={SETTINGS_PATH}>
      <Help>{t('calc.pickWhichProductsEach')}</Help>
      <Rows>
        {getRecipes(config).map(recipe => (
          <Door key={recipe.id} opener={divisorRecipeOpener(recipe.id)} to={divisorRecipePath(recipe.id)} title={recipe.name} />
        ))}
      </Rows>
    </SettingsPage>
  );
}

// One recipe's products. A recipe that is not there (an address typed by hand, or deleted on another phone)
// goes back to the list of recipes rather than showing an empty form.
export function DivisorProducts({ recipeId }: { recipeId: string }) {
  const { config } = useCalculator();
  const recipe = getRecipeById(config, recipeId);
  if (!recipe) return <Navigate to={divisorPath} replace state={KEEP_FOCUS} />;
  return <DivisorForm key={recipeId} recipeId={recipeId} recipeName={recipe.name} />;
}

function DivisorForm({ recipeId, recipeName }: { recipeId: string; recipeName: string }) {
  const { t } = useT();
  const { config } = useCalculator();
  // Made ONCE, when the screen opens (see SettingsGate): the products, and which of them are ticked.
  const [products] = useState(() => divisorProducts(config, recipeId));
  const [opening] = useState(() => divisorOpening(config, recipeId));
  const [ticked, setTicked] = useState(opening);

  const toggle = (id: string, on: boolean) => {
    setTicked(known => (on ? (known.includes(id) ? known : [...known, id]) : known.filter(other => other !== id)));
  };

  return (
    <SettingsEditor
      title={t('calc.divisorTitle', { recipe: recipeName })}
      fallback={divisorPath}
      dirty={!sameTicks(opening, ticked)}
      build={latest => applyDivisor(latest, recipeId, ticked)}
      saveQuestion={t('calc.saveTheseChanges')}
      showSave={products.length > 0}
    >
      {products.length === 0 ? (
        <Empty>{t('calc.noProductsInThis3')}</Empty>
      ) : (
        <>
          <Rows>
            {products.map(product => (
              <label key={product.id} className={styles.tick}>
                <input
                  type="checkbox"
                  checked={ticked.includes(product.id)}
                  onChange={event => { toggle(product.id, event.target.checked); }}
                />
                <span>{product.name}</span>
              </label>
            ))}
          </Rows>
          <Button className={styles.clear} onPress={() => { setTicked([]); }}>{t('calc.untickAll')}</Button>
        </>
      )}
    </SettingsEditor>
  );
}
