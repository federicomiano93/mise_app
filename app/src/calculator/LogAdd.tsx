import { useId, useRef, useState } from 'react';
import { ToggleButton } from 'react-aria-components';
import { getRecipeById, getRecipes, usesOrders, usesTrays, usesTypedTotal } from '@mise/shared/calculator-config';
import type { ForDay } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import { announceAction } from '../telemetry/usage';
import { useAlert } from '../ui/useAlert';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { recipeProblemSentence } from './calculatorMessages';
import { LOG_PATH } from './calculatorPath';
import { LogTotalField, LogTraysField } from './LogAmountFields';
import { LogQtyRows } from './LogQtyRows';
import { buildManualVersion, manualRows, recipeToSave } from './logVersions';
import type { QtyRow } from './logVersions';
import { SettingsEditor } from './SettingsEditor';
import styles from './LogEditor.module.css';

// What the screen holds while it is open: nothing is chosen (P20), and nothing is written until Save.
type Draft = {
  recipeId: string | null;
  forDay: ForDay | null;
  // Save was pressed with no day: the two buttons are red until one is picked.
  dayMissing: boolean;
  trays: number;
  total: number;
  rows: QtyRow[];
};

const EMPTY: Draft = { recipeId: null, forDay: null, dayMissing: false, trays: 0, total: 0, rows: [] };

const DAYS: readonly ForDay[] = ['today', 'tomorrow'];

// «Add dough»: a log made by hand, from the Dough history. Pick a recipe (required), pick Today or Tomorrow (required),
// type what the recipe's logic asks for (trays, a total, quantities by client), Save → a NEW log, written exactly as a
// Confirm in the Calculator would (the recipe's own leavening %, no extra dough). The recipe it is saved from is the one
// the Calculator would show (`recipeToSave`): refused, with the Calculator's sentence, when it cannot be read.
//
// The form is SettingsEditor's: leaving with a recipe chosen asks, Save waits for a recipe, and a saved dough lands
// back on the list.
export function LogAdd() {
  const { t } = useT();
  const store = useCalculatorStore();
  const { config, configAnswered, configFailed } = useCalculator();
  const [alert, alertDialog] = useAlert();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const uid = useId();
  const firstDay = useRef<HTMLButtonElement | null>(null);
  const recipes = getRecipes(config);
  const recipe = draft.recipeId === null ? null : getRecipeById(config, draft.recipeId);
  // ⚠️ A RECIPE THAT GOES AWAY (deleted on another phone) TAKES THE CHOICE WITH IT: otherwise Save would stay on
  // while nothing on screen says what is being saved. The recipe, and what depends on it, start over.
  if (draft.recipeId !== null && recipe === null && configAnswered) {
    setDraft(before => ({ ...before, recipeId: null, dayMissing: false, trays: 0, total: 0, rows: [] }));
  }

  // Another recipe starts over: its trays, total and products are its own.
  const pick = (id: string) => {
    if (id === draft.recipeId) return;
    setDraft(before => ({ ...before, recipeId: id, trays: 0, total: 0, rows: manualRows(config, id) }));
  };
  const pickDay = (day: ForDay) => { setDraft(before => ({ ...before, forDay: day, dayMissing: false })); };
  const setQty = (index: number, qty: number) => {
    setDraft(before => ({ ...before, rows: before.rows.map((row, at) => (at === index ? { ...row, qty } : row)) }));
  };

  // ⚠️ SAVE IS ON THE BAR FROM THE MOMENT A RECIPE IS PICKED, so it can be pressed with no day chosen: it then says so
  // above the two buttons, turns them red and puts the focus on the first, and writes nothing.
  const beforeSave = (): boolean => {
    if (draft.forDay !== null) return true;
    setDraft(before => ({ ...before, dayMissing: true }));
    firstDay.current?.focus();
    return false;
  };

  const commit = async (): Promise<boolean> => {
    const { recipeId, forDay } = draft;
    if (recipeId === null || forDay === null) return false;
    // Read now, not when the screen opened: a linked recipe may have arrived, or gone, since.
    const latest = store.getSnapshot();
    const chosen = getRecipeById(latest.config, recipeId);
    if (!chosen) {
      await alert({ message: recipeProblemSentence(t, { problem: 'missing', row: '' }), okLabel: t('common.ok') });
      return false;
    }
    const toSave = recipeToSave(chosen, latest.linked);
    if ('problem' in toSave) {
      await alert({ message: recipeProblemSentence(t, toSave), okLabel: t('common.ok') });
      return false;
    }
    const version = buildManualVersion({
      config: latest.config,
      recipeId,
      recipe: toSave.recipe,
      rows: draft.rows,
      totalInput: draft.total,
      trays: draft.trays,
      // Read NOW, at save time: the words are written into the document in the language of this moment.
      words: { occasionalClient: t('calc.logOccasionalClient'), extraDough: t('calc.logExtraDough') },
      nowMs: Date.now(),
    });
    store.addLog({ dough: toSave.recipe.name, recipeId, forDay, version });
    announceAction('log-added');
    return true;
  };

  const waiting = !configAnswered && !configFailed;
  const dayMissing = draft.dayMissing && draft.forDay === null;

  return (
    <SettingsEditor
      title={t('calc.addLog')}
      fallback={LOG_PATH}
      dirty={draft.recipeId !== null}
      saveQuestion={t('calc.saveThisLog')}
      beforeSave={beforeSave}
      commit={commit}
    >
      <div className={styles.form}>
        {waiting ? <p className={styles.hint}>{t('calc.loading')}</p> : recipes.length === 0 ? (
          <p className={styles.hint}>{t('calc.noRecipesYetAdd')}</p>
        ) : (
          <>
            <div className={styles.field} role="group" aria-labelledby={`${uid}-recipe`}>
              <p id={`${uid}-recipe`} className={styles.label}>{t('ui.recipe')}</p>
              <div className={styles.choices}>
                {recipes.map(known => (
                  <ToggleButton
                    key={known.id}
                    className={styles.choice}
                    isSelected={known.id === draft.recipeId}
                    onChange={() => { pick(known.id); }}
                  >
                    {known.name}
                  </ToggleButton>
                ))}
              </div>
            </div>

            {recipe === null ? <p className={styles.hint}>{t('calc.pickARecipeTo')}</p> : (
              <>
                <div className={`${styles.field} ${dayMissing ? styles.missing : ''}`} role="group" aria-labelledby={`${uid}-day`}>
                  <p id={`${uid}-day`} className={styles.label}>{t('calc.whenIsThisDough')}</p>
                  {dayMissing ? <p role="alert" className={styles.alert}>{t('calc.chooseDayFirst')}</p> : null}
                  <div className={styles.choices}>
                    {DAYS.map((day, at) => (
                      <ToggleButton
                        key={day}
                        ref={at === 0 ? firstDay : undefined}
                        className={styles.choice}
                        isSelected={draft.forDay === day}
                        onChange={() => { pickDay(day); }}
                      >
                        {day === 'today' ? t('day.today') : t('day.tomorrow')}
                      </ToggleButton>
                    ))}
                  </div>
                </div>

                {usesTrays(recipe.logic) ? (
                  <LogTraysField weight={recipe} trays={draft.trays} onChange={trays => { setDraft(before => ({ ...before, trays })); }} />
                ) : null}
                {usesTypedTotal(recipe.logic) ? (
                  <LogTotalField total={draft.total} onChange={total => { setDraft(before => ({ ...before, total })); }} />
                ) : null}
                {usesOrders(recipe.logic) ? (
                  <div className={styles.field}>
                    <p className={styles.label}>{t('calc.productsQuantitiesOnly')}</p>
                    <LogQtyRows rows={draft.rows} onChange={setQty} empty={t('calc.noProductsForThis')} />
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      {alertDialog}
    </SettingsEditor>
  );
}
