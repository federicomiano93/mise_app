import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Session, SessionStore } from './session';

// The session store (session.ts) is plain TypeScript with no React in it, so a spec can drive
// it with a fake backend. This is the one place React meets it: the store goes in a context,
// and every screen reads the CURRENT session through useSession().
//
// ⚠️ THE DEFAULT IS null, NOT A QUIET "NOBODY". A screen drawn outside the provider would
// otherwise read "signed out, no powers" and look fine in a spec while being wired to nothing;
// the error names the missing provider instead.
const SessionContext = createContext<SessionStore | null>(null);

export function SessionProvider({ store, children }: { store: SessionStore; children: ReactNode }) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

// The store itself, for a screen that ACTS (sign in, sign out, switch venue) rather than reads.
export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSession must be used inside a <SessionProvider>.');
  return store;
}

// The current session. The store hands back the SAME object until something changes (it
// freezes a new one per update), which is what useSyncExternalStore needs to not loop.
export function useSession(): Session {
  const store = useSessionStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
