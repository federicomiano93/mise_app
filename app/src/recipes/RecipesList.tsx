import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { filterByName, sortByUsage } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { recipeOpener, useHandBack } from './handBack';
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
export function RecipesList({ openRecipeId, split, onOpenRecipe }: Props) {
  const { t } = useT();
  const store = useRecipesStore();
  const handBack = useHandBack();
  const { recipes, recipesLoaded, usage } = useRecipes();

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

  const press = (id: string) => {
    // The recipe that is already open stays as it is: nothing to open, nothing to count.
    if (id === openRecipeId) return;
    // Held BEFORE the count goes up, so the tapped row does not jump while the recipe opens. (Already
    // held, when another recipe is open: those older counts stay in charge.)
    if (split && held === null) setHeld(usage);
    store.bumpUsage(id);
    onOpenRecipe(id);
  };

  return (
    <div className={styles.column}>
      <div className={styles.search}>
        <Search aria-hidden="true" />
        <input
          type="search"
          autoComplete="off"
          className={styles.input}
          aria-label={t('cat.searchARecipeBy')}
          placeholder={t('cat.searchARecipe')}
          value={text}
          onChange={event => { setText(event.target.value); }}
        />
      </div>

      {!recipesLoaded ? (
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      ) : recipes.length === 0 ? (
        // No recipes at all: the empty state. (Its «Add a recipe» button arrives with writing recipes,
        // step 3d-6.)
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('calc.noRecipesYet')}</p>
          <p className={styles.emptySub}>{t('cat.empty.sub')}</p>
        </div>
      ) : visible.length === 0 ? (
        // A search that matches nothing stays a small line under the box.
        <p className={styles.nothing}>{t('cat.noRecipeMatchesYour')}</p>
      ) : (
        <ul className={styles.rows}>
          {visible.map(recipe => (
            <RecipeRow
              key={recipe.id}
              id={recipe.id}
              name={recipe.name === '' ? t('cat.noName') : recipe.name}
              isOpen={recipe.id === openRecipeId}
              onPress={press}
              register={handBack.register}
            />
          ))}
        </ul>
      )}
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
