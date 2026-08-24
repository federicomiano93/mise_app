// photo-model.js — the Catalogue's half of "read a recipe from a photograph": its own
// table of what to SAY when a read does not work. No DOM, no Firebase, no phrases.
//
// ⚠️ THE SIZES AND THE GEOMETRY LEFT THIS FILE ON 24 Aug 2026 and now live in
// js/photo-model.js, because Orders reads a PACKET's ingredient list through the same
// pipeline and a feature may not import from another feature's folder. They are
// re-exported here so every caller and every test that already knew this file still
// finds them. What stayed is the WORDING — «no recipe in that photograph» and «no
// ingredient list on that packet» are different sentences about the same code.
//
// The rest of the feature is js/catalogue/photo-capture.js (the screen and the canvas),
// js/catalogue/firebase-photo.js (the one call) and, on the server,
// functions/recipe-photo-model.js (every judgement about what the photo said).

import { errorKey, answerKey } from '../photo-model.js';

export {
  MAX_EDGE, JPEG_QUALITY, FALLBACK_QUALITY,
  MAX_PHOTOS, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES,
  fitWithin, base64Of, mediaTypeOf, approxBytes, payloadProblem,
} from '../photo-model.js';

// ⚠️ A KEY, NEVER A PHRASE, AND NEVER A t() CALL. A t() resolved here would run at
// module load — before a venue is open, so before the interface language is even
// known — and freeze in whatever language the app started in. Fourteen constants in
// this app did exactly that and rendered English for weeks with every translation
// correctly in place (tests/frozen-phrases.test.mjs).
const BY_KEY = {
  'signed-out': 'cat.photo.err.signedOut',
  'no-location': 'cat.photo.err.failed',
  'no-images': 'cat.photo.err.noImages',
  'too-many-images': 'cat.photo.err.tooMany',
  'image-too-large': 'cat.photo.err.tooLarge',
  'images-too-large': 'cat.photo.err.tooLarge',
  'bad-image': 'cat.photo.err.badImage',
  'not-allowed': 'cat.photo.err.notAllowed',
  'person-limit': 'cat.photo.err.personLimit',
  'venue-limit': 'cat.photo.err.venueLimit',
  'photo-off': 'cat.photo.err.photoOff',
  'read-failed': 'cat.photo.err.failed',
  'too-slow': 'cat.photo.err.tooSlow',
  // Not errors at all — the call worked and the answer was "nothing I can use".
  // They are here so one lookup covers both, and the screen treats them alike.
  'nothing-readable': 'cat.photo.err.nothingFound',
  refused: 'cat.photo.err.refused',
  truncated: 'cat.photo.err.tooLong',
  'no-tool': 'cat.photo.err.nothingFound',
  // Raised on the phone, before anything is sent.
  undecodable: 'cat.photo.err.badFormat',
  offline: 'cat.photo.err.offline',
};

export function photoErrorKey(err) {
  return errorKey(err, BY_KEY);
}

// The key for an answer that arrived and carried no recipe.
export function noRecipeKey(reason) {
  return answerKey(reason, BY_KEY);
}
