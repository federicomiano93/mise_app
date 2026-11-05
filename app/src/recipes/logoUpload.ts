import { decodeUpright } from '@mise/shared/photo-model';
import { CANVAS_H, LOGO_W } from '@mise/shared/label-image-layout';
import { autocontrast, cropToInk, resizeLanczos } from '@mise/shared/label-image-raster';
import type { GreyImage } from '@mise/shared/label-image-raster';
import { greyOfCanvas } from './labelCanvas';
import { LOGO_PNG_MAX, LOGO_PNG_PREFIX } from './imageLabelData';
import type { LabelLogo } from './imageLabelData';

// A picked file becomes the stored logo the way the owner's script prepares it: grey, autocontrast, cut to the ink,
// reduced to LOGO_W wide with Pillow's Lanczos, kept as a PNG data address. NEW IN MISE 2.
//
// The failure is a CODE, never a sentence: the screen words it, in the language of the moment.

export type LogoProblem = 'blank' | 'too-tall';

export class LogoError extends Error {
  readonly code: LogoProblem | 'undecodable' | 'too-big';
  constructor(code: LogoProblem | 'undecodable' | 'too-big') {
    super(code);
    this.name = 'LogoError';
    this.code = code;
  }
}

// ⚠️ PYTHON 3's round() ROUNDS A HALF TO EVEN (2.5 → 2, 3.5 → 4), and the script computes the logo's height with it;
// Math.round would give 3 for 2.5 and a logo one pixel taller than the script's. Exact on .5 only, as the script's input is.
export function pythonRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// The logo's height once a picture of this size is reduced to LOGO_W wide, rounded the script's way.
// ⚠️ A VERY WIDE, THIN PICTURE ROUNDS TO 0 (a 1-pixel line 3000 wide gives 0.44): there is no picture left, and the rules
// need a height of at least 1. It is called blank (nothing to print), never «too big», which would send somebody looking
// for a smaller file when the trouble is that there is too little of it.
export function logoHeightFor(width: number, height: number): number {
  return pythonRound((height * LOGO_W) / width);
}

// The pure half: a grey picture → the logo's grey picture, or what is wrong with it.
export function logoFromGrey(grey: GreyImage): GreyImage | LogoProblem {
  const cropped = cropToInk(autocontrast(grey));
  if (cropped === null) return 'blank';
  const height = logoHeightFor(cropped.width, cropped.height);
  if (height < 1) return 'blank';
  if (height > CANVAS_H) return 'too-tall';
  return resizeLanczos(cropped, LOGO_W, height);
}

// A side over this is a photograph, not a logo: decoding it would also cost the tablet a lot of memory.
const MAX_SIDE = 6000;

// Same as photoImage.ts: Chrome 101 refuses the orientation option, decodeUpright retries without it.
const decodeFile = (file: Blob): Promise<ImageBitmap> => decodeUpright<Blob, ImageBitmap>(
  file, (f, options) => (options === undefined ? createImageBitmap(f) : createImageBitmap(f, options)),
);

function free(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export async function prepareLogo(file: Blob): Promise<LabelLogo> {
  if (typeof createImageBitmap !== 'function') throw new LogoError('undecodable');
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeFile(file);
  } catch {
    throw new LogoError('undecodable');
  }
  const source = document.createElement('canvas');
  const target = document.createElement('canvas');
  try {
    const { width, height } = bitmap;
    if (!width || !height) throw new LogoError('undecodable');
    if (width > MAX_SIDE || height > MAX_SIDE) throw new LogoError('too-big');
    source.width = width;
    source.height = height;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    if (sctx === null) throw new LogoError('undecodable');
    sctx.drawImage(bitmap, 0, 0);
    const result = logoFromGrey(greyOfCanvas(sctx, width, height));
    if (typeof result === 'string') throw new LogoError(result);

    target.width = result.width;
    target.height = result.height;
    const tctx = target.getContext('2d');
    if (tctx === null) throw new LogoError('undecodable');
    const image = tctx.createImageData(result.width, result.height);
    for (let i = 0; i < result.data.length; i++) {
      const v = result.data[i] as number;
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = v;
      image.data[i * 4 + 3] = 255;
    }
    tctx.putImageData(image, 0, 0);
    const png = target.toDataURL('image/png');
    if (!png.startsWith(LOGO_PNG_PREFIX) || png.length > LOGO_PNG_MAX) throw new LogoError('too-big');
    return { png, width: LOGO_W, height: result.height };
  } finally {
    bitmap.close();
    free(source);
    free(target);
  }
}
