// ⚠️⚠️ FIRST, BEFORE EVERY OTHER IMPORT: a join link's token is read and taken out of the address bar and the history
// entry here, before the router (created as router.ts is imported) or the telemetry can see it (session/joinLinkBoot.ts;
// main.spec.ts pins the order).
import { joinFlow, setJoinLinkReturn } from './session/joinLinkBoot';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { createDataServices, DataProvider } from './data/DataContext';
import { AppBoundary } from './errors/AppBoundary';
import { PartBoundary } from './errors/PartBoundary';
import { onRouteError } from './errors/routeErrors';
import { I18nProvider } from './i18n/I18nProvider';
import { loadLanguage, pickLanguage } from './i18n/i18n';
import { vapidKeyForHost } from '@mise/shared/firebase-target';
import { browserHasSubscription, browserPushEnv, createPhonePush, rowWriter } from './push/phonePush';
import { PhonePushProvider } from './push/PhonePushContext';
import { createTimerPush } from './push/timerPush';
import { browserRefreshDeps, startPushTokenRefresh, tokenWriter } from './orders/pushTokenRefresh';
import { router } from './router';
import { createBrowserEnv } from './session/browserEnv';
import { createFirebaseBackend } from './session/firebaseBackend';
import { createSession } from './session/session';
import { SessionGate } from './session/SessionGate';
import { SessionProvider } from './session/SessionContext';
import { JoinFlowProvider } from './session/JoinFlowContext';
import { Kiosk } from './kiosk/Kiosk';
import { browserServiceWorkerEnv, watchServiceWorker } from './shell/serviceWorker';
import { installViewportHeight } from './shell/viewportHeight';
import { createTelemetrySinks } from './telemetry/sinks';
import { startTelemetry } from './telemetry/startTelemetry';
import { browserStorage } from './telemetry/common';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Mise 2 cannot start: index.html has no element with id="root".');
}

// ONE backend: the session reads through it, and the telemetry writes through the same Firestore
// and Auth (a second one would be a second connection and a second offline cache).
const backend = createFirebaseBackend(location.hostname);
// ⚠️ `phonePush` is made below (it reads this store); the sign-out calls it lazily, long after both exist (security audit A2-1).
const store = createSession(backend, createBrowserEnv(() => phonePush.forgetThisPhone()));
const sinks = createTelemetrySinks(backend, () => {
  const session = store.getSnapshot();
  return session.status === 'ready' ? session.locationId : null;
});

// ⚠️ THE TELEMETRY STARTS BEFORE THE SESSION (main.spec.ts pins the order). Its error
// listeners must be on before anything else runs, or an error during boot is lost: the reporter
// keeps it in memory and sends it once a venue is open.
startTelemetry({ store, sinks });

// This phone's alert registration, kept younger than the nightly clean-up's 60 days (orders/pushTokenRefresh.ts): at most
// one small write a week, a few seconds after a venue opens, never offline, never visible.
startPushTokenRefresh(store, browserRefreshDeps(tokenWriter(backend.firestore)));

// This phone's registration for server push, made on a tap in Orders → Settings (push/phonePush.ts): the token comes from the
// backend's Cloud Messaging (a made-up one on a local address), the row goes through the backend's Firestore.
const phonePush = createPhonePush({
  env: browserPushEnv(),
  vapidKey: vapidKeyForHost(location.hostname),
  storage: browserStorage(),
  session: () => store.getSnapshot(),
  online: () => navigator.onLine !== false,
  now: () => Date.now(),
  getToken: backend.pushToken,
  // A row refused as somebody else's (a phone that changed hands): drop the token and register a new one (audit A2-1).
  dropToken: backend.dropPushToken,
  // ⚠️ NOT ON A LOCAL ADDRESS: its token is made up and has no browser subscription, so the check would take it back at once.
  hasSubscription: backend.isEmulator ? undefined : browserHasSubscription,
  ...rowWriter(backend.firestore),
});

// The push a guided-mix timer books so the phone rings with the app closed (push/timerPush.ts): only for a phone registered above.
const timerPush = createTimerPush({
  phonePush,
  storage: browserStorage(),
  session: () => store.getSnapshot(),
  online: () => navigator.onLine !== false,
  now: () => Date.now(),
  firestore: backend.firestore,
});

// Every section's data, on the same backend: Firestore is loaded by the first section that reads.
const services = createDataServices(backend.firestore, backend, () => store.getSnapshot().role);

// Nobody signed in: the sign-in form needs no Firestore (firebaseBackend.ts loads it lazily), so
// it is fetched while the password is being typed. Signed in, the session's first read loads it.
store.subscribe(() => {
  if (store.getSnapshot().status === 'signed-out') backend.preloadFirestore();
});

// A join link opened in a tab already running the app puts back the screen the app was on, with the router's own history
// state for it (its key and index), read after every move the router makes (joinLinkBoot.ts).
let routerHistoryState: unknown = window.history.state;
router.subscribe(() => { routerHistoryState = window.history.state; });
setJoinLinkReturn(() => ({
  fragment: `#${router.state.location.pathname}${router.state.location.search}`,
  state: routerHistoryState,
}));

// The session starts listening NOW, in parallel with the language loading below: by the time
// the first screen is drawn the session has often already answered who is signed in.
store.start();

// The screens above a venue follow the phone's language (his decision, 1 Oct 2026); the
// venue's own language takes over once one is opened (SessionGate). The messages are loaded
// BEFORE the first render, so an Italian phone never flashes English.
const wanted = pickLanguage(navigator.language);

// ⚠️ SAID AT ONCE, NOT AFTER THE MESSAGES LOAD. Chrome decides whether to offer a translation from <html lang> early,
// and index.html says "en": on the lab tablet (13 Oct 2026) an Italian screen was offered «translate from English».
// I18nProvider keeps it up to date from here on (the venue's language, a change of language).
document.documentElement.lang = wanted;

// Where the browser has no dvh (the lab tablet's Chrome 101), the stylesheets read the visible height from here.
installViewportHeight();

// The service worker (step 5): same address and name as the current app's, so installed phones update to Mise 2
// and, after a revert, back. Built app only — `npm run dev` and the specs register nothing. After the page has
// loaded, so its own files come first; a new release is let in only when nobody is editing (shell/serviceWorker.ts).
if (import.meta.env.PROD) {
  window.addEventListener('load', () => { void watchServiceWorker(browserServiceWorkerEnv(import.meta.env.BASE_URL)); });
}

void loadLanguage(wanted).then(({ lang, messages }) => {
  createRoot(container).render(
    <StrictMode>
      <AppBoundary>
        <I18nProvider initialLanguage={lang} initialMessages={messages}>
          <SessionProvider store={store}>
            <JoinFlowProvider flow={joinFlow}>
              <DataProvider services={services}>
                <PhonePushProvider phonePush={phonePush} timerPush={timerPush}>
                  <SessionGate>
                    <RouterProvider router={router} onError={onRouteError} />
                  </SessionGate>
                </PhonePushProvider>
                {/* Kiosk mode (staff slice 5): beside the gate, so it sees every state of the session; nothing with the setting off.
                    Its own boundary: a failure there must not take the whole app down. */}
                <PartBoundary>
                  <Kiosk />
                </PartBoundary>
              </DataProvider>
            </JoinFlowProvider>
          </SessionProvider>
        </I18nProvider>
      </AppBoundary>
    </StrictMode>,
  );
});
