import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { useMediaQuery } from '../ui/useMediaQuery';
import { HandBackProvider, NEW_OPENER, SETTINGS_OPENER, supplierOpener, useHandBackState } from './handBack';
import { createSupplierDeletions, SupplierDeletionsProvider } from './supplierDeletions';
import { SuppliersProvider, useSuppliers, useSuppliersStore } from './SuppliersContext';
import { SuppliersDetail } from './SuppliersDetail';
import type { ShownView } from './SuppliersDetail';
import { SuppliersList } from './SuppliersList';
import { FROM_LIST, cameFromList } from './suppliersNav';
import { messageText } from './suppliersMessages';
import { NEW_SUPPLIER_PATH, SUPPLIERS_PATH, SUPPLIERS_SETTINGS_PATH, parseSuppliersPath, supplierPath, tabOf, tabPath } from './suppliersPath';
import type { SuppliersTab } from './suppliersPath';
import styles from './SuppliersSection.module.css';

// «Ingredients & suppliers»: the three lists (Ingredients, Suppliers, Packaging) and, beside them from 1000px, the chosen
// supplier. Loaded only when somebody opens it (shell/sectionScreens.ts), and only for a person the venue shows it to
// (SectionRoute).
//
// Its data lives exactly as long as it is on screen: SuppliersProvider starts the four listeners on mount and stops them
// on unmount (P14).
//
// Step 3e-1 slice A looks: the lists and a supplier's own screen. Slice B writes suppliers (the card, a new one, switching
// one off, deleting it) and adds Settings; 3e-2 adds the ingredient card (docs/parity/suppliers.md).
export default function SuppliersSection() {
  return (
    <SuppliersProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <SuppliersScreen />
      </StatusMessageProvider>
    </SuppliersProvider>
  );
}

// What the store reports (a refused star, a refused write) goes to the status message.
function StoreMessages() {
  const { t } = useT();
  const store = useSuppliersStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => {
    say(messageText(t, message));
  }), [store, say, t]);
  return null;
}

function SuppliersScreen() {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const { canManage } = useSession();
  // The address as it is written, not React Router's «*»: a supplier id is split before it is decoded (suppliersPath.ts).
  const view = parseSuppliersPath(pathname.slice(SUPPLIERS_PATH.length));

  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT: on a POP the app is arranging itself, so KEEP_FOCUS;
  // on any other move the state of the address being replaced is passed on.
  if (view.kind === 'unknown') {
    return <Navigate to={SUPPLIERS_PATH} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }
  // ⚠️ SETTINGS ARE FOR WHOEVER RUNS THE PLACE: an employee who types the address is sent to the list, and nothing of the
  // screen is drawn. The rules are the real guard (the panel switches go through a function that refuses anybody else);
  // this is courtesy.
  if (view.kind === 'settings' && !canManage) {
    return <Navigate to={SUPPLIERS_PATH} replace state={KEEP_FOCUS} />;
  }
  return <SuppliersLayout view={view} />;
}

function SuppliersLayout({ view }: { view: ShownView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  // The suppliers this phone's own screens are deleting (supplierDeletions.ts); a mark goes when its supplier is back.
  const deletions = useMemo(createSupplierDeletions, []);
  const handBack = useHandBackState(deletions);
  const { suppliers } = useSuppliers();
  useEffect(() => { deletions.prune(suppliers.map(supplier => supplier.id)); }, [deletions, suppliers]);

  // ⚠️ THIS SECTION OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx), because its list and its suppliers
  // are separate addresses: the shell's reset to the top at every address would send the list back to the top at each
  // supplier on the split, and bring Back on a phone to the top of the list while the focus went to a row far below. The
  // effects below handle every move.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a supplier opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  // A supplier opens one level down, so Back steps up to the list. On the split, with a supplier already open beside the
  // list, picking another is lateral and replaces it — and keeps whatever the entry it replaces knew about where Back goes.
  const openSupplier = (id: string) => {
    handBack.expect(supplierOpener(id));
    if (split && view.kind !== 'list') {
      void navigate(supplierPath(id), { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      // On a phone the list is hidden behind the supplier, and the page shrinks to it: the place in the list is written
      // down now, while the list is what is on screen.
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(supplierPath(id), { state: FROM_LIST });
    }
  };

  // «New supplier» and Settings open the way a supplier does: one level down, in the right-hand pane on the split for the
  // card (with a supplier already open there, picking it is lateral and replaces it), and Settings full width at every size.
  const openNew = () => {
    if (view.kind === 'supplier-new') return;
    handBack.expect(NEW_OPENER);
    if (split && view.kind !== 'list') {
      void navigate(NEW_SUPPLIER_PATH, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(NEW_SUPPLIER_PATH, { state: FROM_LIST });
    }
  };

  const openSettings = () => {
    if (view.kind === 'settings') return;
    handBack.expect(SETTINGS_OPENER);
    // The list is hidden behind Settings at every width, so its place is written down whatever the width.
    listTop.current = scrollArea()?.scrollTop ?? null;
    if (split && view.kind !== 'list') {
      void navigate(SUPPLIERS_SETTINGS_PATH, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      void navigate(SUPPLIERS_SETTINGS_PATH, { state: FROM_LIST });
    }
  };

  // A tab REPLACES the entry: three lists are three windows onto the same records, not three steps (parity S45). The focus
  // stays on the tab that was pressed, so the next arrow key has something to move from.
  const openTab = (tab: SuppliersTab) => {
    if (view.kind === 'list' && view.tab === tab) return;
    void navigate(tabPath(tab), { replace: true, state: KEEP_FOCUS });
  };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so the place is back when the
  // row takes the focus: focusing a row that is in view scrolls nothing.
  //  - A tab is a new list: the top, whatever the width.
  //  - On the split the list otherwise keeps its place (the right-hand side starts at its own top, below). Settings are the
  //    exception: they take the whole row, so to and from them the split behaves as a phone does.
  //  - On a phone, Back to the list restores the place written down when a supplier opened; any other move is a new screen
  //    and starts at the top.
  //  - The first render does nothing: the shell reset the area when the section was entered.
  const shown = useRef<{ pathname: string; kind: ShownView['kind'] } | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { pathname, kind: view.kind };
    const area = scrollArea();
    // The same address twice is StrictMode running the effect again, not a move.
    if (before === null || before.pathname === pathname || area === null) return;
    if (before.kind === 'list' && view.kind === 'list') {
      listTop.current = null;
      area.scrollTop = 0;
    } else if (split && before.kind !== 'settings' && view.kind !== 'settings') {
      listTop.current = null;
    } else if (view.kind === 'list' && listTop.current !== null) {
      area.scrollTop = listTop.current;
      listTop.current = null;
    } else {
      area.scrollTop = 0;
    }
  }, [pathname]);

  // Back out of a supplier (its own Back, or the phone's back gesture): the row that opened it takes the focus, once the
  // list is on screen again (on a phone it was hidden behind the supplier, not unmounted).
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver();
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own (SuppliersSection.module.css), and it stays mounted from one
  // supplier to the next: another supplier starts at its top instead of where the last one was left. On a phone it is not
  // a scroll area and this is a no-op.
  useLayoutEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [pathname]);

  return (
    <HandBackProvider value={handBack}>
      <SupplierDeletionsProvider value={deletions}>
      <Page title={t('sup.title')}>
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : view.kind === 'settings' ? 'wide' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <SuppliersList
                tab={tabOf(view)}
                openSupplierId={view.kind === 'supplier' || view.kind === 'supplier-edit' ? view.id : null}
                onTab={openTab}
                onOpenSupplier={openSupplier}
                newOpen={view.kind === 'supplier-new'}
                onNew={openNew}
                settingsOpen={view.kind === 'settings'}
                onOpenSettings={openSettings}
              />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <SuppliersDetail view={view} />
            </PartBoundary>
          </div>
        </div>
      </Page>
      </SupplierDeletionsProvider>
    </HandBackProvider>
  );
}
