import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { StocktakeMessage } from './stocktakeStore';

// What the store says when something goes wrong, in the person's words. The store itself says
// nothing in words (it has no language): it hands over a kind, and this is the one place that turns
// it into a sentence — or into silence.
//
// ⚠️ THE BROKEN MONTH STREAM IS SAID ONLY TO WHOEVER RUNS THE PLACE. For an employee it is the
// rules keeping a closed (or priced) month from them: the screen answers that with its own
// sentence in place of the list (StocktakeSection), and «live updates interrupted» over it would
// read as a broken app. null means «say nothing».
export function messageText(
  t: (key: MessageKey, params?: MessageParams) => string,
  message: StocktakeMessage,
  canManage: boolean,
): string | null {
  switch (message.kind) {
    case 'not-saved-yet':
      return t('stock.notSavedYet');
    case 'month-stream-broken':
      return canManage ? t('stock.liveSyncInterrupted') : null;
  }
}
