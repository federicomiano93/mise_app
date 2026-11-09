import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { ClientOrdersMessage } from './clientOrdersStore';

type Say = (key: MessageKey, params?: MessageParams) => string;

// What the clients' orders store reports, in the person's language.
//
// ⚠️ BOTH ARE SAID, NEVER SWALLOWED. A deadline the database refused: the old one is back on screen, and the person must
// know it did not take. An order that went into the Calculator but could not be RECORDED: the app can no longer warn if
// the client changes it afterwards.
export function clientOrdersMessageText(t: Say, message: ClientOrdersMessage): string {
  switch (message.kind) {
    case 'applied-not-recorded':
      return t('calc.clientOrders.notRecorded');
    case 'cutoff-not-saved':
      return t('calc.notSavedCheckConnection');
  }
}

// How a message is said: a short status line that goes by itself, or an alert dialog that stays until it is dismissed.
//
// ⚠️ «NOT RECORDED» IS AN ALERT, NOT A STATUS LINE (the current app used an alert): it is the warning that the app will
// no longer notice the client changing the order, and a line that vanishes after a few seconds can be missed by someone
// whose hands are in the dough. The deadline that was not saved is a status line: the old deadline is back on screen.
export function clientOrdersMessageDelivery(message: ClientOrdersMessage): 'status' | 'alert' {
  return message.kind === 'applied-not-recorded' ? 'alert' : 'status';
}
