// pack-words.ts — the package words the ingredient card's «Che confezione è?» menu adds to the venue's list, and the
// plural a quantity of a package reads with («2 bottiglie», «1 secchiello»). PURE: it imports only record-choices.
//
// New in Mise 2 (no file of the current app to pair it with): `packWordFor` in record-choices.ts stays the paired port of
// the original and knows only the seven default words, so the two words added here live in this file and the paired file
// is not touched.
//
// ⚠️ THE WORDS FOLLOW THE VENUE'S COUNTRY (its OUTPUT language), never the screen's: «secchiello» is a word the supplier
// reads in the order. Callers pass `outputLanguage(location) ?? 'en'`; nothing here is a t() key.

import { packChoices, packWordFor } from './record-choices';
import type { ChoicesInput } from './record-choices';

// The package words added to the defaults, per output language. Anything that is not 'it' reads the English column.
export const EXTRA_PACKS: Readonly<{ it: readonly string[]; en: readonly string[] }> = Object.freeze({
  it: Object.freeze(['secchiello', 'latta']),
  en: Object.freeze(['bucket', 'tin']),
});

// Their plurals. A small table, not a grammar; read only with hasOwnProperty («constructor» is not a word in it).
const EXTRA_PLURALS: Readonly<{ it: Readonly<Record<string, string>>; en: Readonly<Record<string, string>> }> = Object.freeze({
  it: Object.freeze({ secchiello: 'secchielli', latta: 'latte' }),
  en: Object.freeze({ bucket: 'buckets', tin: 'tins' }),
});

const side = (language: unknown): 'it' | 'en' => (language === 'it' ? 'it' : 'en');

const clean = (word: unknown): string => (typeof word === 'string' ? word.trim() : '');

// The word as it reads for `count` packages: the plural, or the singular for exactly one. null for any word the two tables do
// not know (the caller then writes «2 × word»). The default words are answered by record-choices.packWordFor — asked with a
// count of 2 first, because that is the call that tells a known word from an unknown one («constructor» comes back as a
// function there, never a string).
export function packPlural(word: unknown, count: unknown, language: unknown): string | null {
  const key = clean(word).toLowerCase();
  if (key === '') return null;
  if (typeof packWordFor(key, 2, language) === 'string') {
    const known = packWordFor(key, count, language);
    return typeof known === 'string' ? known : null;
  }
  const plurals = EXTRA_PLURALS[side(language)];
  if (!Object.prototype.hasOwnProperty.call(plurals, key)) return null;
  return Number(count) === 1 ? key : plurals[key] as string;
}

// record-choices.packChoices plus the venue-language extras that are not already in the list (ignoring case: an
// in-use spelling wins), in the same alphabetical order.
export function packChoicesWithExtras(input: ChoicesInput = {}): string[] {
  const base = packChoices(input);
  const have = new Set(base.map(word => word.toLowerCase()));
  const extra = EXTRA_PACKS[side(input.language)].filter(word => !have.has(word));
  return [...base, ...extra].sort((a, b) => a.localeCompare(b));
}
