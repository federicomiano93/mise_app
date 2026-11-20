import { describe, expect, test } from 'vitest';

// main.tsx draws the app the moment it is imported, so it cannot be run from a spec. What it must
// get right is the ORDER things start in, and that is a few lines of text — read as text, the way
// css-modules.spec.ts reads the stylesheets.
const sources = import.meta.glob<string>('./main.tsx', { query: '?raw', import: 'default', eager: true });
const main = sources['./main.tsx'] ?? '';

describe('main.tsx', () => {
  test('the scan finds the file', () => {
    expect(main).toContain('createRoot(');
  });

  // ⚠️⚠️ A JOIN LINK'S TOKEN IS A KEY TO A VENUE. ES modules run in import order: imported first, joinLinkBoot takes the
  // token out of the address bar and the history entry before the router (created as router.ts is imported) or the
  // telemetry can read it (docs/parity/staff-plan.md, «Security»).
  test('reads the join link before anything else is imported', () => {
    const imports = [...main.matchAll(/^import\s.*?from\s+'([^']+)'|^import\s+'([^']+)'/gm)].map(m => m[1] ?? m[2]);
    expect(imports[0]).toBe('./session/joinLinkBoot');
  });

  test('hands the page’s join flow to the screens, inside the session', () => {
    expect(main).toMatch(/<JoinFlowProvider flow=\{joinFlow\}>/);
    expect(main.indexOf('<SessionProvider')).toBeLessThan(main.indexOf('<JoinFlowProvider'));
    expect(main.indexOf('<JoinFlowProvider')).toBeLessThan(main.indexOf('<SessionGate>'));
  });

  // ⚠️ AN ERROR DURING BOOT IS CAUGHT ONLY IF THE LISTENERS ARE ALREADY ON. Started after the
  // session, an error in the sign-in or the first read would be lost.
  test('starts the telemetry before the session', () => {
    const telemetry = main.indexOf('startTelemetry(');
    const session = main.indexOf('store.start()');
    expect(telemetry).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(telemetry);
  });

  // ⚠️ Chrome decides early whether to offer a translation, from <html lang>; index.html says "en". Set only after the
  // messages had loaded, an Italian screen on the lab tablet was offered «translate from English» (13 Oct 2026).
  test('says the page language before the messages load', () => {
    const said = main.indexOf('document.documentElement.lang = wanted;');
    const loaded = main.indexOf('loadLanguage(wanted)');
    expect(said).toBeGreaterThan(-1);
    expect(loaded).toBeGreaterThan(said);
  });

  // Where the browser has no dvh (the lab tablet), every screen reads the visible height from --vh100.
  test('installs the visible-height fallback before the first render', () => {
    const installed = main.indexOf('installViewportHeight()');
    expect(installed).toBeGreaterThan(-1);
    expect(main.indexOf('createRoot(container)')).toBeGreaterThan(installed);
  });

  // The nightly clean-up deletes a push token silent for 60 days (functions/retention.js); this keeps a phone in use younger.
  test('keeps this phone\'s push registration fresh, through the one backend\'s Firestore', () => {
    expect(main).toContain('startPushTokenRefresh(store, browserRefreshDeps(tokenWriter(backend.firestore)));');
  });

  // The Settings button registers this phone for server push on the same backend: its token and its Firestore, and the screens
  // get it through the provider (a missing provider throws, orders/PhonePushContext.tsx).
  test('registers phones for push through the one backend, and gives the screens that registration', () => {
    expect(main).toMatch(/getToken: backend\.pushToken,/);
    expect(main).toContain('...rowWriter(backend.firestore),');
    expect(main).toMatch(/vapidKey: vapidKeyForHost\(location\.hostname\)/);
    expect(main).toMatch(/<PhonePushProvider phonePush=\{phonePush\}>/);
  });

  // A second backend would be a second Firebase connection and a second offline cache.
  test('creates one backend and gives it to both the session and the telemetry writes', () => {
    expect(main.match(/createFirebaseBackend\(/g)).toHaveLength(1);
    expect(main).toContain('createSession(backend,');
    expect(main).toContain('createTelemetrySinks(backend,');
  });

  // They would replace React's own console logging, which is how a caught render error reaches
  // the error report (see startTelemetry.ts).
  test('does not take over how React logs its errors', () => {
    expect(main).not.toMatch(/onCaughtError|onUncaughtError|onRecoverableError/);
  });

  // Without it React Router writes a second line for every render error of the shell's frame, and
  // the error report counts it as a second error (errors/routeErrors.ts).
  test('gives the router the handler that stops it logging render errors a second time', () => {
    expect(main).toMatch(/<RouterProvider router=\{router\} onError=\{onRouteError\} \/>/);
  });

  test('the venue the telemetry writes under is the open one, and none before that', () => {
    expect(main).toMatch(/status === 'ready' \? session\.locationId : null/);
  });
});
