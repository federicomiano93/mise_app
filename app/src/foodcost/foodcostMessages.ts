import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { FoodcostMessage } from './foodcostStore';

// What the store says when something goes wrong, in the person's words. The store itself says
// nothing in words (it has no language): it hands over a kind, and this is the one place that turns
// it into a sentence.
export function messageText(
  t: (key: MessageKey, params?: MessageParams) => string,
  message: FoodcostMessage,
): string {
  switch (message.kind) {
    case 'product-not-saved':
      // A product with no name still has to be named in the sentence.
      return t('fc.couldNotSaveProduct', { name: message.name.trim() === '' ? t('fc.productWord') : message.name });
    case 'loss-not-saved':
      return t('fc.couldNotSaveLoss', { name: message.name });
    case 'product-not-deleted':
      return t('fc.couldnTDeleteThe');
    case 'rate-not-saved':
      return t('fc.settings.couldNotSave');
    case 'products-stream-broken':
      return t('fc.liveSyncInterruptedProducts');
  }
}
