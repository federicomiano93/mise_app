import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useCopyWait } from './copyWait';
import { SupplierCard } from './SupplierCard';
import { useSuppliers } from './SuppliersContext';
import { cameFromList, cameFromSupplier } from './suppliersNav';
import { SUPPLIERS_TAB_PATH } from './suppliersPath';
import styles from './SupplierCard.module.css';

// The card's own screen: a new supplier (`id` null), or a supplier by its address.
//
// ⚠️ AN EXISTING SUPPLIER OPENS ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE: the card copies the supplier once and
// Save writes every field, so a card opened from a copy a week old would write last week's phone number back over another
// phone's change. It waits for the server's first answer — or, with no signal (or none after COPY_WAIT_MS), opens what
// this phone has. «This supplier no longer exists» is said only on the server's word (or after that wait), like the
// supplier's own screen.
//
// ⚠️ A SUPPLIER THAT LEAVES THE LIST WHILE ITS CARD IS OPEN (deleted on another phone) KEEPS THE CARD ON SCREEN: the card
// holds the person's typing, and Save puts the supplier back (the current app does the same).
export function SupplierCardScreen({ id }: { id: string | null }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const snapshot = useSuppliers();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const supplier = id === null ? null : snapshot.suppliers.find(candidate => candidate.id === id) ?? null;

  const waited = useCopyWait(id === null || snapshot.suppliersFromServer || snapshot.suppliersBroken);
  const canOpen = id === null || (supplier !== null && waited);

  // The id whose card has been shown: a supplier that leaves the list afterwards is not «gone» for this screen.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (canOpen && id !== null && shownFor !== id) setShownFor(id);
  const hasForm = id === null || canOpen || shownFor === id;
  const gone = !hasForm && supplier === null && snapshot.suppliersLoaded && !snapshot.suppliersBroken && waited;
  const broken = !hasForm && supplier === null && snapshot.suppliersBroken;
  const waiting = !hasForm && !gone && !broken;

  useEffect(() => {
    if (!gone) return;
    say(t('sup.supplierGone'));
    void navigate(SUPPLIERS_TAB_PATH, { replace: true, state: KEEP_FOCUS });
  }, [gone]);

  // Opened from a tap (the list's button, the supplier's «Edit»), the page does not move the focus: it goes to this title.
  // Not on a POP (Back arriving here again).
  useEffect(() => {
    if (waiting || gone || broken) return;
    if ((cameFromList(state) || cameFromSupplier(state)) && navigationType !== 'POP') title.current?.focus();
  }, [waiting, gone, broken]);

  if (broken) {
    return (
      <section className={styles.waiting} aria-labelledby={titleId}>
        <FormBar
          backLabel={t('ui.back')}
          onBack={() => { void navigate(SUPPLIERS_TAB_PATH, { replace: true, state: KEEP_FOCUS }); }}
          title={t('sup.editSupplier')}
          titleId={titleId}
          titleRef={title}
        />
        <p className={styles.failed}>{t('sup.loadFailed')}</p>
      </section>
    );
  }
  if (waiting || gone) {
    return (
      <section className={styles.waiting} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return <SupplierCard key={id ?? 'new'} id={id} supplier={supplier} titleRef={title} />;
}
