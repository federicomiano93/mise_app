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
