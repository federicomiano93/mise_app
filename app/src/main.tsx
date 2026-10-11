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
import { createTelemetrySinks } from './telemetry/sinks';
import { startTelemetry } from './telemetry/startTelemetry';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Mise 2 cannot start: index.html has no element with id="root".');
}

// ONE backend: the session reads through it, and the telemetry writes through the same Firestore
// and Auth (a second one would be a second connection and a second offline cache).
const backend = createFirebaseBackend(location.hostname);
const store = createSession(backend, createBrowserEnv());
const sinks = createTelemetrySinks(backend, () => {
  const session = store.getSnapshot();
  return session.status === 'ready' ? session.locationId : null;
});

// ⚠️ THE TELEMETRY STARTS BEFORE THE SESSION (main.spec.ts pins the order). Its error
// listeners must be on before anything else runs, or an error during boot is lost: the reporter
// keeps it in memory and sends it once a venue is open.
startTelemetry({ store, sinks });

// The session starts listening NOW, in parallel with the language loading below: by the time
// the first screen is drawn the session has often already answered who is signed in.
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
