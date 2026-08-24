// firebase-photo.js — the one call that reads a photographed PACKET.
//
// ⚠️ THE SWITCH THAT TURNS IT ON IS NOT HERE, it is in ./firebase-features.js beside
// the other two this page owns. One door for «which optional features does this venue
// use», so the page-local override that makes a thrown switch stick is written once.
//
// ⚠️ A COPY OF js/catalogue/firebase-photo.js, written out rather than imported: the
// project rule is that a feature folder never reaches into another's. Every comment
// below is the same warning, and each of them was paid for once already.
//
// It is a Cloud Function and not a direct API call for one reason: the key that pays
// for the read is a REAL secret. Anything the browser holds is readable by anybody
// holding the phone, so a key in the app would be a key on the internet.
// See functions/pack-photo.js.

import { sessionReady, isLocalEmulator } from '../firebase.js';
import { currentLocationId } from '../location.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFunctions, httpsCallable, connectFunctionsEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { firebaseConfig } from '../firebase.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ⚠️ THE REGION HAS TO MATCH THE ONE THE FUNCTION DECLARES. Left to its default the
// client calls us-central1 anyway, but saying it here means a later move fails loudly
// in one place rather than as a silent CORS error on every call.
const functions = getFunctions(app, 'us-central1');

// ⚠️ js/firebase.js points Firestore and Auth at the emulator on localhost, but nothing
// points FUNCTIONS anywhere — so without this line, testing on localhost would call the
// REAL deployed function and spend REAL money, on a page whose console says
// "LOCAL EMULATOR mode".
if (isLocalEmulator) connectFunctionsEmulator(functions, '127.0.0.1', 5001);

// ⚠️⚠️ THE TIMEOUT IS SET EXPLICITLY, AND IT MUST STAY >= THE FUNCTION'S OWN.
// httpsCallable defaults to 70 seconds; functions/pack-photo.js declares 120 through
// the shared PHOTO_CALL. Left at the default, the phone gives up on a call that is
// still running and has ALREADY BEEN PAID FOR — the person sees a failure, the money is
// gone, and the daily allowance has been spent. tests/photo-timeouts.test.mjs pins the
// relationship between the two numbers.
const CLIENT_TIMEOUT_MS = 120000;

const readPackFromPhotosCall = httpsCallable(functions, 'readPackIngredientsFromPhotos', {
  timeout: CLIENT_TIMEOUT_MS,
});

// Ask the server to read these photographs of a packet.
//
// Resolves with the server's own answer, which is one of:
//   { ok: true,  text, notes, remaining }
//   { ok: false, reason }        ← the call worked; there was no list to find
// and REJECTS only when the call itself failed. Those two are different things and the
// screen says different sentences for them.
//
// ⚠️ sessionReady, NOT signedInReady: this call carries a locationId, so it needs a
// location to be OPEN and not merely an account to be signed in. Sent too early it
// would answer 'unauthenticated', which reads exactly like being logged out.
//
// ⚠️⚠️ AND THE LOCATION IS READ HERE, AFTER THAT WAIT — NEVER PASSED IN FROM THE SCREEN.
// currentLocationId() returns null before a location is open, so a screen that resolves
// it once while rendering can freeze a null and have every read afterwards come back
// "which location?" for the life of that screen. It was a RACE in the Catalogue's copy:
// the same code read perfectly on one run and refused on the next, with nothing on
// screen distinguishing them. Reading it at call time cannot race.
export async function readPackFromPhotos(images) {
  await sessionReady;
  const locationId = currentLocationId();
  const res = await readPackFromPhotosCall({ locationId, images });
  return res.data;
}
