import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { INITIAL_SESSION } from '../session/session';
import type { Session, SessionStore } from '../session/session';

// A SessionStore for the specs of screens: every method is a spy, and the snapshot can be moved
// between statuses with set(). The real store (session.ts) is covered by session.spec.ts against
// a fake backend; a screen's spec only needs to know what the store SAYS and what it was ASKED.
type FakeStore = SessionStore & {
  // Updates the snapshot and tells every subscriber, like the real store does.
  set(partial: Partial<Session>): void;
  signIn: Mock<SessionStore['signIn']>;
  sendReset: Mock<SessionStore['sendReset']>;
  signOut: Mock<SessionStore['signOut']>;
  chooseLocation: Mock<SessionStore['chooseLocation']>;
  switchLocation: Mock<SessionStore['switchLocation']>;
  changesStillWaiting: Mock<SessionStore['changesStillWaiting']>;
  refreshLocation: Mock<SessionStore['refreshLocation']>;
};

// By default: the owner of one venue, signed in and ready, in English.
export function fakeStore(partial: Partial<Session> = {}): FakeStore {
  let snapshot: Session = Object.freeze({
    ...INITIAL_SESSION,
    status: 'ready',
    user: { uid: 'u1', email: 'owner@club.test', isAnonymous: false },
    locationId: 'bakery',
    location: {},
    options: ['bakery'],
    optionNames: {},
    name: 'Bakery',
    role: 'owner',
    canManage: true,
    isOwner: true,
    language: 'en',
    ...partial,
  });
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: vi.fn(),
    signIn: vi.fn<SessionStore['signIn']>(() => Promise.resolve()),
    sendReset: vi.fn<SessionStore['sendReset']>(() => Promise.resolve()),
    signOut: vi.fn<SessionStore['signOut']>(() => Promise.resolve()),
    chooseLocation: vi.fn<SessionStore['chooseLocation']>(() => Promise.resolve()),
    switchLocation: vi.fn<SessionStore['switchLocation']>(() => Promise.resolve()),
    changesStillWaiting: vi.fn<SessionStore['changesStillWaiting']>(() => Promise.resolve(false)),
    refreshLocation: vi.fn<SessionStore['refreshLocation']>(() => Promise.resolve()),
    set(next) {
      snapshot = Object.freeze({ ...snapshot, ...next });
      listeners.forEach(listener => { listener(); });
    },
  };
}
