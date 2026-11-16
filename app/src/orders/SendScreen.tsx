import { useEffect, useId, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useOrders } from './OrdersContext';
import { SendPicker } from './SendPicker';
import { SEND_OPENER, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { ORDERS_PATH } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import { draftSendRows } from './sendFlow';
import styles from './SendScreen.module.css';

// «Send order» (parity X15–X21, step 3f-3), at /orders/send: the suppliers with something in the order, each a tick, over a
// choice of how the WhatsApp message is written and one «Send» button. One level below the list; Back is Back (P20).
//
// The ticks, the format and the button are SendPicker's, shared with History's «Send <day>» screen. Nothing is ticked when it
// opens, and «Send» is called straight from its press (see SendPicker).
//
// A send that reached suppliers goes back to the list, and «Order to X sent at 10:42: did it go?» is asked on every device (v1.145.0,
// store.waitForAnswer — SendPicker writes it at the press' numbers): opening WhatsApp is not sending, and nothing is recorded until
// somebody says it went. The confirm screen is no longer in this road.
export function SendScreen({ lens }: { lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const { draft } = useOrders();
  const handBack = useHandBack();
  const leave = useLeave(ORDERS_PATH, () => { handBack.expect(SEND_OPENER); });
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  // The rows are live: another phone's quantities appear, a supplier whose lines were cleared drops out.
  const rows = useMemo(() => draftSendRows(lens, draft), [lens, draft]);

  useEffect(() => {
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.send.title')} titleId={titleId} titleRef={title} />
      <SendPicker
        lens={lens}
        rows={rows}
        titleId={titleId}
        emptyText={t('ord.send.empty')}
        // Back to the Orders list: the question «did it go?» is on the banner there, and the dialog asks here if this device sent it.
        onReached={leave}
        // The in-app list is written: back to the Orders list, with the order as it was (nothing is recorded after a list).
        onListSent={leave}
      />
    </section>
  );
}
