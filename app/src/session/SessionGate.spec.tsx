import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { loadLanguage } from '../i18n/i18n';
import type { Language } from '../i18n/i18n';
import { useT } from '../i18n/useT';
import { fakeStore } from '../testing/fakeSession';
import { SessionGate } from './SessionGate';
import { SessionProvider } from './SessionContext';
import type { Session } from './session';

// The real loadLanguage, wrapped so one spec can make Italian fail to load.
vi.mock('../i18n/i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('../i18n/i18n')>();
  return { ...actual, loadLanguage: vi.fn(actual.loadLanguage) };
});

// Records every word it was drawn with, so a spec can prove the app was NEVER drawn in the wrong
// language, not merely that it ended up in the right one.
const drawn: string[] = [];
function App() {
  const { t } = useT();
  const word = t('section.orders');
  drawn.push(word);
  return <p>the app: {word}</p>;
}

function draw(session: Partial<Session>, lang: Language = 'en') {
  const store = fakeStore(session);
  const view = render(
    <I18nProvider initialLanguage={lang} initialMessages={en}>
      <SessionProvider store={store}>
        <SessionGate><App /></SessionGate>
      </SessionProvider>
    </I18nProvider>,
  );
  return { store, ...view };
}

afterEach(() => {
  drawn.length = 0;
});

describe('SessionGate: one screen per status', () => {
  it('shows only the loading screen while the session is working, and not the app', () => {
    draw({ status: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/the app/)).not.toBeInTheDocument();
  });

  it('shows the sign-in form when nobody is signed in', () => {
    draw({ status: 'signed-out', user: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Mise' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByText(/the app/)).not.toBeInTheDocument();
  });

  it('shows the venue picker when the account has several and has not chosen', () => {
    draw({ status: 'choose-location', options: ['a', 'b'], optionNames: { a: 'A', b: 'B' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Choose location' })).toBeInTheDocument();
    expect(screen.queryByText(/the app/)).not.toBeInTheDocument();
  });

  it('shows «No location yet» for an account with no venue', () => {
    draw({ status: 'no-access', options: [] });
    expect(screen.getByRole('heading', { level: 1, name: 'No location yet' })).toBeInTheDocument();
    expect(screen.queryByText(/the app/)).not.toBeInTheDocument();
  });

  it('shows «Could not check your access» when the session could not be read', () => {
    draw({ status: 'error' });
    expect(screen.getByRole('heading', { level: 1, name: 'Could not check your access' })).toBeInTheDocument();
    expect(screen.queryByText(/the app/)).not.toBeInTheDocument();
  });

  it('lets the app through only when the session is ready', () => {
    draw({ status: 'ready' });
    expect(screen.getByText('the app: Orders')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('follows the session from one screen to the next', () => {
    const { store } = draw({ status: 'loading' });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => { store.set({ status: 'signed-out', user: null }); });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();

    act(() => { store.set({ status: 'ready' }); });
    expect(screen.getByText('the app: Orders')).toBeInTheDocument();
  });

  it('has one main landmark and one h1 on every screen above the app', () => {
    for (const status of ['loading', 'signed-out', 'choose-location', 'no-access', 'error'] as const) {
      const { unmount } = draw({ status, options: ['a', 'b'], optionNames: { a: 'A', b: 'B' } });
      expect(screen.getAllByRole('main'), status).toHaveLength(1);
      if (status !== 'loading') expect(screen.getAllByRole('heading', { level: 1 }), status).toHaveLength(1);
      unmount();
    }
  });
});

describe('SessionGate: the venue\'s language comes first', () => {
  it('holds the app back until the venue\'s language is loaded, then draws it in that language', async () => {
    draw({ status: 'ready', language: 'it' }, 'en');

    // At once: the loading screen, not an English app.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/the app/)).not.toBeInTheDocument();

    // The Italian messages are a dynamic import: under a loaded CI machine it can take longer than
    // findBy's default second, which made this spec flaky.
    expect(await screen.findByText('the app: Ordini', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // ⚠️ and not once in between.
    expect(drawn).not.toContain('Orders');
    expect(document.documentElement.lang).toBe('it');
  });

  it('does not wait when the venue speaks the language already on screen', () => {
    draw({ status: 'ready', language: 'en' }, 'en');
    expect(screen.getByText('the app: Orders')).toBeInTheDocument();
    expect(drawn).toEqual(['Orders']);
  });

  it('does not touch the language of the screens above a venue', () => {
    draw({ status: 'signed-out', user: null, language: null }, 'en');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  // ⚠️ If Italian cannot be fetched the app falls back to English (loadLanguage), so the
  // language never "matches": the gate must give up waiting rather than show a spinner for ever.
  it('opens the app anyway when the venue\'s language could not be loaded', async () => {
    vi.mocked(loadLanguage).mockResolvedValueOnce({ lang: 'en', messages: en });
    draw({ status: 'ready', language: 'it' }, 'en');

    expect(await screen.findByText('the app: Orders')).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument(); });
  });
});
