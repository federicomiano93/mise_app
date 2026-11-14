import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { Ref } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { ingredientBook, searchBook } from '@mise/shared/ingredient-usage';
import type { IngredientEntry, IngredientUse } from '@mise/shared/ingredient-usage';
import { useT } from '../i18n/useT';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { FormBar } from '../ui/FormBar';
import { ingredientUseOpener, useHandBack } from './handBack';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { amountNumber, unitWord } from './recipeAmounts';
import styles from './IngredientBook.module.css';

type Props = {
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
  // A recipe was tapped under an ingredient: the section opens it one level down.
  onOpenRecipe: (ingredientId: string, recipeId: string) => void;
};

// The ingredients a person has open and what they searched for, kept while the page is loaded: the book is unmounted while a
// recipe opened from it is on screen, and Back must find the same ingredient open, behind the same search, with its line there to
// take the focus (handBack.ts). Nothing in it names a venue or a person; a page reload starts it again.
let remembered: ReadonlySet<string> = new Set();
let rememberedQuery = '';

// For specs, which draw many apps in one page.
export function forgetOpenIngredients(): void {
  remembered = new Set();
  rememberedQuery = '';
}

// The ingredient book (part 2 of the owner's plan, 14 Nov 2026; NEW IN MISE 2, no original): every ingredient, and under each the
// recipes that use it with how much is in each, as written. Read-only. Drawn like the HACCP list — the right-hand pane on the
// split, a screen of its own on a phone, one level below the recipe list — and reached from a door at the foot of that list
// (not from the app's menu: the tablet's rail is full).
//
// ⚠️ IT READS WHAT THE SECTION ALREADY HOLDS (the store's recipes and ingredients; the ingredients carry no price), so it starts no
// listener of its own. What counts is shared/src/ingredient-usage.ts: only rows LINKED to the ingredient, and only DIRECT uses.
// ⚠️ THE ROWS WAIT FOR BOTH LISTS: drawn before the ingredients arrive, every ingredient would read «not in any recipe».
export function IngredientBook({ titleRef, onBack, onOpenRecipe }: Props) {
  const { t, locale } = useT();
  const handBack = useHandBack();
  const store = useRecipesStore();
  const { recipes, recipesLoaded, ingredients, ingredientsLoaded, ingredientsUnreadable } = useRecipes();
  const [query, setQueryState] = useState(rememberedQuery);
  const setQuery = (text: string) => { rememberedQuery = text; setQueryState(text); };
  // ⚠️ THE LIVE REGION IS DRAWN EMPTY FIRST and filled once mounted: text already in it when it appears is not announced, and the
  // ingredients may be known unreadable before the book opens (the store starts with the section). Only that failure is said here:
  // a broken recipe stream is said by the section itself (recipes-stream-broken), once.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [open, setOpen] = useState<ReadonlySet<string>>(remembered);
  const titleId = useId();

  const ingredientList = useMemo(() => Object.values(ingredients), [ingredients]);
  const book = useMemo(() => ingredientBook(recipes, ingredientList, locale), [recipes, ingredientList, locale]);
  const shown = useMemo(() => searchBook(book, ingredientList, query), [book, ingredientList, query]);
  const used = shown.filter(entry => entry.uses.length > 0);
  const unused = shown.filter(entry => entry.uses.length === 0);
  // The fold opens by itself when a search finds only ingredients that are in it.
  const fold = useFoldedOpen(query.trim() !== '' && used.length === 0 && unused.length > 0);
  const ready = recipesLoaded && ingredientsLoaded;

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    remembered = next;
    setOpen(next);
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={onBack} title={t('ib.title')} titleId={titleId} titleRef={titleRef} />
      <div className={styles.body}>
        <p className={styles.lead}>{t('ib.lead')}</p>
        {/* Present (empty) before it speaks: a list that cannot be read says so here. */}
        <p role="status" className={styles.status}>{mounted && ingredientsUnreadable ? t('ib.error') : ''}</p>
        {!ready ? (
          <p className={styles.nothing} aria-busy="true">{t('session.loading')}</p>
        ) : (
          <>
            <div className={styles.search}>
              <Search aria-hidden="true" />
              <input
                type="search"
                autoComplete="off"
                className={styles.input}
                aria-label={t('ib.search')}
                placeholder={t('ib.search')}
                value={query}
                onChange={event => { setQuery(event.target.value); }}
              />
            </div>

            {/* «No ingredients yet» only when that is the truth: not when they simply could not be read (said above). */}
            {book.length === 0 && !ingredientsUnreadable ? <p className={styles.nothing}>{t('ib.empty')}</p> : null}
            {book.length > 0 && shown.length === 0 ? <p className={styles.nothing}>{t('ib.noMatch', { query: query.trim() })}</p> : null}
            {used.length > 0 ? (
              <ul className={styles.list} aria-labelledby={titleId}>
                {used.map(entry => (
                  <Entry
                    key={entry.id}
                    entry={entry}
                    open={open.has(entry.id)}
                    onToggle={() => { toggle(entry.id); }}
                    onOpenRecipe={recipeId => {
                      // Counted for «most opened first», as a recipe opened from the Allergen sheet is.
                      store.bumpUsage(recipeId);
                      onOpenRecipe(entry.id, recipeId);
                    }}
                    register={handBack.register}
                  />
                ))}
              </ul>
            ) : null}
            {unused.length > 0 ? (
              <FoldedGroup title={t('ib.unused', { n: unused.length })} open={fold.open} onToggle={fold.onToggle}>
                <ul className={styles.unusedList}>
                  {unused.map(entry => (
                    <li key={entry.id} className={styles.unusedRow}>
                      <span>{entry.name === '' ? t('cat.noName') : entry.name}</span>
                      {entry.inactive ? <span className={styles.tag}>{t('ib.notInUse')}</span> : null}
                    </li>
                  ))}
                </ul>
              </FoldedGroup>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

// One ingredient: a button that opens and closes its recipes (a disclosure: aria-expanded, and the list it controls), then the list.
function Entry({ entry, open, onToggle, onOpenRecipe, register }: {
  entry: IngredientEntry;
  open: boolean;
  onToggle: () => void;
  onOpenRecipe: (recipeId: string) => void;
  register: (name: string, node: HTMLElement | null) => void;
}) {
  const { t } = useT();
  const listId = useId();
  const name = entry.name === '' ? t('cat.noName') : entry.name;
  return (
    <li className={styles.entry}>
      <button type="button" className={styles.head} aria-expanded={open} aria-controls={listId} onClick={onToggle}>
        <ChevronDown aria-hidden="true" className={styles.chevron} />
        <span className={styles.name}>{name}</span>
        {entry.inactive ? <span className={styles.tag}>{t('ib.notInUse')}</span> : null}
        <span className={styles.count}>{t('ib.recipeCount', { n: entry.uses.length })}</span>
      </button>
      <ul id={listId} className={styles.uses} hidden={!open}>
        {entry.uses.map(use => (
          <Use key={use.recipeId} ingredientId={entry.id} use={use} visible={open} onOpen={onOpenRecipe} register={register} />
        ))}
      </ul>
    </li>
  );
}

// One recipe under an ingredient: its name (and «archived»), the amounts, a chevron; the whole line a button that opens the recipe.
// Back from that recipe hands the focus back to it.
function Use({ ingredientId, use, visible, onOpen, register }: {
  ingredientId: string;
  use: IngredientUse;
  // ⚠️ A LINE INSIDE A CLOSED INGREDIENT IS NOT REGISTERED for the hand-back: a hidden button cannot take the focus, and a
  // registered one would stop the hand-back from falling back to something that can.
  visible: boolean;
  onOpen: (recipeId: string) => void;
  register: (name: string, node: HTMLElement | null) => void;
}) {
  const { t, locale } = useT();
  const opener = useCallback((node: HTMLButtonElement | null) => {
    register(ingredientUseOpener(ingredientId, use.recipeId), visible ? node : null);
  }, [register, ingredientId, use.recipeId, visible]);
  // «800 g», «0,8 kg», «200 g + 20 g», «to taste»: each row as the recipe writes it, with the Recipe book's own number rule.
  const amounts = use.rows.map(row => (row.unit === 'to taste' ? unitWord(t, row.unit) : `${amountNumber(row.amount, row.unit, locale)} ${unitWord(t, row.unit)}`))
    .join(' + ');
  return (
    <li>
      <button ref={opener} type="button" className={styles.use} onClick={() => { onOpen(use.recipeId); }}>
        <span className={styles.recipe}>
          <span className={styles.recipeName}>{use.recipeName === '' ? t('cat.noName') : use.recipeName}</span>
          {use.archived ? <span className={styles.tag}>{t('ib.archived')}</span> : null}
        </span>
        <span className={styles.amount}>{amounts}</span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </button>
    </li>
  );
}
