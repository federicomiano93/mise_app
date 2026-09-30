// firebase-target.js — which Firebase project a page talks to, decided by its hostname.
// PURE (no imports, no DOM): tests/firebase-target.test.mjs asserts every rule below.
//
// Two projects, both PUBLIC config (P1 — committed on purpose, like js/firebase.js):
//   production  bakery-app-ebf90   the real venues, served from GitHub Pages
//   preview     mise-app-preview   FAKE data only, served from Firebase Hosting preview
//                                  channels — one link per pull request, so Federico can try
//                                  a change on his phone BEFORE it goes live
//                                  (.github/workflows/preview.yml, scripts/seed-preview.mjs)
//
// ⚠️⚠️ PRODUCTION IS AN ALLOWLIST, AND EVERYTHING ELSE IS THE PREVIEW. Production's config goes
// only to the live site and to localhost (which js/firebase.js then diverts to the emulator,
// with production's project id, exactly as before). Any other host — a preview channel on
// web.app OR on firebaseapp.com, a trailing-dot spelling, a LAN address, a tunnel, a copy of
// the app served anywhere — gets the preview project. The first version did the opposite
// (preview only on recognised hosts) and a review found two preview addresses that fell
// through to production: when this file is wrong, it must be wrong towards an EMPTY TEST APP,
// never towards somebody writing real orders.
//
// The cost of that direction, taken knowingly: if the live site ever moves to another address,
// every phone would open the empty preview until this list names the new one — loud, and
// harmless to the data.

export const PRODUCTION_CONFIG = Object.freeze({
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
export const PREVIEW_CONFIG = Object.freeze({
  apiKey: "AIzaSyB3d5Q4Gp2F6VXVGBXxtNZ6JRI3QyuXUEc",
  authDomain: "mise-app-preview.firebaseapp.com",
  projectId: PREVIEW_PROJECT_ID,
  storageBucket: "mise-app-preview.firebasestorage.app",
  messagingSenderId: "863348756512",
  appId: "1:863348756512:web:b1fb6fb82fa1448abf6c45",
});

// The live site, and the addresses the local emulator switch in js/firebase.js recognises.
export const LIVE_HOST = 'federicomiano93.github.io';
export const LOCAL_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1', '[::1]']);
export const PRODUCTION_HOSTS = Object.freeze([LIVE_HOST, ...LOCAL_HOSTS]);

// ⚠️ THE TRAILING DOT IS FORGIVEN FOR THE LIVE SITE ONLY. "federicomiano93.github.io." is the
// same site and GitHub serves it. But the local names must match EXACTLY what the emulator
// switch in js/firebase.js compares: "localhost." would get production's config there without
// being diverted to the emulator — real writes from a page that looks local.
export function isPreviewHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return !(host === LIVE_HOST || host === `${LIVE_HOST}.` || LOCAL_HOSTS.includes(host));
}

export function configForHost(hostname) {
  return isPreviewHost(hostname) ? PREVIEW_CONFIG : PRODUCTION_CONFIG;
}
