import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

// The sentence for a recipe that cannot be declared, from how many of its rows are not. It is the
// current app's `incompleteText`, which the shared port leaves out because it reads the dictionary:
// here the screen hands over its own translate function.
//
//   no gap at all   the recipe has nothing in it to declare («Nothing in this recipe is declared yet»)
//   some            «{n} ingredient is / ingredients are not declared — no label can be made»; the
//                   plural form is the dictionary's job, never this file's
export function incompleteSentence(t: (key: MessageKey, params?: MessageParams) => string, gapCount: number): string {
  return gapCount === 0 ? t('cat.nothingInThisRecipe') : t('cat.alg.notDeclaredCount', { n: gapCount });
}
