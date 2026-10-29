import { useEffect, useId, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useOrders } from './OrdersContext';
import { SendPicker } from './SendPicker';
import { SEND_OPENER, useHandBack } from './handBack';
import { cameFromList, confirmState, useLeave } from './ordersNav';
import { ORDERS_PATH, PLACE_ALL_CONFIRM_PATH } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import { draftSendRows } from './sendFlow';
import styles from './SendScreen.module.css';

// «Send order» (parity X15–X21, step 3f-3), at /orders/send: the suppliers with something in the order, each a tick, over a
// choice of how the WhatsApp message is written and one «Send» button. One level below the list; Back is Back (P20).
//
// The ticks, the format and the button are SendPicker's, shared with History's «Send <day>» screen. Nothing is ticked when it
// opens, and «Send» is called straight from its press (see SendPicker).
//
// A send that reached suppliers goes on to the confirm screen, where they are recorded as ordered (record-after-send, parity
// X10): opening WhatsApp is not sending, so «Did you send it?» is still asked there.
export function SendScreen({ lens }: { lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
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
        // Record-after-send: the confirm screen takes the suppliers that were reached.
        onReached={ids => { void navigate(PLACE_ALL_CONFIRM_PATH, { state: confirmState(state, { ids, afterSend: true }) }); }}
      />
    </section>
  );
}
