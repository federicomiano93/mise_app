import { useCallback, useEffect, useId, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
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
import { NotInUseGroup, useNotInUseOpen } from './NotInUseGroup';
import type { StoredDoc } from './suppliersSource';
import { ADD_INGREDIENT_OPENER, SEARCH_OPENER, supplierItemOpener, supplierOpener, useHandBack } from './handBack';
import { DAY_KEY, isWeekday } from './supplierDays';
import { useSupplierDeletions } from './supplierDeletions';
import { SUPPLIERS_TAB_PATH, ingredientPath, newIngredientPath, supplierEditPath } from './suppliersPath';
import { FROM_SUPPLIER, cameFromList, fromSupplierScreen, useLeave } from './suppliersNav';
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
  // ⚠️ AFTER A DELETE THE FOCUS GOES TO THE SEARCH BOX, never to this supplier's own row: with the real database the row is
  // still in the list while the screen leaves, so it would take the focus and then vanish under it.
  const leaveAfterDelete = useLeave(SUPPLIERS_TAB_PATH, () => { handBack.expect(SEARCH_OPENER); });
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
  // Back from an ingredient's card opened from here is owed to the row or to «Add ingredient» it was opened from.
  const owed = useRef<string | null | undefined>(undefined);
  const addButton = useCallback((node: HTMLButtonElement | null) => { handBack.register(ADD_INGREDIENT_OPENER, node); }, [handBack]);
  // The folded «Not in use» group. ⚠️ A row inside a closed <details> cannot take the focus, so when Back owes the focus to the
  // row of an item that is switched off, the group is opened first and the focus is given once it is open (`pendingFocus`).
  const group = useNotInUseOpen(false);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!shown) return;
    owed.current ??= handBack.takeEdit(id) ? 'edit' : handBack.takeOn(id);
    const target = owed.current;
    if (target === 'edit') editButton.current?.focus();
    else if (target) {
      const inGroup = snapshot.ingredients.some(item => item.supplierId === id && item.active === false && supplierItemOpener(item.id) === target);
      if (inGroup) {
        pendingFocus.current = target;
        group.show();
      } else {
        handBack.focus(target);
      }
    } else if (cameFromList(state)) title.current?.focus();
  }, [shown]);
  useEffect(() => {
    if (!group.open || pendingFocus.current === null) return;
    handBack.focus(pendingFocus.current);
    pendingFocus.current = null;
  }, [group.open]);

  // The card of an item, one level below this screen: Back is the browser's Back, which lands here.
  const openItem = (itemId: string) => {
    handBack.wantOn(id, supplierItemOpener(itemId));
    void navigate(ingredientPath(itemId), { state: fromSupplierScreen(id) });
  };
  const addItem = () => {
    handBack.wantOn(id, ADD_INGREDIENT_OPENER);
    void navigate(newIngredientPath({ supplier: id }), { state: fromSupplierScreen(id) });
  };

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
  // 3e-5b: what a supplier sells that is switched off with «Not in use at the moment» sits under the rest in a folded group.
  const sold = mine.filter(item => item.active !== false);
  const inactive = mine.filter(item => item.active === false);
  const rowOf = (item: StoredDoc, inNotInUse: boolean) => (
    // ⚠️ undefined, NOT '': on the supplier's own screen the supplier is not named again (parity S58).
    <ItemRow
      key={item.id}
      item={item}
      supplier={undefined}
      isOpen={false}
      onOpen={openItem}
      opener={supplierItemOpener(item.id)}
      register={handBack.register}
      inNotInUse={inNotInUse}
    />
  );

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
      await runDelete({ id, name: label }, leaveAfterDelete);
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
        {/* ⚠️ A NEW ITEM STARTS ON THIS SUPPLIER (the address carries it); an existing item never changes supplier by being opened
            from here. */}
        <Button ref={addButton} variant="secondary" className={styles.add} onPress={addItem}>
          <Plus aria-hidden="true" />
          <span>{t('sup.addIngredient')}</span>
        </Button>
        {!snapshot.ingredientsLoaded ? (
          <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        ) : snapshot.ingredientsBroken ? (
          <p className={styles.failed}>{t('sup.loadFailed')}</p>
        ) : mine.length === 0 ? (
          <p className={styles.nothing}>{t('sup.noIngredientsYet')}</p>
        ) : (
          <>
            {sold.length > 0 ? <ItemRows>{sold.map(item => rowOf(item, false))}</ItemRows> : null}
            {inactive.length > 0 ? (
              <NotInUseGroup count={inactive.length} open={group.open} onToggle={group.onToggle}>
                <ItemRows>{inactive.map(item => rowOf(item, true))}</ItemRows>
              </NotInUseGroup>
            ) : null}
          </>
        )}

        {/* ⚠️ DISABLED UNTIL THE INGREDIENTS HAVE ANSWERED: the question says how many products stay without a supplier, and before
            they arrive that count would be a false 0. */}
        {/* ⚠️ THE VERY END OF THE PAGE: small, low-key, icon only, for whoever runs the place. Absent — not disabled — for an
            employee, who still has Switch off, the reversible half (parity S6, S8). */}
        {canManage ? (
          <button
            type="button"
            className={styles.deleteIcon}
            aria-label={t('sup.delete', { name: label })}
            title={t('sup.delete', { name: label })}
            disabled={!snapshot.ingredientsLoaded}
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
