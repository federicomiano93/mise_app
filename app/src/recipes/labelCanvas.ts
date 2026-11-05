import { CANVAS_H, CANVAS_W } from '@mise/shared/label-image-layout';
import type { LogoLabelLayout } from '@mise/shared/label-image-layout';
import { ascentOf, measureLikePillow } from '@mise/shared/label-image-fonts';
import type { LabelMetrics } from '@mise/shared/label-image-fonts';
import { LABEL_H, LABEL_W, dotIsBlack, greyFromRgba, resizeLanczos, toBitmap } from '@mise/shared/label-image-raster';
import type { Bitmap, GreyImage } from '@mise/shared/label-image-raster';
import { LABEL_FONT_CSS } from './labelFonts';

// The DOM half of drawing the image label: the layout (shared, pure) is painted on a 2560 × 1920 canvas, read back as grey,
// reduced to the label's 640 × 480 dots by Pillow's own Lanczos (shared) and cut to black and white. The canvas only
// supplies the SHAPES of the glyphs; every position and every reduction is the owner's script's.

// The few members of a 2d context the drawing uses, so a spec can pass a recording fake (jsdom has no canvas).
export type LabelCanvasContext = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'font' | 'textBaseline' | 'textAlign' | 'fillRect' | 'fillText' | 'drawImage'
>;

export function drawLogoLabel(
  ctx: LabelCanvasContext, layout: LogoLabelLayout, metrics: LabelMetrics, logo: CanvasImageSource,
): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const el of layout.elements) {
    if (el.kind === 'image') {
      ctx.drawImage(logo, el.x, el.y, el.w, el.h);
    } else if (el.kind === 'rect') {
      // Pillow's rectangle includes both corners.
      ctx.fillRect(el.x0, el.y0, el.x1 - el.x0 + 1, el.y1 - el.y0 + 1);
    } else {
      ctx.font = LABEL_FONT_CSS[el.font](el.px);
      // The layout gives the TOP OF THE ASCENDER (Pillow's anchor «la»); the canvas wants the baseline.
      const baseline = el.y + ascentOf(metrics, el.font, el.px);
      // ⚠️ ONE CHARACTER AT A TIME. Pillow places every glyph at its hinted whole-pixel advance plus kerning rounded its
      // own way (label-image-fonts.ts); a browser drawing a whole string would place glyphs at its own unhinted advances
      // and drift a few pixels over a line. So the positions are Pillow's and only the glyph shapes are the browser's.
      // Code points, never `.length` indexes: a character outside the BMP is two UTF-16 units.
      const chars = Array.from(el.text);
      chars.forEach((ch, i) => {
        if (/\s/u.test(ch)) return;
        const x = el.x + measureLikePillow(metrics, chars.slice(0, i).join(''), el.font, el.px);
        ctx.fillText(ch, x, baseline);
      });
    }
  }
}

export function greyOfCanvas(ctx: Pick<CanvasRenderingContext2D, 'getImageData'>, width: number, height: number): GreyImage {
  return greyFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
}

export function renderLogoLabelBitmap(layout: LogoLabelLayout, metrics: LabelMetrics, logo: CanvasImageSource): Bitmap {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('no-canvas');
    drawLogoLabel(ctx, layout, metrics, logo);
    const grey = greyOfCanvas(ctx, CANVAS_W, CANVAS_H);
    return toBitmap(resizeLanczos(grey, LABEL_W, LABEL_H));
  } finally {
    // The big canvas is ~20 MB of pixels: let it go now, not when the garbage collector gets round to it.
    canvas.width = 0;
    canvas.height = 0;
  }
}

// The dots on a canvas: black where the printer prints, white elsewhere. ⚠️ The preview AND the print both use this, so
// the screen shows exactly the dots that go to the printer.
export function paintBitmap(canvas: HTMLCanvasElement, bitmap: Bitmap): void {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no-canvas');
  const image = ctx.createImageData(bitmap.width, bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const i = (y * bitmap.width + x) * 4;
      const v = dotIsBlack(bitmap, x, y) ? 0 : 255;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

// The dots as a PNG data address, for the system print dialog's image.
export function bitmapPng(bitmap: Bitmap): string {
  const canvas = document.createElement('canvas');
  try {
    paintBitmap(canvas, bitmap);
    return canvas.toDataURL('image/png');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function loadLogoImage(png: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = png;
  await img.decode();
  return img;
}
