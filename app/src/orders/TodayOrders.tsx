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
// A supplier CLOSED AS NOT ORDERED today (drafts/current.skipped, the current app's PR #470) is done too: nothing was needed. Its
// chip, dashed, stays a button, but it opens the supplier's SUMMARY, where «Reopen» lives. Its visible words ARE its name
// («Brava · not ordered»): no aria-label a screen reader would read differently from what is drawn.
//
// ⚠️ DRAWN ONLY ONCE THE SUPPLIERS AND THE RECORDS HAVE ARRIVED: before the records a supplier that was placed this morning would
// flash as not placed, which is worse than saying nothing. A dead records stream says nothing either, for the same reason.
export function TodayOrders({ onOpenSupplier, onOpenSummary }: {
  onOpenSupplier: (id: string) => void;
  onOpenSummary: (id: string) => void;
}) {
  const { t } = useT();
  const { suppliers, suppliersLoaded, history, historyLoaded, historyBroken, draft } = useOrders();
  if (!suppliersLoaded || !historyLoaded || historyBroken) return null;
  const rows = todayOrders({ suppliers, history: history as readonly PlacedRecord[], today: todayISO(), skipped: draft.skipped });
  if (rows.length === 0) return null;

  if (rows.every(row => row.placed || row.skipped)) {
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
        {rows.map(({ supplier, placed, skipped }) => (
          <li key={supplier.id} className={styles.item}>
            {placed ? (
              <span className={styles.placed}>
                <Check aria-hidden="true" />
                <span>{supplierLabel(supplier)}</span>
                <span className="visually-hidden">{t('ord.today.placed')}</span>
              </span>
            ) : skipped ? (
              <Button variant="bare" className={styles.skipped} onPress={() => { onOpenSummary(supplier.id as string); }}>
                {/* ⚠️ A REAL SPACE between the two: without it the name read out is «Brava· not ordered». */}
                <span>{supplierLabel(supplier)}</span>{' '}
                <span className={styles.note}>{t('ord.today.notOrdered')}</span>
              </Button>
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
