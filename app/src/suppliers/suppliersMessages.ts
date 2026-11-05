import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { SuppliersMessage } from './suppliersStore';

// What the store says when something goes wrong, in the person's words (the store has no language): every kind has a
// sentence, said through the status message. Each names what was being done, and every one but the star names the thing
// it was done to.
export function messageText(
  t: (key: MessageKey, params?: MessageParams) => string,
  message: SuppliersMessage,
): string {
  switch (message.kind) {
    case 'favourite-not-saved': return t('sup.favouriteNotSaved');
    case 'supplier-not-saved': return t('sup.notSaved', { name: message.name });
    case 'supplier-active-not-saved': return t('sup.notSwitched', { name: message.name });
    case 'supplier-not-deleted': return t('sup.notDeleted', { name: message.name });
    case 'category-not-deleted': return t('sup.categoryNotDeleted', { name: message.name });
  }
}
