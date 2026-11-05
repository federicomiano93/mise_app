// photo-model.ts — the part of "read something from a photograph" that is the same whatever is being photographed:
// how big a photo may be, how to shrink it, and how a server refusal turns into a key the screen can say something
// about. No DOM, no Firebase, no phrases.
//
// TypeScript port of js/photo-model.js for Mise 2, a FULL port. Behaviour is identical, input for input:
// photo-model.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and odd-inputs.spec.ts
// feeds both the same strange values. The comments below are the ones the original paid for in bugs.
//
// ⚠️ IN shared/ ROOT, NOT IN A FEATURE FOLDER: two features use it — the Catalogue reads a RECIPE from a photograph,
// Orders will read a PACKET's ingredient list — and a feature may not import from another feature's folder. Copying it
// instead would put the caps in two places, and the caps have to agree with the server's or somebody is refused by
// whichever is stricter with a message written for the other.
//
// ⚠️ WHAT DID **NOT** MOVE UP HERE IS THE WORDING. Each feature owns its own table of codes → message keys, because
// «no recipe in that photograph» and «no ingredient list on that packet» are different sentences about the same code.
// The Catalogue's table is catalogue-photo-model.ts.

// ⚠️ 1568px IS NOT A ROUND NUMBER PICKED FOR TIDINESS. The reader downsamples anything larger than this before looking
// at it, so a bigger photo costs upload time and payload budget and is read no better. Below it, small print starts to
// go. It is the one size that is both cheapest and clearest.
export const MAX_EDGE = 1568;
export const JPEG_QUALITY = 0.82;
// A second, lower pass for a photo that is still too heavy. ⚠️ Quality drops before SIZE does: a smaller picture of
// small print is unreadable, a slightly softer one is not.
export const FALLBACK_QUALITY = 0.7;

export const MAX_PHOTOS = 5;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

// The dimensions to draw at: never larger than maxEdge, never UPSCALED, always whole pixels, aspect ratio kept.
export function fitWithin(width: unknown, height: unknown, maxEdge: number = MAX_EDGE): { w: number; h: number } {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { w: 0, h: 0 };
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w: Math.round(w), h: Math.round(h) };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// The payload half of a `data:image/jpeg;base64,…` URL. Returns '' for anything that is not one, so a caller cannot
// accidentally send a whole data URL as if it were base64 — the server would reject it and nobody would know why.
export function base64Of(dataUrl: unknown): string {
  if (typeof dataUrl !== 'string') return '';
  const at = dataUrl.indexOf(';base64,');
  if (at < 0 || !dataUrl.startsWith('data:image/')) return '';
  return dataUrl.slice(at + ';base64,'.length);
}

export function mediaTypeOf(dataUrl: unknown): string {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return '';
  const at = dataUrl.indexOf(';');
  return at < 0 ? '' : dataUrl.slice('data:'.length, at);
}

export function approxBytes(base64: unknown): number {
  return typeof base64 === 'string' ? Math.floor(base64.length * 3 / 4) : 0;
}

// ⚠️ THE SAME GUARD THE SERVER RUNS, ON PURPOSE. The server's copy is the one that is enforced; this one exists so
// somebody on a slow connection is told in an instant instead of after a two-megabyte upload. Returns a CODE, never a
// sentence — the phrase is chosen by the screen, in the reader's own language.
export function payloadProblem(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return 'no-images';
  if (images.length > MAX_PHOTOS) return 'too-many-images';
  let total = 0;
  for (const image of images as unknown[]) {
    const bytes = approxBytes(image && (image as { data?: unknown }).data);
    if (!bytes) return 'bad-image';
    if (bytes > MAX_IMAGE_BYTES) return 'image-too-large';
    total += bytes;
  }
  return total > MAX_TOTAL_BYTES ? 'images-too-large' : null;
}

// ── What went wrong, as a message KEY ────────────────────────────────────────
//
// ⚠️ A KEY, NEVER A PHRASE, AND NEVER A t() CALL — in this file or in the tables handed to it. A phrase resolved when
// a module loads runs before a venue is open, so before the interface language is even known, and freezes in whatever
// language the app started in.
//
// ⚠️ ONLY ONE ANSWER MAY MENTION THE CONNECTION, and it is the one where there genuinely is not one. Telling somebody
// with full signal to check their connection sends them to fix the one thing that is working. A refusal, a daily limit
// and an unreadable photograph are all decisions, and each has to say so.
//
// `keys` is the caller's own code → key table. Every code this can produce must be in it; each feature's spec walks
// that table against the dictionaries.
export type PhotoKeys = Readonly<Record<string, string>>;

// ⚠️ A table is a plain object, as in the original: a `details.key` that names an inherited property (`constructor`)
// would be answered with that property. No server sends one; fixing it is a fix to BOTH files at once.
const at = (keys: PhotoKeys, code: string): string => keys[code] as string;

export function errorKey(err: unknown, keys: PhotoKeys): string {
  const e = err as { details?: { key?: unknown }; code?: unknown } | null | undefined;
  const key = e && e.details && typeof e.details.key === 'string' ? e.details.key : '';
  if (keys[key]) return at(keys, key);

  const code = e && typeof e.code === 'string' ? e.code : '';
  // Firebase prefixes a callable's code with 'functions/'.
  const bare = code.replace(/^functions\//, '');
  if (bare === 'unauthenticated') return at(keys, 'signed-out');
  if (bare === 'permission-denied') return at(keys, 'not-allowed');
  if (bare === 'resource-exhausted') return at(keys, 'person-limit');
  // 'unavailable' is what a callable reports when it could not be reached at all, and 'deadline-exceeded' when the
  // phone gave up waiting.
  if (bare === 'unavailable') return at(keys, 'offline');
  if (bare === 'deadline-exceeded') return at(keys, 'too-slow');
  return at(keys, 'read-failed');
}

// The key for an answer that arrived and carried nothing usable.
export function answerKey(reason: unknown, keys: PhotoKeys): string {
  return (keys[reason as string] || keys['nothing-readable']) as string;
}

// Decode a chosen photo the right way up (the current app's js/photo-model.js, PR #374).
//
// ⚠️ Chrome 101 (the lab tablet's, the newest the SM-T550 can get) does not know the word 'from-image': it REJECTS the
// options with a TypeError before looking at the photo, so every camera photo on the tablet was reported as an
// unreadable format (found on the real tablet in Mise 2, 18 Oct 2026). Its own default already honours the EXIF
// rotation (measured there: a 40×30 JPEG flagged «rotate 90°» decodes 30×40) — the spec later renamed that behaviour
// 'from-image'. So ONLY a TypeError (the options refused) retries without them; a photo that truly cannot be decoded
// fails with a DOMException and stays «undecodable» for the caller.
//
// `create` is createImageBitmap, passed in so a test can stand in for the browser. shared/ knows no DOM, so the
// bitmap and the file are whatever the browser's own function takes and gives.
type CreateBitmap<F, B> = (file: F, options?: { imageOrientation: 'from-image' }) => Promise<B>;
export async function decodeUpright<F, B>(
  file: F,
  create: CreateBitmap<F, B> = (globalThis as unknown as { createImageBitmap: CreateBitmap<F, B> }).createImageBitmap,
): Promise<B> {
  try {
    return await create(file, { imageOrientation: 'from-image' });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return create(file);
  }
}
