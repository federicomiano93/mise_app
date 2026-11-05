import { useCallback, useEffect, useId, useRef } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  LOGICS, MAX_TRAY_WEIGHT, MAX_VISIBLE_RECIPES, MIN_TRAY_WEIGHT, isValidTrayWeight, usesTrays,
} from '@mise/shared/calculator-config';
import type { Logic } from '@mise/shared/calculator-config';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FROM_PARENT } from './calculatorNav';
import { SETTINGS_PATH, recipeSettingsPath } from './calculatorPath';
import { DecimalBox } from './DecimalBox';
import { ADD_RECIPE_ROW_OPENER, recipeOpener, useHandBack } from './handBack';
import { useRecipesEditor } from './recipesEditorContext';
import { logicOf } from './recipesModel';
import type { EditableRecipe } from './recipesModel';
import { RecipesSaveButton } from './RecipesSaveButton';
import { SettingsPage } from './SettingsPage';
import { SettingSwitch } from './SettingSwitch';
import { Help } from './SettingsParts';
import styles from './RecipeList.module.css';

// Each way a recipe calculates, by the words the current app uses for it (looked up when DRAWING).
export const LOGIC_LABELS: Readonly<Record<Logic, MessageKey>> = {
  orders: 'calc.fromOrders', total: 'calc.fromATotal', both: 'calc.bothOrdersTotal',
  trays: 'calc.byTray', traysTotal: 'calc.byTrayPlusTotal',
};

export const LOGIC_HINTS: Readonly<Record<Logic, MessageKey>> = {
  orders: 'calc.logicHint.orders', total: 'calc.logicHint.total', both: 'calc.logicHint.both',
  trays: 'calc.logicHint.trays', traysTotal: 'calc.logicHint.traysTotal',
};

// The recipes: an accordion, one row open at a time (a port of `renderRecipeList` in js/recipes.js). Each row says how
// the recipe calculates, how many ingredients it has and whether it shows in the calculator; the open row holds the
// settings that belong to the LIST (how it calculates, the tray weight, whether it shows) and the way into the full
// recipe. Everything edits the working copy: the switch does NOT save on the tap (P20: this list has a Save).
export function RecipeList() {
  const { t } = useT();
  const editor = useRecipesEditor();
  const handBack = useHandBack();
  const list = useRef<HTMLDivElement>(null);
  const add = useRef<HTMLButtonElement | null>(null);

  // Save found a missing tray weight and said so: the focus goes to the first marked field of the list.
  const seenTick = useRef(editor.checkTick);
  useEffect(() => {
    if (editor.checkTick === seenTick.current) return;
    seenTick.current = editor.checkTick;
    list.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [editor.checkTick]);

  const registerAdd = useCallback((node: HTMLButtonElement | null) => {
    add.current = node;
    handBack.register(ADD_RECIPE_ROW_OPENER, node);
  }, [handBack]);

  const navigate = useNavigate();
  async function addRecipe() {
    const id = await editor.addRecipe();
    if (id === null) return;
    handBack.expect(ADD_RECIPE_ROW_OPENER);
    void navigate(recipeSettingsPath(id), { state: FROM_PARENT });
  }

  return (
    <SettingsPage
      title={t('ui.recipes')}
      fallback={SETTINGS_PATH}
      onBack={() => { void editor.leaveEditor(); }}
      action={<RecipesSaveButton />}
    >
      <Help>{t('calc.recipesIntro', { n: MAX_VISIBLE_RECIPES })}</Help>
      <div ref={list} className={styles.list}>
        {editor.recipes.map(recipe => (
          <RecipeRow key={recipe.id} recipe={recipe} onDeleted={() => { add.current?.focus(); }} />
        ))}
      </div>
      <Button ref={registerAdd} className={styles.add} onPress={() => { void addRecipe(); }}>{t('calc.addRecipe')}</Button>
    </SettingsPage>
  );
}

function RecipeRow({ recipe, onDeleted }: { recipe: EditableRecipe; onDeleted: () => void }) {
  const { t } = useT();
  const editor = useRecipesEditor();
  const handBack = useHandBack();
  const navigate = useNavigate();
  const ids = useId();
  const id = (part: string) => `${ids}-${part}`;
  const open = editor.openId === recipe.id;
  const logic = logicOf(recipe);
  const shownName = recipe.name.trim() === '' ? t('calc.unnamedRecipe') : recipe.name;
  // «From a total · 16 ingredients · shown»: the current app's whole phrases, kept in step live by the open row.
  const sub = `${t(LOGIC_LABELS[logic])}  ·  ${t('calc.ingredientCount', { n: recipe.ingredients.length })}`
    + (recipe.visible !== false ? t('calc.shown') : t('calc.hidden'));

  const register = useCallback((node: HTMLButtonElement | null) => {
    handBack.register(recipeOpener(recipe.id), node);
    if (node) handBack.deliver();
  }, [handBack, recipe.id]);

  const trayBad = editor.showErrors && usesTrays(logic) && !isValidTrayWeight(recipe.trayWeight);

  return (
    <div className={open ? `${styles.card} ${styles.isOpen}` : styles.card}>
      <div className={styles.head}>
        <Button
          ref={register}
          variant="bare"
          className={styles.open}
          aria-expanded={open}
          aria-controls={id('panel')}
          onPress={() => { editor.setOpenId(open ? null : recipe.id); }}
        >
          <span className={styles.text}>
            <span id={id('name')} className={styles.name}>{shownName}</span>
            {/* A space between the two, or a screen reader joins the name to the sentence under it. */}
            {' '}
            <span className={styles.sub}>{sub}</span>
          </span>
          <ChevronRight aria-hidden="true" className={styles.chevron} />
        </Button>
        <Button
          variant="bare"
          className={styles.del}
          aria-label={t('calc.deleteRecipe')}
          aria-describedby={id('name')}
          onPress={() => { void editor.deleteRecipe(recipe.id).then(gone => { if (gone) onDeleted(); }); }}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <div id={id('panel')} role="group" aria-label={shownName} hidden={!open} className={styles.panel}>
        <div className={styles.field}>
          <label htmlFor={id('logic')} className={styles.label}>{t('calc.howItCalculates')}</label>
          <select
            id={id('logic')}
            className={styles.input}
            value={logic}
            aria-describedby={id('hint')}
            onChange={event => { editor.patch(recipe.id, { logic: event.target.value as Logic }); }}
          >
            {LOGICS.map(known => <option key={known} value={known}>{t(LOGIC_LABELS[known])}</option>)}
          </select>
          {/* The sentence for the CHOSEN option, right under the select: a dropdown can only explain the option already chosen. */}
          <p id={id('hint')} className={styles.hint}>{t(LOGIC_HINTS[logic])}</p>
        </div>

        {usesTrays(logic) ? (
          // The weight stays on the recipe when the logic is switched away and back: the field is left out, never cleared.
          <div className={styles.field}>
            <label htmlFor={id('tray')} className={styles.label}>{t('calc.trayWeightG')}</label>
            <div className={styles.withUnit}>
              <DecimalBox
                id={id('tray')}
                className={trayBad ? `${styles.input} ${styles.invalid}` : styles.input}
                value={recipe.trayWeight}
                min={MIN_TRAY_WEIGHT}
                max={MAX_TRAY_WEIGHT}
                step={1}
                inputMode="numeric"
                invalid={trayBad}
                describedBy={trayBad ? id('tray-error') : undefined}
                onText={text => { editor.patch(recipe.id, { trayWeight: text === '' ? '' : Number(text) }); }}
              />
              <span className={styles.unit} aria-hidden="true">g</span>
            </div>
            <div role="alert">
              {trayBad ? (
                // An empty box and a weight that looks like kilos are different mistakes: say which.
                <p id={id('tray-error')} className={styles.error}>
                  {t(recipe.trayWeight === '' ? 'calc.trayWeightMissing' : 'calc.trayWeightTooLight')}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className={styles.switchRow}>
          <span id={id('show')} className={styles.switchName}>{t('calc.recipe.showInCalculator')}</span>
          <SettingSwitch
            selected={recipe.visible !== false}
            onChange={selected => { void editor.setVisible(recipe.id, selected); }}
            labelledBy={id('show')}
          />
        </div>

        <Button
          className={styles.edit}
          onPress={() => {
            editor.keep();
            handBack.expect(recipeOpener(recipe.id));
            void navigate(recipeSettingsPath(recipe.id), { state: FROM_PARENT });
          }}
        >
          {t('calc.editRecipe')}
        </Button>
      </div>
    </div>
  );
}
