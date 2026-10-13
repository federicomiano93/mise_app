import { useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { useMediaQuery } from '../ui/useMediaQuery';
import { RecipesProvider, useRecipesStore } from './RecipesContext';
import { RecipesDetail } from './RecipesDetail';
import { RecipesList } from './RecipesList';
import { HandBackProvider, recipeOpener, useHandBackState } from './handBack';
import { messageText } from './recipesMessages';
import { FROM_LIST, cameFromList } from './recipesNav';
import { RECIPES_PATH, recipePath, resolveRecipesPath } from './recipesPath';
import type { ShownView } from './recipesPath';
import styles from './RecipesSection.module.css';

// The Recipe catalogue: the recipes most opened first and, beside them from 1000px, the chosen
// recipe. Loaded only when somebody opens it (shell/sectionScreens.ts), and only for a person the
// venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: RecipesProvider starts the listener on mount and
// stops it on unmount (P14).
//
// Step 3d-1 only LOOKS at recipes: no editing, no allergens, no labels yet (docs/parity/catalogue.md).
export default function RecipesSection() {
  return (
    <RecipesProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <RecipesScreen />
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
  // The address as it is written, not React Router's «*»: a recipe id is split before it is decoded
  // (recipesPath.ts).
  const resolved = resolveRecipesPath(pathname.slice(RECIPES_PATH.length));

  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT: on a POP the app is arranging
  // itself, so KEEP_FOCUS; on any other move the state of the address being replaced is passed on.
  if ('redirect' in resolved) {
    return <Navigate to={resolved.redirect} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }
  return <RecipesLayout view={resolved.view} />;
}

function RecipesLayout({ view }: { view: ShownView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBackState();

  // ⚠️ THE CATALOGUE OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx), because its
  // list and its recipes are separate addresses: the shell's reset to the top at every address would
  // send the list back to the top at each recipe on the split, and bring Back on a phone to the top of
  // the list while the focus went to a row far below. The effects below handle every move.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a recipe opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);

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
    if (before === null || before.pathname === pathname || area === null) return;
    if (split) {
      listTop.current = null;
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
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver();
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own (RecipesSection.module.css), and it stays
  // mounted from one recipe to the next: another recipe starts at its top instead of where the last
  // one was left. On a phone it is not a scroll area and this is a no-op.
  const detail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [pathname]);

  return (
    <HandBackProvider value={handBack}>
      <Page title={t('section.recipes')}>
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <RecipesList
                openRecipeId={view.kind === 'recipe' ? view.id : null}
                split={split}
                onOpenRecipe={openRecipe}
              />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <RecipesDetail view={view} />
            </PartBoundary>
          </div>
        </div>
      </Page>
    </HandBackProvider>
  );
}
