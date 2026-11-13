// backend.ts — everything the session needs from Firebase and from the browser, as two small
// interfaces.
//
// WHY AN INTERFACE. The session decides who may see which venue's data on a shared phone, and
// every one of those decisions has a trap the current app paid for (a cached "missing" read as
// "no access", another person's offline copy, a reload that never stops). Behind an interface
// each trap is a spec with a fake backend (session.spec.ts) instead of a manual test on a phone.
// The real implementations are firebaseBackend.ts and browserEnv.ts.

import type { Language } from '../i18n/i18n';

export interface SessionUser {
  readonly uid: string;
  readonly email: string | null;
  // A leftover anonymous session from before 2026's sign-in: never a person (see session.ts).
  readonly isAnonymous: boolean;
}

export type DocData = Record<string, unknown>;

export type WipeResult = 'cleared' | 'busy' | 'unavailable';

export interface DocRead {
  // null when the document does not exist.
  readonly data: DocData | null;
  // true when the answer came from this phone's offline copy, not from the server.
  readonly cached: boolean;
}

export interface SessionBackend {
  // Calls back with the signed-in account (null = nobody), first with the answer the page opened
  // with. Returns the unsubscribe function.
  onAuthChange(callback: (user: SessionUser | null) => void): () => void;
  // This phone's copy when it has one, else the server. A cached "does not exist" is returned as
  // an answer only with `trustMissing`; otherwise the server is asked.
  readPreferCache(path: string, options?: { trustMissing?: boolean }): Promise<DocRead>;
  // The server's answer, never the cache. Rejects offline.
  readFromServer(path: string): Promise<DocData | null>;
  signIn(email: string, password: string): Promise<void>;
  // Creates an account with this email and password AND SIGNS IT IN on this page, replacing nobody (it is reached only signed
  // out), and resolves with it. Staff slice 2: the join form for a new account. Rejects with Firebase's `auth/…` error.
  // ⚠️ IT GRANTS NOTHING: a brand-new account has no users/{uid}, so every rule refuses it until redeemJoinCode writes the
  // membership on the server.
  signUp(email: string, password: string): Promise<SessionUser>;
  sendReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  // Stops Firestore and deletes its offline database. Never rejects:
  //   'cleared'     — done;
  //   'busy'        — another open tab of the app holds the database (tried again next opening);
  //   'unavailable' — Firestore itself could not be loaded (no signal on the first download):
  //                   nothing could be wiped, and nothing can be READ either until a reload.
  wipeOfflineCache(): Promise<WipeResult>;
  // Is something typed on this phone still waiting to reach the server? true after `ms` with
  // nothing confirmed (usually: no signal).
  changesStillWaiting(ms?: number): Promise<boolean>;
  // Calls a Cloud Function (an «https callable», region us-central1) and resolves with what it returned; rejects with the
  // SDK's error (its `code`, `message` and `details`) when it fails or `timeoutMs` passes. The Functions SDK is loaded on
  // first use. In the session's interface since staff slice 1: joining with a code changes WHICH VENUES this account has,
  // and that is the session's business (session.ts redeemJoinCode).
  callFunction(name: string, data: unknown, timeoutMs: number): Promise<unknown>;
}

// The two Storage methods the session uses, so a spec can pass a Map-backed fake.
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionEnv {
  // localStorage: shared with the current app on purpose (same keys, same meaning).
  readonly local: KeyValueStorage;
  // sessionStorage: "once per opening of the app".
  readonly session: KeyValueStorage;
  // Every key in `local`, for clearLocalData.
  localKeys(): string[];
  reload(): void;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  // Is somebody in the middle of typing? A reload then would throw their work away.
  isBusy(): boolean;
  // Loads a language's messages so the first screen inside a venue is drawn in its language.
  preloadLanguage(lang: Language): Promise<unknown>;
  // Resolves once the screens have had the time to redraw after the session changed. Used before Firestore is stopped on a
  // change of venue: the app is taken off the screen first, so every listener of every section unsubscribes BEFORE the
  // client is terminated (session.ts `leaving`).
  letScreensClose(): Promise<void>;
  warn(message: string, detail?: unknown): void;
}
