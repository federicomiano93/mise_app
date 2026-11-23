// The people list's listener and a change of venue, a sign-out or another person signing in (staff slice 4). Each of those stops
// Firestore (backend.wipeOfflineCache → terminate), which errors every listener still live («Firestore shutting down»); the roster
// would then write «The people list stream failed» to the console — and so to the owner's error reports — right before the reload
// (staff slice 2 found it with the to-do list; session/leaveVenue.spec.tsx).
//
// These specs run the REAL session, the REAL gate and the REAL people store against a fake Firestore that behaves as the SDK does on
// terminate(): the screen leaves first (session.ts `leaving`), so the roster has unsubscribed by the time the client is stopped.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import type { DocData, SessionBackend, SessionEnv, SessionUser } from '../session/backend';
import { JoinFlowProvider } from '../session/JoinFlowContext';
import { createJoinFlow } from '../session/joinFlow';
import { createSession, ACTIVE_LOCATION_KEY } from '../session/session';
import { SessionGate } from '../session/SessionGate';
import { SessionProvider } from '../session/SessionContext';
import { member } from '../testing/fakeSettingsSource';
import { memoryStorage } from '../testing/renderWithSession';
import { createPeopleStore } from './peopleStore';
import type { SettingsSource } from './settingsSource';

const ALICE: SessionUser = { uid: 'alice', email: 'alice@club.test', isAnonymous: false };

// A Firestore with listeners, as far as these specs need one: live listeners are kept in a set, terminate() errors each of
// them exactly as the SDK's errorAllTargets does, and a listener started after it is refused as the SDK refuses it.
function fakeFirestore() {
  const live = new Set<(err: unknown) => void>();
  let terminated = false;
  const source: Pick<SettingsSource, 'watchMembers'> = {
    watchMembers(onChange, onError) {
      if (terminated) {
        onError(Object.assign(new Error('The client has already been terminated.'), { code: 'failed-precondition' }));
        return () => {};
      }
      live.add(onError);
      onChange([member('alice', { email: 'alice@club.test', firstName: 'Alice', role: 'owner' })]);
      return () => { live.delete(onError); };
    },
  };
  return {
    source,
    live,
    terminate() {
      terminated = true;
      for (const onError of [...live]) onError(Object.assign(new Error('Firestore shutting down'), { code: 'aborted' }));
      live.clear();
    },
  };
}

// The people list, as PeopleList.tsx holds its store: one listener for as long as it is on screen.
function Roster({ source }: { source: Pick<SettingsSource, 'watchMembers'> }) {
  const [store] = useState(() => createPeopleStore(source));
  useEffect(() => {
    store.start();
    return () => { store.stop(); };
  }, [store]);
  return <p>the people list</p>;
}

function setup() {
  const db = fakeFirestore();
  const docs: Record<string, DocData> = {
    'users/alice': { locations: { bakery: 'owner', restaurant: 'owner' } },
    'users/bob': { locations: { bakery: true } },
    'locations/bakery': { name: 'Bakery' },
    'locations/restaurant': { name: 'Restaurant' },
  };
  let auth: (user: SessionUser | null) => void = () => {};
  const backend: SessionBackend = {
    onAuthChange: cb => { auth = cb; return () => {}; },
    readPreferCache: async path => ({ data: docs[path] ?? null, cached: false }),
    readFromServer: async path => docs[path] ?? null,
    signIn: async () => {},
    signUp: async () => ALICE,
    sendReset: async () => {},
    sendEmailVerification: async () => {},
    refreshEmailVerified: async () => true,
    deleteCurrentAccount: async () => {},
    signOut: async () => {},
    wipeOfflineCache: vi.fn(async () => { db.terminate(); return 'cleared' as const; }),
    changesStillWaiting: async () => false,
    callFunction: async () => ({ locationId: 'newplace' }),
  };
  const local = memoryStorage({ [ACTIVE_LOCATION_KEY]: 'bakery', 'offline-cache-uid': 'alice' });
  const env: SessionEnv = {
    local,
    session: memoryStorage(),
    localKeys: () => [...local.map.keys()],
    reload: vi.fn(),
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    isBusy: () => false,
    preloadLanguage: async () => {},
    warn: () => {},
    // The browser's own wait (browserEnv.ts): a short timer, in which React redraws.
    letScreensClose: () => new Promise(resolve => { setTimeout(resolve, 10); }),
  };
  const store = createSession(backend, env);
  const flow = createJoinFlow(memoryStorage());
  render(
    <I18nProvider initialLanguage="en" initialMessages={en}>
      <SessionProvider store={store}>
        <JoinFlowProvider flow={flow}>
          <SessionGate><Roster source={db.source} /></SessionGate>
        </JoinFlowProvider>
      </SessionProvider>
    </I18nProvider>,
  );
  store.start();
  act(() => { auth(ALICE); });
  return { db, store, backend, env, flow, auth: (user: SessionUser | null) => { auth(user); } };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('leaving the venue stops the people list before Firestore is stopped', () => {
  test('switching venue: the roster has unsubscribed when the wipe runs, and nothing reaches the console', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await screen.findByText('the people list');
    expect(s.db.live.size).toBe(1);
    vi.mocked(s.backend.wipeOfflineCache).mockImplementationOnce(async () => {
      expect(s.db.live.size).toBe(0);
      s.db.terminate();
      return 'cleared';
    });
    await act(async () => { await s.store.switchLocation('restaurant'); });
    expect(s.backend.wipeOfflineCache).toHaveBeenCalledOnce();
    expect(s.env.reload).toHaveBeenCalledOnce();
    expect(screen.queryByText('the people list')).not.toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });

  test('signing out: the roster has unsubscribed when the wipe runs, and nothing reaches the console', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await screen.findByText('the people list');
    vi.mocked(s.backend.wipeOfflineCache).mockImplementationOnce(async () => {
      expect(s.db.live.size).toBe(0);
      s.db.terminate();
      return 'cleared';
    });
    await act(async () => { await s.store.signOut(); });
    expect(s.backend.wipeOfflineCache).toHaveBeenCalledOnce();
    expect(s.env.reload).toHaveBeenCalledOnce();
    expect(errors).not.toHaveBeenCalled();
  });

  test('a different person signing in: the roster has unsubscribed when the wipe runs, and nothing reaches the console', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await screen.findByText('the people list');
    vi.mocked(s.backend.wipeOfflineCache).mockImplementationOnce(async () => {
      expect(s.db.live.size).toBe(0);
      s.db.terminate();
      return 'cleared';
    });
    act(() => { s.auth({ uid: 'bob', email: 'bob@club.test', isAnonymous: false }); });
    await waitFor(() => { expect(s.env.reload).toHaveBeenCalledOnce(); });
    expect(s.backend.wipeOfflineCache).toHaveBeenCalledOnce();
    expect(screen.queryByText('the people list')).not.toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });
});
