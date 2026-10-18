import { FALLBACK_QUALITY, JPEG_QUALITY, MAX_EDGE, MAX_IMAGE_BYTES, approxBytes, base64Of, fitWithin } from '@mise/shared/photo-model';

// The DOM half of a photograph: one chosen file becomes the ONE string that is both the thumbnail and the payload (a port of
// `shrink` in js/catalogue/photo-capture.js; the arithmetic is the shared photo model's).
//
// The failure is a CODE of the shared model's table (`undecodable`, `bad-image`), never a sentence: the screen turns it
// into one while it draws, in the language of the moment.

export type PhotoProblem = 'undecodable' | 'bad-image';

export class PhotoImageError extends Error {
  readonly code: PhotoProblem;
  constructor(code: PhotoProblem) {
    super(code);
    this.name = 'PhotoImageError';
    this.code = code;
  }
}

// ⚠️ createImageBitmap, NOT FileReader, AND `imageOrientation` IS THE LINE THAT MUST NOT BE LOST. A phone held upright
// writes an EXIF rotation flag into the file instead of rotating the pixels; the historical default is to ignore it.
// Ignored, the reader is handed a photograph lying on its side and answers with confident nonsense — and NOTHING reports
// an error, because nothing has gone wrong as far as any code can tell.
//
// It also takes the File directly, so no blob: URL is ever made — the app's Content-Security-Policy allows
// `img-src 'self' data:` and nothing else — and it holds one downscaled copy rather than the original as well.
//
// ⚠️ Chrome 101 (the lab tablet's) does not know the word 'from-image': it REJECTS the options with a TypeError before
// looking at the photo, and every camera photo on the tablet was reported as an unreadable format (found on the real
// tablet, 18 Oct 2026). Its own default already honours the EXIF flag (measured there: a 40×30 JPEG flagged «rotate 90°»
// decodes 30×40) — the spec later renamed that behaviour 'from-image'. So ONLY a TypeError (the options refused) retries
// without them; a photo that truly cannot be decoded fails with a DOMException and stays «undecodable».
async function decodeUpright(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return createImageBitmap(file);
  }
}

export async function shrinkPhoto(file: Blob): Promise<string> {
  // A browser without it (Chrome 101, the lab tablet's, has it) cannot prepare a photo: said as «could not be prepared»,
  // not as a format problem, because no format is to blame.
  if (typeof createImageBitmap !== 'function') throw new PhotoImageError('bad-image');

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeUpright(file);
  } catch {
    // ⚠️ ALMOST ALWAYS HEIC, off an iPhone, picked from the library rather than taken with the camera. Android cannot
    // decode it at all. There is no fallback path on purpose: a second decoder that works on one platform is a defect that
    // exists only on the other.
    throw new PhotoImageError('undecodable');
  }
  try {
    const { w, h } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    if (!w || !h) throw new PhotoImageError('undecodable');

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    if (context === null) throw new PhotoImageError('bad-image');
    context.drawImage(bitmap, 0, 0, w, h);

    let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    // ⚠️ Quality drops before SIZE does. A softer photograph of handwriting is still readable; a smaller one is not.
    if (approxBytes(base64Of(dataUrl)) > MAX_IMAGE_BYTES) dataUrl = canvas.toDataURL('image/jpeg', FALLBACK_QUALITY);
    if (base64Of(dataUrl) === '') throw new PhotoImageError('bad-image');
    return dataUrl;
  } catch (error) {
    if (error instanceof PhotoImageError) throw error;
    throw new PhotoImageError('bad-image');
  } finally {
    bitmap.close();
  }
}
