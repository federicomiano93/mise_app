import { useCallback } from 'react';
import { ChevronRight, Package, RotateCcw } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOrders } from './OrdersContext';
import { INCOMING_DOOR, REORDER_DOOR, useHandBack } from './handBack';
import { useDeliveryView } from './useDeliveryView';
import styles from './DeliveryDoors.module.css';

// The two doors of the deliveries (step 3f-5): «Incoming» with the debt on a small pill, «To re-order» with what is still to order
// again. Since the redesign of 16 Nov 2026 they sit in the top-right of the split, the size of the Suppliers / Ingredients tabs,
// centred and always visible (a supplier open beside the list too); on a phone under the search box.
//
// ⚠️ DRAWN ONLY WHILE THE VENUE'S SWITCH IS ON (decision F4), and only once config/orders has answered: before that the switch
// reads «on» by default, and a venue that turned it off would see the doors flash on every cold start.
//
// ⚠️ «TO RE-ORDER» NEVER HIDES, only its number comes and goes (Federico, 3 Oct 2026) — a button that appears and disappears is a
// button nobody can find.
export function DeliveryDoors({ onIncoming, onReorder }: { onIncoming: () => void; onReorder: () => void }) {
  const { t } = useT();
  const { configLoaded } = useOrders();
  const { on, owed, reorder } = useDeliveryView();
  const handBack = useHandBack();
  const incomingNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(INCOMING_DOOR, node); }, [handBack]);
  const reorderNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(REORDER_DOOR, node); }, [handBack]);

  if (!configLoaded || !on) return null;

  return (
    <div className={styles.row}>
      <Button
        ref={incomingNode}
        variant="bare"
        className={styles.door}
        aria-label={owed.length > 0 ? t('ord.incoming.badgeAria', { n: owed.length }) : t('ord.incoming.title')}
        onPress={onIncoming}
      >
        <Package aria-hidden="true" />
        <span className={styles.label}>{t('ord.incoming.title')}</span>
        {owed.length > 0 ? <span className={styles.badge} aria-hidden="true">{owed.length}</span> : null}
      </Button>
      <Button
        ref={reorderNode}
        variant="bare"
        className={styles.door}
        aria-label={reorder.length > 0 ? t('ord.reorder.buttonAria', { n: reorder.length }) : t('ord.reorder.buttonAriaNone')}
        onPress={onReorder}
      >
        <RotateCcw aria-hidden="true" />
        <span className={styles.label}>{t('ord.reorder.title')}</span>
        {reorder.length > 0 ? <span className={styles.badge} aria-hidden="true">{reorder.length}</span> : null}
      </Button>
    </div>
  );
}

// «N orders from before this week — did they arrive?»: the debt, while orders from before this week are unanswered. On the split it
// takes the line under the doors (where «Choose a supplier» is otherwise); on a phone it sits above the doors.
//
// ⚠️ THE DEBT BANNER NEVER GOES QUIET BY ITSELF: only an answer clears it (parity V6). It opens Incoming like the door does, and Back
// hands the focus to the DOOR: the banner can be gone by then (the last owed order was answered), the door never is.
export function DebtBanner({ onIncoming }: { onIncoming: () => void }) {
  const { t } = useT();
  const { configLoaded } = useOrders();
  const { on, owed } = useDeliveryView();
  if (!configLoaded || !on || owed.length === 0) return null;
  return (
    <Button variant="bare" className={styles.banner} onPress={onIncoming}>
      <span className={styles.bannerText}>{t('ord.incoming.owed', { n: owed.length })}</span>
      <ChevronRight aria-hidden="true" />
    </Button>
  );
}
