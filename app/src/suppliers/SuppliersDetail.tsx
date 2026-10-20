import { useT } from '../i18n/useT';
import { SupplierScreen } from './SupplierScreen';
import { useSuppliers } from './SuppliersContext';
import type { SuppliersTab, SuppliersView } from './suppliersPath';
import styles from './SuppliersDetail.module.css';

// The views this slice draws: a list, or one supplier's own screen. The supplier card, a new supplier and Settings arrive
// with slice B (the section sends their addresses to the list until then).
export type ShownView = Extract<SuppliersView, { kind: 'list' | 'supplier' }>;

// The right-hand side of the split — and, on a phone, the whole screen when a supplier is open. With nothing chosen it
// says what to do.
//
// (No `key` on the supplier screen: the section keeps one screen from one supplier to the next on the split, so the focus
// stays on the row that was pressed.)
export function SuppliersDetail({ view }: { view: ShownView }) {
  if (view.kind === 'list') return <Prompt tab={view.tab} />;
  return <SupplierScreen id={view.id} />;
}

// Only the split draws this (a phone hides the right-hand side while the list is the screen).
//
// ⚠️ ONLY BESIDE THE SUPPLIERS TAB: an ingredient has no card to open yet (step 3e-2), so a prompt to «tap an ingredient»
// would promise what is not there.
function Prompt({ tab }: { tab: SuppliersTab }) {
  const { t } = useT();
  const { suppliers } = useSuppliers();
  // ⚠️ NOT BESIDE «NO SUPPLIERS YET»: a prompt to tap a supplier, next to a list that says there are none, would send
  // somebody looking for what is not there.
  if (tab !== 'suppliers' || suppliers.length === 0) return null;
  return (
    <div className={styles.prompt}>
      <p className={styles.promptTitle}>{t('sup.pane.suppliers.title')}</p>
      <p>{t('sup.pane.suppliers.text')}</p>
    </div>
  );
}
