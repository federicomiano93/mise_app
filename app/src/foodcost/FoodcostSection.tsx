import { useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { useMediaQuery } from '../ui/useMediaQuery';
import { FoodcostProvider, useFoodcostStore } from './FoodcostContext';
import { FoodcostDetail } from './FoodcostDetail';
import { FoodcostList } from './FoodcostList';
import { messageText } from './foodcostMessages';
import { FROM_LIST, cameFromList } from './foodcostNav';
import {
  FOODCOST_PATH, newPath, productPath, resolveFoodcostPath, settingsPath,
} from './foodcostPath';
import type { ShownView } from './foodcostPath';
import { HandBackProvider, NEW_OPENER, SETTINGS_OPENER, productOpener, useHandBackState } from './handBack';
import styles from './FoodcostSection.module.css';

// Food cost: the products worst food cost first and, beside them from 1000px, the chosen product,
// its margin history or Settings. Loaded only when somebody opens it (shell/sectionScreens.ts), and
// only for a person the venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: FoodcostProvider starts the listeners on mount
// and stops them on unmount, handing what is unsent to Firestore (P14).
export default function FoodcostSection() {
  return (
    <FoodcostProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <FoodcostScreen />
      </StatusMessageProvider>
    </FoodcostProvider>
  );
}

// What the store reports (a refused save, a broken stream) goes to the status message.
function StoreMessages() {
  const { t } = useT();
  const store = useFoodcostStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => { say(messageText(t, message)); }), [store, say, t]);
  return null;
}

function FoodcostScreen() {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  // The address as it is written, not React Router's «*»: a product id is split before it is
  // decoded (foodcostPath.ts).
  const resolved = resolveFoodcostPath(pathname.slice(FOODCOST_PATH.length));

  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT (see StocktakeSection): on a
  // POP the app is arranging itself, so KEEP_FOCUS; on any other move the state of the address being
  // replaced is passed on.
  if ('redirect' in resolved) {
    return <Navigate to={resolved.redirect} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }
  return <FoodcostLayout view={resolved.view} />;
}

function FoodcostLayout({ view }: { view: ShownView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBackState();

  // ⚠️ FOOD COST OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx), because its
  // list and its screens are separate addresses: the shell's reset to the top at every address
  // sent the list back to the top at each product on the split, and brought Back on a phone to the
  // top of the list while the focus went to a row far below. The effects below handle every move.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a screen opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);

  // A product, a new product or Settings opens one level down, so Back steps up to the list. On the
  // split, with something already open beside the list, picking another is lateral and replaces it
  // — and keeps whatever the entry it replaces knew about where Back goes.
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
    openScreen(productPath(id));
  };
  const openNew = () => {
    handBack.expect(NEW_OPENER);
    openScreen(newPath);
  };
  const openSettings = () => {
    handBack.expect(SETTINGS_OPENER);
    openScreen(settingsPath);
  };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so
  // the place is back when the row's button takes the focus: focusing a row that is in view
  // scrolls nothing.
  //  - On the split the list keeps its place (the right-hand side starts at its own top, below).
  //  - On a phone, Back to the list restores the place written down when a screen opened; any
  //    other move is a new screen and starts at the top.
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

  // Back out of a screen (its own Back, or the phone's back gesture): the button that opened it
  // takes the focus, once the list is on screen again (on a phone it was hidden behind the screen,
  // not unmounted).
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver();
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own (FoodcostSection.module.css), and it stays
  // mounted from one product to the next: another screen starts at its top instead of where the
  // last one was left. On a phone it is not a scroll area and this is a no-op.
  const detail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [pathname]);

  return (
    <HandBackProvider value={handBack}>
      <Page title={t('section.foodcost')}>
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <FoodcostList
                openProductId={view.kind === 'product' || view.kind === 'history' ? view.id : null}
                onOpenProduct={openProduct}
                onOpenNew={openNew}
                onOpenSettings={openSettings}
              />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <FoodcostDetail view={view} />
            </PartBoundary>
          </div>
        </div>
      </Page>
    </HandBackProvider>
  );
}
