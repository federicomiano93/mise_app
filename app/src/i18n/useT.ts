import { useCallback, useContext, useMemo } from 'react';
import type { MessageKey } from './en';
import { I18nContext } from './I18nContext';
import { format, localeOf } from './i18n';
import type { MessageParams } from './i18n';

// ⚠️ A component calls useT() and reads t() while it DRAWS, never in a module-level constant:
// a constant would freeze the language the page booted in, for the life of the page, and the
// language changes when a venue opens.
export function useT() {
  const { lang, messages } = useContext(I18nContext);

  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => format(lang, messages[key], params),
    [lang, messages],
  );

  return useMemo(() => ({ t, lang, locale: localeOf(lang) }), [t, lang]);
}
