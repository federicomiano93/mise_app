import { useEffect, useId, useRef } from 'react';
import { useLocation } from 'react-router';
import { Star } from 'lucide-react';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { ItemRow, ItemRows } from './ItemRow';
import { supplierOpener, useHandBack } from './handBack';
import { SUPPLIERS_TAB_PATH } from './suppliersPath';
import { cameFromList, useLeave } from './suppliersNav';
import { useSuppliers, useSuppliersStore } from './SuppliersContext';
import styles from './SupplierScreen.module.css';

// The stored delivery and order days are ENGLISH words (parity S43) and must stay so; only the label is looked up.
// Sunday is 0, as the dictionary's weekday words are numbered.
const DAY_KEY = {
  Sunday: 'day.weekdayShort.0',
  Monday: 'day.weekdayShort.1',
  Tuesday: 'day.weekdayShort.2',
  Wednesday: 'day.weekdayShort.3',
  Thursday: 'day.weekdayShort.4',
  Friday: 'day.weekdayShort.5',
  Saturday: 'day.weekdayShort.6',
} as const satisfies Record<string, MessageKey>;

const isDayName = (value: string): value is keyof typeof DAY_KEY => Object.hasOwn(DAY_KEY, value);

// One supplier by its address, followed live: its details, and everything it sells in ONE list (parity S61).
//
// ⚠️ THE SUPPLIER IS ABSENT ONLY ON THE LIST'S WORD. Until the suppliers have been believed (the server answered, or the
// browser's copy held some) the screen says «Loading…», never «no longer exists». Once they have, a supplier that is not
// there — deleted on another phone while its screen was open, or an address that names none — leaves for the Suppliers
// tab and says so once (parity S62).
export function SupplierScreen({ id }: { id: string }) {
  const { t } = useT();
  const { state } = useLocation();
  const { canManage } = useSession();
  const handBack = useHandBack();
  const say = useStatusMessage();
  const store = useSuppliersStore();
  const snapshot = useSuppliers();
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const supplier = snapshot.suppliers.find(candidate => candidate.id === id) ?? null;
  // Back is the browser's Back when the list is the entry behind; an address typed in replaces itself.
  const leave = useLeave(SUPPLIERS_TAB_PATH, () => { handBack.expect(supplierOpener(id)); });
  const gone = supplier === null && snapshot.suppliersLoaded && !snapshot.suppliersBroken;

  useEffect(() => {
    if (!gone) return;
    say(t('sup.supplierGone'));
    leave();
  }, [gone]);

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only when the screen
  // first appears — another supplier picked beside it (the split) keeps the focus on the row that was pressed.
  const shown = supplier !== null;
  useEffect(() => {
    if (shown && cameFromList(state)) title.current?.focus();
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
  const daysOf = (value: unknown): string => (Array.isArray(value) ? value : [])
    .filter((day): day is string => typeof day === 'string')
    .map(day => (isDayName(day) ? t(DAY_KEY[day]) : day))
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

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={label}
        titleId={titleId}
        titleRef={title}
        sub={meta === '' ? undefined : <p className={styles.meta}>{meta}</p>}
        // ⚠️ THE STAR IS FOR WHOEVER RUNS THE PLACE (parity S12; the rules are the real guard). The write is NOT awaited:
        // the star moves at once in Firestore's own answer, and a refusal puts it back and says so (parity S89).
        // Slice B puts Edit, Switch off / on and Delete in this bar.
        action={canManage ? (
          <Button
            variant="secondary"
            className={styles.star}
            aria-label={t('sup.favourite')}
            aria-pressed={starred}
            onPress={() => { store.setFavourite(id, !starred); }}
          >
            <Star aria-hidden="true" fill={starred ? 'currentColor' : 'none'} />
          </Button>
        ) : undefined}
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
      </div>
    </section>
  );
}
