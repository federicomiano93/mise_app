import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { PastriesMessage } from './pastriesStore';
import { weekdayLabel } from './weekdays';

// What the store says when something goes wrong, in the person's words. The store itself says
// nothing in words (it has no language): it hands over a kind and the day, and this is the one
// place that turns them into a sentence.
//
// ⚠️ THE DAY IS ITS LABEL («Martedì»), never its id.
export function messageText(
  t: (key: MessageKey, params?: MessageParams) => string,
  message: PastriesMessage,
): string {
  switch (message.kind) {
    case 'save-failed':
      return t('past.couldNotSaveDay', { day: weekdayLabel(t, message.day) });
    case 'days-stream-broken':
      return t('past.liveSyncInterruptedThis');
    case 'logs-stream-broken':
      return t('past.liveSyncInterruptedThese');
    case 'record-failed':
      return t('past.couldNotRecord', { day: weekdayLabel(t, message.day) });
    case 'remove-failed':
      return t('past.couldnTRemoveThat');
  }
}
