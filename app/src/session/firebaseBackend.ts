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

import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, connectAuthEmulator, type Auth,
} from 'firebase/auth';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator, doc, getDoc, getDocFromCache, getDocFromServer, terminate,
  clearIndexedDbPersistence, waitForPendingWrites, type Firestore,
} from 'firebase/firestore';
import { configForHost, LOCAL_HOSTS } from '@mise/shared/firebase-target';
import type { DocData, SessionBackend } from './backend';

export interface FirebaseBackend extends SessionBackend {
  // Firestore, for the data layers of the sections (step 3). Started here, first, because its
  // settings are fixed by its first use.
  readonly db: Firestore;
  // Auth, for the writes that must carry the signed-in account's uid (telemetry/sinks.ts).
  readonly auth: Auth;
  readonly isEmulator: boolean;
}

function startFirestore(app: ReturnType<typeof initializeApp>): Firestore {
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
  const db = startFirestore(app);

  const isEmulator = LOCAL_HOSTS.includes(hostname);
  if (isEmulator) {
    // Before any sign-in and any read: both settle on first use.
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    console.info('%c[Firebase] LOCAL EMULATOR mode — production data is NOT touched.', 'color:#0a0;font-weight:bold');
  }

  const dataOf = (snap: { exists(): boolean; data(): unknown }): DocData | null =>
    snap.exists() ? (snap.data() as DocData) : null;

  return {
    db,
    auth,
    isEmulator,
    onAuthChange: callback => onAuthStateChanged(auth, user => {
      callback(user ? { uid: user.uid, email: user.email, isAnonymous: user.isAnonymous } : null);
    }),
    async readPreferCache(path, { trustMissing = false } = {}) {
      const ref = doc(db, path);
      try {
        const snap = await getDocFromCache(ref);
        if (snap.exists() || trustMissing) return { data: dataOf(snap), cached: true };
      } catch { /* not on this phone yet */ }
      return { data: dataOf(await getDoc(ref)), cached: false };
    },
    readFromServer: async path => dataOf(await getDocFromServer(doc(db, path))),
    signIn: async (email, password) => { await signInWithEmailAndPassword(auth, email, password); },
    sendReset: email => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    // ⚠️ terminate() stops every listener, which is why every caller reloads straight after.
    async wipeOfflineCache() {
      try {
        await terminate(db);
        await clearIndexedDbPersistence(db);
        return true;
      } catch (err) {
        console.warn('Could not clear the offline copy of the data:', err);
        return false;
      }
    },
    async changesStillWaiting(ms = 4000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const sent = await Promise.race([
          waitForPendingWrites(db).then(() => true),
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
