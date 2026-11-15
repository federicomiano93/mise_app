import { createContext } from 'react';
import { en } from './en';
import type { Messages } from './en';
import type { Language } from './i18n';

type I18nValue = {
  readonly lang: Language;
  readonly messages: Messages;
  // Swaps the language once its messages are loaded (a venue opening is what will call it).
  readonly setLanguage: (lang: Language) => Promise<void>;
};

// ⚠️ THE DEFAULT IS A WORKING ENGLISH CONTEXT, NOT `undefined`. The whole-app error screen
// (RootError) is drawn when something above or beside the provider has already failed; if it
// threw "no provider" it would be a failure inside the failure screen, and a blank page is
// the one outcome this app must never show.
export const I18nContext = createContext<I18nValue>({
  lang: 'en',
  messages: en,
  setLanguage: () => Promise.resolve(),
});
