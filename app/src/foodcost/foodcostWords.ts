import type { PriceTranslate } from '@mise/shared/price-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

// The translator the shared Food cost model is handed (productPreview, unpricedParts, unpricedReasonText: the words
// of a line that no longer exists and of a reason, item 26). The shared package knows its dictionary keys as plain
// strings; they are the app's own `fc.*` and `cat.cost.*` keys, so this only narrows the type. A key the app lacked
// would print as a bare key: foodcostWords.spec.ts asks for every one of them in both languages.
export function foodcostTranslate(t: (key: MessageKey, params?: MessageParams) => string): PriceTranslate {
  return (key, params) => t(key as MessageKey, params);
}
