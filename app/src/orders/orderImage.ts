// orderImage.ts — the order message as a PICTURE, drawn on a canvas and handed to the phone's share sheet (parity X22,
// decision T11). The browser half of js/orders/order-image.js; WHAT is drawn where is @mise/shared/order-image (layoutOrder).
//
// ⚠️ THE ONE PLACE navigator.share() AND A File LIVE IN ORDERS. The owner's rule is «one mechanism, wa.me, everywhere» —
// reversed for the ORDER PICTURE ONLY (7 Oct 2026): a supplier who receives a picture can open it and zoom, which a WhatsApp
// text bubble does not allow. No blob: URL and no download: a File handed to navigator.share() needs neither.
//
// ⚠️ THE FONT IS GEIST (decision F of 3f-3), the one font Mise 2 bundles; the current app draws in Manrope. The fonts are
// awaited first, or the canvas silently draws in a fallback.

import { FONT_SIZE, IMAGE_PADDING, INK, PAPER, imageFileName, layoutOrder } from '@mise/shared/order-image';

const FAMILY = "'Geist Variable', sans-serif";
const font = (bold: boolean) => `${bold ? 800 : 400} ${FONT_SIZE}px ${FAMILY}`;

// Draw it. Rejects when the browser cannot (no canvas, no picture): the caller then offers the text instead.
export async function renderOrderImage(text: string, { date = new Date(), language = null as unknown } = {}): Promise<File> {
  await Promise.all([document.fonts.load(font(false), text), document.fonts.load(font(true), text)]);

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('no canvas');
  const measure = (s: string, bold: boolean) => { probe.font = font(bold); return probe.measureText(s).width; };
  const layout = layoutOrder(text, measure);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';

  layout.lines.forEach((row, i) => {
    let x = IMAGE_PADDING;
    const baseline = IMAGE_PADDING + i * layout.step + Math.round(FONT_SIZE * 1.05);
    row.forEach(seg => {
      ctx.font = font(seg.bold);
      ctx.fillText(seg.text, x, baseline);
      x += ctx.measureText(seg.text).width;
    });
  });

  const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png'); });
  if (!blob) throw new Error('canvas gave no picture');
  return new File([blob], imageFileName(date, language), { type: 'image/png' });
}

// A tiny real PNG (1×1) used only to ask the browser «can you share a png file?».
export function probeFile(): File {
  const bytes = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='),
  c => c.charCodeAt(0));
  return new File([bytes], 'probe.png', { type: 'image/png' });
}

type ShareNavigator = Pick<Navigator, 'share' | 'canShare'> | null | undefined;

// Whether the person is asked «photo or text?» at all: only where the browser says it can share a PNG.
export function canSharePhotos(nav: ShareNavigator = typeof navigator === 'undefined' ? null : navigator,
  makeProbe: () => File = probeFile): boolean {
  try {
    return !!(nav && typeof nav.canShare === 'function' && typeof nav.share === 'function'
      && nav.canShare({ files: [makeProbe()] }));
  } catch { return false; }
}

// 'shared' (the promise resolved), 'cancelled' (the person closed the sheet — nothing marked, nothing said) or 'failed'
// (anything else — the caller falls back to text).
export async function sharePhoto(file: File, nav: Pick<Navigator, 'share'> = navigator): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await nav.share({ files: [file] });
    return 'shared';
  } catch (err) {
    // By name, not by class: the browser throws a DOMException.
    return (err as { name?: unknown } | null)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
