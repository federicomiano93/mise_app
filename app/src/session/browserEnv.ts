// browserEnv.ts — the session's SessionEnv on a real page.

import { loadLanguage } from '../i18n/i18n';
import type { KeyValueStorage, SessionEnv } from './backend';
import { isBusy } from './busy';

// Reaching for localStorage can itself throw (blocked site data); such a phone simply remembers
// nothing, which is the safe way to fail.
function storage(get: () => Storage): KeyValueStorage & { keys(): string[] } {
  const target = (): Storage | null => { try { return get(); } catch { return null; } };
  return {
    getItem: key => target()?.getItem(key) ?? null,
    setItem: (key, value) => { target()?.setItem(key, value); },
    removeItem: key => { target()?.removeItem(key); },
    keys: () => { const s = target(); return s ? Object.keys(s) : []; },
  };
}

export function createBrowserEnv(): SessionEnv {
  const local = storage(() => window.localStorage);
  return {
    local,
    session: storage(() => window.sessionStorage),
    localKeys: () => local.keys(),
    reload: () => { window.location.reload(); },
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    isBusy,
    preloadLanguage: lang => loadLanguage(lang),
    warn: (message, detail) => { console.warn(message, detail ?? ''); },
  };
}
