import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useOrders, useOrdersStore } from './OrdersContext';
import { awaitingSupplierName } from './awaitingWords';
import type { OrdersLens } from './ordersLens';
import { useAnswerAwaiting } from './useAnswerAwaiting';
import styles from './AskHereDialog.module.css';

// How often a question that had to wait (another dialog was open) looks again whether the way is clear.
const RECHECK_MS = 1000;

// «ROSSI — Order sent?» as a small centred dialog, on the device that SENT it, once the page is back (the share sheet answered while it
// was visible, or the window the text opened has come back). One supplier at a time, big «No» / «Yes» (the redesign of 16 Nov 2026,
// replacing the «did it go?» banner on this device).
//
// ⚠️ IT MUST BE ANSWERED: no Cancel, and neither a tap outside nor Escape closes it (`forced`); the focus starts on its first button.
// On every other device the same question stays a line that blocks nothing (AwaitingBanners). The recording is unchanged: «Yes»
// records it in History, «No» keeps the quantities.
//
// Mounted at the level of the whole section, so it survives moving from one Orders screen to another — and so it is asked on any
// Orders screen. (Outside Orders the section's store, and with it this device's own list of questions, is not running: the question
// then stays the line on every device.)
//
// ⚠️ NEVER OVER ANOTHER DIALOG (an editor still going through its suppliers, a confirmation): two stacked dialogs share one Escape. The
// question waits, and is asked again at the next snapshot or when the page comes back; the banner asks meanwhile.
//
// ⚠️ IT CLOSES ITSELF WHEN SOMEBODY ELSE HAS ANSWERED (or a newer send replaced the question) while it is open — the leftover found on
// the tablet in the current app, where a dialog kept asking about an order another device had already recorded. It says so.
// ⚠️ «ELSEWHERE» ONLY WHEN THAT QUESTION IS GONE (same supplier, same `at`) from the questions on the page — never because the store
// stopped asking: it stops while the page is hidden, and a question that still stands has not been answered by anybody.
export function AskHereDialog({ lens }: { lens: OrdersLens }) {
  const { t } = useT();
  const store = useOrdersStore();
  const { awaiting, suppliers } = useOrders();
  const { questions } = awaiting;
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
    const stands = questions.some(question => question.supplierId === open.supplierId && question.entry.at === open.at);
    if (!stands) {
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
      forced
      small
      title={awaitingSupplierName(suppliers, open.supplierId, t)}
      message={t('ord.awaiting.sent')}
      // Never called while `forced` (no Escape, no backdrop, no Cancel): kept so the question is handed to the line if it ever is.
      onClose={() => {
        store.leaveAskToBanner(open.supplierId);
        setOpen(null);
      }}
      actions={
        <>
          <Button key="no" className={styles.answer} autoFocus onPress={() => { reply('no'); }}>{t('ord.awaiting.no')}</Button>
          <Button key="yes" variant="primary" className={styles.answer} onPress={() => { reply('yes'); }}>{t('ord.awaiting.yes')}</Button>
        </>
      }
    />
  );

  return <>{dialog}{dialogs}</>;
}
