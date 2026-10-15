import { useId } from 'react';
import { isLinked } from '@mise/shared/calculator-recipe-source';
import { useT } from '../i18n/useT';
import { DecimalBox } from './DecimalBox';
import { useRecipesEditor } from './recipesEditorContext';
import { leaveningRows, leaveningValue } from './recipesModel';
import type { EditableRecipe } from './recipesModel';
import { SettingSwitch } from '../ui/SettingSwitch';
import styles from './RecipeScreen.module.css';

// The Leavening box (a port of `leaveningBox` in js/recipes.js): ONE bounded block holding the three things that
// belong together — WHICH ingredient is the leavening, what percentage a phone starts from, and whether the tab shows
// the knob at all.
//
// ⚠️ THE PERCENTAGE STAYS: the knob is saved per PHONE, while this number lives in Firestore and is the value EVERY
// phone starts from — a new device has nothing else to read. Remove it and the shared starting point can never be
// corrected again.
//
// ⚠️ WHEN LINKED, THE ROWS COME FROM THE CATALOGUE and the choice is stored as leaveningRid — the row's own id.
// Offering the tab's own leftover list here would let somebody pick an ingredient the dough no longer contains.
export function LeaveningBox({ recipe }: { recipe: EditableRecipe }) {
  const { t } = useT();
  const editor = useRecipesEditor();
  const ids = useId();
  const id = (part: string) => `${ids}-${part}`;
  const linked = isLinked(recipe);
  const rows = leaveningRows(recipe, editor.linkedRows(recipe));
  const chosen = leaveningValue(recipe, linked);
  const knob = recipe.showLeavening !== false;

  return (
    <section className={styles.field} aria-labelledby={id('title')}>
      <h3 id={id('title')} className={styles.label}>{t('calc.leavening')}</h3>
      {/* ⚠️ THE EMPTY OPTION IS FIRST AND IS A REAL ANSWER: a recipe may legitimately have no leavening, and without it
          the only way back from a wrong choice would be to pick a different wrong one. The options follow the names as
          they are typed — they are drawn from the working copy, so the field being typed in is never redrawn. */}
      <select
        className={styles.input}
        aria-label={t('calc.leavening')}
        aria-describedby={id('hint')}
        value={chosen}
        onChange={event => { editor.chooseLeavening(recipe.id, event.target.value); }}
      >
        <option value="">{t('calc.leaveningNone')}</option>
        {rows.map(row => <option key={row.value} value={row.value}>{row.label.trim() === '' ? t('calc.unnamedIngredient') : row.label}</option>)}
      </select>
      <p id={id('hint')} className={styles.hint}>{t('calc.leaveningHint')}</p>

      {/* The rest of the box only means anything once something IS the leavening. */}
      {chosen !== '' ? (
        <>
          <div className={styles.withUnit}>
            <label htmlFor={id('pct')} className={styles.unitLabel}>{t('calc.leaveningStartAt')}</label>
            <DecimalBox
              id={id('pct')}
              className={styles.input}
              value={recipe.leaveningDefaultPct}
              min={0}
              max={100}
              step={0.05}
              inputMode="decimal"
              onText={text => { editor.patch(recipe.id, { leaveningDefaultPct: Number(text) || 0 }); }}
            />
            <span className={styles.unit} aria-hidden="true">%</span>
          </div>
          {/* ⚠️ THE HINT CHANGES WITH THE ANSWER. With the knob on, this number is where every phone STARTS; with it
              off, it is the only number there is. */}
          <p className={styles.hint}>{knob ? t('calc.leaveningPctHintKnob') : t('calc.leaveningPctHintFixed')}</p>

          <div className={styles.switchRow}>
            <span id={id('knob')} className={styles.switchName}>{t('calc.showTheAdjustKnob')}</span>
            <SettingSwitch
              selected={knob}
              onChange={selected => { editor.patch(recipe.id, { showLeavening: selected }); }}
              labelledBy={id('knob')}
            />
          </div>
          <p className={styles.hint}>{t('calc.leaveningKnobHint')}</p>
        </>
      ) : null}
    </section>
  );
}
