import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Language } from '../i18n/i18n';
import { markLoaded } from '../telemetry/usage';
import { fakeStore } from '../testing/fakeSession';
import { SessionGate } from './SessionGate';
import { SessionProvider } from './SessionContext';
import type { Session } from './session';

// The page's load time (usage.ts, markLoaded) is when the FIRST screen is up. Marked at the
// shell's first render instead, a visit that starts signed out would count the time it takes to
// type a password. markLoaded itself keeps only its first call (usage.spec.ts); what is pinned
// here is WHEN the gate calls it, so the function is replaced by a spy.
vi.mock('../telemetry/usage', async importOriginal => {
  const actual = await importOriginal<typeof import('../telemetry/usage')>();
  return { ...actual, markLoaded: vi.fn() };
});

function draw(session: Partial<Session>, lang: Language = 'en') {
  const store = fakeStore(session);
  render(
    <I18nProvider initialLanguage={lang} initialMessages={en}>
      <SessionProvider store={store}>
        <SessionGate><p>the app</p></SessionGate>
      </SessionProvider>
    </I18nProvider>,
  );
  return store;
}

beforeEach(() => {
  vi.mocked(markLoaded).mockClear();
});

describe('SessionGate: the page counts as loaded when the first screen is up', () => {
  it('not while the session is still loading', () => {
    draw({ status: 'loading' });
    expect(markLoaded).not.toHaveBeenCalled();
  });

  it.each([
    ['signed-out', { user: null }],
    ['choose-location', { options: ['a', 'b'], optionNames: { a: 'A', b: 'B' } }],
    ['no-access', { options: [] }],
    ['error', {}],
  ] as const)('at the %s screen, without waiting for the shell', (status, more) => {
    draw({ status, ...more });
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    expect(markLoaded).toHaveBeenCalled();
  });

  it('when the shell is up, for a visit that starts already signed in', () => {
    draw({ status: 'ready' });
    expect(screen.getByText('the app')).toBeInTheDocument();
    expect(markLoaded).toHaveBeenCalled();
  });

  it('when the loading screen gives way to the sign-in form, and not before', () => {
    const store = draw({ status: 'loading' });
    expect(markLoaded).not.toHaveBeenCalled();

    act(() => { store.set({ status: 'signed-out', user: null }); });
    expect(markLoaded).toHaveBeenCalledTimes(1);
  });

  // The venue's language holds the shell back until it is loaded: the page is not up yet.
  it('not while the shell is held back for the venue\'s language, only once it is drawn', async () => {
    draw({ status: 'ready', language: 'it' }, 'en');
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    expect(markLoaded).not.toHaveBeenCalled();

    await waitFor(() => { expect(screen.getByText('the app')).toBeInTheDocument(); }, { timeout: 5000 });
    // Called from an effect, which can run a moment after the screen is on the page.
    await waitFor(() => { expect(markLoaded).toHaveBeenCalled(); });
  });
});
