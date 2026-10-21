import { useEffect, useId, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useCopyWait } from './copyWait';
import { ItemRow, ItemRows } from './ItemRow';
import { supplierOpener, useHandBack } from './handBack';
import { DAY_KEY, isWeekday } from './supplierDays';
import { useSupplierDeletions } from './supplierDeletions';
import { SUPPLIERS_TAB_PATH, supplierEditPath } from './suppliersPath';
import { FROM_SUPPLIER, cameFromList, useLeave } from './suppliersNav';
import { useSuppliers, useSuppliersStore } from './SuppliersContext';
import { useDeleteSupplier } from './useDeleteSupplier';
import styles from './SupplierScreen.module.css';

// One supplier by its address, followed live: its details, and everything it sells in ONE list (parity S61).
//
// ⚠️ THE SUPPLIER IS ABSENT ONLY ON THE SERVER'S WORD. Until the suppliers have been believed (the server answered, or the
// browser's copy held some) the screen says «Loading…», never «no longer exists»; and a copy that holds suppliers but not
// this one waits for the server's answer (or COPY_WAIT_MS, with no signal) before it calls this one gone, because the copy
// can be older than a supplier somebody added on another phone. Once it is believed, a supplier that is not there — deleted
// on another phone while its screen was open, or an address that names none — leaves for the Suppliers tab and says so once
// (parity S62). A delete made on THIS screen says its own sentence and leaves by itself (supplierDeletions.ts).
export function SupplierScreen({ id }: { id: string }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { canManage } = useSession();
  const handBack = useHandBack();
  const say = useStatusMessage();
  const store = useSuppliersStore();
  const snapshot = useSuppliers();
  const deletions = useSupplierDeletions();
  const [confirm, confirmDialog] = useConfirm();
  const [runDelete, deleteDialog] = useDeleteSupplier();
  const title = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  // A second tap on Switch off, or on Delete, while a question is open is ignored.
  const asking = useRef(false);

  const supplier = snapshot.suppliers.find(candidate => candidate.id === id) ?? null;
  // Back is the browser's Back when the list is the entry behind; an address typed in replaces itself.
  const leave = useLeave(SUPPLIERS_TAB_PATH, () => { handBack.expect(supplierOpener(id)); });
  const waited = useCopyWait(snapshot.suppliersFromServer || snapshot.suppliersBroken);
  const gone = supplier === null && snapshot.suppliersLoaded && !snapshot.suppliersBroken && waited && !deletions.has(id);

  useEffect(() => {
    if (!gone) return;
    say(t('sup.supplierGone'));
    leave();
  }, [gone]);

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only when the screen
  // first appears — another supplier picked beside it (the split) keeps the focus on the row that was pressed. Back from
  // this supplier's card is owed to «Edit» instead, where the person left (handBack.takeEdit). Asked once per screen: a
  // second run of this effect (StrictMode) must find the answer the first one got.
  const shown = supplier !== null;
  const owedEdit = useRef<boolean | null>(null);
  useEffect(() => {
    if (!shown) return;
    owedEdit.current ??= handBack.takeEdit(id);
    if (owedEdit.current) editButton.current?.focus();
    else if (cameFromList(state)) title.current?.focus();
  }, [shown]);

  if (supplier === null) {
    if (snapshot.suppliersBroken) {
      return (
        <section className={styles.waiting} aria-label={t('sup.tab.suppliers')}>
          <FormBar backLabel={t('ui.back')} onBack={leave} title={t('sup.tab.suppliers')} titleRef={title} />
          <p className={styles.failed}>{t('sup.loadFailed')}</p>
        </section>
      );
    }
    return (
      <section className={styles.waiting} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }

  const label = supplierLabel(supplier);
  const active = supplier.active !== false;
  const daysOf = (value: unknown): string => (Array.isArray(value) ? value : [])
    .filter((day): day is string => typeof day === 'string')
    .map(day => (isWeekday(day) ? t(DAY_KEY[day]) : day))
    .join(', ');
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const delivery = daysOf(supplier.deliveryDays);
  const order = daysOf(supplier.orderDays);
  // The invoice name stays in sight here, on its own screen, once a shorter one is shown everywhere else — the one place
  // it is still needed, to match a delivery note.
  const name = text(supplier.name);
  const meta = [
    label !== name ? name : '',
    text(supplier.category),
    delivery === '' ? '' : `${t('sup.deliveryShort')} ${delivery}`,
    order === '' ? '' : `${t('sup.orderShort')} ${order}`,
    text(supplier.phone),
    text(supplier.email),
  ].filter(part => part !== '').join(' · ');

  const mine = snapshot.ingredients
    .filter(item => item.supplierId === id)
    .sort((a, b) => ingredientDisplayName(a).localeCompare(ingredientDisplayName(b)));
  const starred = snapshot.favourites.includes(id);

  // ⚠️ SWITCHING OFF ASKS, SWITCHING ON DOES NOT (parity S88), AND IT IS FOR EVERYBODY: it can be undone in one tap, so the
  // reversible half of the job stays with whoever is working. Local-first: the row dims at once, a refusal puts it back and
  // says so (the store).
  async function toggleActive() {
    if (asking.current) return;
    asking.current = true;
    try {
      if (active) {
        const ok = await confirm({
          title: t('sup.switchOff.title'),
          message: t('sup.switchOff.question', { name: label }),
          okLabel: t('sup.switchOff'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        if (!ok) return;
      }
      store.setSupplierActive(id, !active);
    } finally {
      asking.current = false;
    }
  }

  async function remove() {
    if (asking.current) return;
    asking.current = true;
    try {
      await runDelete({ id, name: label }, leave);
    } finally {
      asking.current = false;
    }
  }

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={label}
        titleId={titleId}
        titleRef={title}
        sub={meta === '' ? undefined : <p className={styles.meta}>{meta}</p>}
        action={
          <div className={styles.actions}>
            {/* ⚠️ THE STAR IS FOR WHOEVER RUNS THE PLACE (parity S12; the rules are the real guard). The write is NOT awaited:
                the star moves at once in Firestore's own answer, and a refusal puts it back and says so (parity S89). */}
            {canManage ? (
              <Button
                variant="secondary"
                className={styles.star}
                aria-label={t('sup.favourite')}
                aria-pressed={starred}
                onPress={() => { store.setFavourite(id, !starred); }}
              >
                <Star aria-hidden="true" fill={starred ? 'currentColor' : 'none'} />
              </Button>
            ) : null}
            <Button
              ref={editButton}
              variant="secondary"
              onPress={() => { void navigate(supplierEditPath(id), { state: FROM_SUPPLIER }); }}
            >
              <Pencil aria-hidden="true" />
              {t('ui.edit')}
            </Button>
            <Button variant="secondary" onPress={() => { void toggleActive(); }}>
              {t(active ? 'sup.switchOff' : 'sup.switchOn')}
            </Button>
          </div>
        }
      />

      <div className={styles.sells}>
        <h3 className={styles.sellsTitle}>{t('sup.whatTheySell')}</h3>
        {!snapshot.ingredientsLoaded ? (
          <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        ) : snapshot.ingredientsBroken ? (
          <p className={styles.failed}>{t('sup.loadFailed')}</p>
        ) : mine.length === 0 ? (
          <p className={styles.nothing}>{t('sup.noIngredientsYet')}</p>
        ) : (
          <ItemRows>
            {/* ⚠️ undefined, NOT '': on the supplier's own screen the supplier is not named again (parity S58). */}
            {mine.map(item => <ItemRow key={item.id} item={item} supplier={undefined} />)}
          </ItemRows>
        )}

        {/* ⚠️ THE VERY END OF THE PAGE: small, low-key, icon only, for whoever runs the place. Absent — not disabled — for an
            employee, who still has Switch off, the reversible half (parity S6, S8). */}
        {canManage ? (
          <button
            type="button"
            className={styles.deleteIcon}
            aria-label={t('sup.delete', { name: label })}
            title={t('sup.delete', { name: label })}
            onClick={() => { void remove(); }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {confirmDialog}
      {deleteDialog}
    </section>
  );
}
