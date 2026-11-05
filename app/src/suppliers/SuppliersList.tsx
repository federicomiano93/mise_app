import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronRight, FileUp, Plus, Search, Settings } from 'lucide-react';
import { favouriteGroups } from '@mise/shared/favourite-suppliers';
import { ingredientDisplayName, ingredientNameMatches } from '@mise/shared/ingredient-name';
import { isPackaging } from '@mise/shared/ingredient-kind';
import { normalizeText } from '@mise/shared/ingredient-search';
import { supplierLabel, supplierMatches } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { ItemRow, ItemRows } from './ItemRow';
import { NotInUseGroup, useNotInUseOpen } from './NotInUseGroup';
import { useMayImport } from './invoiceImport/useMayImport';
import { IMPORT_OPENER, NEW_OPENER, SEARCH_OPENER, SETTINGS_OPENER, itemOpener, supplierOpener, useHandBack } from './handBack';
import type { SuppliersTab } from './suppliersPath';
import { useSuppliers } from './SuppliersContext';
import type { StoredDoc } from './suppliersSource';
import styles from './SuppliersList.module.css';

// The current app's debounce: the box tells the list what is typed on every keystroke, and the rows are repainted
// 140 ms after the last one.
export const SEARCH_DEBOUNCE_MS = 140;

// Ingredients first (parity S45: «this list IS the work»): the default, the DOM order and the order on screen agree.
const TABS: readonly SuppliersTab[] = ['ingredients', 'suppliers', 'packaging'];

const TAB_KEY = {
  ingredients: 'sup.tab.ingredients',
  suppliers: 'sup.tab.suppliers',
  packaging: 'sup.tab.packaging',
} as const satisfies Record<SuppliersTab, MessageKey>;

const SEARCH_KEY = {
  ingredients: 'sup.search.ingredients',
  suppliers: 'sup.search.suppliers',
  packaging: 'sup.search.packaging',
} as const satisfies Record<SuppliersTab, MessageKey>;

const EMPTY_TITLE_KEY = {
  ingredients: 'sup.empty.ingredients.title',
  suppliers: 'sup.empty.suppliers.title',
  packaging: 'sup.empty.packaging.title',
} as const satisfies Record<SuppliersTab, MessageKey>;

const EMPTY_SUB_KEY = {
  ingredients: 'sup.empty.ingredients.sub',
  suppliers: 'sup.empty.suppliers.sub',
  packaging: 'sup.empty.packaging.sub',
} as const satisfies Record<SuppliersTab, MessageKey>;

const NO_MATCH_KEY = {
  ingredients: 'sup.noMatch.ingredients',
  suppliers: 'sup.noMatch.suppliers',
  packaging: 'sup.noMatch.packaging',
} as const satisfies Record<SuppliersTab, MessageKey>;

const NEW_KEY = {
  ingredients: 'sup.newIngredient',
  suppliers: 'sup.newSupplier',
  packaging: 'sup.newPackaging',
} as const satisfies Record<SuppliersTab, MessageKey>;

const tabId = (tab: SuppliersTab): string => `sup-tab-${tab}`;
const PANEL_ID = 'sup-panel';

type Props = {
  // The tab the address names (tabOf(view)).
  tab: SuppliersTab;
  // The supplier open beside the list (the tablet's split), marked as the current one.
  openSupplierId: string | null;
  onTab: (tab: SuppliersTab) => void;
  onOpenSupplier: (id: string) => void;
  // The ingredient or packaging item open beside the list, and the row that opens one.
  openItemId: string | null;
  onOpenItem: (id: string) => void;
  // «New supplier» / «New ingredient» / «New packaging» (by the tab) is the screen shown, and the button that opens it.
  newOpen: boolean;
  onNew: () => void;
  // Settings are the screen shown, and the door to them at the foot of the list.
  settingsOpen: boolean;
  onOpenSettings: () => void;
  // «Import from invoices» is the screen shown, and the door to it beside Settings (drawn only where the import is allowed).
  importOpen: boolean;
  onOpenImport: () => void;
};

// Where an arrow, Home or End key sends the selection.
function targetOf(key: string, index: number, last: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return index === last ? 0 : index + 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return index === 0 ? last : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

// The left column: the tabs and ONE search box (they stay on screen while the rows scroll), over the list the tab names.
//
// ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT. It is a controlled input in a component that stays mounted,
// and only the rows below it are redrawn: a snapshot landing mid-keystroke must find the text and the keyboard where
// the person left them. The three tabs share it, so it is not even remounted by a tab (parity S48).
//
// ⚠️ A TAB CLEARS THE SEARCH (parity S49), however the tab came to change — one list's query must never filter the other.
export function SuppliersList({ tab, openSupplierId, onTab, onOpenSupplier, openItemId, onOpenItem, newOpen, onNew, settingsOpen, onOpenSettings, importOpen, onOpenImport }: Props) {
  const { t } = useT();
  const { canManage } = useSession();
  const handBack = useHandBack();
  const newDoor = useCallback((node: HTMLButtonElement | null) => { handBack.register(NEW_OPENER, node); }, [handBack]);
  const mayImport = useMayImport();
  const importDoor = useCallback((node: HTMLButtonElement | null) => { handBack.register(IMPORT_OPENER, node); }, [handBack]);
  const settingsDoor = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);
  const snapshot = useSuppliers();
  const searchOpener = useCallback((node: HTMLInputElement | null) => { handBack.register(SEARCH_OPENER, node); }, [handBack]);
  const tabs = useRef(new Map<SuppliersTab, HTMLButtonElement>());

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [lastTab, setLastTab] = useState(tab);
  if (lastTab !== tab) {
    setLastTab(tab);
    setText('');
    setQuery('');
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(text); }, SEARCH_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); };
  }, [text]);

  const suppliersTab = tab === 'suppliers';
  const loaded = suppliersTab ? snapshot.suppliersLoaded : snapshot.ingredientsLoaded;
  const broken = suppliersTab ? snapshot.suppliersBroken : snapshot.ingredientsBroken;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = targetOf(event.key, index, TABS.length - 1);
    const next = target === null ? undefined : TABS[target];
    if (!next) return;
    event.preventDefault();
    onTab(next);
    tabs.current.get(next)?.focus();
  }

  return (
    <div className={styles.column}>
      <div className={styles.head}>
        <div role="tablist" aria-label={t('sup.whichList')} className={styles.tabs}>
          {TABS.map((name, index) => {
            const selected = name === tab;
            return (
              <button
                key={name}
                ref={node => {
                  if (node) tabs.current.set(name, node);
                  else tabs.current.delete(name);
                }}
                type="button"
                role="tab"
                id={tabId(name)}
                aria-selected={selected}
                aria-controls={selected ? PANEL_ID : undefined}
                tabIndex={selected ? 0 : -1}
                className={styles.tab}
                onClick={() => { onTab(name); }}
                onKeyDown={event => { onKeyDown(event, index); }}
              >
                {t(TAB_KEY[name])}
              </button>
            );
          })}
        </div>
        {/* The search box and, under it at every width, the button that makes a new one of what the tab lists (a supplier, an
            ingredient, a packaging item). ⚠️ NEVER HIDDEN ON A ROLE (parity S5): employees add them too, and it stands also over
            «No … yet», the way to the first one. */}
        <div className={styles.top}>
          <div className={styles.search}>
            <Search aria-hidden="true" />
            <input
              ref={searchOpener}
              type="search"
              autoComplete="off"
              className={styles.input}
              aria-label={t(SEARCH_KEY[tab])}
              placeholder={t(SEARCH_KEY[tab])}
              value={text}
              onChange={event => { setText(event.target.value); }}
            />
          </div>
          <Button
            ref={newDoor}
            variant="primary"
            className={styles.newSupplier}
            aria-current={newOpen ? 'true' : undefined}
            onPress={onNew}
          >
            <Plus aria-hidden="true" />
            <span>{t(NEW_KEY[tab])}</span>
          </Button>
        </div>
      </div>

      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className={styles.panel}>
        {/* ⚠️ A DEAD STREAM IS SAID OUT LOUD (parity S71): an empty list reads as «this bakery has no suppliers» while
            standing in front of a delivery. The live region is on the page before it speaks. */}
        <p role="status" className={broken ? styles.failed : styles.quiet}>{broken ? t('sup.loadFailed') : null}</p>

        {!loaded ? (
          <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        ) : suppliersTab ? (
          <SupplierRows
            suppliers={snapshot.suppliers}
            items={snapshot.ingredients}
            countsReady={snapshot.ingredientsLoaded}
            favourites={snapshot.favourites}
            query={query}
            broken={broken}
            openSupplierId={openSupplierId}
            onOpenSupplier={onOpenSupplier}
          />
        ) : (
          // Keyed by the tab: each list starts with its «Not in use» group folded (the two tabs are the same component).
          <ItemList
            key={tab}
            tab={tab}
            items={snapshot.ingredients}
            suppliers={snapshot.suppliers}
            query={query}
            broken={broken}
            openItemId={openItemId}
            onOpenItem={onOpenItem}
          />
        )}
      </div>

      {/* ⚠️ THE DOOR TO THE IMPORT IS FOR A PRICE WRITER OF AN ITALIAN VENUE (useMayImport): the importer reads only Italian e-invoices. */}
      {mayImport ? (
        <Button
          ref={importDoor}
          variant="secondary"
          className={styles.door}
          aria-current={importOpen ? 'true' : undefined}
          onPress={onOpenImport}
        >
          <FileUp aria-hidden="true" />
          <span>{t('sup.imp.title')}</span>
        </Button>
      ) : null}
      {/* ⚠️ THE DOOR TO SETTINGS EXISTS ONLY FOR WHOEVER RUNS THE PLACE (owner or manager): a screen of switches that an
          employee could not save would be worse than no screen. The address is checked again by the section, and the rules
          are the real guard (parity S9). */}
      {canManage ? (
        <Button
          ref={settingsDoor}
          variant="secondary"
          className={styles.door}
          aria-current={settingsOpen ? 'true' : undefined}
          onPress={onOpenSettings}
        >
          <Settings aria-hidden="true" />
          <span>{t('ui.settings')}</span>
        </Button>
      ) : null}
    </div>
  );
}

function EmptyState({ tab }: { tab: SuppliersTab }) {
  const { t } = useT();
  // Nothing exists yet. (The button that makes the first one is «New …» above.)
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{t(EMPTY_TITLE_KEY[tab])}</p>
      <p className={styles.emptySub}>{t(EMPTY_SUB_KEY[tab])}</p>
    </div>
  );
}

type SupplierRowsProps = {
  suppliers: readonly StoredDoc[];
  items: readonly StoredDoc[];
  countsReady: boolean;
  favourites: readonly string[];
  query: string;
  broken: boolean;
  openSupplierId: string | null;
  onOpenSupplier: (id: string) => void;
};

// The Suppliers tab: every supplier, switched off ones too, A–Z by the label the app shows, the starred ones first under
// their own heading when any is in view (parity S54–S56).
function SupplierRows({ suppliers, items, countsReady, favourites, query, broken, openSupplierId, onOpenSupplier }: SupplierRowsProps) {
  const { t } = useT();
  const handBack = useHandBack();

  const sorted = useMemo(
    () => [...suppliers].sort((a, b) => supplierLabel(a).localeCompare(supplierLabel(b))),
    [suppliers],
  );
  // The search folds accents (decision T10) and looks at the name and the short name — never the category (S54).
  const visible = useMemo(() => {
    const q = normalizeText(query);
    return sorted.filter(supplier => supplierMatches(supplier, q, normalizeText));
  }, [sorted, query]);
  // Built once per paint rather than filtered per row.
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const item of items) {
      if (typeof item.supplierId === 'string') out.set(item.supplierId, (out.get(item.supplierId) ?? 0) + 1);
    }
    return out;
  }, [items]);

  if (suppliers.length === 0) return broken ? null : <EmptyState tab="suppliers" />;
  if (visible.length === 0) return <p className={styles.nothing}>{t(NO_MATCH_KEY.suppliers)}</p>;

  const groups = favouriteGroups(visible, favourites);
  return (
    <>
      {groups.map(group => (
        <div key={group.headingKey ?? 'all'} className={styles.group}>
          {group.headingKey === null ? null : (
            <h2 className={styles.groupTitle}>
              {t(group.headingKey === 'orders.favourites.title' ? 'sup.favourites.title' : 'sup.favourites.others')}
            </h2>
          )}
          <ul className={styles.rows}>
            {group.suppliers.map(supplier => {
              const count = counts.get(supplier.id) ?? 0;
              const meta = [
                typeof supplier.category === 'string' ? supplier.category : '',
                // The count waits for the ingredients: before them every supplier would say «0 products».
                countsReady ? t('sup.productsCount', { n: count }) : '',
              ].filter(part => part !== '').join(' · ');
              return (
                <SupplierRow
                  key={supplier.id}
                  id={supplier.id}
                  name={supplierLabel(supplier)}
                  meta={meta}
                  off={supplier.active === false}
                  isOpen={supplier.id === openSupplierId}
                  // The supplier that is already open stays as it is: nothing to open.
                  onPress={opened => { if (opened !== openSupplierId) onOpenSupplier(opened); }}
                  register={handBack.register}
                />
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

type ItemListProps = {
  tab: SuppliersTab;
  items: readonly StoredDoc[];
  suppliers: readonly StoredDoc[];
  query: string;
  broken: boolean;
  openItemId: string | null;
  onOpenItem: (id: string) => void;
};

// The Ingredients and Packaging tabs: every item of that kind, A–Z, whoever sells it (parity S57–S60).
function ItemList({ tab, items, suppliers, query, broken, openItemId, onOpenItem }: ItemListProps) {
  const { t } = useT();
  const handBack = useHandBack();
  const packaging = tab === 'packaging';

  const all = useMemo(
    () => items
      .filter(item => isPackaging(item) === packaging)
      .sort((a, b) => ingredientDisplayName(a).localeCompare(ingredientDisplayName(b))),
    [items, packaging],
  );
  const visible = useMemo(() => {
    const q = normalizeText(query);
    return all.filter(item => ingredientNameMatches(item, q, normalizeText));
  }, [all, query]);
  // ⚠️ 3e-5b: the items switched off with «Not in use at the moment» are never hidden: they sit under the active ones in a folded
  // group. The group opens by itself when the item open beside the list is in it (a just-switched-off item keeps its row, and
  // Back hands the focus to it) or when the search finds one.
  const active = useMemo(() => visible.filter(item => item.active !== false), [visible]);
  const inactive = useMemo(() => visible.filter(item => item.active === false), [visible]);
  const group = useNotInUseOpen(
    (openItemId !== null && inactive.some(item => item.id === openItemId)) || (query.trim() !== '' && inactive.length > 0),
  );
  const labels = useMemo(() => new Map(suppliers.map(supplier => [supplier.id, supplierLabel(supplier)] as const)), [suppliers]);

  if (all.length === 0) return broken ? null : <EmptyState tab={tab} />;
  if (visible.length === 0) return <p className={styles.nothing}>{t(NO_MATCH_KEY[tab])}</p>;
  const rowOf = (item: StoredDoc, inNotInUse: boolean) => (
    // ⚠️ '' and never undefined for an item whose supplier is gone: undefined means «on the supplier's own screen».
    <ItemRow
      key={item.id}
      item={item}
      supplier={typeof item.supplierId === 'string' ? (labels.get(item.supplierId) ?? '') : ''}
      isOpen={item.id === openItemId}
      onOpen={onOpenItem}
      opener={itemOpener(item.id)}
      register={handBack.register}
      inNotInUse={inNotInUse}
    />
  );
  return (
    <>
      {active.length > 0 ? <ItemRows>{active.map(item => rowOf(item, false))}</ItemRows> : null}
      {inactive.length > 0 ? (
        <NotInUseGroup count={inactive.length} open={group.open} onToggle={group.onToggle}>
          <ItemRows>{inactive.map(item => rowOf(item, true))}</ItemRows>
        </NotInUseGroup>
      ) : null}
    </>
  );
}

type RowProps = {
  id: string;
  name: string;
  meta: string;
  off: boolean;
  isOpen: boolean;
  onPress: (id: string) => void;
  register: (name: string, node: HTMLElement | null) => void;
};

// One supplier: its name, a line under it and a chevron. The whole row is the button.
function SupplierRow({ id, name, meta, off, isOpen, onPress, register }: RowProps) {
  const { t } = useT();
  // Back from this supplier's screen hands the focus back to this button.
  const opener = useCallback((node: HTMLButtonElement | null) => { register(supplierOpener(id), node); }, [register, id]);
  return (
    <li className={styles.item}>
      <button
        ref={opener}
        type="button"
        className={styles.row}
        aria-current={isOpen ? 'true' : undefined}
        data-open={isOpen}
        data-off={off}
        onClick={() => { onPress(id); }}
      >
        <span className={styles.main}>
          <span className={styles.name}>{name}</span>
          {meta !== '' ? <span className={styles.meta}>{meta}</span> : null}
          {off ? <span className={styles.tag}>{t('sup.switchedOff')}</span> : null}
        </span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </button>
    </li>
  );
}
