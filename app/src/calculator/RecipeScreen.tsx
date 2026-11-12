import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Navigate } from 'react-router';
import { moveIngredient, usesOrders } from '@mise/shared/calculator-config';
import { isLinked } from '@mise/shared/calculator-recipe-source';
import type { ResolvedRecipe } from '@mise/shared/calculator-recipe-source';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { ReorderRows } from '../recipes/ReorderRows';
import { Button } from '../ui/Button';
import { recipesPath } from './calculatorPath';
import { DecimalBox } from './DecimalBox';
import { ADD_RECIPE_ROW_OPENER, recipeOpener, useHandBack } from './handBack';
import { LeaveningBox } from './LeaveningBox';
import { useRecipesEditor } from './recipesEditorContext';
import { dropMove, isBlank, isEmptyRecipe, stepMove } from './recipesModel';
import type { DropPosition } from './recipesModel';
import type { EditableRecipe } from './recipesModel';
import { RecipesSaveButton } from './RecipesSaveButton';
import { SettingsPage } from './SettingsPage';
import { SourceBox } from './SourceBox';
import styles from './RecipeScreen.module.css';

// One recipe: its name, where its ingredients come from, the ingredients themselves and — for the logics that take
// orders — the leavening (a port of `renderRecipeDetail` in js/recipes.js). The edits go to the working copy held
// by RecipesEditor; Save and Back are the bar's.
//
// ⚠️ A RECIPE JUST ADDED AND LEFT UNTOUCHED IS NOT KEPT: leaving it (Back, or the browser's) asks «discard this new
// recipe?» and drops it. An address whose recipe the working copy does not have goes back to the list.
export function RecipeScreen({ recipeId }: { recipeId: string }) {
  const { t } = useT();
  const editor = useRecipesEditor();
  const handBack = useHandBack();
  const nameId = useId();
  const form = useRef<HTMLDivElement>(null);
  const recipe = editor.recipes.find(known => known.id === recipeId);
  const leaving = useRef(false);

  // Save found something missing and said so: the focus goes to the first marked field of the recipe it opened.
  const seenTick = useRef(editor.checkTick);
  useEffect(() => {
    if (editor.checkTick === seenTick.current) return;
    seenTick.current = editor.checkTick;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [editor.checkTick]);

  // What the list's row should do when Back lands on it.
  function handFocusToList(opener: string) {
    if (editor.cameFromList()) handBack.expect(opener);
  }

  // The bar's Back. The browser's own Back is the editor's blocker (RecipesEditor).
  //
  // ⚠️ `leaving` IS GIVEN BACK when the move is done: leaving the editor altogether (a recipe made by the work view's
  // door has no list behind it) can be refused by the unsaved-changes question, and Back must work again then.
  async function back() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      if (editor.freshId === recipeId && isEmptyRecipe(recipe)) {
        if (!(await editor.askDiscardNewRecipe())) return;
        editor.dropRecipe(recipeId);
        handFocusToList(ADD_RECIPE_ROW_OPENER);
      } else {
        editor.keep();
        handFocusToList(recipeOpener(recipeId));
      }
      editor.leaveToList();
    } finally {
      leaving.current = false;
    }
  }

  async function deleteRecipe() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      if (!(await editor.deleteRecipe(recipeId))) return;
      handFocusToList(ADD_RECIPE_ROW_OPENER);
      editor.leaveToList();
    } finally {
      leaving.current = false;
    }
  }

  if (!recipe) return editor.wasDropped(recipeId) ? null : <Navigate to={recipesPath} replace state={KEEP_FOCUS} />;

  const nameInvalid = editor.showErrors && isBlank(recipe.name);

  return (
    <SettingsPage
      title={t('calc.editRecipe')}
      fallback={recipesPath}
      onBack={() => { void back(); }}
      action={<RecipesSaveButton />}
    >
      <div ref={form} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>{t('calc.recipeName')}</label>
          <div className={styles.nameRow}>
            <input
              id={nameId}
              type="text"
              className={nameInvalid ? `${styles.input} ${styles.invalid}` : styles.input}
              value={recipe.name}
              placeholder={t('calc.recipeName')}
              autoComplete="off"
              aria-invalid={nameInvalid ? true : undefined}
              onChange={event => { editor.patch(recipeId, { name: event.target.value }); }}
            />
            <Button
              variant="bare"
              className={styles.del}
              aria-label={t('calc.deleteRecipe')}
              onPress={() => { void deleteRecipe(); }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>

        <SourceBox recipe={recipe} />

        <Ingredients recipe={recipe} />

        {usesOrders(recipe.logic) ? (
          <PartBoundary>
            <LeaveningBox recipe={recipe} />
          </PartBoundary>
        ) : null}
      </div>
    </SettingsPage>
  );
}

// The ingredients: the recipe's own rows to edit, or — when it is linked — the Catalogue's rows, read-only.
function Ingredients({ recipe }: { recipe: EditableRecipe }) {
  const { t } = useT();
  const editor = useRecipesEditor();
  const listId = useId();
  const headingId = useId();
  const [added, setAdded] = useState<number | null>(null);
  const linked = isLinked(recipe);

  // ── Reordering (current app 71627519): a MODE, as in the recipe book. Each row is a grip, its name and its grams — nothing
  // to type in, so nothing can change by accident while a row is carried. Turning it on or off is not an edit; a move is.
  // ⚠️ The rows have no identity of their own (a new one has no key yet), so while the mode is on each carries a number for
  // the grip's focus and for the drag: `order` holds those numbers in the rows' present order and moves with them.
  const hintId = useId();
  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<readonly number[]>([]);
  const [focusGrip, setFocusGrip] = useState<{ key: number } | null>(null);
  const reorderButton = useRef<HTMLButtonElement>(null);
  const count = recipe.ingredients.length;
  const ids = useMemo(() => (order.length === count ? order : Array.from({ length: count }, (_, index) => index)), [order, count]);
  const rows = useMemo(
    () => ids.map((key, index) => ({ key, row: { ...recipe.ingredients[index] } })),
    [ids, recipe.ingredients],
  );
  // A recipe that was linked, or lost rows, while the mode was on is no longer one to reorder.
  const canReorder = !linked && count > 1;
  const reorderOn = reordering && canReorder;

  // Save found a name missing: the mode ends so the blank box is there to be marked and reached (the reorder rows have no
  // name box to highlight).
  useEffect(() => {
    if (editor.showErrors) setReordering(false);
  }, [editor.showErrors]);

  // ⚠️ A linked recipe is read-only, so the mode must not outlive the change of source (current app 262efcfe): unlinked again
  // later, the recipe would otherwise come back already in the mode.
  useEffect(() => {
    if (!canReorder) setReordering(false);
  }, [canReorder]);

  const toggleReorder = () => {
    if (reorderOn) {
      setReordering(false);
      setFocusGrip(null);
      // ⚠️ THE FOCUS GOES TO THE BUTTON, not left where it was: a tap does not focus a button everywhere (Safari), so the
      // focus may still be on a grip that is about to go, and it would fall to the page's body.
      reorderButton.current?.focus();
      return;
    }
    setOrder(Array.from({ length: count }, (_, index) => index));
    setReordering(true);
    setFocusGrip({ key: 0 });
  };
  const go = (move: { from: number; to: number } | null, focus: number) => {
    if (move === null) return;
    editor.moveIngredient(recipe.id, move.from, move.to);
    setOrder(moveIngredient(ids, move.from, move.to));
    setFocusGrip({ key: focus });
  };
  const stepRow = (key: number, delta: -1 | 1) => { go(stepMove(ids, key, delta), key); };
  const dropRow = (moved: number, target: number, position: DropPosition) => { go(dropMove(ids, moved, target, position), moved); };

  if (linked) {
    const resolved = editor.resolved(recipe);
    return (
      <section className={styles.field} aria-labelledby={headingId}>
        <h3 id={headingId} className={styles.label}>{t('ui.ingredients')}</h3>
        {/* ⚠️ READ-ONLY, AND THAT IS THE POINT: the recipe is edited in the Catalogue and nowhere else. Two screens that
            can both change the same amounts is exactly the disagreement the link removes. */}
        {resolved.problem ? (
          <p className={styles.problem}>{problemText(t, resolved)}</p>
        ) : (
          <>
            <ul className={styles.readonly}>
              {resolved.ingredients.map((row, index) => (
                <li key={`${row.key}-${index}`} className={styles.readonlyRow}>
                  <span className={styles.readonlyName}>{row.label}</span>
                  <span className={styles.readonlyGrams}>{`${row.grams} g`}</span>
                </li>
              ))}
            </ul>
            <p className={styles.hint}>{t('calc.editedInCatalogue')}</p>
          </>
        )}
      </section>
    );
  }

  return (
    <section className={styles.field} aria-labelledby={headingId}>
      <div className={styles.ingHead}>
        <h3 id={headingId} className={styles.label}>{t('ui.ingredients')}</h3>
        {/* ABSENT, not disabled, with fewer than two rows: there is nothing to put in another order. */}
        {canReorder ? (
          <Button ref={reorderButton} variant="secondary" className={styles.reorder} aria-pressed={reorderOn} onPress={toggleReorder}>
            {t(reorderOn ? 'calc.reorderDone' : 'calc.reorderIngredients')}
          </Button>
        ) : null}
      </div>
      {reorderOn ? (
        <>
          <p id={hintId} className={styles.hint}>{t('calc.reorderHint')}</p>
          <div className={styles.reorderFrame}>
            <ReorderRows
              rows={rows}
              labelledBy={headingId}
              hintId={hintId}
              onDrop={dropRow}
              onStep={stepRow}
              focusGrip={focusGrip}
              moveLabel={name => t('calc.moveIngredient', { name })}
            />
          </div>
        </>
      ) : null}
      {reorderOn ? null : (
        <>
          <datalist id={listId}>
            {editor.ingredientNames.map(name => <option key={name} value={name} />)}
          </datalist>
          {recipe.ingredients.map((row, index) => {
            const invalid = editor.showErrors && isBlank(row.label);
            const n = index + 1;
            return (
              <div key={index} className={styles.card}>
                <div className={styles.nameRow}>
                  <input
                    type="text"
                    list={listId}
                    className={invalid ? `${styles.input} ${styles.invalid}` : styles.input}
                    value={row.label}
                    placeholder={t('calc.ingredient')}
                    aria-label={t('calc.ingredientN', { n })}
                    aria-invalid={invalid ? true : undefined}
                    autoComplete="off"
                    autoFocus={added === index}
                    onChange={event => { editor.patchIngredient(recipe.id, index, { label: event.target.value }); }}
                  />
                  <Button
                    variant="bare"
                    className={styles.del}
                    aria-label={t('calc.removeIngredientN', { n })}
                    onPress={() => { editor.removeIngredient(recipe.id, index); }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <div className={styles.withUnit}>
                  <DecimalBox
                    id={`${listId}-grams-${index}`}
                    className={styles.input}
                    value={row.grams}
                    min={0}
                    step={0.1}
                    inputMode="decimal"
                    label={t('calc.ingredientGramsN', { n })}
                    onText={text => { editor.patchIngredient(recipe.id, index, { grams: Number(text) || 0 }); }}
                  />
                  <span className={styles.unit} aria-hidden="true">g</span>
                </div>
                {usesOrders(recipe.logic) && row.key && recipe.leaveningKey === row.key ? (
                  // The answer is chosen once, in the Leavening box below; a row that IS the leavening says so quietly.
                  <p className={styles.hint}>{t('calc.thisIsTheLeavening')}</p>
                ) : null}
              </div>
            );
          })}
          <Button className={styles.add} onPress={() => { setAdded(editor.addIngredient(recipe.id)); }}>
            {t('calc.addIngredient')}
          </Button>
        </>
      )}
    </section>
  );
}

// Why a linked recipe cannot be read, as a sentence (the same words the Calculator's tab says).
function problemText(t: ReturnType<typeof useT>['t'], resolved: ResolvedRecipe): string {
  if (resolved.problem === 'unweighable') return t('calc.sourceUnweighable', { row: resolved.problemRow });
  if (resolved.problem === 'empty') return t('calc.sourceEmpty');
  return t('calc.sourceMissing');
}
