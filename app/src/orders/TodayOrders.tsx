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
// A supplier CLOSED AS NOT ORDERED today (drafts/current.skipped, the current app's PR #470) is done too: nothing was needed. Its
// chip, dashed, stays a button, but it opens the supplier's SUMMARY, where «Reopen» lives, and Back from there returns to it
// (ClosedChip). Its visible words ARE its name («Brava not ordered»): no aria-label a screen reader would read differently from
// what is drawn.
// ⚠️ «ALL PLACED» ONLY WHEN THEY REALLY WERE ALL PLACED (the current app's a710dcb): with some only closed the chips stay — the
// sentence would be false, and the closed chip is the way to «Reopen».
//
// ⚠️ DRAWN ONLY ONCE THE SUPPLIERS, THE RECORDS AND THE DRAFT HAVE ARRIVED: before the records a supplier that was placed this
// morning would flash as not placed, before the draft one closed this morning would flash as «to order» — worse than saying
// nothing. A dead records stream says nothing either, for the same reason. A DEAD DRAFT stream counts as arrived (draftLoaded), and its
// closes are read as NONE, even those it delivered before it died (another phone may have reopened since, and the summary offers no
// «Reopen» over a dead draft): a «to order» chip too many is the safe side (the current app's kiosk reads a failed read so too).
export function TodayOrders({ onOpenSupplier, onOpenClosed }: {
  onOpenSupplier: (id: string) => void;
  onOpenClosed: (id: string) => void;
}) {
  const { t } = useT();
  const { suppliers, suppliersLoaded, history, historyLoaded, historyBroken, draft, draftLoaded, draftBroken } = useOrders();
  if (!suppliersLoaded || !historyLoaded || historyBroken || !draftLoaded) return null;
  const skipped = draftBroken ? null : draft.skipped;
  const rows = todayOrders({ suppliers, history: history as readonly PlacedRecord[], today: todayISO(), skipped });
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

// A closed supplier's chip, registered under its own opener: Back from the summary it opens hands the focus back to it.
function ClosedChip({ id, label, onOpen }: { id: string; label: string; onOpen: (id: string) => void }) {
  const { t } = useT();
  const handBack = useHandBack();
  const node = useCallback((button: HTMLButtonElement | null) => { handBack.register(todayOpener(id), button); }, [handBack, id]);
  return (
    <Button ref={node} variant="bare" className={styles.skipped} onPress={() => { onOpen(id); }}>
      {/* ⚠️ A REAL SPACE between the two: without it the name read out is «Bravanot ordered». */}
      <span>{label}</span>{' '}
      <span className={styles.note}>{t('ord.today.notOrdered')}</span>
    </Button>
  );
}
