import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { withoutArchived } from '@mise/shared/recipe-shelf';
import { useT } from '../i18n/useT';
import { useAllergenTables } from '../recipes/allergenTables';
import { isInBook } from '../recipes/labelTexts';
import { COPY_WAIT_MS } from '../recipes/RecipeEditorScreen';
import { useRecipes, useRecipesStore } from '../recipes/RecipesContext';
import { markBusy } from '../session/busy';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useConfirm } from '../ui/useConfirm';
import { ALLERGEN_BOOK_PATH } from './allergenBookPath';
import { cameFromBook } from './allergenBookNav';
import { isBookComplete } from './bookEntry';
import { chooseShelf } from './bookShelf';
import styles from './ChooseScreen.module.css';

// «Prodotti nel libro», the pencil screen: whoever runs the place ticks the products that go in the allergen book. The app's own
// editing pattern (P20), as StepsEditor.tsx has it: a working COPY made once, nothing is written before Save, Save asks first, and
// leaving with unsaved ticks asks too.
//
// ⚠️ THE WORKING COPY STARTS FROM THE STORED FLAGS WITH THE REFUSED CHOICES LAID OVER THEM (D7): a save the database refused keeps the
// person's ticks in the store's memory (refusedBookChoices), and this screen reopens from them, dirty, so one tap on Save tries again.
//
// ⚠️ ARCHIVED RECIPES ARE NOT OFFERED and never touched: they keep their flag, and are hidden from the book while archived.
//
// ⚠️ SAVE IS NOT AWAITED: saveBookChoices is local-first and, offline, its promise waits for the network. The screen returns to the
// book at once; a refusal is said in the section's status line.
//
// NOT a label file: «allergens incomplete» is the interface's sentence, and the decision behind it is bookEntry.ts's (isBookComplete).
type Working = { readonly start: ReadonlySet<string>; readonly chosen: ReadonlySet<string>; readonly forced: boolean };

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every(id => b.has(id));

export function ChooseScreen() {
  const { t, locale } = useT();
  const store = useRecipesStore();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { recipes, recipesFromServer, streamBroken, ingredients, ingredientsLoaded, categories } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const [confirm, confirmDialog] = useConfirm();
  const titleId = useId();
  const rowIds = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState<Working | null>(null);

  // ⚠️ THE COPY IS MADE ON THE SERVER'S WORD, NOT ON THE PHONE'S LOCAL COPY (as StepsEditorScreen does): the local copy can be older than a
  // colleague's change, and a working copy made from it would remove their product at Save. With no signal (or a stream that died) it is
  // made after COPY_WAIT_MS on what this phone holds. Until then the screen says «Loading…».
  const settled = recipesFromServer || streamBroken;
  const [patienceOver, setPatienceOver] = useState(false);
  useEffect(() => {
    if (settled || patienceOver) return undefined;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPatienceOver(true);
      return undefined;
    }
    const timer = window.setTimeout(() => { setPatienceOver(true); }, COPY_WAIT_MS);
    return () => { window.clearTimeout(timer); };
  }, [settled, patienceOver]);

  // Made once. `start` is what was stored at that moment: Save writes only the products whose tick differs from it, so a change made
  // by somebody else since then is never undone by a tick the person did not touch.
  useEffect(() => {
    if (working !== null || !(settled || patienceOver)) return;
    const start = new Set(withoutArchived(recipes).filter(isInBook).map(recipe => recipe.id));
    const chosen = new Set(start);
    const refused = store.refusedBookChoices();
    for (const [id, wanted] of refused) {
      if (wanted) chosen.add(id);
      else chosen.delete(id);
    }
    setWorking({ start, chosen, forced: refused.size > 0 });
  }, [working, settled, patienceOver, recipes, store]);
  // The choices the database refused are in the working copy now: the store forgets them, so they come back once, not for ever.
  // A separate effect (not in the one above): Strict Mode runs that one twice before the state is set.
  useEffect(() => {
    if (working !== null) store.forgetRefusedBookChoices();
  }, [working, store]);

  const dirty = working !== null && (working.forced || !sameSet(working.start, working.chosen));
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; });
  // Unsaved ticks: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Set once the choices are saved or the person has left on purpose, so leaving asks nothing.
  const leavingClean = useRef(false);
  const busy = useRef(false);
  const askingLeave = useRef(false);

  // One level up: the book. The browser's Back when the book is the entry behind this one, otherwise this entry is replaced by it (a
  // page opened by its address).
  const fromBook = cameFromBook(state);
  const leave = useCallback(() => {
    if (fromBook) void navigate(-1);
    else void navigate(ALLERGEN_BOOK_PATH, { replace: true, state: KEEP_FOCUS });
  }, [navigate, fromBook]);

  const discardQuestion = () => confirm({
    title: t('cat.discardChanges'),
    message: t('allergenBook.choose.discardBody'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's Back, the rail and the tab bar all
  // navigate. Staying on the same address is never blocked.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      askingLeave.current = false;
      return;
    }
    if (askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        // The screen went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } catch (error) {
        askingLeave.current = false;
        throw error;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker fails silently on a
  // POP to an entry it did not create (a page opened by its address).
  async function back() {
    if (busy.current || askingLeave.current) return;
    if (dirtyRef.current) {
      busy.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        busy.current = false;
      }
    }
    leavingClean.current = true;
    leave();
  }

  // What Save would change: every recipe on offer whose tick differs from what it was when the copy was made, with the ticked value.
  function changes(): Array<{ id: string; inBook: boolean }> {
    if (working === null) return [];
    return withoutArchived(recipes)
      .filter(recipe => working.chosen.has(recipe.id) !== working.start.has(recipe.id))
      .map(recipe => ({ id: recipe.id, inBook: working.chosen.has(recipe.id) }));
  }

  async function save() {
    if (working === null || busy.current || askingLeave.current || leavingClean.current) return;
    const changed = changes();
    if (changed.length > 0) {
      busy.current = true;
      let yes = false;
      try {
        yes = await confirm({
          title: t('allergenBook.choose.confirm.title'),
          message: t('allergenBook.choose.confirm.message', { n: working.chosen.size }),
          okLabel: t('ui.save'),
          cancelLabel: t('common.cancel'),
        });
      } finally {
        busy.current = false;
      }
      if (!yes || !mounted.current) return;
      // Local-first: the book shows the change at once. NOT awaited (offline it waits for the network).
      void store.saveBookChoices(changed);
    }
    leavingClean.current = true;
    leave();
  }

  const toggle = (id: string) => {
    setWorking(current => {
      if (current === null) return current;
      const chosen = new Set(current.chosen);
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      return { ...current, chosen };
    });
  };

  // Which recipes cannot have their label made today (only once the ingredients have answered: before that every row would read
  // «not declared» only because nothing had come yet).
  const incompleteIds = useMemo(() => {
    const ids = new Set<string>();
    if (!ingredientsLoaded) return ids;
    for (const recipe of withoutArchived(recipes)) if (!isBookComplete(recipe, tables)) ids.add(recipe.id);
    return ids;
  }, [ingredientsLoaded, recipes, tables]);

  const groups = useMemo(() => chooseShelf(recipes, categories, locale, query), [recipes, categories, locale, query]);
  const offered = withoutArchived(recipes).length;

  // Opened from the book (KEEP_FOCUS: the page leaves the focus alone): the focus goes to this screen's title. Opened by its address: left
  // to the skip link.
  useEffect(() => { if (fromBook) title.current?.focus(); }, []);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t('allergenBook.choose.title')}
        titleId={titleId}
        titleRef={title}
        action={<Button variant="primary" isDisabled={working === null} onPress={() => { void save(); }}>{t('ui.save')}</Button>}
      />
      <div className={styles.body}>
        <p className={styles.count} role="status" aria-live="polite">
          {t('allergenBook.choose.count', { n: working?.chosen.size ?? 0 })}
        </p>
        {working === null ? (
          <p className={styles.quiet} aria-busy="true">{t('session.loading')}</p>
        ) : (
          <>
            <div className={styles.search}>
              <Search aria-hidden="true" />
              <input
                type="search"
                autoComplete="off"
                className={styles.input}
                aria-label={t('cat.searchARecipeBy')}
                placeholder={t('cat.searchARecipe')}
                value={query}
                onChange={event => { setQuery(event.target.value); }}
              />
            </div>
            {offered === 0 ? (
              <p className={styles.quiet}>{t('cat.noRecipesYet')}</p>
            ) : groups.length === 0 ? (
              <p className={styles.quiet}>{t('cat.noRecipeMatchesYour')}</p>
            ) : groups.map(group => (
              <section key={group.category} className={styles.group}>
                {group.category !== '' || groups.length > 1 ? (
                  <h2 className={styles.category}>{group.category === '' ? t('cat.shelf.noCategory') : group.category}</h2>
                ) : null}
                <ul className={styles.rows}>
                  {group.recipes.map(recipe => {
                    const nameId = `${rowIds}-${recipe.id}-name`;
                    const noteId = `${rowIds}-${recipe.id}-note`;
                    const incomplete = incompleteIds.has(recipe.id);
                    return (
                      <li key={recipe.id} className={styles.item}>
                        <label className={styles.row}>
                          <input
                            type="checkbox"
                            className={styles.box}
                            checked={working.chosen.has(recipe.id)}
                            aria-labelledby={nameId}
                            aria-describedby={incomplete ? noteId : undefined}
                            onChange={() => { toggle(recipe.id); }}
                          />
                          <span id={nameId} className={styles.name}>{recipe.name === '' ? t('cat.noName') : recipe.name}</span>
                          {incomplete ? <span id={noteId} className={styles.incomplete}>{t('allergenBook.choose.incomplete')}</span> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
      {confirmDialog}
    </section>
  );
}
