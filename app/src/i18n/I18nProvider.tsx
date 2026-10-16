import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Messages } from './en';
import { I18nContext } from './I18nContext';
import { loadLanguage } from './i18n';
import type { Language, LoadedLanguage } from './i18n';

type Props = {
  // Both come from loadLanguage() BEFORE the first render (main.tsx), so an Italian phone
  // never flashes English. They are a pair: pass what loadLanguage returned.
  initialLanguage: Language;
  initialMessages: Messages;
  children: ReactNode;
};

export function I18nProvider({ initialLanguage, initialMessages, children }: Props) {
  const [loaded, setLoaded] = useState<LoadedLanguage>({
    lang: initialLanguage,
    messages: initialMessages,
  });
  const latestRequest = useRef(0);

  // Two quick calls can finish out of order (the second language is already cached, the first
  // is not); only the LAST one asked for may win.
  const setLanguage = useCallback(async (next: Language) => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    const result = await loadLanguage(next);
    if (request === latestRequest.current) setLoaded(result);
  }, []);

  // Screen readers pick their voice from <html lang>, and the browser decides hyphenation and
  // quotes from it.
  useEffect(() => {
    document.documentElement.lang = loaded.lang;
  }, [loaded.lang]);

  const value = useMemo(
    () => ({ lang: loaded.lang, messages: loaded.messages, setLanguage }),
    [loaded, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
