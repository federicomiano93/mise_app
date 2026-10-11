import { useEffect, useLayoutEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { SPLIT_QUERY } from '../ui/split';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { useMediaQuery } from '../ui/useMediaQuery';
import { StocktakeProvider, useStocktakeStore } from './StocktakeContext';
import { StocktakeDetail } from './StocktakeDetail';
import { StocktakeList } from './StocktakeList';
import { messageText } from './stocktakeMessages';
import { FROM_LIST, cameFromList } from './stocktakeNav';
import { STOCKTAKE_PATH, currentMonthId, monthPath, productPath, resolveStocktakePath } from './stocktakePath';
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
  const { pathname } = useLocation();
  // The address as it is written, not React Router's «*»: a product id is split before it is
  // decoded (stocktakePath.ts).
  const resolved = resolveStocktakePath(pathname.slice(STOCKTAKE_PATH.length), current);

  // KEEP_FOCUS: the app arranging itself, not a person asking to go somewhere.
  if ('redirect' in resolved) return <Navigate to={resolved.redirect} replace state={KEEP_FOCUS} />;
  return <MonthScreen view={resolved.view} current={current} />;
}

function MonthScreen({ view, current }: { view: ShownView; current: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const store = useStocktakeStore();
  const split = useMediaQuery(SPLIT_QUERY);
  const month = view.month;

  // The store watches the month in the address. A layout effect, so the month's local copy is in the
  // very first paint of a new month instead of one frame of «Loading…» before it.
  useLayoutEffect(() => { store.openMonth(month); }, [store, month]);

  // ⚠️ CHANGING MONTH IS LATERAL: it replaces the address, like picking a day in Pastries, so Back
  // does not walk through every month that was looked at. What is still unsent is handed to
  // Firestore first and NEVER awaited — with no signal in a storeroom the answer would never come.
  // KEEP_FOCUS: the focus stays on the arrow that was pressed.
  const moveTo = (other: string) => {
    void store.flushBeforeLeaving();
    void navigate(monthPath(other), { replace: true, state: KEEP_FOCUS });
  };

  // A product opens one level down, so Back steps up to the list. On the split, with a product (or
  // «What it cost») already open beside the list, picking another is lateral and replaces it — and
  // keeps whatever the entry it replaces knew about where Back goes.
  const openProduct = (id: string) => {
    const to = productPath(month, id);
    if (split && view.kind !== 'list') {
      void navigate(to, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      void navigate(to, { state: FROM_LIST });
    }
  };

  return (
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
              // The two fill-in actions arrive with the dialogs in the next slice.
              onCarry={noop}
              onPurchases={noop}
            />
          </PartBoundary>
        </div>
        <div className={styles.detail}>
          <PartBoundary resetKey={pathname}>
            <StocktakeDetail view={view} />
          </PartBoundary>
        </div>
      </div>
    </Page>
  );
}

function noop(): void {
  // Replaced by the fill-in dialogs of the next slice.
}
