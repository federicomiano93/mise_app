import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, ShieldCheck, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { filterByName } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { haccpListCategory, haccpSettingsOf } from '@mise/shared/haccp-label';
import { categoryOf, withoutArchived } from '@mise/shared/recipe-shelf';
import { PartBoundary } from '../errors/PartBoundary';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { RecipesProvider, useRecipes, useRecipesStore } from '../recipes/RecipesContext';
import { messageText } from '../recipes/recipesMessages';
import { FROM_LABELS_HACCP, FROM_LABELS_PRODUCT } from '../recipes/recipesNav';
import { haccpPath, labelPath } from '../recipes/recipesPath';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { ScrollAreaContext } from '../shell/scrollArea';
import { FormBar } from '../ui/FormBar';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { LABELS_PATH, LABEL_KINDS, labelListPath, parseLabelsPath } from './labelsPath';
import type { LabelKind } from './labelsPath';
import styles from './LabelsSection.module.css';

// «Labels» (the owner, 13 Nov 2026): one way in to the labels, which until now were reached only from inside the Recipe
// catalogue. Three levels, Back one level at a time:
//
//   the two choices (/labels)  →  the recipes, with a search box (/labels/product, /labels/haccp)  →  that recipe's label
//
// ⚠️ THE LABEL IS THE RECIPE CATALOGUE'S OWN SCREEN, AT ITS OWN ADDRESS (`/recipes/<id>/label`, `/recipes/<id>/haccp`), never a
// copy: the refusals (allergens not declared, no country, a label too long…), the preview, the print roads and the queue are
// all that screen's. The move carries the marker that screen already obeys (recipesNav.ts, FROM_LABELS_*), so its Back is the
// browser's Back, which is this list.
//
// Shown to exactly whoever is shown Recipes (session/visibility.ts): the same gate, the same card.
export default function LabelsSection() {
  const { t } = useT();
  const { pathname } = useLocation();
  const view = parseLabelsPath(pathname.slice(LABELS_PATH.length));
  // A junk address under /labels goes back to the choices, as the other sections send theirs back to their first screen.
  if (view.kind === 'unknown') return <Navigate to={LABELS_PATH} replace state={KEEP_FOCUS} />;
  return (
    <Page title={t('section.labels')}>
      <div className={styles.column}>
        {view.kind === 'choices' ? (
          <PartBoundary>
            <Choices />
          </PartBoundary>
        ) : (
          // The recipes are listened to only while a list is on screen (P14): the choices need none of them.
          <RecipesProvider>
            <StatusMessageProvider>
              <StoreMessages />
              <PartBoundary resetKey={view.label}>
                <RecipeList key={view.label} kind={view.label} />
              </PartBoundary>
            </StatusMessageProvider>
          </RecipesProvider>
        )}
      </div>
    </Page>
  );
}

// What the store reports (the recipes' feed broken) is said in the status message, as the Recipe catalogue says it: without it a
// refused read on an empty phone would read as «No recipes yet».
function StoreMessages() {
  const { t } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => { say(messageText(t, message)); }), [store, say, t]);
  return null;
}

// ── Where the focus goes back to ─────────────────────────────────────────────
//
// ⚠️ PROMISED WHEN THE NEXT SCREEN OPENS, NOT WHEN ITS BACK IS PRESSED: a phone's back gesture is the browser's Back and runs
// no code of the screen it leaves (docs/architecture.md, «Traps already paid for»). The label is even another section's screen.
// A module variable because the whole section is unmounted while the label is open; it holds a kind, a search and an id —
// nothing of the venue's that could outlive a venue switch, which reloads the page anyway.
let owedChoice: LabelKind | null = null;
let owedRow: { kind: LabelKind; id: string; query: string; top: number } | null = null;

// What the choices put in the navigation's state: the list one level down knows the choices are one step behind it.
// KEEP_FOCUS: the page leaves the focus alone, and the list puts it on its own title.
const FROM_CHOICES = { ...KEEP_FOCUS, fromChoices: true } as const;

const cameFromChoices = (state: unknown): boolean => typeof state === 'object' && state !== null && 'fromChoices' in state;

// What a list opened by its address puts in the state when its Back REPLACES it with the choices: a return like a POP, so the choices
// hand the focus back (the Back button that held it is gone with the list).
const BACK_TO_CHOICES = { ...KEEP_FOCUS, backToChoices: true } as const;

const backToChoices = (state: unknown): boolean => typeof state === 'object' && state !== null && 'backToChoices' in state;

// What each kind says. KEYS, resolved while drawing (a constant holding the words would freeze the language the page booted in).
const KIND: Readonly<Record<LabelKind, { title: MessageKey; sub: MessageKey; icon: LucideIcon }>> = {
  product: { title: 'labels.product', sub: 'labels.product.sub', icon: Tag },
  haccp: { title: 'haccp.label.title', sub: 'labels.haccp.sub', icon: ShieldCheck },
};

// ── The two choices ──────────────────────────────────────────────────────────

// Back goes to the Home. ⚠️ A REPLACE, not a new entry: «Labels» is reached from the rail or «More» as often as from the Home,
// so the entry behind it is not always the Home, and a pushed Home would leave the phone's back gesture bouncing between the
// Home and these choices.
function Choices() {
  const { t } = useT();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { state } = useLocation();
  const titleId = useId();
  const links = useRef(new Map<LabelKind, HTMLAnchorElement>());

  // Back from a list (the browser's Back, a POP, or the replace of a list opened by its address) gives the focus back to the
  // choice that opened it. Any other arrival leaves it to the page, which puts it on the h1.
  useEffect(() => {
    const owed = owedChoice;
    owedChoice = null;
    if (owed !== null && (navigationType === 'POP' || backToChoices(state))) links.current.get(owed)?.focus();
  }, []);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void navigate('/home', { replace: true }); }}
        title={t('labels.choose')}
        titleId={titleId}
      />
      <ul className={styles.choices}>
        {LABEL_KINDS.map(kind => (
          <Choice
            key={kind}
            kind={kind}
            register={node => { if (node) links.current.set(kind, node); else links.current.delete(kind); }}
          />
        ))}
      </ul>
    </section>
  );
}

function Choice({ kind, register }: { kind: LabelKind; register: (node: HTMLAnchorElement | null) => void }) {
  const { t } = useT();
  const titleId = useId();
  const subId = useId();
  const { title, sub, icon: Icon } = KIND[kind];
  return (
    <li>
      {/* The whole tile is the link, named by its title and described by its sentence. */}
      <Link
        ref={register}
        to={labelListPath(kind)}
        state={FROM_CHOICES}
        className={styles.choice}
        aria-labelledby={titleId}
        aria-describedby={subId}
        onClick={() => { owedChoice = kind; owedRow = null; }}
      >
        <span className={styles.choiceIcon} aria-hidden="true"><Icon /></span>
        <span className={styles.choiceText}>
          <span id={titleId} className={styles.choiceTitle}>{t(title)}</span>
          <span id={subId} className={styles.choiceSub}>{t(sub)}</span>
        </span>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
      </Link>
    </li>
  );
}

// ── The recipes for one kind of label ────────────────────────────────────────

// Which recipes each list offers. ⚠️ ARCHIVED RECIPES ARE LEFT OUT OF BOTH, as the Recipe catalogue's HACCP list already
// does: an archived recipe is no longer made. The HACCP list also keeps to the one category the venue chose in the label
// Settings (none = every recipe), exactly as the catalogue's own HACCP list, so the two lists never disagree.
function inScopeFor(kind: LabelKind, recipes: readonly CatalogueRecipe[], categories: readonly string[], only: string | null): CatalogueRecipe[] {
  const kept = withoutArchived(recipes);
  if (kind === 'product' || only === null) return [...kept];
  return kept.filter(recipe => categoryOf(recipe, categories) === only);
}

// The list: Back, the title, (for HACCP) which recipes are shown, the search, the rows. Alphabetical in the interface's
// language — a list to pick ONE recipe from, so the order is the one a person scans. Nothing here decides whether a label can
// be made: a recipe whose label is refused today opens the label screen, which says why, exactly as from inside the recipe.
function RecipeList({ kind }: { kind: LabelKind }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const { recipes, recipesLoaded, labelConfig, labelConfigKnown, categories } = useRecipes();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const scrollArea = useContext(ScrollAreaContext);

  // Back from a label (a POP) brings back the search as it was and owes the focus to the row that opened it. Read here, and
  // forgotten by the effect below (an initializer must not change anything: Strict Mode runs it twice).
  const [returning] = useState(() => (owedRow !== null && owedRow.kind === kind && navigationType === 'POP' ? owedRow : null));
  useEffect(() => { owedRow = null; }, []);
  const [query, setQuery] = useState(returning?.query ?? '');

  const only = kind === 'haccp' ? haccpListCategory(haccpSettingsOf(labelConfig), categories) : null;
  const inScope = useMemo(
    () => inScopeFor(kind, recipes, categories, only).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [kind, recipes, categories, only, locale],
  );
  const shown = useMemo(() => filterByName(inScope, query), [inScope, query]);
  // ⚠️ THE HACCP ROWS WAIT FOR THE LABEL SETTINGS: drawn before them, the list would show every recipe and then lose the ones
  // outside the venue's category, under the finger.
  const ready = recipesLoaded && (kind === 'product' || labelConfigKnown);

  // Opened from the choices: the focus goes to this screen's title. Back from a label: to the row, once the rows are drawn
  // (its recipe may have gone meanwhile: then the title). Opened by its address: left to the skip link.
  useEffect(() => {
    if (returning === null && cameFromChoices(state) && navigationType !== 'POP') title.current?.focus();
  }, []);
  //
  // ⚠️ AFTER THE SHELL'S RESET, IN THE NEXT FRAME. Coming back from the label is a change of SECTION (Recipes → Labels), so the
  // shell puts its scroll area at the top — in its own effect, which runs AFTER this child's. Focused here, the row would scroll
  // into view and then be scrolled away, the focus ring out of sight. So the place written down at the tap is put back, and the
  // row focused without scrolling, a frame later. `delivered` is set inside the frame: Strict Mode cancels the first one.
  const delivered = useRef(false);
  useEffect(() => {
    if (!ready || returning === null || delivered.current) return;
    const frame = requestAnimationFrame(() => {
      delivered.current = true;
      const area = scrollArea.element();
      if (area) area.scrollTop = returning.top;
      const row = rows.current.get(returning.id);
      if (row) row.focus({ preventScroll: area !== null });
      else title.current?.focus();
    });
    return () => { cancelAnimationFrame(frame); };
  }, [ready]);

  // One level up. From the choices, the entry behind this one IS the choices: the browser's Back. Opened by its address, there
  // is nothing behind it, so it REPLACES itself with them. Either way the choices owe the focus to this kind.
  const fromChoices = cameFromChoices(state);
  const leave = useCallback(() => {
    owedChoice = kind;
    if (fromChoices) void navigate(-1);
    else void navigate(LABELS_PATH, { replace: true, state: BACK_TO_CHOICES });
  }, [navigate, fromChoices, kind]);

  const open = (id: string) => {
    owedRow = { kind, id, query, top: scrollArea.element()?.scrollTop ?? 0 };
    if (kind === 'product') void navigate(labelPath(id), { state: FROM_LABELS_PRODUCT });
    else void navigate(haccpPath(id), { state: FROM_LABELS_HACCP });
  };

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t(KIND[kind].title)} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        {!ready ? (
          <p className={styles.quiet} aria-busy="true">{t('session.loading')}</p>
        ) : (
          <>
            {kind === 'haccp' ? (
              <p className={styles.scope}>
                {only === null ? t('haccp.list.shownAll') : t('haccp.list.shownCategory', { name: only })}
              </p>
            ) : null}

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

            {inScope.length === 0 ? (
              <p className={styles.quiet}>
                {only === null ? t('cat.noRecipesYet') : t('haccp.list.emptyCategory', { name: only })}
              </p>
            ) : shown.length === 0 ? (
              <p className={styles.quiet}>{t('cat.noRecipeMatchesYour')}</p>
            ) : (
              <ul className={styles.rows}>
                {shown.map(recipe => (
                  <li key={recipe.id} className={styles.item}>
                    <button
                      ref={node => { if (node) rows.current.set(recipe.id, node); else rows.current.delete(recipe.id); }}
                      type="button"
                      className={styles.row}
                      onClick={() => { open(recipe.id); }}
                    >
                      <span className={styles.name}>{recipe.name === '' ? t('cat.noName') : recipe.name}</span>
                      <ChevronRight aria-hidden="true" className={styles.chevron} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
