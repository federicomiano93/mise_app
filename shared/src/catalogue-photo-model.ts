// catalogue-photo-model.ts — the Catalogue's half of "read a recipe from a photograph": its own table of what to SAY
// when a read does not work. No DOM, no Firebase, no phrases.
//
// TypeScript port of js/catalogue/photo-model.js for Mise 2. It is not paired export by export in parity.spec.ts: the
// original re-exports the sizes and the geometry of js/photo-model.js (they are photo-model.ts here) and keeps its
// table private, while this port exports the table (`CATALOGUE_PHOTO_KEYS`) so the app's spec can walk it against both
// dictionaries. catalogue-photo-model.spec.ts runs every test against both files.
//
// ⚠️ A KEY, NEVER A PHRASE, AND NEVER A t() CALL: a phrase resolved when the module loads freezes in whatever language
// the app started in. The app resolves these keys while drawing.
import { answerKey, errorKey } from './photo-model';

export const CATALOGUE_PHOTO_KEYS: Readonly<Record<string, string>> = {
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
  // Not errors at all — the call worked and the answer was "nothing I can use". They are here so one lookup covers
  // both, and the screen treats them alike.
  'nothing-readable': 'cat.photo.err.nothingFound',
  refused: 'cat.photo.err.refused',
  truncated: 'cat.photo.err.tooLong',
  'no-tool': 'cat.photo.err.nothingFound',
  // Raised on the phone, before anything is sent.
  undecodable: 'cat.photo.err.badFormat',
  offline: 'cat.photo.err.offline',
};

// Named like the original's functions so the two files read side by side.
export function photoErrorKey(err: unknown): string {
  return errorKey(err, CATALOGUE_PHOTO_KEYS);
}

// The key for an answer that arrived and carried no recipe.
export function noRecipeKey(reason: unknown): string {
  return answerKey(reason, CATALOGUE_PHOTO_KEYS);
}
