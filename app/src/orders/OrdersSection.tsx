import { useLayoutEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { OrdersProvider, useOrders } from './OrdersContext';
import { OrdersList } from './OrdersList';
import { SupplierItemsScreen } from './SupplierItemsScreen';
import { SupplierOrderScreen } from './SupplierOrderScreen';
import { HandBackProvider, ITEMS_DOOR, itemsOpener, supplierOpener, useHandBackState } from './handBack';
import { FROM_LIST, cameFromList } from './ordersNav';
import { ORDERS_PATH, parseOrdersPath, supplierItemsPath, supplierPath } from './ordersPath';
import type { OrdersView } from './ordersPath';
import { buildOrdersLens } from './ordersLens';
import styles from './OrdersSection.module.css';

// «Orders»: the supplier list and, beside it from 1000px, the chosen supplier's order. Loaded only when somebody opens it
// (shell/sectionScreens.ts), and only for a person the venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: OrdersProvider starts the four listeners on mount and stops them on
// unmount (P14), sending a change still waiting for the autosave at once.
//
// Step 3f-1: the list and the shared order in progress (docs/parity/orders.md). Nothing in it is role-gated: every member
// with the section types quantities (L2).
export default function OrdersSection() {
  return (
    <OrdersProvider>
      <OrdersScreen />
    </OrdersProvider>
  );
}

type ShownView = Exclude<OrdersView, { kind: 'unknown' }>;

function OrdersScreen() {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  // The address as it is written, not React Router's «*»: a supplier id is split before it is decoded (ordersPath.ts).
  const view = parseOrdersPath(pathname.slice(ORDERS_PATH.length));
  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT: on a POP the app is arranging itself, so KEEP_FOCUS.
  if (view.kind === 'unknown') {
    return <Navigate to={ORDERS_PATH} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }
  return <OrdersLayout view={view} />;
}

// The page's status line: a stream that died, and an order that could not be saved. The live region is on the page BEFORE it
// speaks (an element inserted already filled is announced unreliably); only its text comes and goes. Derived from the
// store, so «could not be saved» goes the moment a later save lands (parity L5, L37).
function StatusLine() {
  const { t } = useT();
  const snapshot = useOrders();
  const lost = [
    snapshot.draftBroken ? t('ord.live.draft') : '',
    snapshot.suppliersBroken ? t('ord.live.suppliers') : '',
    snapshot.ingredientsBroken ? t('ord.live.ingredients') : '',
  ].filter(what => what !== '');
  return (
    <div role="status" className={styles.status}>
      {lost.map(what => <p key={what} className={styles.problem}>{t('ord.liveLost', { what })}</p>)}
      {snapshot.draftSaveFailed ? <p className={styles.problem}>{t('ord.saveFailed')}</p> : null}
    </div>
  );
}

function OrdersLayout({ view }: { view: ShownView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBackState();
  const snapshot = useOrders();
  const noSupplierName = t('ord.noSupplier');

  // ⚠️ THE LENS IS THE ONE PLACE THAT DECIDES AN INGREDIENT'S SUPPLIER (ordersLens.ts): the list, a supplier's screen and
  // «What they sell» all read this one, so they can never disagree.
  const lens = useMemo(() => buildOrdersLens({
    suppliers: snapshot.suppliers,
    suppliersLoaded: snapshot.suppliersLoaded,
    ingredients: snapshot.ingredients,
    entries: snapshot.draft.entries,
    supplierOrder: snapshot.config.supplierOrder,
    noSupplierName,
  }), [snapshot.suppliers, snapshot.suppliersLoaded, snapshot.ingredients, snapshot.draft.entries, snapshot.config.supplierOrder, noSupplierName]);
  const ready = snapshot.suppliersLoaded && snapshot.ingredientsLoaded && snapshot.draftLoaded;

  // ⚠️ THIS SECTION OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx): its list and its suppliers are
  // separate addresses, so the shell's reset to the top at every address would send the list back to the top at each supplier
  // on the split, and bring Back on a phone to the top of the list while the focus went to a row far below.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a screen opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  // A screen opens one level down, so Back steps up to the list. On the split, with one already open beside the list, picking
  // another is lateral and replaces it — and keeps whatever the entry it replaces knew about where Back goes.
  const open = (opener: string, path: string) => {
    handBack.expect(opener);
    if (split && view.kind !== 'list') {
      void navigate(path, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      // On a phone the list is hidden behind the screen: the place in it is written down now, while it is what is on screen.
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(path, { state: FROM_LIST });
    }
  };
  const openSupplier = (id: string) => { open(supplierOpener(id), supplierPath(id)); };
  const openItems = (id: string) => { open(itemsOpener(id), supplierItemsPath(id)); };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so the place is back when the row
  // takes the focus: focusing a row that is in view scrolls nothing.
  //  - On the split the list keeps its place (the right-hand side starts at its own top, below).
  //  - On a phone, Back to the list restores the place written down when a screen opened; any other move starts at the top.
  //  - The first render does nothing: the shell reset the area when the section was entered.
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = pathname;
    const area = scrollArea();
    // The same address twice is StrictMode running the effect again, not a move.
    if (before === null || before === pathname || area === null) return;
    if (split) {
      listTop.current = null;
    } else if (view.kind === 'list' && listTop.current !== null) {
      area.scrollTop = listTop.current;
      listTop.current = null;
    } else {
      area.scrollTop = 0;
    }
  }, [pathname]);

  // Back out of a supplier (its own Back, or the phone's back gesture): the button that opened it takes the focus, once the
  // list is on screen again (on a phone it was hidden behind the supplier, not unmounted).
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver();
    // The supplier's screen coming back from «What they sell»: only its own button is owed the focus. ⚠️ NOT deliver(): a
    // supplier opened from the list expects the list row, which must keep its focus (phone: the title takes it; split: the row).
    else if (view.kind === 'supplier') handBack.deliverIf(ITEMS_DOOR);
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own and stays mounted from one supplier to the next: another supplier
  // starts at its top instead of where the last one was left. On a phone it is not a scroll area and this is a no-op.
  useLayoutEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [pathname]);

  return (
    <HandBackProvider value={handBack}>
      <Page title={t('section.orders')}>
        <StatusLine />
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <OrdersList
                lens={lens}
                ready={ready}
                openId={view.kind === 'list' ? null : view.id}
                onOpenSupplier={openSupplier}
                onOpenItems={openItems}
              />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <Detail view={view} lens={lens} ready={ready} />
            </PartBoundary>
          </div>
        </div>
      </Page>
    </HandBackProvider>
  );
}

// The right-hand side of the split — and, on a phone, the whole screen when a supplier is open. With nothing chosen it says
// what to do.
//
// (No `key` on the screens: the section keeps one from one supplier to the next on the split, so the focus stays on the row
// that was pressed.)
function Detail({ view, lens, ready }: { view: ShownView; lens: ReturnType<typeof buildOrdersLens>; ready: boolean }) {
  const { t } = useT();
  if (view.kind === 'list') {
    // ⚠️ NOT BESIDE «NO SUPPLIERS YET»: a prompt to tap a row, next to a list that says there are none, would send somebody
    // looking for what is not there.
    if (!ready || lens.suppliers.length === 0) return null;
    return (
      <div className={styles.prompt}>
        <p className={styles.promptTitle}>{t('ord.pane.title')}</p>
        <p>{t('ord.pane.text')}</p>
      </div>
    );
  }
  if (!ready) {
    return <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>;
  }
  if (view.kind === 'items') return <SupplierItemsScreen id={view.id} lens={lens} />;
  return <SupplierOrderScreen id={view.id} lens={lens} />;
}
