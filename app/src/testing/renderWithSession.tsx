import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Language } from '../i18n/i18n';
import { SessionProvider } from '../session/SessionContext';
import type { Session } from '../session/session';
import { fakeStore } from './fakeSession';

type Options = {
  lang?: Language;
  // What the session says, on top of the default (see fakeStore).
  session?: Partial<Session>;
};

// Draws ONE screen (no router, no shell) with a language and a fake session around it, and gives
// back the fake store and a user to click with. For the specs of the gate screens and of the
// buttons that act on the session; renderApp is for the whole app.
export function renderWithSession(ui: ReactNode, { lang = 'en', session }: Options = {}) {
  const store = fakeStore(session);
  const user = userEvent.setup();
  const view = render(
    <I18nProvider initialLanguage={lang} initialMessages={lang === 'it' ? italian : en}>
      <SessionProvider store={store}>{ui}</SessionProvider>
    </I18nProvider>,
  );
  return { store, user, ...view };
}
