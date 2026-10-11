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

  // ⚠️ AN ERROR DURING BOOT IS CAUGHT ONLY IF THE LISTENERS ARE ALREADY ON. Started after the
  // session, an error in the sign-in or the first read would be lost.
  test('starts the telemetry before the session', () => {
    const telemetry = main.indexOf('startTelemetry(');
    const session = main.indexOf('store.start()');
    expect(telemetry).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(telemetry);
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

  test('the venue the telemetry writes under is the open one, and none before that', () => {
    expect(main).toMatch(/status === 'ready' \? session\.locationId : null/);
  });
});
