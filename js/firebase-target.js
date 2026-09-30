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
// ⚠️ PRODUCTION IS THE DEFAULT. The live site, localhost (which js/firebase.js then diverts to
// the emulator by hostname, as before) and any host this file does not recognise all get the
// production config — exactly what every page got before this file existed.
//
// ⚠️⚠️ THE DIRECTION THAT MATTERS IS THE OTHER ONE: a preview page must NEVER get the
// production config, or somebody trying a pull request would be saving real orders. So the
// preview hosts are recognised by their fixed shapes and nothing looser:
//   mise-app-preview.web.app · mise-app-preview.firebaseapp.com · mise-app-preview--<channel>.web.app

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

const PREVIEW_CHANNEL_HOST = new RegExp(`^${PREVIEW_PROJECT_ID}--[a-z0-9-]{1,63}\\.web\\.app$`);

export function isPreviewHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === `${PREVIEW_PROJECT_ID}.web.app`
    || host === `${PREVIEW_PROJECT_ID}.firebaseapp.com`
    || PREVIEW_CHANNEL_HOST.test(host);
}

export function configForHost(hostname) {
  return isPreviewHost(hostname) ? PREVIEW_CONFIG : PRODUCTION_CONFIG;
}
