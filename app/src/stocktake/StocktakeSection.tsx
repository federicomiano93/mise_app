import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { useMediaQuery } from '../ui/useMediaQuery';
import { COST_OPENER, HandBackProvider, productOpener, useHandBackState } from './handBack';
import { StocktakeProvider, useStocktakeStore } from './StocktakeContext';
import { StocktakeDetail } from './StocktakeDetail';
import { StocktakeList } from './StocktakeList';
import { messageText } from './stocktakeMessages';
import { FROM_LIST, cameFromList } from './stocktakeNav';
import {
  STOCKTAKE_PATH, costPath, currentMonthId, monthPath, productPath, resolveStocktakePath,
} from './stocktakePath';
import type { ShownView } from './stocktakePath';
import styles from './StocktakeSection.module.css';

// The Stocktake: the month being counted (a list with a box on every row) and, beside it from
// 1000px, the chosen product or «What the month cost». Loaded only when somebody opens it
// (shell/sectionScreens.ts), and only for a person the venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: StocktakeProvider starts the ingredients'
// listener on mount and stops everything on unmount, handing what is unsent to Firestore (P14).
export default function StocktakeSection() {
  return (
    <StocktakeProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <StocktakeScreen />
      </StatusMessageProvider>
    </StocktakeProvider>
  );
}

// What the store reports (a refused save, a broken stream) goes to the status message.
function StoreMessages() {
  const { t } = useT();
  const store = useStocktakeStore();
  const say = useStatusMessage();
  const { canManage } = useSession();
  useEffect(() => store.onMessage(message => {
    const text = messageText(t, message, canManage);
    if (text !== null) say(text);
  }), [store, say, t, canManage]);
  return null;
}

// The month of the clock, worked out when the Stocktake opens and kept while it is on screen.
//
// ⚠️ BUT NOT FOR EVER: Mise 2 never reloads by itself, so a tablet left open on the bench across
// the turn of the month would still stop its arrow at the month it was opened in, and `/stocktake`
// would still land there. When the app COMES BACK to the foreground (the screen woken, the tab
// switched back to) nobody was looking at it a moment ago, so nothing can jump under a finger: the
// month is read again.
function useCurrentMonth(): string {
  const [current, setCurrent] = useState(() => currentMonthId());
  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === 'visible') setCurrent(currentMonthId());
    };
    document.addEventListener('visibilitychange', onForeground);
    return () => { document.removeEventListener('visibilitychange', onForeground); };
  }, []);
  return current;
}

function StocktakeScreen() {
  const current = useCurrentMonth();
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  // The address as it is written, not React Router's «*»: a product id is split before it is
  // decoded (stocktakePath.ts).
  const resolved = resolveStocktakePath(pathname.slice(STOCKTAKE_PATH.length), current);

  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT. `/stocktake` always lands on a
  // month, and Page (shell/Page.tsx) decides about the focus only on the address the person ends up
  // on, never on the one they tapped:
  //  - On a POP (the first load, the browser's Back or Forward) the person asked for no move, so the
  //    redirect is the app arranging itself: KEEP_FOCUS, and the skip link stays the first Tab stop.
  //  - On any other move the state of the address being redirected is passed on. A tap on the rail
  //    or the tab bar carries none, so the h1 takes the focus and a screen reader says where it is
  //    (a KEEP_FOCUS here, as there once was, left the focus on the link just pressed and announced
  //    nothing); a move the app made itself and marked KEEP_FOCUS still keeps it.
  if ('redirect' in resolved) {
    return <Navigate to={resolved.redirect} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }
  return <MonthScreen view={resolved.view} current={current} />;
}

function MonthScreen({ view, current }: { view: ShownView; current: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const store = useStocktakeStore();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBackState();
  const month = view.month;

  // ⚠️ THE STOCKTAKE OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx), because its
  // list and its product are separate addresses: the shell's reset to the top at every address
  // sent the list back to the top at each product on the split, and brought Back on a phone to the
  // top of the list while the focus went to a row far below. The effects below handle every move.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a screen opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);

  // The store watches the month in the address. A layout effect, so the month's local copy is in the
  // very first paint of a new month instead of one frame of «Loading…» before it.
  useLayoutEffect(() => { store.openMonth(month); }, [store, month]);

  // ⚠️ CHANGING MONTH IS LATERAL: it replaces the address, like picking a day in Pastries, so Back
  // does not walk through every month that was looked at. What is still unsent is handed to
  // Firestore first and NEVER awaited — with no signal in a storeroom the answer would never come.
  // KEEP_FOCUS: the focus stays on the arrow that was pressed — and no row is owed it, even with a
  // product open beside the list (the split), which the new month's list replaces.
  const moveTo = (other: string) => {
    handBack.forget();
    void store.flushBeforeLeaving();
    void navigate(monthPath(other), { replace: true, state: KEEP_FOCUS });
  };

  // A product, or «What it cost», opens one level down, so Back steps up to the list. On the split,
  // with a product (or «What it cost») already open beside the list, picking another is lateral and
  // replaces it — and keeps whatever the entry it replaces knew about where Back goes.
  const openScreen = (to: string) => {
    if (split && view.kind !== 'list') {
      void navigate(to, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      // On a phone the list is hidden behind what opens, and the page shrinks to it: the place in
      // the list is written down now, while the list is what is on screen.
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(to, { state: FROM_LIST });
    }
  };
  const openProduct = (id: string) => {
    handBack.expect(productOpener(id));
    openScreen(productPath(month, id));
  };
  const openCost = () => {
    handBack.expect(COST_OPENER);
    openScreen(costPath(month));
  };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so
  // the place is back when the row's button takes the focus: focusing a row that is in view
  // scrolls nothing.
  //  - On the split the list keeps its place (the right-hand side starts at its own top, below).
  //  - On a phone, Back to the list restores the place written down when the product opened; any
  //    other move is a new screen and starts at the top: a product or «What it cost» opening, a
  //    month's arrow, Back to a list nobody scrolled (a product opened by its address).
  //  - The first render does nothing: the shell reset the area when the section was entered. (So it
  //    did for `/stocktake` landing on the month: while that redirect is drawn this screen is gone
  //    and nothing owns the scroll, so the shell resets it.)
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

  // Back out of a product or «What it cost» (its own Back, or the phone's back gesture): the button
  // that opened it takes the focus, once the list is on screen again (on a phone it was hidden
  // behind the screen, not unmounted).
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver();
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own (StocktakeSection.module.css), and it stays
  // mounted from one product to the next: another product, or «What it cost», starts at its top
  // instead of where the last one was left. On a phone it is not a scroll area and this is a no-op.
  const detail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [pathname]);

  return (
    <HandBackProvider value={handBack}>
      <Page title={t('section.stocktake')}>
        <div className={styles.layout} data-view={view.kind}>
          <div className={styles.list}>
            <PartBoundary>
              <StocktakeList
                month={month}
                current={current}
                openProductId={view.kind === 'product' ? view.id : null}
                onMove={moveTo}
                onOpenProduct={openProduct}
                onOpenCost={openCost}
              />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <StocktakeDetail view={view} />
            </PartBoundary>
          </div>
        </div>
      </Page>
    </HandBackProvider>
  );
}
