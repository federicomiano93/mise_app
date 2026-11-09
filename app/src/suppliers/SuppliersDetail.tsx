import { Suspense, lazy, useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { SETTINGS_OPENER, useHandBack } from './handBack';
import { IngredientCardScreen } from './IngredientCardScreen';
import { MergeScreen } from './merge/MergeScreen';
import { PriceChangesScreen } from './priceChanges/PriceChangesScreen';
import { SupplierCardScreen } from './SupplierCardScreen';
import { SupplierScreen } from './SupplierScreen';
import { useSuppliers } from './SuppliersContext';
import { SuppliersSettings } from './SuppliersSettings';
import { cameFromList, useLeave } from './suppliersNav';
import { SUPPLIERS_PATH } from './suppliersPath';
import type { SuppliersTab, SuppliersView } from './suppliersPath';
import styles from './SuppliersDetail.module.css';

const InvoiceImportScreen = lazy(() => import('./invoiceImport/InvoiceImportScreen'));

// Every view the section draws: a list, a supplier's own screen, its card, a new supplier, Settings or the import. (An address that
// names none of them is sent back to the list by the section.)
export type ShownView = Exclude<SuppliersView, { kind: 'unknown' }>;

// The right-hand side of the split — and, on a phone, the whole screen when a supplier is open. With nothing chosen it
// says what to do.
//
// (No `key` on the supplier screen: the section keeps one screen from one supplier to the next on the split, so the focus
// stays on the row that was pressed. The card and Settings are keyed on what they are: each puts the focus on its own title
// when it opens.)
export function SuppliersDetail({ view }: { view: ShownView }) {
  if (view.kind === 'list') return <Prompt tab={view.tab} />;
  if (view.kind === 'supplier-new') return <SupplierCardScreen key="new" id={null} />;
  if (view.kind === 'supplier-edit') return <SupplierCardScreen key="edit" id={view.id} />;
  // Keyed on what the card is, so a card opened for another item starts afresh (it copies its item once).
  if (view.kind === 'ingredient') return <IngredientCardScreen key={`ingredient-${view.id}`} id={view.id} packaging={false} preset={null} />;
  // The chooser of «Merge another pack…», keyed like the card so a chooser for another item starts afresh.
  if (view.kind === 'ingredient-merge') return <MergeScreen key={`merge-${view.id}`} id={view.id} />;
  if (view.kind === 'ingredient-new') {
    return <IngredientCardScreen key="ingredient-new" id={null} packaging={view.packaging} preset={view.supplier} />;
  }
  if (view.kind === 'settings') return <SettingsScreen />;
  // Loaded when somebody opens it: the reader, the plan and the zip library are code nobody needs until then (P16).
  if (view.kind === 'import') {
    return (
      <Suspense fallback={null}>
        <InvoiceImportScreen />
      </Suspense>
    );
  }
  if (view.kind === 'price-changes') return <PriceChangesScreen />;
  return <SupplierScreen id={view.id} />;
}

// Settings (its gate, whoever runs the place, is checked by the section before it gets here). Back steps up to the list
// and hands the focus back to the door that opened it.
function SettingsScreen() {
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const title = useRef<HTMLHeadingElement>(null);
  const leave = useLeave(SUPPLIERS_PATH, () => { handBack.expect(SETTINGS_OPENER); });

  // Opened from the list the page does not move the focus (FROM_LIST): it goes to this title.
  useEffect(() => {
    if (cameFromList(state) && navigationType !== 'POP') title.current?.focus();
  }, []);

  return <SuppliersSettings titleRef={title} onBack={leave} />;
}

const PANE_TITLE = {
  ingredients: 'sup.pane.ingredients.title',
  suppliers: 'sup.pane.suppliers.title',
  packaging: 'sup.pane.packaging.title',
} as const satisfies Record<SuppliersTab, MessageKey>;

const PANE_TEXT = {
  ingredients: 'sup.pane.ingredients.text',
  suppliers: 'sup.pane.suppliers.text',
  packaging: 'sup.pane.packaging.text',
} as const satisfies Record<SuppliersTab, MessageKey>;

// Only the split draws this (a phone hides the right-hand side while the list is the screen).
//
function Prompt({ tab }: { tab: SuppliersTab }) {
  const { t } = useT();
  const { suppliers } = useSuppliers();
  const { ingredients } = useSuppliers();
  // ⚠️ NOT BESIDE «NO … YET»: a prompt to tap a row, next to a list that says there are none, would send somebody looking for
  // what is not there.
  const wanted = tab === 'suppliers' ? suppliers.length : ingredients.filter(item => (item.kind === 'packaging') === (tab === 'packaging')).length;
  if (wanted === 0) return null;
  return (
    <div className={styles.prompt}>
      <p className={styles.promptTitle}>{t(PANE_TITLE[tab])}</p>
      <p>{t(PANE_TEXT[tab])}</p>
    </div>
  );
}
