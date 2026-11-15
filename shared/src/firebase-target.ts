// firebase-target.ts — which Firebase project a page talks to, decided by its hostname.
//
// TypeScript port of js/firebase-target.js for Mise 2. Behaviour is identical, input for input:
// firebase-target.spec.ts runs every test against BOTH files and parity.spec.ts compares their
// exports — so the two apps, which share one origin, can never disagree about where data goes.
//
// Two projects, both PUBLIC config (P1 — committed on purpose, like js/firebase.js):
//   production  bakery-app-ebf90   the real venues, served from GitHub Pages
//   preview     mise-app-preview   FAKE data only, served from Firebase Hosting preview channels
//
// ⚠️⚠️ PRODUCTION IS AN ALLOWLIST, AND EVERYTHING ELSE IS THE PREVIEW. Production's config goes
// only to the live site and to localhost (which the app then diverts to the emulator, with
// production's project id). Any other host — a preview channel, a trailing-dot spelling, a LAN
// address, a tunnel, a copy of the app served anywhere — gets the preview project. When this
// file is wrong, it must be wrong towards an EMPTY TEST APP, never towards real orders.

export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
}

export const PRODUCTION_CONFIG: FirebaseWebConfig = Object.freeze({
  apiKey: "AIzaSyCIy5dRbE9Ce_mJQ4-r7QuSOquKpgkwoMo",
  authDomain: "bakery-app-ebf90.firebaseapp.com",
  projectId: "bakery-app-ebf90",
  storageBucket: "bakery-app-ebf90.firebasestorage.app",
  messagingSenderId: "27778450817",
  appId: "1:27778450817:web:74e1bab55d10c3f9279480",
});

export const PREVIEW_PROJECT_ID = 'mise-app-preview';

// Its API key is restricted to *.web.app and the project's own firebaseapp.com, and to the
// sign-in and Firestore APIs only (P4). It reaches nothing but the preview project's fake data.
export const PREVIEW_CONFIG: FirebaseWebConfig = Object.freeze({
  apiKey: "AIzaSyB3d5Q4Gp2F6VXVGBXxtNZ6JRI3QyuXUEc",
  authDomain: "mise-app-preview.firebaseapp.com",
  projectId: PREVIEW_PROJECT_ID,
  storageBucket: "mise-app-preview.firebasestorage.app",
  messagingSenderId: "863348756512",
  appId: "1:863348756512:web:b1fb6fb82fa1448abf6c45",
});

// The live site, and the addresses the local emulator switch recognises.
export const LIVE_HOST = 'federicomiano93.github.io';
export const LOCAL_HOSTS: readonly string[] = Object.freeze(['localhost', '127.0.0.1', '::1', '[::1]']);
export const PRODUCTION_HOSTS: readonly string[] = Object.freeze([LIVE_HOST, ...LOCAL_HOSTS]);

// ⚠️ THE TRAILING DOT IS FORGIVEN FOR THE LIVE SITE ONLY. The local names must match EXACTLY what
// the emulator switch compares: "localhost." would get production's config without being
// diverted to the emulator — real writes from a page that looks local.
export function isPreviewHost(hostname: unknown): boolean {
  const host = String(hostname || '').toLowerCase();
  return !(host === LIVE_HOST || host === `${LIVE_HOST}.` || LOCAL_HOSTS.includes(host));
}

export function configForHost(hostname: unknown): FirebaseWebConfig {
  return isPreviewHost(hostname) ? PREVIEW_CONFIG : PRODUCTION_CONFIG;
}
