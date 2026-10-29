import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Check } from 'lucide-react';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { CLEAR_OPENER, PLACE_ALL_OPENER, useHandBack } from './handBack';
import { cameFromList, confirmState, useLeave } from './ordersNav';
import { ORDERS_PATH, PLACE_ALL_CONFIRM_PATH } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import { useClearQuantities } from './useClearQuantities';
import styles from './SupplierPicker.module.css';

type Mode = 'place-all' | 'clear';

// «Which suppliers?»: the suppliers with quantities typed, each a tick, over one action (parity X8, X11; the current app's
// supplier-picker.js without its WhatsApp parts). One screen for two errands:
//   place-all  everything ticked to begin with; the action opens the confirm screen with the ticked suppliers;
//   clear      NOTHING ticked to begin with (it throws work away); the action asks, then clears.
// Back is one level up, to the list (P20).
export function SupplierPicker({ mode, lens }: { mode: Mode; lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const handBack = useHandBack();
  const opener = mode === 'place-all' ? PLACE_ALL_OPENER : CLEAR_OPENER;
  const leave = useLeave(ORDERS_PATH, () => { handBack.expect(opener); });
  const [clearQuantities, clearDialog] = useClearQuantities(lens);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const available = lens.suppliers.filter(supplier => lens.filledFor(supplier.id) > 0);
  // Taken once, when the screen opens: a supplier whose quantities arrive later is not ticked behind the person's back.
  const [ticked, setTicked] = useState<readonly string[]>(() => (mode === 'place-all' ? available.map(supplier => supplier.id) : []));
  const [busy, setBusy] = useState(false);
  // What is acted on: ticked AND still having quantities (another phone may have placed one meanwhile).
  const chosen = available.filter(supplier => ticked.includes(supplier.id)).map(supplier => supplier.id);

  // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once.
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const heading = mode === 'place-all' ? t('ord.orderPlaced') : t('ord.clear.title');
  const act = () => {
    if (chosen.length === 0) return;
    if (mode === 'place-all') {
      // Ordered as the list shows them, so the confirm screen reads the same way.
      void navigate(PLACE_ALL_CONFIRM_PATH, { state: confirmState(state, { ids: chosen }) });
      return;
    }
    setBusy(true);
    void clearQuantities(chosen).then(cleared => {
      setBusy(false);
      if (cleared) leave();
    });
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={heading} titleId={titleId} titleRef={title} />
      {available.length === 0 ? (
        <p className={styles.empty}>{mode === 'place-all' ? t('ord.picker.emptyPlace') : t('ord.picker.emptyClear')}</p>
      ) : (
        <div className={styles.body}>
          <ul className={styles.rows} aria-labelledby={titleId}>
            {available.map(supplier => (
              <li key={supplier.id} className={styles.item}>
                <label className={styles.tick}>
                  <input
                    type="checkbox"
                    checked={ticked.includes(supplier.id)}
                    onChange={event => {
                      setTicked(before => (event.target.checked ? [...before, supplier.id] : before.filter(id => id !== supplier.id)));
                    }}
                  />
                  <span className={styles.name}>{supplierLabel(supplier)}</span>
                  <span className={styles.count}>{t('ord.itemsCount', { n: lens.filledFor(supplier.id) })}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button
              variant={mode === 'place-all' ? 'primary' : 'danger'}
              isDisabled={chosen.length === 0 || busy}
              onPress={act}
            >
              {mode === 'place-all' ? <Check aria-hidden="true" /> : null}
              {mode === 'place-all' ? t('ord.orderPlaced') : t('ord.clear.ok')}
            </Button>
          </div>
        </div>
      )}
      {clearDialog}
    </section>
  );
}
