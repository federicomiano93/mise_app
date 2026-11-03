import { useCallback } from 'react';
import { waitingRequests } from '@mise/shared/order-request-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOrders } from './OrdersContext';
import { LISTS_DOOR, useHandBack } from './handBack';
import styles from './ListsDoor.module.css';

// The door to the order lists (step 3f-7), under the list's head.
//
// ⚠️ SHOWN TO EVERYBODY, because the people who SEND a list must be able to see one, and the rules let anybody in the venue read
// them. ⚠️ IT NEVER DISAPPEARS WHILE LISTS ARE ON, not even with nothing waiting: the tap that finished the last list once removed
// the only entrance (v1.31.1). Only the venue's own switch (`orderLists: false` on config/orders) hides it.
//
// It is NOT part of DeliveryDoors: those hide with the delivery switch, and this one has nothing to do with it.
export function ListsDoor({ onOpen }: { onOpen: () => void }) {
  const { t } = useT();
  const { config, requests } = useOrders();
  const handBack = useHandBack();
  const node = useCallback((button: HTMLButtonElement | null) => { handBack.register(LISTS_DOOR, button); }, [handBack]);

  if (config.orderLists === false) return null;
  const waiting = waitingRequests(requests).length;

  return (
    <Button
      ref={node}
      variant="bare"
      className={styles.door}
      aria-label={waiting > 0 ? `${t('ord.request.open')}: ${t('ord.request.waiting', { n: waiting })}` : t('ord.request.open')}
      onPress={onOpen}
    >
      <span className={styles.label}>{t('ord.request.open')}</span>
      {waiting > 0 ? <span className={styles.badge} aria-hidden="true">{waiting}</span> : null}
    </Button>
  );
}
