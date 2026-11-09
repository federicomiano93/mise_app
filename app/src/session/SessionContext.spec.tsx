import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { fakeStore } from '../testing/fakeSession';
import { SessionProvider, useSession, useSessionStore } from './SessionContext';

function Status() {
  const session = useSession();
  return <p>{session.status}:{session.name}</p>;
}

describe('SessionProvider and useSession', () => {
  it('gives a screen the current session', () => {
    render(<SessionProvider store={fakeStore({ name: 'Bakery' })}><Status /></SessionProvider>);
    expect(screen.getByText('ready:Bakery')).toBeInTheDocument();
  });

  it('redraws the screen when the session changes', () => {
    const store = fakeStore({ status: 'loading', name: '' });
    render(<SessionProvider store={store}><Status /></SessionProvider>);
    expect(screen.getByText('loading:')).toBeInTheDocument();

    act(() => { store.set({ status: 'ready', name: 'Bakery' }); });

    expect(screen.getByText('ready:Bakery')).toBeInTheDocument();
  });

  it('gives a screen the store itself, to act on', () => {
    const store = fakeStore();
    let seen: unknown = null;
    function Probe() {
      seen = useSessionStore();
      return null;
    }
    render(<SessionProvider store={store}><Probe /></SessionProvider>);
    expect(seen).toBe(store);
  });

  it('stops listening when the screen goes away', () => {
    const store = fakeStore();
    const unsubscribe = vi.fn();
    store.subscribe = () => unsubscribe;
    const { unmount } = render(<SessionProvider store={store}><Status /></SessionProvider>);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  describe('outside a provider', () => {
    let logged: MockInstance;

    beforeEach(() => {
      logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it('fails loudly instead of reading "nobody is signed in"', () => {
      expect(() => render(<Status />)).toThrow('useSession must be used inside a <SessionProvider>.');
    });
  });
});
