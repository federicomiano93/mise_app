import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { RecipesMessage } from './recipesStore';

// What the store says when something goes wrong, in the person's words. The store itself says
// nothing in words (it has no language): it hands over a kind, and this is the one place that turns
// it into a sentence.
export function messageText(
  t: (key: MessageKey, params?: MessageParams) => string,
  message: RecipesMessage,
): string {
  switch (message.kind) {
    case 'recipes-stream-broken':
      return t('cat.liveSyncInterruptedRecipes');
  }
}
