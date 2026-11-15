import { useMemo } from 'react';
import { stillToReorder, unansweredBefore } from '@mise/shared/deliveries';
import { askedAbout } from '@mise/shared/delivery-check';
import { todayISO } from '@mise/shared/day';
import { useOrders } from './OrdersContext';

// What the three delivery screens and the list's doors all read, in ONE place so they can never disagree about a number
// (step 3f-5, parity V1–V11).
//
//   records  the orders Incoming asks about: none while the venue's switch is off, and none recorded before the day it was turned
//            back on (askedAbout). ⚠️ NEVER `snapshot.history` straight: that would put months of unasked orders in the debt.
//   owed     the debt: ordered before this week and never answered, oldest first (the banner, the badge, Incoming's first group).
//   reorder  what did not arrive and has not been dealt with, newest first — read from every record of the live window and the
//            order being typed, as the current app does; the switch hides the screen, it does not change the derivation.
//
// The week starts on the venue's setting, and «today» is read when the data moves, so a phone left open overnight redraws the
// moment anything changes (the lists are derived, never stored).
export function useDeliveryView() {
  const { history, deliveryCheck, config, draft } = useOrders();
  const today = todayISO();
  const weekStartsOn = config.weekStartsOn;

  const records = useMemo(() => askedAbout(history, deliveryCheck), [history, deliveryCheck]);
  const owed = useMemo(() => unansweredBefore(records, today, { weekStartsOn }), [records, today, weekStartsOn]);
  const reorder = useMemo(() => stillToReorder(history, draft.entries), [history, draft.entries]);

  return { today, weekStartsOn, records, owed, reorder, on: deliveryCheck.on };
}
