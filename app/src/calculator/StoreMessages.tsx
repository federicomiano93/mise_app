import { useEffect } from 'react';
import { useT } from '../i18n/useT';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useCalculatorStore, useClientOrdersStore } from './CalculatorContext';
import { messageText } from './calculatorMessages';
import { clientOrdersMessageDelivery, clientOrdersMessageText } from './clientOrdersMessages';

// What the stores report (a dough the database refused, a log that is full, an order that could not be recorded as used,
// a deadline that was not saved) goes to the status message, on whatever Calculator screen is open — and on the Clients
// section's, which shares the stores. Draw it inside a StatusMessageProvider.
export function StoreMessages() {
  const { t } = useT();
  const store = useCalculatorStore();
  const clientOrders = useClientOrdersStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => {
    const text = messageText(t, message);
    if (text !== null) say(text);
  }), [store, say, t]);
  // ⚠️ A message that is a warning (an order used but not recorded) stays on screen until it is dismissed.
  const [alert, alertDialog] = useAlert();
  useEffect(() => clientOrders.onMessage(message => {
    const text = clientOrdersMessageText(t, message);
    if (clientOrdersMessageDelivery(message) === 'alert') void alert({ message: text, okLabel: t('common.ok') });
    else say(text);
  }), [clientOrders, say, alert, t]);
  return alertDialog;
}
