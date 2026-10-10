// The language machinery, with no React in it so every rule can be asserted without a screen
// (the same reason the current app keeps js/i18n.js free of the DOM). The React side is
// I18nProvider.tsx and useT.ts.
import { en } from './en';
import type { Message, Messages, PluralMessage } from './en';

export type Language = 'en' | 'it';
export const LANGUAGES: readonly Language[] = ['en', 'it'];
export const DEFAULT_LANGUAGE: Language = 'en';

export type MessageParams = Readonly<Record<string, string | number>>;

// The phone's language, as the current app reads it (languageFromTag in js/i18n.js): the part
// before the first «-», lower-cased; Italian is Italian, everything else is English.
//
// ⚠️ IT IS A GUESS, AND ONLY EVER APPLIES BEFORE A VENUE IS OPEN (his decision, 1 Oct 2026:
// the screens above a venue follow the phone). The venue's own language takes over once one
// is chosen — a venue whose staff read English stays English on an Italian phone. And neither
// of them decides the language of a printed label: that follows the venue's COUNTRY.
export function pickLanguage(tag: string | undefined | null): Language {
  const base = (tag ?? '').toLowerCase().split('-')[0];
  return LANGUAGES.find(language => language === base) ?? DEFAULT_LANGUAGE;
}

// The tag Intl needs for dates, numbers and plurals. en-GB, not en-US: the first customer
// is in the UK, so «10 October» and «1,000» are what he expects to read.
export function localeOf(lang: Language): string {
  return lang === 'it' ? 'it-IT' : 'en-GB';
}

// Which form of a plural message a count selects. CLDR decides (Italian has a `many` form
// for millions, English has no `few`), and a language whose rule picks a form the message does
// not carry falls back to `other`, which every PluralMessage must have.
function pluralForm(lang: Language, message: PluralMessage, count: unknown): string {
  if (typeof count !== 'number') return message.other;
  const category = new Intl.PluralRules(localeOf(lang)).select(count);
  return message[category] ?? message.other;
}

const PLACEHOLDER = /\{(\w+)\}/g;

// Fills a message in. ⚠️ A placeholder nobody supplied stays visible as «{name}» instead of
// becoming «undefined» or throwing: a missing word is a bug a person can read out loud, a
// thrown error is a blank screen. Numbers are formatted for the language, so 1000 reads
// «1,000» in English and «1.000» in Italian.
export function format(lang: Language, message: Message, params?: MessageParams): string {
  const text = typeof message === 'string' ? message : pluralForm(lang, message, params?.['count']);
  if (!params) return text;
  let numbers: Intl.NumberFormat | undefined;
  return text.replace(PLACEHOLDER, (placeholder, name: string) => {
    if (!Object.hasOwn(params, name)) return placeholder;
    const value = params[name];
    if (value === undefined) return placeholder;
    if (typeof value === 'string') return value;
    numbers ??= new Intl.NumberFormat(localeOf(lang));
    return numbers.format(value);
  });
}

export type LoadedLanguage = { readonly lang: Language; readonly messages: Messages };

// English travels in the main bundle; Italian is its own chunk, fetched only by a phone that
// asks for it. ⚠️ IF THAT FETCH FAILS (offline on a first visit, nothing cached yet) THE ANSWER
// IS ENGLISH, NOT A REJECTION: a rejected promise here is a screen that never appears, and
// English text is a screen a person can still use. The language reported back is the one the
// messages are really in, so <html lang> never claims Italian over English text.
export async function loadLanguage(lang: Language): Promise<LoadedLanguage> {
  if (lang === 'it') {
    try {
      const { it } = await import('./it');
      return { lang: 'it', messages: it };
    } catch {
      return { lang: 'en', messages: en };
    }
  }
  return { lang: 'en', messages: en };
}
