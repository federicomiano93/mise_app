import { useCallback } from 'react';
import { Check } from 'lucide-react';
import { todayISO } from '@mise/shared/day';
import { todayOrders } from '@mise/shared/reminders';
import type { PlacedRecord } from '@mise/shared/reminders';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOrders } from './OrdersContext';
import { todayOpener, useHandBack } from './handBack';
import styles from './TodayOrders.module.css';

// «Order today» (step 3f-6, parity R1, R2): the suppliers whose order day is today, over the list. A placed one is a quiet chip with
// a check; one still to place is a button that opens that supplier like its row does. All placed: one line saying so.
//
// CLOSED AS NOT ORDERED (checklist item 3, 8 Nov 2026, the current app's v1.143.0): a supplier closed today from its summary
// (drafts/current.skipped) is done too — nothing was needed. Its chip is quiet, with a DASHED edge and the words «not ordered» (the edge
// tells it from a placed one besides the words), and it stays a button: it opens the supplier's SUMMARY, where «Reopen» lives. ⚠️ «All
// placed» only when every one really was PLACED: with a closed one among them the strip goes quiet but keeps its chips, so «all placed»
// is never false and the closed chip is still the way to «Reopen». (The current app also greys its banner box then; Mise 2's strip has no
// box, so nothing else changes.)
//
// ⚠️ DRAWN ONLY ONCE THE SUPPLIERS, THE RECORDS AND THE DRAFT HAVE ARRIVED: before the records a supplier that was placed this morning
// would flash as not placed, before the draft one closed this morning as still to order — worse than saying nothing. A dead records
// stream says nothing either, for the same reason.
export function TodayOrders({ onOpenSupplier, onOpenClosed }: {
  onOpenSupplier: (id: string) => void;
  onOpenClosed: (id: string) => void;
}) {
  const { t } = useT();
  const { suppliers, suppliersLoaded, history, historyLoaded, historyBroken, draft, draftLoaded } = useOrders();
  if (!suppliersLoaded || !historyLoaded || historyBroken || !draftLoaded) return null;
  const rows = todayOrders({ suppliers, history: history as readonly PlacedRecord[], today: todayISO(), skipped: draft.skipped });
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
        {rows.map(({ supplier, placed, skipped }) => (
          <li key={supplier.id} className={styles.item}>
            {placed ? (
              <span className={styles.placed}>
                <Check aria-hidden="true" />
                <span>{supplierLabel(supplier)}</span>
                <span className="visually-hidden">{t('ord.today.placed')}</span>
              </span>
            ) : skipped ? (
              <ClosedChip id={supplier.id as string} label={supplierLabel(supplier)} onOpen={onOpenClosed} />
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

// A closed supplier's chip. Registered under its own opener, so Back from the summary it opens hands the focus back to it.
// The visible words ARE the button's name («Brava not ordered»): no aria-label a screen reader would read differently.
function ClosedChip({ id, label, onOpen }: { id: string; label: string; onOpen: (id: string) => void }) {
  const { t } = useT();
  const handBack = useHandBack();
  const ref = useCallback((node: HTMLButtonElement | null) => { handBack.register(todayOpener(id), node); }, [handBack, id]);
  return (
    <Button ref={ref} variant="bare" className={styles.skipped} onPress={() => { onOpen(id); }}>
      <span>{label}</span>
      {/* The space keeps the two words apart in the button's name; the gap draws it. */}
      {' '}
      <span className={styles.note}>{t('ord.today.notOrdered')}</span>
    </Button>
  );
}
