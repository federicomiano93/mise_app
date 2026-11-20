import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { CakesMessage } from './cakesStore';

// What the store says when something goes wrong, in the person's words (the store has no language: it hands over a kind).
export function cakesMessageText(
  t: (key: MessageKey, params?: MessageParams) => string,
  message: CakesMessage,
): string {
  switch (message.kind) {
    case 'cakes-stream-broken':
      return t('cakes.liveSyncInterrupted');
    case 'reference-not-saved':
      return t('cakes.referenceNotSaved');
  }
}
