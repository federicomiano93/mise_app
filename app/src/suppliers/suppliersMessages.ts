import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { SuppliersMessage } from './suppliersStore';

// What the store says when something goes wrong, in the person's words (the store has no language). Slice A can
// only star a supplier, so only a refused star has a sentence; the supplier writes of slice B add theirs, and until
// then nothing else is ever sent.
export function messageText(
  t: (key: MessageKey, params?: MessageParams) => string,
  message: SuppliersMessage,
): string | null {
  if (message.kind === 'favourite-not-saved') return t('sup.favouriteNotSaved');
  return null;
}
