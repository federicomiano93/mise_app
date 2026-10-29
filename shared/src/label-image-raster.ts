// label-image-raster.ts — the pixels of an IMAGE label: grey pictures resized the way Pillow resizes them, made 1-bit
// at the threshold, and packed into the rows a Zebra prints. NEW IN MISE 2 (no original in js/): it is the image half
// of the owner's own label script (`genera_etichetta.py`, outside the repository), which draws the product label with the logo
// with Pillow and sends it to the printer as a picture.
//
// ⚠️ WHY COPY PILLOW AND NOT LET THE BROWSER RESIZE. The label is drawn four times too big and reduced (supersampling,
// for cleaner edges), then cut to black and white at 150. Which dots end up black depends on HOW the reduction blends
// the pixels: the browser's own reduction is not specified and differs between versions, so the same label could print
// differently on the lab tablet and on the home PC. This is Pillow's Lanczos, coefficient for coefficient and with its
// fixed-point rounding (Resample.c: precompute_coeffs, normalize_coeffs_8bpc, the horizontal pass then the vertical
// one), so the same grey picture gives the same dots everywhere, and the same dots as the owner's script.
//
// PURE: plain arrays in, plain arrays out. The canvas that draws the text is the app's (the only DOM half).

// A grey picture: one byte per pixel, 0 = black, 255 = white, row after row.
export interface GreyImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

// The owner's numbers (the script's «SPECIFICHE FISSE»): 80 × 60 mm at 8 dots per mm, drawn four times bigger, and
// the threshold «slightly towards black, because thin strokes fade in thermal printing».
export const LABEL_W = 640;
export const LABEL_H = 480;
export const SUPERSAMPLE = 4;
export const THRESHOLD = 150;

// ── Pillow's Lanczos ─────────────────────────────────────────────────────────

const PRECISION_BITS = 32 - 8 - 2;
const ONE = 2 ** PRECISION_BITS;
const HALF = 2 ** (PRECISION_BITS - 1);
const LANCZOS_SUPPORT = 3;

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = x * Math.PI;
  return Math.sin(px) / px;
}

function lanczos(x: number): number {
  return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
}

// C's (int) cast: towards zero.
const toInt = (x: number): number => (x < 0 ? Math.ceil(x) : Math.floor(x));

interface Coeffs {
  readonly ksize: number;
  readonly bounds: Int32Array; // per output pixel: first input pixel, how many
  readonly kk: Float64Array; // integer coefficients, scaled by 2^22 (held in doubles: exact)
}

function precompute(inSize: number, outSize: number): Coeffs {
  const scale = inSize / outSize;
  const filterscale = scale < 1 ? 1 : scale;
  const support = LANCZOS_SUPPORT * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Float64Array(outSize * ksize);
  const pre = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1 / filterscale;
    let xmin = toInt(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = toInt(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      pre[x] = w;
      ww += w;
    }
    for (let x = 0; x < ksize; x++) {
      const k = x < xmax && ww !== 0 ? (pre[x] as number) / ww : 0;
      // normalize_coeffs_8bpc: rounded away from zero to an integer on 2^22.
      kk[xx * ksize + x] = k < 0 ? toInt(-0.5 + k * ONE) : toInt(0.5 + k * ONE);
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { ksize, bounds, kk };
}

// clip8: the sum back to a byte.
function clip8(ss: number): number {
  if (ss >= ONE * 256) return 255;
  if (ss <= 0) return 0;
  return Math.floor(ss / ONE);
}

// A grey picture resized with Lanczos, exactly as Pillow's `Image.resize(size, Image.LANCZOS)` does it for an «L» image:
// the horizontal pass first (into bytes), then the vertical one.
export function resizeLanczos(src: GreyImage, outW: number, outH: number): GreyImage {
  const w = Math.max(1, Math.round(outW));
  const h = Math.max(1, Math.round(outH));
  let img = src;
  if (w !== src.width) {
    const c = precompute(src.width, w);
    const out = new Uint8Array(w * src.height);
    for (let y = 0; y < src.height; y++) {
      const row = y * src.width;
      for (let xx = 0; xx < w; xx++) {
        const xmin = c.bounds[xx * 2] as number;
        const xmax = c.bounds[xx * 2 + 1] as number;
        const k = xx * c.ksize;
        let ss = HALF;
        for (let x = 0; x < xmax; x++) ss += (img.data[row + x + xmin] as number) * (c.kk[k + x] as number);
        out[y * w + xx] = clip8(ss);
      }
    }
    img = { width: w, height: src.height, data: out };
  }
  if (h !== img.height) {
    const c = precompute(img.height, h);
    const out = new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++) {
      const ymin = c.bounds[yy * 2] as number;
      const ymax = c.bounds[yy * 2 + 1] as number;
      const k = yy * c.ksize;
      for (let xx = 0; xx < w; xx++) {
        let ss = HALF;
        for (let y = 0; y < ymax; y++) ss += (img.data[(y + ymin) * w + xx] as number) * (c.kk[k + y] as number);
        out[yy * w + xx] = clip8(ss);
      }
    }
    img = { width: w, height: h, data: out };
  }
  return img;
}

// ── From the canvas to grey ──────────────────────────────────────────────────

// RGBA pixels (a canvas's getImageData) → grey, the way Pillow converts to «L» (ITU-R 601-2, its integer form).
// ⚠️ A SEE-THROUGH PIXEL IS LAID ON WHITE FIRST. Pillow drops the alpha and keeps whatever colour hides under it —
// usually black, which would turn a transparent logo's background into a black slab. A logo is uploaded once and
// looked at in the preview, so the kinder reading costs nothing and never prints a black rectangle.
export function greyFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GreyImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = (rgba[i * 4 + 3] as number) / 255;
    const r = Math.round((rgba[i * 4] as number) * a + 255 * (1 - a));
    const g = Math.round((rgba[i * 4 + 1] as number) * a + 255 * (1 - a));
    const b = Math.round((rgba[i * 4 + 2] as number) * a + 255 * (1 - a));
    data[i] = (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16;
  }
  return { width, height, data };
}

// Pillow's `ImageOps.autocontrast` with no cutoff: the darkest grey becomes black and the lightest white, the rest
// stretched in between (its lookup table, rounded the same way). A flat picture is returned as it is.
export function autocontrast(img: GreyImage): GreyImage {
  let lo = 255;
  let hi = 0;
  for (const v of img.data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi <= lo) return img;
  const scale = 255 / (hi - lo);
  const offset = -lo * scale;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const ix = Math.trunc(i * scale + offset);
    lut[i] = ix < 0 ? 0 : ix > 255 ? 255 : ix;
  }
  return { width: img.width, height: img.height, data: img.data.map(v => lut[v] as number) };
}

// The picture cut to what is not pure white (the script's `logo.crop(ImageOps.invert(logo).getbbox())`), or null for
// a picture with nothing on it.
export function cropToInk(img: GreyImage): GreyImage | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if ((img.data[y * img.width + x] as number) !== 255) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(img.data.subarray((y + y0) * img.width + x0, (y + y0) * img.width + x0 + w), y * w);
  return { width: w, height: h, data };
}

// ── 1-bit, as the printer wants it ───────────────────────────────────────────

// The label's dots: one bit per dot, a 1 printed black, eight dots to a byte with the leftmost in the high bit, each
// row padded to whole bytes (what ^GF expects). Grey under the threshold is black, as in the script.
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  readonly bits: Uint8Array;
}

export function toBitmap(img: GreyImage, threshold: number = THRESHOLD): Bitmap {
  const bytesPerRow = Math.ceil(img.width / 8);
  const bits = new Uint8Array(bytesPerRow * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if ((img.data[y * img.width + x] as number) < threshold) {
        const i = y * bytesPerRow + (x >> 3);
        bits[i] = (bits[i] as number) | (0x80 >> (x & 7));
      }
    }
  }
  return { width: img.width, height: img.height, bytesPerRow, bits };
}

// Whether a dot is black (for the preview and the specs).
export function dotIsBlack(bitmap: Bitmap, x: number, y: number): boolean {
  return (((bitmap.bits[y * bitmap.bytesPerRow + (x >> 3)] as number) >> (7 - (x & 7))) & 1) === 1;
}

// The dots as the script's uncompressed ^GF data: two hex digits per byte, upper case. ~77 000 characters for one
// label, which is why the app sends Z64 instead (zpl-z64.ts); kept for the specs, which compare it with the script's.
export function bitmapHex(bitmap: Bitmap): string {
  let out = '';
  for (const b of bitmap.bits) out += (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
  return out;
}
