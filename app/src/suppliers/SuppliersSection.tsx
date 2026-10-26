import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { isPackaging } from '@mise/shared/ingredient-kind';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { useMediaQuery } from '../ui/useMediaQuery';
import { HandBackProvider, IMPORT_OPENER, NEW_OPENER, PRICE_CHANGES_OPENER, SETTINGS_OPENER, itemOpener, supplierOpener, useHandBackState } from './handBack';
import { createIngredientDeletions, IngredientDeletionsProvider } from './ingredientDeletions';
import { useMayImport } from './invoiceImport/useMayImport';
import { createSupplierDeletions, SupplierDeletionsProvider } from './supplierDeletions';
import { SuppliersProvider, useSuppliers, useSuppliersStore } from './SuppliersContext';
import { SuppliersDetail } from './SuppliersDetail';
import type { ShownView } from './SuppliersDetail';
import { SuppliersList } from './SuppliersList';
import { FROM_LIST, cameFromList, fromListTab, supplierScreenOf, tabOfState } from './suppliersNav';
import { messageText } from './suppliersMessages';
import {
  NEW_INGREDIENT_PATH, NEW_PACKAGING_PATH, NEW_SUPPLIER_PATH, SUPPLIERS_IMPORT_PATH, SUPPLIERS_PATH, SUPPLIERS_PRICE_CHANGES_PATH, SUPPLIERS_SETTINGS_PATH,
  ingredientPath, parseSuppliersPath, supplierPath, tabOf, tabPath,
} from './suppliersPath';
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
// one off, deleting it) and adds Settings; 3e-2 adds the ingredient card, whose product data it opens from a row, from «New …»
// and from a supplier's screen (docs/parity/suppliers.md).
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
  const { pathname, search, state } = useLocation();
  const navigationType = useNavigationType();
  const { canManage } = useSession();
  const mayImport = useMayImport();
  // The address as it is written, not React Router's «*»: a supplier id is split before it is decoded (suppliersPath.ts).
  const view = parseSuppliersPath(pathname.slice(SUPPLIERS_PATH.length), search);

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
  // ⚠️ THE IMPORT IS FOR A PRICE WRITER OF AN ITALIAN VENUE (decision F3 (b)): anybody else who types the address is sent to the
  // list, and nothing of the screen is drawn. The rules are the real guard; this is courtesy.
  // «Price changes» has the import's gate (parity I101): the report fills only from imports.
  if ((view.kind === 'import' || view.kind === 'price-changes') && !mayImport) {
    return <Navigate to={SUPPLIERS_PATH} replace state={KEEP_FOCUS} />;
  }
  return <SuppliersLayout view={view} />;
}

// The screens that take the whole row at every size (the list is not drawn beside them).
const isWide = (kind: ShownView['kind']): boolean => kind === 'settings' || kind === 'import' || kind === 'price-changes';

function SuppliersLayout({ view }: { view: ShownView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  // The suppliers this phone's own screens are deleting (supplierDeletions.ts); a mark goes when its supplier is back.
  const deletions = useMemo(createSupplierDeletions, []);
  const handBack = useHandBackState(deletions);
  const { suppliers, ingredients } = useSuppliers();
  useEffect(() => { deletions.prune(suppliers.map(supplier => supplier.id)); }, [deletions, suppliers]);
  // The same for the ingredients this phone is deleting (ingredientDeletions.ts).
  const ingredientDeletions = useMemo(createIngredientDeletions, []);
  useEffect(() => { ingredientDeletions.prune(ingredients.map(item => item.id)); }, [ingredientDeletions, ingredients]);

  // ⚠️ THE LIST BESIDE (OR BEHIND) AN ITEM'S CARD: opened from a supplier's screen, the Suppliers tab; otherwise the tab it was
  // opened from (carried in the navigation state), and by its address alone, the tab of its kind.
  const supplierOrigin = view.kind === 'ingredient' || view.kind === 'ingredient-new' ? supplierScreenOf(state) : null;
  let listTab = tabOf(view);
  if (view.kind === 'ingredient' || view.kind === 'ingredient-new') {
    const item = view.kind === 'ingredient' ? ingredients.find(candidate => candidate.id === view.id) : undefined;
    listTab = supplierOrigin !== null ? 'suppliers' : (tabOfState(state) ?? (item && isPackaging(item) ? 'packaging' : listTab));
  }

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

  // An ingredient or packaging row opens its card the same way, remembering the tab it was opened from so the same list stays
  // beside the card (a packaging item opened from the Ingredients tab by its address would otherwise bring the other tab).
  const openItem = (id: string) => {
    handBack.expect(itemOpener(id));
    if (split && view.kind !== 'list') {
      void navigate(ingredientPath(id), { replace: true, state: cameFromList(state) ? fromListTab(listTab) : KEEP_FOCUS });
    } else {
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(ingredientPath(id), { state: fromListTab(listTab) });
    }
  };

  // «New supplier», «New ingredient» and «New packaging» (by the tab) and Settings open the way a supplier does: one level
  // down, in the right-hand pane on the split for the card (with something already open there, picking it is lateral and
  // replaces it), and Settings full width at every size.
  const newOpen = view.kind === 'supplier-new' || (view.kind === 'ingredient-new' && supplierOrigin === null);
  const openNew = () => {
    if (newOpen) return;
    handBack.expect(NEW_OPENER);
    const target = listTab === 'suppliers' ? NEW_SUPPLIER_PATH : listTab === 'packaging' ? NEW_PACKAGING_PATH : NEW_INGREDIENT_PATH;
    if (split && view.kind !== 'list') {
      void navigate(target, { replace: true, state: cameFromList(state) ? fromListTab(listTab) : KEEP_FOCUS });
    } else {
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(target, { state: fromListTab(listTab) });
    }
  };

  // «Import from invoices» opens the way Settings does: full width at every size, one level down.
  const openImport = () => {
    if (view.kind === 'import') return;
    handBack.expect(IMPORT_OPENER);
    listTop.current = scrollArea()?.scrollTop ?? null;
    if (split && view.kind !== 'list') {
      void navigate(SUPPLIERS_IMPORT_PATH, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      void navigate(SUPPLIERS_IMPORT_PATH, { state: FROM_LIST });
    }
  };

  // «Price changes» opens the same way: full width at every size, one level down.
  const openPriceChanges = () => {
    if (view.kind === 'price-changes') return;
    handBack.expect(PRICE_CHANGES_OPENER);
    listTop.current = scrollArea()?.scrollTop ?? null;
    if (split && view.kind !== 'list') {
      void navigate(SUPPLIERS_PRICE_CHANGES_PATH, { replace: true, state: cameFromList(state) ? FROM_LIST : KEEP_FOCUS });
    } else {
      void navigate(SUPPLIERS_PRICE_CHANGES_PATH, { state: FROM_LIST });
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
  //  - On the split the list otherwise keeps its place (the right-hand side starts at its own top, below). Settings and the
  //    import are the exception: they take the whole row, so to and from them the split behaves as a phone does.
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
    } else if (split && !isWide(before.kind) && !isWide(view.kind)) {
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
      <IngredientDeletionsProvider value={ingredientDeletions}>
      <Page title={t('sup.title')}>
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : isWide(view.kind) ? 'wide' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <SuppliersList
                tab={listTab}
                openSupplierId={view.kind === 'supplier' || view.kind === 'supplier-edit' ? view.id : supplierOrigin}
                onTab={openTab}
                onOpenSupplier={openSupplier}
                openItemId={view.kind === 'ingredient' ? view.id : null}
                onOpenItem={openItem}
                newOpen={newOpen}
                onNew={openNew}
                settingsOpen={view.kind === 'settings'}
                onOpenSettings={openSettings}
                importOpen={view.kind === 'import'}
                onOpenImport={openImport}
                priceChangesOpen={view.kind === 'price-changes'}
                onOpenPriceChanges={openPriceChanges}
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
      </IngredientDeletionsProvider>
      </SupplierDeletionsProvider>
    </HandBackProvider>
  );
}
