import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { catalogueChoices } from '@mise/shared/calculator-recipe-source';
import { withoutArchived } from '@mise/shared/recipe-shelf';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import type { StoredDoc } from './calculatorSource';
import { recipesPath } from './calculatorPath';
import { useRecipesEditor } from './recipesEditorContext';
import { SettingsPage } from './SettingsPage';
import styles from './AddRecipeScreen.module.css';

type Reading =
  | { status: 'loading' }
  | { status: 'failed' }
  // The rules refuse the list (the Recipe catalogue is closed to this account): not a connection problem, so the screen
  // offers only the new recipe instead of «check the connection».
  | { status: 'denied' }
  | { status: 'ready'; recipes: StoredDoc[]; allArchived: boolean };

// «Add a recipe» (a port of `renderSourceChooser` in js/recipes.js, current app a221c160): the recipe book's recipes by
// name, marked when the calculator already has one, and «New recipe, written here» last. It sits at /recipes/new, a level
// of its own between the list (or the work view's empty Calculator) and a recipe.
//
// Federico, 29 Oct 2026: «+ Add recipe» opened a blank recipe to type out, and the recipe book was only reachable through
// the second field of that blank form, which left the name empty so Save refused it.
//
// ⚠️ WHILE A PICK IS LINKING, THE WHOLE CHOICE WAITS (current app 97ac8fe3). On a slow line the wait can be 10 s, and a
// second tap (another recipe, or «new recipe») used to start a second piece of work that the first one's late answer then
// trampled. The buttons stay real buttons that ignore the tap (aria-disabled), so the focus stays where it was and a screen
// reader hears the status line.
// ⚠️ EVERY WAY OUT MAKES A LATE ANSWER STALE (`pick`), and the editor adds nothing for a stale pick (e0b92090).
export function AddRecipeScreen() {
  const { t } = useT();
  const editor = useRecipesEditor();
  const [reading, setReading] = useState<Reading>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const pick = useRef(0);
  useEffect(() => () => { pick.current += 1; }, []);

  // The editor hands back the SAME read to every caller, so a development double-mount reads the Catalogue once.
  const { loadCatalogue } = editor;
  useEffect(() => {
    let live = true;
    loadCatalogue().then(
      recipes => {
        if (!live) return;
        const offered = withoutArchived(recipes);
        setReading({ status: 'ready', recipes: offered, allArchived: recipes.length > 0 && offered.length === 0 });
      },
      (error: unknown) => {
        if (!live) return;
        setReading({ status: (error as { code?: unknown } | null)?.code === 'permission-denied' ? 'denied' : 'failed' });
      },
    );
    return () => { live = false; };
  }, [loadCatalogue]);

  const choices = reading.status === 'ready' ? catalogueChoices(reading.recipes, editor.recipes) : [];

  async function addFrom(source: StoredDoc) {
    if (busy) return;
    const mine = ++pick.current;
    setBusy(true);
    const result = await editor.addFromCatalogue(source, () => pick.current === mine);
    // Left the choice meanwhile (Back, Save, the screen closed): this pick is stale, its message included — it would be
    // about a choice no longer on screen.
    if (result.status === 'stale') return;
    setBusy(false);
    if (result.status === 'added') {
      editor.showRecipe(result.id);
      return;
    }
    await editor.say(t(result.message));
  }

  const made = useRef(false);
  function addBlank() {
    if (busy || made.current) return;
    made.current = true;
    editor.showRecipe(editor.addBlankRecipe());
  }

  return (
    <SettingsPage
      title={t('calc.addARecipe')}
      fallback={recipesPath}
      onBack={() => { pick.current += 1; editor.leaveToList(); }}
    >
      {reading.status === 'denied' ? null : <p className={styles.intro}>{t('calc.addFrom.intro')}</p>}

      {reading.status === 'denied' ? null : (
      <section className={styles.group} aria-labelledby={headingId}>
        <h3 id={headingId} className={styles.heading}>{t('calc.addFrom.catalogue')}</h3>
        {reading.status === 'loading' ? <p role="status" className={styles.note}>{t('calc.addFrom.loading')}</p> : null}
        <div role="alert">
          {reading.status === 'failed' ? <p className={styles.note}>{t('calc.addFrom.failed')}</p> : null}
        </div>
        {reading.status === 'ready' && reading.recipes.length === 0
          ? <p className={styles.note}>{t(reading.allArchived ? 'cat.shelf.allArchived' : 'calc.addFrom.none')}</p> : null}
        {choices.length > 0 ? (
          <ul className={styles.rows}>
            {choices.map(choice => {
              const source = reading.status === 'ready' ? reading.recipes.find(known => known.id === choice.id) : undefined;
              return (
                <li key={choice.id}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-disabled={busy ? true : undefined}
                    onClick={() => { if (source) void addFrom(source); }}
                  >
                    <span className={styles.text}>
                      <span className={styles.name}>{choice.name || t('calc.unnamedRecipe')}</span>
                      {choice.used ? <span className={styles.sub}>{t('calc.addFrom.used')}</span> : null}
                    </span>
                    <ChevronRight aria-hidden="true" className={styles.chevron} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      )}
      {/* Present before it has anything to say, so a screen reader hears it when a pick starts linking. */}
      <div role="status" className={styles.status}>{busy ? t('calc.addFrom.linking') : ''}</div>

      <Button className={styles.blank} isDisabled={busy} onPress={addBlank}>
        {t('calc.addFrom.blank')}
      </Button>
    </SettingsPage>
  );
}
