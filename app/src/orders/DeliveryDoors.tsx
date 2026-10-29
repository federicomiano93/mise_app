import { useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOrders } from './OrdersContext';
import { INCOMING_DOOR, REORDER_DOOR, useHandBack } from './handBack';
import { useDeliveryView } from './useDeliveryView';
import styles from './DeliveryDoors.module.css';

type Props = {
  onIncoming: () => void;
  onReorder: () => void;
};

// The two doors under the list's head (step 3f-5): «Incoming» with the debt on a small badge, «To re-order» with what is still to
// order again, and above them the debt banner while orders from before this week are unanswered.
//
// ⚠️ DRAWN ONLY WHILE THE VENUE'S SWITCH IS ON (decision F4), and only once config/orders has answered: before that the switch
// reads «on» by default, and a venue that turned it off would see the doors flash on every cold start.
//
// ⚠️ THE DEBT BANNER NEVER GOES QUIET BY ITSELF: only an answer clears it (parity V6). ⚠️ «TO RE-ORDER» NEVER HIDES, only its
// number comes and goes (Federico, 3 Oct 2026) — a button that appears and disappears is a button nobody can find.
//
// The banner opens Incoming like the door does, and Back hands the focus to the DOOR: the banner can be gone by then (the last
// owed order was answered), the door never is.
export function DeliveryDoors({ onIncoming, onReorder }: Props) {
  const { t } = useT();
  const { configLoaded } = useOrders();
  const { on, owed, reorder } = useDeliveryView();
  const handBack = useHandBack();
  const incomingNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(INCOMING_DOOR, node); }, [handBack]);
  const reorderNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(REORDER_DOOR, node); }, [handBack]);

  if (!configLoaded || !on) return null;

  return (
    <div className={styles.doors}>
      {owed.length > 0 ? (
        <Button variant="bare" className={styles.banner} onPress={onIncoming}>
          <span className={styles.bannerText}>{t('ord.incoming.owed', { n: owed.length })}</span>
          <ChevronRight aria-hidden="true" />
        </Button>
      ) : null}
      <div className={styles.row}>
        <Button
          ref={incomingNode}
          variant="bare"
          className={styles.door}
          aria-label={owed.length > 0 ? t('ord.incoming.badgeAria', { n: owed.length }) : t('ord.incoming.title')}
          onPress={onIncoming}
        >
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
          <span className={styles.label}>{t('ord.reorder.title')}</span>
          {reorder.length > 0 ? <span className={styles.badge} aria-hidden="true">{reorder.length}</span> : null}
        </Button>
      </div>
    </div>
  );
}
