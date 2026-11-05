// firebaseBackend.ts — the session's backend, on the real Firebase SDK.
//
// ⚠️ THE SAME FIREBASE AS THE CURRENT APP, ON THE SAME DATABASE. Mise 2 is served from the current
// app's address, so the default Firebase app here opens the SAME IndexedDB: Auth's record of who
// is signed in (one sign-in serves both apps) and Firestore's offline cache. That only holds
// while three things match js/firebase.js exactly, and each one is pinned:
//   • the SDK version (npm `firebase` = the gstatic version; tests/mise2-ci.test.mjs),
//   • the Auth persistence list and its ORDER (below) — another list reads another place and
//     signs every phone out,
//   • the Firestore cache settings (persistent, shared between tabs).
//
// ⚠️ WHICH PROJECT is decided by the hostname, by the same allowlist as the current app
// (@mise/shared/firebase-target): production only on the live site and localhost, the preview
// project (fake data) everywhere else — and on localhost every call is diverted to the local
// emulator, so development can never touch production.
//
// ⚠️ NO APP CHECK, NO reCAPTCHA (his decision, PR #212): no client sends a token, so never switch
// either on in the console. initializeAuth, not getAuth: getAuth() also installs the Google
// pop-up machinery, which phones would load on every screen for a sign-in method nobody uses.
//
// ⚠️ FIRESTORE IS LOADED ONLY WHEN IT IS NEEDED (step 2c, measured). It is over half of the
// app's code (its file is 554 KB of about 1.1 MB), and the sign-in form needs none of it: on the lab-tablet profile
// running it delayed every opening by the better part of a second. So `firestore()` imports it on
// the first call — the first read of a signed-in session, or `preloadFirestore()` once the sign-in
// form is on screen — and starts it exactly once, emulator included. Every part of the app gets
// Firestore from here and NEVER from getFirestore(): its settings are fixed by its first use, and
// a getFirestore() that ran first would make THE one client memory-only (the offline copy shared
// with the current app gone) — src/firestore-access.spec.ts refuses one anywhere else.

import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, connectAuthEmulator,
  createUserWithEmailAndPassword, type Auth,
} from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { configForHost, LOCAL_HOSTS } from '@mise/shared/firebase-target';
import type { DocData, SessionBackend, WipeResult } from './backend';

// The Firestore SDK's functions, from the lazily loaded module, and the one client.
export type FirestoreSdk = typeof import('firebase/firestore');
export interface FirestoreKit {
  readonly fs: FirestoreSdk;
  readonly db: Firestore;
}

export interface FirebaseBackend extends SessionBackend {
  // Firestore, loaded and started on the first call (see the header). The data layers of the
  // sections (step 3) and the telemetry writes get it from here, and only from here.
  firestore(): Promise<FirestoreKit>;
  // The same, but only if it is already loaded — so a write handed over as the page is being
  // hidden is not a microtask late. null before the first load has finished.
  firestoreIfReady(): FirestoreKit | null;
  // Starts loading Firestore when the browser is idle; called once the sign-in form is drawn, so
  // it is ready by the time the password is typed. Calling it again does nothing.
  preloadFirestore(): void;
  // Auth, for the writes that must carry the signed-in account's uid (telemetry/sinks.ts).
  readonly auth: Auth;
  readonly isEmulator: boolean;
  // Creates the account behind a client's ordering link and resolves with its uid, WITHOUT touching the
  // signed-in person's own session (see the function). Rejects when Auth refuses or cannot be reached.
  createLinkAccount(email: string, password: string): Promise<string>;
}

function startFirestore(fs: FirestoreSdk, app: FirebaseApp): Firestore {
  const { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } = fs;
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    // No IndexedDB (private Safari, a locked-down webview) is not a reason to have no app.
    console.warn('Firestore offline cache unavailable — running from memory only:', err);
    return getFirestore(app);
  }
}

export function createFirebaseBackend(hostname: string): FirebaseBackend {
  const app = initializeApp(configForHost(hostname));
  // ⚠️ getAuth()'s own persistence list, in the same order (see the header).
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  });

  const isEmulator = LOCAL_HOSTS.includes(hostname);
  if (isEmulator) {
    // Before any sign-in: Auth settles on first use. (Firestore is pointed at the emulator the
    // moment it is started, below, before its first read.)
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    console.info('%c[Firebase] LOCAL EMULATOR mode — production data is NOT touched.', 'color:#0a0;font-weight:bold');
  }

  let loading: Promise<FirestoreKit> | null = null;
  let ready: FirestoreKit | null = null;
  function firestore(): Promise<FirestoreKit> {
    if (!loading) {
      loading = import('firebase/firestore').then(fs => {
        const db = startFirestore(fs, app);
        if (isEmulator) fs.connectFirestoreEmulator(db, 'localhost', 8080);
        ready = { fs, db };
        return ready;
      });
      // ⚠️ A FAILED DOWNLOAD IS NOT RETRIED BY CALLING AGAIN: the browser remembers a failed
      // dynamic import for the life of the page (proved in Edge, code review 11 Oct 2026). The
      // promise is still dropped so a later call does not hand out a stale rejection object, but
      // the real retry is a reload — which the session's error screen offers.
      loading.catch(() => { loading = null; });
    }
    return loading;
  }

  let preloadAsked = false;
  function preloadFirestore(): void {
    if (preloadAsked) return;
    preloadAsked = true;
    const start = () => { firestore().catch(() => { /* the first real read will try again */ }); };
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(start, { timeout: 2000 });
    else setTimeout(start, 300);
  }

  const dataOf = (snap: { exists(): boolean; data(): unknown }): DocData | null =>
    snap.exists() ? (snap.data() as DocData) : null;

  // ⚠️ THE ACCOUNT IS CREATED ON A SECOND FIREBASE APP, and this is not tidiness (js/client-orders-data.js
  // `createOrderingLink`): creating a user signs you in as that user on the app it was created with, so on the
  // default app it would replace the OWNER'S OWN SESSION with the client's — the person minting the link would
  // find themselves signed in as their customer. The second app is signed out at once and thrown away.
  // ⚠️ ITS SESSION LIVES IN MEMORY ONLY (a difference from the current app, which gives it getAuth()'s default,
  // IndexedDB): the IndexedDB is the one both apps share for who is signed in, and a client's credential has no
  // business being written there even for a moment.
  // ⚠️ THE EMULATOR SWITCH IS REPEATED FOR IT: the one above attaches to the default app only, and without it a
  // link made on localhost would create a REAL account in production (found by driving the current app).
  async function createLinkAccount(email: string, password: string): Promise<string> {
    const secondary = initializeApp(configForHost(hostname), `client-link-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const linkAuth = initializeAuth(secondary, { persistence: inMemoryPersistence });
      if (isEmulator) connectAuthEmulator(linkAuth, 'http://localhost:9099', { disableWarnings: true });
      const credential = await createUserWithEmailAndPassword(linkAuth, email, password);
      await signOut(linkAuth);
      return credential.user.uid;
    } finally {
      // Whatever happened, this app must not outlive the call: a leftover instance keeps an Auth observer alive
      // on an account that is not the person's.
      await deleteApp(secondary).catch(() => {});
    }
  }

  return {
    firestore,
    firestoreIfReady: () => ready,
    createLinkAccount,
    preloadFirestore,
    auth,
    isEmulator,
    onAuthChange: callback => onAuthStateChanged(auth, user => {
      callback(user ? { uid: user.uid, email: user.email, isAnonymous: user.isAnonymous } : null);
    }),
    async readPreferCache(path, { trustMissing = false } = {}) {
      const { fs, db } = await firestore();
      const ref = fs.doc(db, path);
      try {
        const snap = await fs.getDocFromCache(ref);
        if (snap.exists() || trustMissing) return { data: dataOf(snap), cached: true };
      } catch { /* not on this phone yet */ }
      return { data: dataOf(await fs.getDoc(ref)), cached: false };
    },
    async readFromServer(path) {
      const { fs, db } = await firestore();
      return dataOf(await fs.getDocFromServer(fs.doc(db, path)));
    },
    signIn: async (email, password) => { await signInWithEmailAndPassword(auth, email, password); },
    sendReset: email => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    // ⚠️ terminate() stops every listener, which is why every caller reloads straight after.
    // ⚠️ It starts Firestore if this page never did: the offline database may still hold a
    // previous session's data (or the current app's, on this same origin).
    async wipeOfflineCache(): Promise<WipeResult> {
      let kit: FirestoreKit;
      try {
        kit = await firestore();
      } catch (err) {
        console.warn('Could not load Firestore to clear the offline copy of the data:', err);
        return 'unavailable';
      }
      try {
        await kit.fs.terminate(kit.db);
        await kit.fs.clearIndexedDbPersistence(kit.db);
        return 'cleared';
      } catch (err) {
        console.warn('Could not clear the offline copy of the data (another tab holds it?):', err);
        return 'busy';
      }
    },
    async changesStillWaiting(ms = 4000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // The time limit covers loading Firestore too, not only the answer.
        const sent = await Promise.race([
          firestore().then(({ fs, db }) => fs.waitForPendingWrites(db)).then(() => true),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ms); }),
        ]);
        return !sent;
      } catch {
        // A client that cannot answer has nothing it could still send.
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
