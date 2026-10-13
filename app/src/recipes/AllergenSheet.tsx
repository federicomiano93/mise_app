import { useCallback, useId, useMemo, useState } from 'react';
import type { Ref } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { ALLERGEN_GROUPS } from '@mise/shared/allergen-model';
import { filterByName } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import {
  allergenGroupCodes, allergenGroupName, allergenName, canPrintLabel, countryOf, outputLanguage,
} from '@mise/shared/market';
import type { Country } from '@mise/shared/market';
import {
  blockingIngredients, recipeAllergens, rowIsBlocked, rowState, unlinkedRowNames,
} from '@mise/shared/recipe-allergen-model';
import type { RecipeAllergens, RowState } from '@mise/shared/recipe-allergen-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { FormBar } from '../ui/FormBar';
import { useAllergenTables } from './allergenTables';
import { incompleteSentence } from './allergenText';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { sheetOpener, useHandBack } from './handBack';
import styles from './AllergenSheet.module.css';

// Six, not twelve: a plan longer than a glance turns back into the flat list it exists to replace.
const WORK_LIMIT = 6;

// «in the United Kingdom» / «in Italy»: the whole phrase per country, because Italian takes the article for one
// and not the other. KEYS, resolved while drawing.
const COUNTRY_IN: Readonly<Record<Country, MessageKey>> = { GB: 'country.GB.in', IT: 'country.IT.in' };

type Props = {
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
  // A recipe was tapped: the section opens it one level down.
  onOpenRecipe: (id: string) => void;
};

// The Allergen sheet: the screen you CONSULT about allergens, plus the work list that says which ingredients to
// declare first. Top to bottom: what the LAW requires here · where things stand · a search · the work · every recipe
// with its state · the caveat.
//
// ⚠️ EVERY VERDICT COMES FROM THE SHARED MODEL: a row's state is `rowState(recipeAllergens(...))` and whether it is
// blocked is `rowIsBlocked(state)`. This file has no `canLabel` and no `allergens.length` of its own to disagree with
// them, on the screen somebody opens to find out whether they can serve a customer.
//
// ⚠️ UNTIL THE INGREDIENTS HAVE ARRIVED the sheet gives no count, no work list and no state: every linked row would
// read «not declared» only because nothing had come yet. A neutral line stands in their place.
//
// ⚠️ THE SEARCH IS ITS OWN and by recipe NAME only, never the list's query and never by allergen: with nothing declared,
// «nuts» would find zero recipes, and an empty result on an allergen search reads as «nothing here contains nuts».
// A snapshot repaints counts, lists and rows; the search box stays mounted with its text and its focus.
export function AllergenSheet({ titleRef, onBack, onOpenRecipe }: Props) {
  const { t } = useT();
  const store = useRecipesStore();
  const handBack = useHandBack();
  const { recipes, recipesLoaded, ingredients, ingredientsLoaded } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const [query, setQuery] = useState('');
  const titleId = useId();

  const rows = useMemo(
    () => recipes.map(recipe => {
      const result = recipeAllergens(recipe, tables);
      return { recipe, result, state: rowState(result) };
    }),
    [recipes, tables],
  );

  // The counts describe the WHOLE catalogue, never the filtered slice: a summary that changed while you typed would be
  // answering a different question from the one it is labelled with.
  const declaredCount = rows.filter(row => !rowIsBlocked(row.state)).length;
  const blockedCount = rows.length - declaredCount;

  const searching = query.trim() !== '';
  const shown = useMemo(() => {
    const keep = new Set(filterByName(recipes, query));
    return rows.filter(row => keep.has(row.recipe));
  }, [rows, recipes, query]);

  // ⚠️ BLOCKED RECIPES FIRST, then declared, each by name: an alphabetical list buries the ones with no answer among the
  // ones that have one. The search filters WITHIN that order. Until the ingredients have arrived nothing is blocked yet,
  // so the order is by name alone.
  const ordered = useMemo(() => {
    const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      a.recipe.name.localeCompare(b.recipe.name);
    if (!ingredientsLoaded) return [...shown].sort(byName);
    return [
      ...shown.filter(row => rowIsBlocked(row.state)).sort(byName),
      ...shown.filter(row => !rowIsBlocked(row.state)).sort(byName),
    ];
  }, [shown, ingredientsLoaded]);

  const unknownName = t('cat.unknownIngredient');
  const unlinked = useMemo(() => unlinkedRowNames(recipes), [recipes]);
  const work = useMemo(
    () => blockingIngredients(recipes, tables, unknownName),
    [recipes, tables, unknownName],
  );

  const open = (id: string) => {
    store.bumpUsage(id);
    onOpenRecipe(id);
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={onBack} title={t('cat.allergenSheet')} titleId={titleId} titleRef={titleRef} />
      <div className={styles.body}>
        <LawCard />

        {!recipesLoaded ? (
          <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        ) : (
          <>
            <div className={styles.summary}>
              {ingredientsLoaded ? (
                <>
                  <p className={styles.count}>{t('cat.sheet.declaredCount', { n: declaredCount, total: rows.length })}</p>
                  {rows.length === 0 ? null : (
                    <p className={styles.sub}>
                      {blockedCount > 0 ? t('cat.sheet.blockedCount', { n: blockedCount }) : t('cat.everyRecipeCanBe')}
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
              )}
            </div>

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

            {/* ⚠️ HIDDEN WHILE SEARCHING: these describe the whole catalogue, and left up over a filtered list of one
                recipe they look like that recipe's job. */}
            {ingredientsLoaded && !searching ? (
              <>
                {unlinked.length > 0 ? (
                  <WorkBox
                    title={t('cat.linkTheseRowsFirst')}
                    sub={t('cat.aRecipeRowHas')}
                    items={unlinked.map(item => ({ key: item.name, name: item.name, n: t('cat.nRows', { n: item.rows }) }))}
                  />
                ) : null}
                {work.length > 0 ? (
                  <WorkBox
                    title={unlinked.length > 0 ? t('cat.thenDeclareThese') : t('cat.declareTheseFirst')}
                    sub={t('cat.eachOneIsHolding')}
                    items={work.map(item => ({ key: item.id, name: item.name, n: t('cat.nRecipes', { n: item.blocks }) }))}
                  />
                ) : null}
              </>
            ) : null}

            {ordered.length === 0 ? (
              <p className={styles.nothing}>{recipes.length > 0 ? t('cat.noRecipeMatchesYour') : t('cat.noRecipesYet')}</p>
            ) : (
              <ul className={styles.rows}>
                {ordered.map(row => (
                  <SheetRow
                    key={row.recipe.id}
                    recipe={row.recipe}
                    result={row.result}
                    state={row.state}
                    checking={!ingredientsLoaded}
                    onOpen={open}
                    register={handBack.register}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {/* ⚠️ THE CAVEAT BELONGS ON THIS SCREEN TOO: it is the one somebody would photograph and pin up. It is drawn
            outside everything that repaints. */}
        <p className={styles.caveat}>{t('cat.fromTheSuppliersSpecifications')}</p>
      </div>
    </section>
  );
}

// ── The fourteen the law names, for this venue's country ─────────────────────
//
// ⚠️ THE COUNTRY DECIDES THESE WORDS, NEVER THE INTERFACE LANGUAGE: a UK bakery reads «Wheat» with the app in Italian,
// and that is the law. AND NO COUNTRY MEANS NO LIST, never a quiet fall back to the UK: an English allergen sheet in an
// Italian bakery is not «a bit off», it is non-compliant.
//
// The answer stays outside the fold; only the detail (which cereals and nuts sit inside two of the groups) folds. The
// card is its own component with its own state, so a snapshot of the recipes never slams its fold shut.
function LawCard() {
  const { t } = useT();
  const { location } = useSession();
  const [open, setOpen] = useState(false);
  const headId = useId();
  const bodyId = useId();

  if (!canPrintLabel(location)) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        <h3 id={headId} className={styles.staticHead}>{t('cat.sheet.theLawHere')}</h3>
        <p className={styles.warn}>{t('cat.sheet.noCountry')}</p>
      </section>
    );
  }

  const lang = outputLanguage(location);
  const country = countryOf(location);
  return (
    <section className={styles.card} aria-labelledby={headId}>
      <h3 id={headId} className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => { setOpen(!open); }}
        >
          <span className={styles.label}>{t('cat.sheet.theLawHere')}</span>
          <ChevronDown aria-hidden="true" className={styles.chevron} />
        </button>
      </h3>
      <p className={styles.lawList}>
        {ALLERGEN_GROUPS.map(group => allergenGroupName(group, lang)).filter(Boolean).join(' · ')}
      </p>
      <div id={bodyId} hidden={!open} className={styles.lawBody}>
        <p className={styles.lawSub}>{t('cat.sheet.theSpecificOnes')}</p>
        {ALLERGEN_GROUPS.map(group => {
          const codes = allergenGroupCodes(group, lang);
          if (codes.length === 0) return null;
          return (
            <p key={group} className={styles.group}>
              <span className={styles.groupName}>{allergenGroupName(group, lang)}</span>
              <span className={styles.groupCodes}>{codes.join(', ')}</span>
            </p>
          );
        })}
        <p className={styles.note}>
          {t('cat.sheet.namesFollowCountry', { country: country === null ? '' : t(COUNTRY_IN[country]) })}
        </p>
      </div>
    </section>
  );
}

// A named list of things to go and do, busiest first, capped.
function WorkBox({ title, sub, items }: {
  title: string;
  sub: string;
  items: ReadonlyArray<{ key: string; name: string; n: string }>;
}) {
  const { t } = useT();
  return (
    <div className={styles.work}>
      <p className={styles.workTitle}>{title}</p>
      <p className={styles.workSub}>{sub}</p>
      <ul className={styles.workList}>
        {items.slice(0, WORK_LIMIT).map(item => (
          <li key={item.key}>
            <span className={styles.workName}>{item.name}</span>
            <span className={styles.workN}>{item.n}</span>
          </li>
        ))}
        {items.length > WORK_LIMIT ? (
          <li className={styles.workMore}>{t('cat.andMore', { n: items.length - WORK_LIMIT })}</li>
        ) : null}
      </ul>
    </div>
  );
}

type RowProps = {
  recipe: CatalogueRecipe;
  result: RecipeAllergens;
  state: RowState;
  // The ingredients have not arrived: no state is drawn.
  checking: boolean;
  onOpen: (id: string) => void;
  register: (name: string, node: HTMLElement | null) => void;
};

// ── One recipe, in one of four states ────────────────────────────────────────
//
// ⚠️⚠️ A BLOCKED ROW NAMES NO ALLERGEN AT ALL, and this is the line to defend. A recipe with two of six rows declared
// has partial knowledge, and the RECIPE screen shows it with room for the sentence saying it is not the full list.
// Here, on a screen somebody scrolls while a customer waits, a red row that printed «Milk, Wheat» would be read as the
// answer, and the row that is missing could be the one with the hazelnuts. The switch is exhaustive over the model's
// four states, and `allergenName` is reached from ONE of them.
//
// ⚠️ AND THE STATE IS A WORD, NEVER COLOUR ALONE (P18).
function SheetRow({ recipe, result, state, checking, onOpen, register }: RowProps) {
  const { t } = useT();
  const { location } = useSession();
  const lang = outputLanguage(location);
  const opener = useCallback((node: HTMLButtonElement | null) => { register(sheetOpener(recipe.id), node); }, [register, recipe.id]);
  const blocked = rowIsBlocked(state);

  let line: string;
  switch (state) {
    case 'declared-listed':
      line = result.allergens.map(code => allergenName(code, lang)).join(', ');
      break;
    case 'declared-none':
      line = t('cat.noneOfThe14');
      break;
    case 'nothing-yet':
      // «0 ingredients to sort out» is nonsense: an empty recipe is not declared, but it has no gaps to count.
      line = t('cat.nothingInItYet');
      break;
    case 'not-declared':
      line = incompleteSentence(t, result.gaps.length);
      break;
  }

  return (
    <li className={styles.item}>
      <button
        ref={opener}
        type="button"
        className={styles.row}
        data-blocked={checking ? 'false' : String(blocked)}
        onClick={() => { onOpen(recipe.id); }}
      >
        <span className={styles.rowMain}>
          <span className={styles.rowTop}>
            <span className={styles.name}>{recipe.name === '' ? t('cat.noName') : recipe.name}</span>
            {' '}
            {checking ? null : (
              <span className={`${styles.pill} ${blocked ? styles.pillBlocked : styles.pillOk}`}>
                {blocked ? t('cat.sheet.rowNotDeclared') : t('cat.sheet.rowDeclared')}
              </span>
            )}
          </span>
          {' '}
          <span className={styles.what}>{checking ? t('recipes.allergensChecking') : line}</span>
        </span>
        <ChevronRight aria-hidden="true" className={styles.rowChevron} />
      </button>
    </li>
  );
}
