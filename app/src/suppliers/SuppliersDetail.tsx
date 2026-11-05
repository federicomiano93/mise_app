import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { SETTINGS_OPENER, useHandBack } from './handBack';
import { SupplierCardScreen } from './SupplierCardScreen';
import { SupplierScreen } from './SupplierScreen';
import { useSuppliers } from './SuppliersContext';
import { SuppliersSettings } from './SuppliersSettings';
import { cameFromList, useLeave } from './suppliersNav';
import { SUPPLIERS_PATH } from './suppliersPath';
import type { SuppliersTab, SuppliersView } from './suppliersPath';
import styles from './SuppliersDetail.module.css';

// Every view the section draws: a list, a supplier's own screen, its card, a new supplier, or Settings. (An address that
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
  if (view.kind === 'settings') return <SettingsScreen />;
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
