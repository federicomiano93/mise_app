import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useOrders, useOrdersStore } from './OrdersContext';
import { awaitingSentence, awaitingSupplierName } from './awaitingWords';
import type { OrdersLens } from './ordersLens';
import { useAnswerAwaiting } from './useAnswerAwaiting';

// How often a question that had to wait (another dialog was open) looks again whether the way is clear.
const RECHECK_MS = 1000;

// «Order to Bruno sent at 10:42: did it go?» as a dialog, on the device that SENT it, once the page is back (the share sheet answered
// while it was visible, or the window the text opened has come back). One question at a time, «Yes» / «No», and no Cancel: Escape or
// a tap outside leaves it to the banner, which asks the same thing for as long as it takes.
//
// Mounted at the level of the whole section, so it survives moving from one Orders screen to another.
//
// ⚠️ NEVER OVER ANOTHER DIALOG (an editor still going through its suppliers, a confirmation): two stacked dialogs share one Escape. The
// question waits, and is asked again at the next snapshot or when the page comes back; the banner asks meanwhile.
//
// ⚠️ IT CLOSES ITSELF WHEN SOMEBODY ELSE HAS ANSWERED (or a newer send replaced the question) while it is open — the leftover found on
// the tablet in the current app, where a dialog kept asking about an order another device had already recorded. It says so.
export function AskHereDialog({ lens }: { lens: OrdersLens }) {
  const { t, locale } = useT();
  const store = useOrdersStore();
  const { awaiting, suppliers } = useOrders();
  const say = useStatusMessage();
  const [answer, dialogs] = useAnswerAwaiting(lens);
  const [open, setOpen] = useState<{ supplierId: string; at: string } | null>(null);
  const [, recheck] = useState(0);
  const ask = awaiting.ask;

  useEffect(() => {
    if (open === null) {
      if (ask !== null && document.querySelector('[role="dialog"],[role="alertdialog"]') === null) setOpen(ask);
      return;
    }
    if (ask === null || ask.supplierId !== open.supplierId || ask.at !== open.at) {
      setOpen(null);
      say(t('ord.awaiting.elsewhere'), 4000);
    }
  });

  // A question held back by another dialog has no snapshot of its own to wake it when that dialog closes.
  const waitingForRoom = open === null && ask !== null;
  useEffect(() => {
    if (!waitingForRoom) return;
    const timer = window.setInterval(() => { recheck(n => n + 1); }, RECHECK_MS);
    return () => { window.clearInterval(timer); };
  }, [waitingForRoom]);

  const reply = (which: 'yes' | 'no') => {
    if (open === null) return;
    const { supplierId, at } = open;
    // Closed first: the answer may open a question of its own («It may already be recorded»), and the store forgets this one now.
    setOpen(null);
    void answer(supplierId, which, at);
  };

  const dialog = open === null ? null : (
    <Dialog
      isOpen
      role="alertdialog"
      title={awaitingSentence(t, locale, awaitingSupplierName(suppliers, open.supplierId, t), open.at)}
      onClose={() => {
        store.leaveAskToBanner(open.supplierId);
        setOpen(null);
      }}
      actions={
        <>
          <Button key="no" onPress={() => { reply('no'); }}>{t('ord.awaiting.no')}</Button>
          <Button key="yes" variant="primary" autoFocus onPress={() => { reply('yes'); }}>{t('ord.awaiting.yes')}</Button>
        </>
      }
    />
  );

  return <>{dialog}{dialogs}</>;
}
