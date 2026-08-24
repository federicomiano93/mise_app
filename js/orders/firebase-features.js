// firebase-features.js — the two switches that say which panels this venue uses on
// an ingredient's record, and the one call that changes them.
//
// ⚠️ IT WRITES NOTHING ITSELF — locations/{lid} is `allow write: if false` for every
// client, so this is a request to a Cloud Function that checks the role and does the
// write. Hiding the control from an employee is courtesy; the server is what refuses.
// Same shape, same reason, as js/catalogue/firebase-photo.js.
//
// ⚠️ THE JUDGEMENT ITSELF IS NOT HERE. What a missing or corrupt value means lives in
// js/venue-features.js — PURE, importable by the Catalogue too, and the only place the
// «default ON» direction is written down.

import { firebaseConfig, sessionReady, isLocalEmulator, currentSession } from '../firebase.js';
import { currentLocationId } from '../location.js';
import { allergensOn, nutritionOn } from '../venue-features.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFunctions, httpsCallable, connectFunctionsEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ⚠️ THE REGION HAS TO MATCH THE ONE THE FUNCTION DECLARES. Left to its default the
// client calls us-central1 anyway, but saying it here means a later move fails
// loudly in one place rather than as a silent CORS error on every call.
const functions = getFunctions(app, 'us-central1');

// ⚠️ WITHOUT THIS, TESTING ON LOCALHOST CALLS THE REAL DEPLOYED FUNCTION — which
// would write the REAL location document while the console says "LOCAL EMULATOR
// mode". js/firebase.js points Firestore and Auth at the emulator; nothing points
// Functions anywhere.
if (isLocalEmulator) connectFunctionsEmulator(functions, '127.0.0.1', 5001);

// ⚠️ WHAT HAS BEEN SWITCHED SINCE THIS PAGE LOADED. The session's copy of the
// location document is read when the location OPENS and does not follow a write made
// afterwards, so without this the switch would spring back the instant the screen
// repainted — and the ingredient card behind it would disagree with the switch that
// had just been thrown. Exactly the `overriddenPhotoOn` problem, one page along.
const override = {};

// What this venue shows on an ingredient's record. A live read, so a screen may call
// it on every paint.
//
// ⚠️⚠️ `packPhoto` POINTS THE OPPOSITE WAY TO THE OTHER TWO, AND THE DIRECTION IS THE
// WHOLE ARGUMENT. allergensOn()/nutritionOn() read `!== false`, so a venue that has
// never heard of them, a document that failed to load and a corrupt value all answer
// ON — because the opposite would quietly remove the part of this app that can send
// somebody to hospital. This one reads `=== true`, because it SPENDS MONEY per tap on
// an account nobody in the venue owns, and a venue that has never heard of it must
// never find it already running. Same direction, and same reason, as `recipePhoto`.
//
// ⚠️ AND ONLY A LITERAL `true` COUNTS. A stray string, a 1, a corrupt value: all off.
export function ingredientPanels() {
  const location = currentSession().location;
  return {
    allergens: 'showAllergens' in override ? override.showAllergens : allergensOn(location),
    nutrition: 'showNutrition' in override ? override.showNutrition : nutritionOn(location),
    packPhoto: 'packPhoto' in override
      ? override.packPhoto
      : !!location && location.packPhoto === true,
  };
}

// Throw one switch. `key` is 'showAllergens' or 'showNutrition'.
//
// ⚠️ ONE AT A TIME, DELIBERATELY. Sending both would let a screen drawn before
// somebody else's change put the other switch back to what it was showing.
export async function setIngredientPanel(key, on) {
  await sessionReady;
  const locationId = currentLocationId();
  await httpsCallable(functions, 'setIngredientPanels')({ locationId, [key]: on });
  // Only after the server has agreed. Setting it first would leave the screen
  // showing a change the venue never got.
  override[key] = on;
  return on;
}

// Throw the pack-photo switch.
//
// ⚠️ ITS OWN CALLABLE, NOT setIngredientPanels. That one writes two fields whose
// absence means YES; this writes one whose absence means NO, and it is the only switch
// on this page that costs money. Keeping them apart is what stops a future «send them
// together» tidy-up from giving the two directions one code path.
export async function setPackPhoto(on) {
  await sessionReady;
  const locationId = currentLocationId();
  await httpsCallable(functions, 'setPackPhoto')({ locationId, enabled: on });
  // Only after the server has agreed. Setting it first would leave the screen showing
  // a change the venue never got — and, here, offering a button that will be refused.
  override.packPhoto = on;
  return on;
}
