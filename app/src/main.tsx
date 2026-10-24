import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { AppBoundary } from './errors/AppBoundary';
import { I18nProvider } from './i18n/I18nProvider';
import { loadLanguage, pickLanguage } from './i18n/i18n';
import { router } from './router';
import { createBrowserEnv } from './session/browserEnv';
import { createFirebaseBackend } from './session/firebaseBackend';
import { createSession } from './session/session';
import { SessionGate } from './session/SessionGate';
import { SessionProvider } from './session/SessionContext';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Mise 2 cannot start: index.html has no element with id="root".');
}

// The session starts listening NOW, in parallel with the language loading below: by the time
// the first screen is drawn the session has often already answered who is signed in.
const store = createSession(createFirebaseBackend(location.hostname), createBrowserEnv());
store.start();

// The screens above a venue follow the phone's language (his decision, 1 Oct 2026); the
// venue's own language takes over once one is opened (SessionGate). The messages are loaded
// BEFORE the first render, so an Italian phone never flashes English.
const wanted = pickLanguage(navigator.language);

void loadLanguage(wanted).then(({ lang, messages }) => {
  createRoot(container).render(
    <StrictMode>
      <AppBoundary>
        <I18nProvider initialLanguage={lang} initialMessages={messages}>
          <SessionProvider store={store}>
            <SessionGate>
              <RouterProvider router={router} />
            </SessionGate>
          </SessionProvider>
        </I18nProvider>
      </AppBoundary>
    </StrictMode>,
  );
});
