// photo-model.js — the part of "read something from a photograph" that is the same
// whatever is being photographed: how big a photo may be, how to shrink it, and how a
// server refusal turns into a key the screen can say something about. No DOM, no
// Firebase, no phrases.
//
// ⚠️ IN js/ ROOT, NOT IN A FEATURE FOLDER, for the same reason as js/price-model.js and
// js/venue-features.js: two features use it now — the Catalogue reads a RECIPE from a
// photograph, Orders reads a PACKET's ingredient list — and a feature may not import
// from another feature's folder. Copying it instead would put the caps in two places,
// and the caps have to agree with the server's or somebody is refused by whichever is
// stricter with a message written for the other.
//
// ⚠️ WHAT DID **NOT** MOVE UP HERE IS THE WORDING. Each feature owns its own table of
// codes → i18n keys, because «no recipe in that photograph» and «no ingredient list on
// that packet» are different sentences about the same code. Same split as
// js/allergen-model.js: shared judgement, feature-owned words.

// ⚠️ 1568px IS NOT A ROUND NUMBER PICKED FOR TIDINESS. The reader downsamples anything
// larger than this before looking at it, so a bigger photo costs upload time and
// payload budget and is read no better. Below it, small print starts to go. It is the
// one size that is both cheapest and clearest.
export const MAX_EDGE = 1568;
export const JPEG_QUALITY = 0.82;
// A second, lower pass for a photo that is still too heavy. ⚠️ Quality drops before
// SIZE does: a smaller picture of small print is unreadable, a slightly softer one is
// not.
export const FALLBACK_QUALITY = 0.7;

export const MAX_PHOTOS = 5;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

// The dimensions to draw at: never larger than maxEdge, never UPSCALED, always whole
// pixels, aspect ratio kept.
export function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { w: 0, h: 0 };
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w: Math.round(w), h: Math.round(h) };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// The payload half of a `data:image/jpeg;base64,…` URL. Returns '' for anything that is
// not one, so a caller cannot accidentally send a whole data URL as if it were base64 —
// the server would reject it and nobody would know why.
export function base64Of(dataUrl) {
  if (typeof dataUrl !== 'string') return '';
  const at = dataUrl.indexOf(';base64,');
  if (at < 0 || !dataUrl.startsWith('data:image/')) return '';
  return dataUrl.slice(at + ';base64,'.length);
}

export function mediaTypeOf(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return '';
  const at = dataUrl.indexOf(';');
  return at < 0 ? '' : dataUrl.slice('data:'.length, at);
}

export function approxBytes(base64) {
  return typeof base64 === 'string' ? Math.floor(base64.length * 3 / 4) : 0;
}

// ⚠️ THE SAME GUARD THE SERVER RUNS, ON PURPOSE. The server's copy is the one that is
// enforced; this one exists so somebody on a slow connection is told in an instant
// instead of after a two-megabyte upload. Returns a CODE, never a sentence — the phrase
// is chosen by the screen, in the reader's own language.
export function payloadProblem(images) {
  if (!Array.isArray(images) || images.length === 0) return 'no-images';
  if (images.length > MAX_PHOTOS) return 'too-many-images';
  let total = 0;
  for (const image of images) {
    const bytes = approxBytes(image && image.data);
    if (!bytes) return 'bad-image';
    if (bytes > MAX_IMAGE_BYTES) return 'image-too-large';
    total += bytes;
  }
  return total > MAX_TOTAL_BYTES ? 'images-too-large' : null;
}

// ── What went wrong, as an i18n KEY ──────────────────────────────────────────
//
// ⚠️ A KEY, NEVER A PHRASE, AND NEVER A t() CALL — in this file or in the tables handed
// to it. A t() resolved at module load runs before a venue is open, so before the
// interface language is even known, and freezes in whatever language the app started
// in. Fourteen constants in this app did exactly that and rendered English for weeks
// with every translation correctly in place (tests/frozen-phrases.test.mjs).
//
// ⚠️ ONLY ONE ANSWER MAY MENTION THE CONNECTION, and it is the one where there
// genuinely is not one. This project has already learnt that the hard way: telling
// somebody with full signal to check their connection sends them to fix the one thing
// that is working. A refusal, a daily limit and an unreadable photograph are all
// decisions, and each has to say so.
//
// `keys` is the caller's own code → key table. Every code this can produce must be in
// it; each feature's tests walk that table against the dictionary.
export function errorKey(err, keys) {
  const key = err && err.details && typeof err.details.key === 'string' ? err.details.key : '';
  if (keys[key]) return keys[key];

  const code = err && typeof err.code === 'string' ? err.code : '';
  // Firebase prefixes a callable's code with 'functions/'.
  const bare = code.replace(/^functions\//, '');
  if (bare === 'unauthenticated') return keys['signed-out'];
  if (bare === 'permission-denied') return keys['not-allowed'];
  if (bare === 'resource-exhausted') return keys['person-limit'];
  // 'unavailable' is what a callable reports when it could not be reached at all, and
  // 'deadline-exceeded' when the phone gave up waiting.
  if (bare === 'unavailable') return keys.offline;
  if (bare === 'deadline-exceeded') return keys['too-slow'];
  return keys['read-failed'];
}

// The key for an answer that arrived and carried nothing usable.
export function answerKey(reason, keys) {
  return keys[reason] || keys['nothing-readable'];
}
