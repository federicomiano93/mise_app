import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, Settings, Wheat } from 'lucide-react';
import { filterByName, sortByUsage } from '@mise/shared/catalogue-model';
import { isArchivedRecipe, shelveRecipes, sortedCategories } from '@mise/shared/recipe-shelf';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { ALLERGENS_OPENER, NEW_OPENER, SEARCH_OPENER, SETTINGS_OPENER, recipeOpener, useHandBack } from './handBack';
import styles from './RecipesList.module.css';

// The current app's debounce: the box tells the list what is typed on every keystroke, and the cards
// are repainted 140 ms after the last one, so a long catalogue is not rebuilt letter by letter.
export const SEARCH_DEBOUNCE_MS = 140;

type Props = {
  // The recipe open beside the list (the tablet's split), marked as the current one.
  openRecipeId: string | null;
  // Whether the section is the split: only then does the order hold still while a recipe is open.
  split: boolean;
  onOpenRecipe: (id: string) => void;
  // The Allergen sheet is the screen shown (beside the list, or instead of it).
  sheetOpen: boolean;
  // The door to the Allergen sheet, at the foot of the list.
  onOpenSheet: () => void;
  // The label Settings are the screen shown, and the door to them at the foot of the list.
  settingsOpen: boolean;
  onOpenSettings: () => void;
  // A new recipe's editor is the screen shown, and the button above the list that opens it (step 3d-6).
  newOpen: boolean;
  onNew: () => void;
};

// The left column: a search box over the recipes, name only, most opened first.
//
// ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT. It is a controlled input in a component
// that stays mounted, and only the rows below it are redrawn: a snapshot landing mid-keystroke must
// find the text and the keyboard where the person left them.
//
// ⚠️ WHILE A RECIPE IS OPEN BESIDE THE LIST THE COUNTS THAT DECIDE THE ORDER ARE FROZEN. Opening a
// recipe counts as one more open of it, and re-sorting the rows under a finger that is about to open
// another is the worst moment for it. The counts that were current when the recipe opened (or when
// the split began) stay in charge of the order until the list is shown alone again or the split is
// left; the fresh ones apply then.
export function RecipesList({ openRecipeId, split, onOpenRecipe, sheetOpen, onOpenSheet, settingsOpen, onOpenSettings, newOpen, onNew }: Props) {
  const { t, locale } = useT();
  const { location, canManage } = useSession();
  const store = useRecipesStore();
  const handBack = useHandBack();
  const doorOpener = useCallback((node: HTMLButtonElement | null) => { handBack.register(ALLERGENS_OPENER, node); }, [handBack]);
  const settingsDoor = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);
  const newDoor = useCallback((node: HTMLButtonElement | null) => { handBack.register(NEW_OPENER, node); }, [handBack]);
  const searchOpener = useCallback((node: HTMLInputElement | null) => { handBack.register(SEARCH_OPENER, node); }, [handBack]);
  const { recipes, recipesLoaded, usage, categories } = useRecipes();

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(text); }, SEARCH_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); };
  }, [text]);

  // The counts held still for the order, or null while the order follows the live ones.
  const [held, setHeld] = useState<Readonly<Record<string, number>> | null>(null);
  const [lastOpen, setLastOpen] = useState(openRecipeId);
  if (lastOpen !== openRecipeId) {
    setLastOpen(openRecipeId);
    // The recipe closed: the list is alone again, and the fresh counts apply.
    if (openRecipeId === null && held !== null) setHeld(null);
  }
  // The split was left (a phone hides the list while a recipe is open, and shows it fresh on Back).
  if (!split && held !== null) setHeld(null);
  // A recipe opened by its address beside the list: the counts as they are now stay in charge.
  if (split && openRecipeId !== null && held === null) setHeld(usage);
  const orderUsage = held ?? usage;

  const visible = useMemo(
    () => sortByUsage(filterByName(recipes, query), orderUsage),
    [recipes, query, orderUsage],
  );
  // The rows laid out on the shelf: under the venue's category words (alphabetical in the interface language), the recipes in
  // none last, and the archived ones apart for the folded group at the foot. Inside a group the order stays «most used first».
  const shelf = useMemo(() => shelveRecipes(visible, sortedCategories(categories, locale)), [visible, categories, locale]);
  // ⚠️ The folded «Archived» group opens by itself when a search finds an archived recipe or the recipe open beside the list is
  // archived (its row must be able to take the focus), and stays as the person left it otherwise.
  const openIsArchived = openRecipeId !== null && recipes.some(recipe => recipe.id === openRecipeId && isArchivedRecipe(recipe));
  const fold = useFoldedOpen(openIsArchived || (query.trim() !== '' && shelf.archived.length > 0));

  const press = (id: string) => {
    // The recipe that is already open stays as it is: nothing to open, nothing to count.
    if (id === openRecipeId) return;
    // Held BEFORE the count goes up, so the tapped row does not jump while the recipe opens. (Already
    // held, when another recipe is open: those older counts stay in charge.)
    if (split && held === null) setHeld(usage);
    store.bumpUsage(id);
    onOpenRecipe(id);
  };

  const rowOf = (recipe: (typeof visible)[number]) => (
    <RecipeRow
      key={recipe.id}
      id={recipe.id}
      name={recipe.name === '' ? t('cat.noName') : recipe.name}
      isOpen={recipe.id === openRecipeId}
      onPress={press}
      register={handBack.register}
    />
  );

  return (
    <div className={styles.column}>
      {/* The search box and the button that makes a recipe: side by side on the tablet's split, one under the other on a phone
          (RecipesList.module.css). The button is for everybody who sees the section — employees write recipes too — and it
          stands also over «No recipes yet». */}
      <div className={styles.top}>
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <input
            ref={searchOpener}
            type="search"
            autoComplete="off"
            className={styles.input}
            aria-label={t('cat.searchARecipeBy')}
            placeholder={t('cat.searchARecipe')}
            value={text}
            onChange={event => { setText(event.target.value); }}
          />
        </div>
        <Button
          ref={newDoor}
          variant="primary"
          className={styles.newRecipe}
          aria-current={newOpen ? 'true' : undefined}
          onPress={onNew}
        >
          <Plus aria-hidden="true" />
          <span>{t('cat.newRecipe')}</span>
        </Button>
      </div>

      {!recipesLoaded ? (
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      ) : recipes.length === 0 ? (
        // No recipes at all: the empty state. The «New recipe» button above it is the way to the first one.
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('calc.noRecipesYet')}</p>
          <p className={styles.emptySub}>{t('cat.empty.sub')}</p>
        </div>
      ) : visible.length === 0 ? (
        // A search that matches nothing stays a small line under the box.
        <p className={styles.nothing}>{t('cat.noRecipeMatchesYour')}</p>
      ) : (
        <>
          {/* No category in use: the list is drawn as it always was, with no heading. */}
          {shelf.groups.length === 1 && shelf.groups[0]?.category === '' ? (
            <ul className={styles.rows}>{shelf.groups[0].recipes.map(rowOf)}</ul>
          ) : (
            shelf.groups.map(group => (
              <div key={group.category} className={styles.group}>
                <h2 className={styles.groupTitle}>{group.category === '' ? t('cat.shelf.noCategory') : group.category}</h2>
                <ul className={styles.rows}>{group.recipes.map(rowOf)}</ul>
              </div>
            ))
          )}
          {/* Everybody sees the fold: an employee may open an archived recipe to print its label. */}
          {shelf.archived.length > 0 ? (
            <FoldedGroup title={t('cat.shelf.archivedGroup', { n: shelf.archived.length })} open={fold.open} onToggle={fold.onToggle}>
              <ul className={styles.rows}>{shelf.archived.map(rowOf)}</ul>
            </FoldedGroup>
          ) : null}
        </>
      )}

      {/* ⚠️ THE DOOR TO THE ALLERGEN SHEET EXISTS ONLY FOR A VENUE THAT TRACKS ALLERGENS (read here on every render; the venue
          document is read once when the venue opens, so a switch thrown on another phone is seen after a reload, like
          the rest of Mise 2). It stands at the foot of the list, where the
          current app's footer button sits. */}
      {allergensOn(location) ? (
        <Button
          ref={doorOpener}
          variant="secondary"
          className={styles.door}
          aria-current={sheetOpen ? 'true' : undefined}
          onPress={onOpenSheet}
        >
          <Wheat aria-hidden="true" />
          <span>{t('cat.allergenSheet')}</span>
        </Button>
      ) : null}

      {/* ⚠️ THE DOOR TO THE LABEL SETTINGS EXISTS ONLY FOR WHOEVER RUNS THE PLACE (owner or manager): a screen of switches
          that an employee could not save would be worse than no screen. The address is checked again by the section, and
          the rules are the real guard. */}
      {canManage ? (
        <Button
          ref={settingsDoor}
          variant="secondary"
          className={styles.door}
          aria-current={settingsOpen ? 'true' : undefined}
          onPress={onOpenSettings}
        >
          <Settings aria-hidden="true" />
          <span>{t('ui.settings')}</span>
        </Button>
      ) : null}
    </div>
  );
}

type RowProps = {
  id: string;
  name: string;
  isOpen: boolean;
  onPress: (id: string) => void;
  register: (name: string, node: HTMLElement | null) => void;
};

// One recipe: its name and a chevron. The whole row is the button.
function RecipeRow({ id, name, isOpen, onPress, register }: RowProps) {
  // Back from this recipe's screen hands the focus back to this button.
  const opener = useCallback((node: HTMLButtonElement | null) => { register(recipeOpener(id), node); }, [register, id]);
  return (
    <li className={styles.item}>
      <button
        ref={opener}
        type="button"
        className={styles.row}
        aria-current={isOpen ? 'true' : undefined}
        data-open={isOpen}
        onClick={() => { onPress(id); }}
      >
        <span className={styles.name}>{name}</span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </button>
    </li>
  );
}
