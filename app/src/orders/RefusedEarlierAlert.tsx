import { useEffect, useRef } from 'react';
import { useT } from '../i18n/useT';
import { useAlert } from '../ui/useAlert';
import { useOrders, useOrdersStore } from './OrdersContext';

// «Quantity not saved», said ONCE when Orders opens after the server refused a typed quantity that had left as the person
// left Orders (item 6 of docs/mise2-port-owed.md; draftSync.ts noteRefused). The current app asks the same thing, with the
// same title, before it lets the person leave (orders.fromRecipe.refusedTitle); Mise 2 does not wait for the server on the way
// out, so it says it on the way back in.
//
// A notice, not a question: there is nothing to choose. Whatever may come back is put on screen by the store meanwhile, as a
// refusal on this opening would be («not saved» on the status line, sent with the next change), so OK, Escape or leaving all
// end it the same way: the store forgets that it has something to say (refusedEarlierSaid), and it is never said again for
// the same refusal (refusedNote.ts `told`).
export function RefusedEarlierAlert() {
  const { t } = useT();
  const store = useOrdersStore();
  const { refusedEarlier } = useOrders();
  const [alert, dialog] = useAlert();
  // One notice at a time: a new `t` (the language loaded) must not open it a second time.
  const shown = useRef(false);
  useEffect(() => {
    if (!refusedEarlier || shown.current) return;
    shown.current = true;
    void alert({
      title: t('ord.refusedEarlier.title'),
      message: t('ord.refusedEarlier.message'),
      okLabel: t('common.ok'),
    }).then(() => {
      shown.current = false;
      store.refusedEarlierSaid();
    });
  }, [refusedEarlier, alert, store, t]);
  return dialog;
}
