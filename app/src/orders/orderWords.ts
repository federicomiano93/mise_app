// orderWords.ts — the lists of names the order screens say aloud. The joiner is a WORD of the interface language
// (`ui.listPair`), never `names.join(' and ')`. Pure: the translator is handed in.
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Say = (key: MessageKey, params?: MessageParams) => string;

// «A», «A and B», «A, B and C».
export function joinList(t: Say, names: readonly string[]): string {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return t('ui.listPair', { a: list.slice(0, -1).join(', '), b: list[list.length - 1] ?? '' });
}

// Who «Clear quantities» is about: one name; up to three joined with commas; more than three, a count.
export function whoWords(t: Say, names: readonly string[]): string {
  if (names.length === 1) return names[0] ?? '';
  if (names.length <= 3) return names.join(', ');
  return t('ord.nSuppliers', { n: names.length });
}
