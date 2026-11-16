import { useCallback } from 'react';
import { ListChecks } from 'lucide-react';
import { waitingRequests } from '@mise/shared/order-request-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOrders } from './OrdersContext';
import { LISTS_DOOR, useHandBack } from './handBack';
import styles from './ListsDoor.module.css';

// The door to the order lists (step 3f-7), in the title band since the redesign of 16 Nov 2026: an icon, «Order lists» and the number
// of lists still waiting. On a 296px phone the words step aside (visually hidden, still its name) and the icon and number stay.
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
      // ⚠️ THE NAME STARTS WITH THE WORDS DRAWN (axe label-content-name-mismatch); the number is read after them.
      aria-label={waiting > 0 ? `${t('ord.request.open')}: ${t('ord.request.waiting', { n: waiting })}` : t('ord.request.open')}
      onPress={onOpen}
    >
      <ListChecks aria-hidden="true" />
      <span className={`visually-hidden ${styles.label}`}>{t('ord.request.open')}</span>
      {waiting > 0 ? <span className={styles.badge} aria-hidden="true">{waiting}</span> : null}
    </Button>
  );
}
