// A change of venue stops Firestore (backend.wipeOfflineCache → terminate). Firestore's terminate() calls the error callback of
// EVERY listener still live («Firestore shutting down»), and the Home's to-do list wrote «The to-do list stream failed» to the
// console — and so to the owner's error reports — at every switch of venue (found driving staff slice 1, 13 Nov 2026).
//
// These specs run the REAL session, the REAL gate and the REAL to-do store, with a fake Firestore that behaves as the SDK
// does on terminate(): every listener still registered is errored. The fix is that the app leaves the screen first
// (session.ts `leaving`, SessionGate), so its listeners have unsubscribed by the time the client is stopped.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { createTodosStore } from '../home/todosStore';
import type { TodosSource } from '../home/todosSource';
import type { DocData, SessionBackend, SessionEnv, SessionUser } from './backend';
import { JoinFlowProvider } from './JoinFlowContext';
import { createJoinFlow } from './joinFlow';
import { createSession, ACTIVE_LOCATION_KEY } from './session';
import { SessionGate } from './SessionGate';
import { SessionProvider } from './SessionContext';
import { memoryStorage } from '../testing/renderWithSession';

const ALICE: SessionUser = { uid: 'alice', email: 'alice@club.test', isAnonymous: false };

// A Firestore with listeners, as far as these specs need one: live listeners are kept in a set, terminate() errors each of
// them exactly as the SDK's errorAllTargets does, and a listener started after it is refused as the SDK refuses it.
function fakeFirestore() {
  const live = new Set<(err: unknown) => void>();
  let terminated = false;
  const source: TodosSource = {
    watch(onChange, onError) {
      if (terminated) {
        onError(Object.assign(new Error('The client has already been terminated.'), { code: 'failed-precondition' }));
        return () => {};
      }
      live.add(onError);
      onChange([], false);
      return () => { live.delete(onError); };
    },
    add: () => ({ id: 'x', written: Promise.resolve() }),
    edit: () => Promise.resolve(),
    setDone: () => Promise.resolve(),
    remove: () => Promise.resolve(),
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

// The Home's to-do list, as the Home holds it: one listener for as long as it is on screen.
function TodoList({ source }: { source: TodosSource }) {
  const [store] = useState(() => createTodosStore(source));
  useEffect(() => {
    store.start();
    return () => { store.stop(); };
  }, [store]);
  return <p>the to-do list</p>;
}

function setup() {
  const db = fakeFirestore();
  const docs: Record<string, DocData> = {
    'users/alice': { locations: { bakery: 'owner', restaurant: 'owner' } },
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
          <SessionGate><TodoList source={db.source} /></SessionGate>
        </JoinFlowProvider>
      </SessionProvider>
    </I18nProvider>,
  );
  store.start();
  act(() => { auth(ALICE); });
  return { db, store, backend, env, flow };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('leaving a venue stops every listener before Firestore is stopped', () => {
  test('switching venue: the to-do list has unsubscribed when the wipe runs, and nothing reaches the console', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await screen.findByText('the to-do list');
    expect(s.db.live.size).toBe(1);
    vi.mocked(s.backend.wipeOfflineCache).mockImplementationOnce(async () => {
      expect(s.db.live.size).toBe(0);
      s.db.terminate();
      return 'cleared';
    });
    await act(async () => { await s.store.switchLocation('restaurant'); });
    expect(s.backend.wipeOfflineCache).toHaveBeenCalledOnce();
    expect(s.env.reload).toHaveBeenCalledOnce();
    expect(screen.queryByText('the to-do list')).not.toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });

  // The join that adds another business ends in the same switch, and its form closes AFTER the wipe: the Home must not come
  // back and start a listener on the stopped client («The client has already been terminated»).
  test('joining another venue: once the form closes, no section starts a listener on the stopped client', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await screen.findByText('the to-do list');
    act(() => { s.flow.openForm(); });
    await waitFor(() => { expect(screen.queryByText('the to-do list')).not.toBeInTheDocument(); });
    await act(async () => { await s.store.openJoinedVenue('newplace', 'alice'); });
    act(() => { s.flow.finish(); });
    expect(s.backend.wipeOfflineCache).toHaveBeenCalledOnce();
    expect(screen.queryByText('the to-do list')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(errors).not.toHaveBeenCalled();
  });
});
