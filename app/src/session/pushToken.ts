// pushToken.ts — how a phone gets its push token, on the one backend (firebaseBackend.ts `pushToken`).
//
// ⚠️⚠️ ON A LOCAL ADDRESS getToken() IS NEVER CALLED. The emulator runs with PRODUCTION's project id, so a real getToken()
// there would register a real installation with the production Firebase project from a test page. An emulator-only token
// is made up instead («emulator-push-» and 16 random hex digits, no «/»), so the whole flow — the tap, the row written
// under fcm-tokens, the switch becoming usable — can be driven end to end against the Firestore emulator. No server will
// ever push to it: nothing delivers to a token Firebase never issued.
//
// ⚠️ NO SECOND SERVICE WORKER. Firebase's usual setup registers its own worker at the SITE ROOT, and the app is not at the
// root (it lives under /mise_app/ on GitHub Pages). getToken() is handed the app's existing registration, whose worker
// (app/sw/worker.js) already handles `push` and `notificationclick`.

export interface MessagingToken {
  getToken(options: { vapidKey: string; serviceWorkerRegistration: ServiceWorkerRegistration }): Promise<string>;
  // Firebase's deleteToken(): unsubscribes this browser, so the next getToken() makes a NEW token.
  deleteToken(): Promise<boolean>;
}

export interface PushTokenDeps {
  readonly isEmulator: boolean;
  readonly vapidKey: string;
  // Loads firebase/messaging (the backend's one dynamic import) and binds it to the app.
  readonly load: () => Promise<MessagingToken>;
  readonly serviceWorkerReady: () => Promise<ServiceWorkerRegistration>;
  readonly randomBytes?: (length: number) => Uint8Array;
}

const EMULATOR_TOKEN_PREFIX = 'emulator-push-';

function browserRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

// Emulator-only: see the header.
export function emulatorPushToken(randomBytes: (length: number) => Uint8Array = browserRandomBytes): string {
  const hex = Array.from(randomBytes(8), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${EMULATOR_TOKEN_PREFIX}${hex}`;
}

export function createPushToken(deps: PushTokenDeps): () => Promise<string> {
  return async () => {
    if (deps.isEmulator) return emulatorPushToken(deps.randomBytes);
    const [messaging, registration] = await Promise.all([deps.load(), deps.serviceWorkerReady()]);
    return messaging.getToken({ vapidKey: deps.vapidKey, serviceWorkerRegistration: registration });
  };
}

// ⚠️ THROWING THE TOKEN AWAY (security audit A2-1). The rules refuse to re-register a row stored under somebody else's uid,
// so a phone that changed hands while a row was left behind (an offline sign-out, the old app, a session that expired)
// would be locked out of notifications for good. Instead the phone drops its token and asks for a new one: a new token is
// a new document, which the next person may create, and the old one dies — the server deletes its row on the next send.
// On a local address there is nothing to drop: every emulator token is made up afresh (see the header).
export function createDropPushToken(deps: Pick<PushTokenDeps, 'isEmulator' | 'load'>): () => Promise<void> {
  return async () => {
    if (deps.isEmulator) return;
    const messaging = await deps.load();
    await messaging.deleteToken();
  };
}
