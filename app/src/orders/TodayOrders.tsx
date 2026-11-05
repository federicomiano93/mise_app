import { Check } from 'lucide-react';
import { todayISO } from '@mise/shared/day';
import { todayOrders } from '@mise/shared/reminders';
import type { PlacedRecord } from '@mise/shared/reminders';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOrders } from './OrdersContext';
import styles from './TodayOrders.module.css';

// «Order today» (step 3f-6, parity R1, R2): the suppliers whose order day is today, over the list. A placed one is a quiet chip with
// a check; one still to place is a button that opens that supplier like its row does. All placed: one line saying so.
//
// ⚠️ DRAWN ONLY ONCE THE SUPPLIERS AND THE RECORDS HAVE ARRIVED: before the records a supplier that was placed this morning would
// flash as not placed, which is worse than saying nothing. A dead records stream says nothing either, for the same reason.
export function TodayOrders({ onOpenSupplier }: { onOpenSupplier: (id: string) => void }) {
  const { t } = useT();
  const { suppliers, suppliersLoaded, history, historyLoaded, historyBroken } = useOrders();
  if (!suppliersLoaded || !historyLoaded || historyBroken) return null;
  const rows = todayOrders({ suppliers, history: history as readonly PlacedRecord[], today: todayISO() });
  if (rows.length === 0) return null;

  if (rows.every(row => row.placed)) {
    return (
      <p className={styles.done}>
        <Check aria-hidden="true" />
        <span>{t('ord.today.allPlaced')}</span>
      </p>
    );
  }
  return (
    <div className={styles.strip}>
      <p className={styles.label}>{t('ord.today.label')}</p>
      <ul className={styles.chips}>
        {rows.map(({ supplier, placed }) => (
          <li key={supplier.id} className={styles.item}>
            {placed ? (
              <span className={styles.placed}>
                <Check aria-hidden="true" />
                <span>{supplierLabel(supplier)}</span>
                <span className="visually-hidden">{t('ord.today.placed')}</span>
              </span>
            ) : (
              <Button variant="bare" className={styles.chip} onPress={() => { onOpenSupplier(supplier.id as string); }}>
                {supplierLabel(supplier)}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
