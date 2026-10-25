import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { allergensOn } from '@mise/shared/venue-features';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { useMediaQuery } from '../ui/useMediaQuery';
import { RecipesProvider, useRecipesStore } from './RecipesContext';
import { RecipesDetail } from './RecipesDetail';
import { RecipesList } from './RecipesList';
import { ResumeOffer } from './ResumeOffer';
import { ALLERGENS_OPENER, HandBackProvider, NEW_OPENER, SETTINGS_OPENER, recipeOpener, useHandBackState } from './handBack';
import { LabelShowsProvider } from './labelShows';
import { createRecipeDeletions, RecipeDeletionsProvider } from './recipeDeletions';
import { messageText } from './recipesMessages';
import { RecipeReturnProvider, carriedPlace, carryPlace, forgetCarriedPlace } from './recipeReturn';
import type { Place, RecipeReturn } from './recipeReturn';
import { FROM_LIST, FROM_SHEET, cameFromList } from './recipesNav';
import { ALLERGENS_PATH, NEW_PATH, RECIPES_PATH, SETTINGS_PATH, recipePath, resolveRecipesPath } from './recipesPath';
import type { ShownView } from './recipesPath';
import styles from './RecipesSection.module.css';

// The Recipe catalogue: the recipes most opened first and, beside them from 1000px, the chosen
// recipe. Loaded only when somebody opens it (shell/sectionScreens.ts), and only for a person the
// venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: RecipesProvider starts the listener on mount and
// stops it on unmount (P14).
//
// Steps 3d-1 to 3d-5 look at recipes: the list, a recipe with its allergen cards, the Allergen sheet, a recipe's label (on
// screen, and printed through the system's own dialog) and the label Settings. Step 3d-6 writes them: a «New recipe» button
// above the list, «Edit» on a recipe, and delete (docs/parity/catalogue.md).
export default function RecipesSection() {
  return (
    <RecipesProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <LabelShowsProvider>
          <RecipesScreen />
        </LabelShowsProvider>
      </StatusMessageProvider>
    </RecipesProvider>
  );
}

// What the store reports (a dead stream) goes to the status message.
function StoreMessages() {
  const { t } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => { say(messageText(t, message)); }), [store, say, t]);
  return null;
}

function RecipesScreen() {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const { location, canManage } = useSession();
  // The address as it is written, not React Router's «*»: a recipe id is split before it is decoded
  // (recipesPath.ts).
  const resolved = resolveRecipesPath(pathname.slice(RECIPES_PATH.length));

  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT: on a POP the app is arranging
  // itself, so KEEP_FOCUS; on any other move the state of the address being replaced is passed on.
  if ('redirect' in resolved) {
    return <Navigate to={resolved.redirect} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }
  // ⚠️ THE SHEET RE-CHECKS ITS OWN GATE: a venue that has switched allergens off has no sheet, whatever address is in
  // the bar (a bookmark, a link, Back; a switch thrown on another phone is seen after a reload, because the venue document is
  // read once when the venue opens and is not live in Mise 2). A gate on a door is a
  // gate on everything later put behind it.
  if (resolved.view.kind === 'allergens' && !allergensOn(location)) {
    return <Navigate to={RECIPES_PATH} replace state={KEEP_FOCUS} />;
  }
  // ⚠️ SETTINGS ARE FOR WHOEVER RUNS THE PLACE: an employee who types the address is sent to the list, and nothing of the
  // screen is drawn. The rules are the real guard (config/labels is written by canManage only); this is courtesy.
  if (resolved.view.kind === 'settings' && !canManage) {
    return <Navigate to={RECIPES_PATH} replace state={KEEP_FOCUS} />;
  }
  return <RecipesLayout view={resolved.view} />;
}

function RecipesLayout({ view }: { view: ShownView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBackState();
  // The recipes this phone's own screens are deleting (recipeDeletions.ts).
  const deletions = useMemo(createRecipeDeletions, []);

  // ⚠️ THE CATALOGUE OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx), because its
  // list and its recipes are separate addresses: the shell's reset to the top at every address would
  // send the list back to the top at each recipe on the split, and bring Back on a phone to the top of
  // the list while the focus went to a row far below. The effects below handle every move.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a recipe opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  // Where a recipe was when its label opened, until the move after Back (recipeReturn.ts).
  // Back (a POP) from Food cost brings the place written before the trip, which the section that wrote it took away with it.
  const place = useRef<Place | null>(useNavigationType() === 'POP' ? carriedPlace() : null);
  useEffect(() => { forgetCarriedPlace(); }, []);
  const recipeReturn = useMemo<RecipeReturn>(() => ({
    remember(recipeId, origin = 'label') {
      place.current = { id: recipeId, origin, area: scrollArea()?.scrollTop ?? null, detail: detail.current?.scrollTop ?? null, delivered: false };
      if (origin === 'cost') carryPlace(place.current);
    },
    pendingCost: recipeId => place.current !== null && place.current.id === recipeId && place.current.origin === 'cost',
    restoreScroll(recipeId) {
      const written = place.current;
      if (written === null || written.id !== recipeId) return;
      const area = scrollArea();
      if (area !== null && written.area !== null) area.scrollTop = written.area;
      if (detail.current !== null && written.detail !== null) detail.current.scrollTop = written.detail;
    },
    pending: recipeId => place.current !== null && place.current.id === recipeId && place.current.origin === 'label',
    pendingEdit: recipeId => place.current !== null && place.current.id === recipeId && place.current.origin === 'edit',
    pendingSteps: recipeId => place.current !== null && place.current.id === recipeId && place.current.origin === 'steps',
    pendingMix: recipeId => place.current !== null && place.current.id === recipeId && place.current.origin === 'mix',
    markDelivered() { if (place.current !== null) place.current.delivered = true; },
    wasDelivered: () => place.current?.delivered === true,
  }), [scrollArea]);
  // Set by the scroll effect below for the detail effect after it: this move is Back from a label (or the editor) to its recipe.
  const backFromLabel = useRef<Place | null>(null);

  // A recipe opens one level down, so Back steps up to the list. On the split, with a recipe already
  // open beside the list, picking another is lateral and replaces it — and keeps whatever the entry it
  // replaces knew about where Back goes.
  const openRecipe = (id: string) => {
    handBack.expect(recipeOpener(id));
    if (split && view.kind !== 'list') {
      void navigate(recipePath(id), { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      // On a phone the list is hidden behind the recipe, and the page shrinks to it: the place in the
      // list is written down now, while the list is what is on screen.
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(recipePath(id), { state: FROM_LIST });
    }
  };

  // The Allergen sheet opens one level down, from the door at the foot of the list. On the split it takes the right-hand
  // pane (the list stays beside it); with a recipe already open there, picking it is lateral and replaces the recipe.
  const openSheet = () => {
    if (view.kind === 'allergens') return;
    handBack.expect(ALLERGENS_OPENER);
    if (split && view.kind !== 'list') {
      void navigate(ALLERGENS_PATH, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(ALLERGENS_PATH, { state: FROM_LIST });
    }
  };

  // A new recipe opens the same way as the sheet: one level down, in the right-hand pane on the split.
  const openNew = () => {
    if (view.kind === 'new') return;
    handBack.expect(NEW_OPENER);
    if (split && view.kind !== 'list') {
      void navigate(NEW_PATH, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(NEW_PATH, { state: FROM_LIST });
    }
  };

  // The label Settings open the same way as the sheet: one level down, in the right-hand pane on the split.
  const openSettings = () => {
    if (view.kind === 'settings') return;
    handBack.expect(SETTINGS_OPENER);
    if (split && view.kind !== 'list') {
      void navigate(SETTINGS_PATH, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(SETTINGS_PATH, { state: FROM_LIST });
    }
  };

  // A row of the sheet opens its recipe one level down, ALWAYS as a new entry, so Back returns to the sheet.
  const openFromSheet = (id: string) => {
    void navigate(recipePath(id), { state: FROM_SHEET });
  };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so the
  // place is back when the row takes the focus: focusing a row that is in view scrolls nothing.
  //  - On the split the list keeps its place (the right-hand side starts at its own top, below).
  //  - On a phone, Back to the list restores the place written down when a recipe opened; any other
  //    move is a new screen and starts at the top.
  //  - The first render does nothing: the shell reset the area when the section was entered.
  const shown = useRef<{ pathname: string; kind: ShownView['kind'] } | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { pathname, kind: view.kind };
    const area = scrollArea();
    // The same address twice is StrictMode running the effect again, not a move.
    backFromLabel.current = null;
    if (before === null || before.pathname === pathname) return;
    // Back from a label (or an editor) to its recipe keeps the place written down when it opened. Any other move forgets it
    // (the opening move itself, recipe → label or recipe → editor, is the one that must not).
    const written = place.current;
    const returning = (before.kind === 'label' || before.kind === 'edit' || before.kind === 'steps' || before.kind === 'mix') && view.kind === 'recipe' && written !== null && written.id === view.id;
    if (returning) backFromLabel.current = written;
    else if (view.kind !== 'label' && view.kind !== 'edit' && view.kind !== 'steps' && view.kind !== 'mix') place.current = null;
    if (area === null) return;
    if (split) {
      listTop.current = null;
    } else if (returning && written.area !== null) {
      area.scrollTop = written.area;
    } else if (view.kind === 'list' && before.kind !== 'list' && listTop.current !== null) {
      area.scrollTop = listTop.current;
      listTop.current = null;
    } else {
      area.scrollTop = 0;
    }
  }, [pathname]);

  // Back out of a recipe (its own Back, or the phone's back gesture): the row that opened it takes
  // the focus, once the list is on screen again (on a phone it was hidden behind the recipe, not
  // unmounted).
  // The same from a recipe that was opened from a row of the Allergen sheet: the sheet comes back, and its row is owed it.
  const lastKind = useRef(view.kind);
  useLayoutEffect(() => {
    const before = lastKind.current;
    lastKind.current = view.kind;
    if (view.kind === 'list' || (view.kind === 'allergens' && before === 'recipe')) handBack.deliver();
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own (RecipesSection.module.css), and it stays
  // mounted from one recipe to the next: another recipe starts at its top instead of where the last
  // one was left. On a phone it is not a scroll area and this is a no-op.
  useLayoutEffect(() => {
    if (detail.current) detail.current.scrollTop = backFromLabel.current?.detail ?? 0;
  }, [pathname]);

  return (
    <HandBackProvider value={handBack}>
      <RecipeReturnProvider value={recipeReturn}>
      <RecipeDeletionsProvider value={deletions}>
      <Page title={t('section.recipes')}>
        {/* A mix left unfinished is offered back once per opening, when the list is what is on screen. */}
        {view.kind === 'list' ? <ResumeOffer /> : null}
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : view.kind === 'mix' ? 'run' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <RecipesList
                openRecipeId={view.kind === 'recipe' || view.kind === 'label' || view.kind === 'edit' || view.kind === 'steps' || view.kind === 'mix' ? view.id : null}
                split={split}
                onOpenRecipe={openRecipe}
                sheetOpen={view.kind === 'allergens'}
                onOpenSheet={openSheet}
                settingsOpen={view.kind === 'settings'}
                onOpenSettings={openSettings}
                newOpen={view.kind === 'new'}
                onNew={openNew}
              />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <RecipesDetail view={view} onOpenFromSheet={openFromSheet} />
            </PartBoundary>
          </div>
        </div>
      </Page>
      </RecipeDeletionsProvider>
      </RecipeReturnProvider>
    </HandBackProvider>
  );
}
