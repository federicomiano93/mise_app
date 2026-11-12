import { useId, useRef, useState } from 'react';
import { isLinked } from '@mise/shared/calculator-recipe-source';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import type { StoredDoc } from './calculatorSource';
import { CataloguePicker } from './CataloguePicker';
import { useRecipesEditor } from './recipesEditorContext';
import type { EditableRecipe } from './recipesModel';
import styles from './RecipeScreen.module.css';

// Where a recipe's ingredients come from: typed here, or taken from a Catalogue recipe (a port of `sourceBox` and
// `link` in js/recipes.js). Choosing «a Catalogue recipe» opens the picker, which reads the Catalogue then and not
// before; the choice stamps the rows and links. Back to «typed here» unlinks and leaves no stale copy.
export function SourceBox({ recipe }: { recipe: EditableRecipe }) {
  const { t } = useT();
  const editor = useRecipesEditor();
  const selectId = useId();
  const [picking, setPicking] = useState(false);
  const linked = isLinked(recipe);
  const resolved = linked ? editor.resolved(recipe) : null;

  // The pick in flight. Closing the picker while it links makes a late answer stale: it changes nothing (current app e0b92090).
  const pick = useRef(0);
  async function choose(source: StoredDoc): Promise<void> {
    const mine = ++pick.current;
    const result = await editor.link(recipe.id, source, () => pick.current === mine);
    if (result.status === 'stale') return;
    setPicking(false);
    if (result.status === 'failed') await editor.say(t(result.message));
  }

  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>{t('calc.recipeSource')}</label>
      <select
        id={selectId}
        className={styles.input}
        // A cancelled picker leaves the select where it was: it only shows what is saved on the recipe.
        value={linked ? 'catalogue' : 'own'}
        onChange={event => {
          if (event.target.value === 'catalogue') {
            if (!linked) setPicking(true);
          } else if (linked) {
            editor.unlink(recipe.id);
          }
        }}
      >
        <option value="own">{t('calc.sourceOwn')}</option>
        <option value="catalogue">{t('calc.sourceCatalogue')}</option>
      </select>
      <p className={styles.hint}>{linked ? t('calc.sourceLinkedHint') : t('calc.sourceOwnHint')}</p>
      {linked ? (
        <div className={styles.linkedRow}>
          <span className={styles.linkedName}>
            {resolved && !resolved.problem ? t('calc.linkedTo', { name: resolved.name }) : ''}
          </span>
          <Button onPress={() => { setPicking(true); }}>{t('calc.sourceChange')}</Button>
        </div>
      ) : null}
      {picking ? (
        <PartBoundary>
          <CataloguePicker onChoose={choose} onClose={() => { pick.current += 1; setPicking(false); }} />
        </PartBoundary>
      ) : null}
    </div>
  );
}
