import { describe, expect, it } from 'vitest';
import { CANVAS_H, CANVAS_W, layoutLogoLabel } from '@mise/shared/label-image-layout';
import { ascentOf, measureLikePillow } from '@mise/shared/label-image-fonts';
import { labelMetrics } from '@mise/shared/label-image-metrics';
import { dotIsBlack, greyFromRgba, toBitmap } from '@mise/shared/label-image-raster';
import { bitmapPng, drawElements, drawLogoLabel, greyOfCanvas, paintBitmap, renderLayoutBitmap } from './labelCanvas';
import type { LabelCanvasContext } from './labelCanvas';

// The drawing half, against a recording fake context (jsdom has no canvas 2d context).

type Op = { op: string; args: unknown[]; font?: string; fill?: string };

function recorder() {
  const ops: Op[] = [];
  const ctx = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    fillRect(...args: number[]) { ops.push({ op: 'fillRect', args, fill: String(this.fillStyle) }); },
    fillText(...args: unknown[]) { ops.push({ op: 'fillText', args, font: this.font }); },
    drawImage(...args: unknown[]) { ops.push({ op: 'drawImage', args }); },
  };
  return { ops, ctx: ctx as unknown as LabelCanvasContext & typeof ctx };
}

const metrics = labelMetrics();
const measure = (t: string, f: 'regular' | 'bold' | 'title', px: number) => measureLikePillow(metrics, t, f, px);
const layout = layoutLogoLabel(
  { title: 'Torta', ingredients: 'farina uova LATTE', header: ['Bar', 'Via 1'], logo: { width: 1320, height: 400 }, producedOn: 'PRODOTTO IL:' },
  measure,
);
const LOGO = {} as CanvasImageSource;

describe('drawLogoLabel', () => {
  it('starts with a full white fill and then draws in black', () => {
    const { ops, ctx } = recorder();
    drawLogoLabel(ctx, layout, metrics, LOGO);
    expect(ops[0]).toEqual({ op: 'fillRect', args: [0, 0, CANVAS_W, CANVAS_H], fill: '#ffffff' });
    expect(ops[1]?.op).toBe('drawImage');
    expect(ctx.textBaseline).toBe('alphabetic');
    expect(ctx.textAlign).toBe('left');
  });

  it('draws the logo at its stored size', () => {
    const { ops, ctx } = recorder();
    drawLogoLabel(ctx, layout, metrics, LOGO);
    const image = layout.elements.find(e => e.kind === 'image');
    expect(image?.kind).toBe('image');
    if (image?.kind !== 'image') return;
    expect(ops.find(o => o.op === 'drawImage')?.args).toEqual([LOGO, image.x, image.y, 1320, 400]);
  });

  it('counts both corners of a rectangle', () => {
    const { ops, ctx } = recorder();
    drawLogoLabel(ctx, layout, metrics, LOGO);
    const rect = layout.elements.find(e => e.kind === 'rect');
    if (rect?.kind !== 'rect') throw new Error('no rect');
    const drawn = ops.filter(o => o.op === 'fillRect')[1];
    expect(drawn?.fill).toBe('#000000');
    expect(drawn?.args).toEqual([rect.x0, rect.y0, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1]);
  });

  it('places each character at the pillow position of its prefix, on the baseline, and skips spaces', () => {
    const { ops, ctx } = recorder();
    drawLogoLabel(ctx, layout, metrics, LOGO);
    const el = layout.elements.find(e => e.kind === 'text' && e.text === 'PRODOTTO IL:');
    if (el?.kind !== 'text') throw new Error('no text');
    const baseline = el.y + ascentOf(metrics, el.font, el.px);
    const chars = Array.from(el.text);
    const expected = chars.flatMap((ch, i) => /\s/u.test(ch) ? [] : [
      [ch, el.x + measureLikePillow(metrics, chars.slice(0, i).join(''), el.font, el.px), baseline],
    ]);
    const drawn = ops.filter(o => o.op === 'fillText' && o.font === '700 56px "Mise Label Sans"').map(o => o.args);
    expect(drawn.slice(-expected.length)).toEqual(expected);
    expect(drawn.some(a => a[0] === ' ')).toBe(false);
    expect(expected).toHaveLength(11);
  });
});

describe('greyOfCanvas', () => {
  it('reads the pixels the way greyFromRgba does', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 200, 10, 90, 128, 0, 0, 0, 0]);
    const grey = greyOfCanvas({ getImageData: () => ({ data: rgba }) as ImageData }, 2, 2);
    expect(grey).toEqual(greyFromRgba(rgba, 2, 2));
  });
});

describe('paintBitmap', () => {
  it('writes black exactly where the dot is black', () => {
    const data = new Uint8Array(10 * 3).fill(255);
    data[0] = 0;
    data[14] = 0;
    data[29] = 0;
    const bitmap = toBitmap({ width: 10, height: 3, data });
    let put: { data: Uint8ClampedArray } | null = null;
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => { put = image; },
      }),
    } as unknown as HTMLCanvasElement;
    paintBitmap(canvas, bitmap);
    expect([canvas.width, canvas.height]).toEqual([10, 3]);
    const image = put as unknown as { data: Uint8ClampedArray };
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 10; x++) {
        const i = (y * 10 + x) * 4;
        const v = dotIsBlack(bitmap, x, y) ? 0 : 255;
        expect([image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]]).toEqual([v, v, v, 255]);
      }
    }
    expect(dotIsBlack(bitmap, 0, 0)).toBe(true);
    expect(dotIsBlack(bitmap, 1, 0)).toBe(false);
  });

  it('bitmapPng returns the data address of a fresh canvas', () => {
    const bitmap = toBitmap({ width: 8, height: 1, data: new Uint8Array(8) });
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }),
      toDataURL: (type: string) => `data:${type};base64,AAAA`,
    };
    const real = document.createElement.bind(document);
    document.createElement = ((tag: string) => tag === 'canvas' ? canvas : real(tag)) as typeof document.createElement;
    try {
      expect(bitmapPng(bitmap)).toBe('data:image/png;base64,AAAA');
    } finally {
      document.createElement = real;
    }
  });
});

// ── The same drawing for the HACCP label (any size) ─────────────────────────

describe('renderLayoutBitmap', () => {
  it('draws on a canvas S times the label and reduces it to the label’s own dots (60x40 mm = 480 × 320)', () => {
    const real = document.createElement.bind(document);
    const made: { width: number; height: number; fills: number[][] }[] = [];
    const rgba = (w: number, h: number) => new Uint8ClampedArray(w * h * 4).fill(255);
    document.createElement = ((tag: string) => {
      if (tag !== 'canvas') return real(tag);
      const canvas = {
        width: 0, height: 0, fills: [] as number[][],
        getContext: () => ({
          fillStyle: '', font: '', textBaseline: '', textAlign: '',
          fillRect: (...args: number[]) => { canvas.fills.push(args); },
          fillText: () => undefined,
          drawImage: () => undefined,
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: rgba(w, h) }),
        }),
      };
      made.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    }) as typeof document.createElement;
    try {
      const bitmap = renderLayoutBitmap([], 480 * 4, 320 * 4, metrics, null);
      expect([bitmap.width, bitmap.height]).toEqual([480, 320]);
      expect(made[0]?.fills[0]).toEqual([0, 0, 1920, 1280]);
    } finally {
      document.createElement = real;
    }
  });

  it('draws a rectangle and skips an image when there is no picture', () => {
    const { ops, ctx } = recorder();
    drawElements(ctx, [
      { kind: 'rect', x0: 4, y0: 8, x1: 9, y1: 9 },
      { kind: 'image', x: 0, y: 0, w: 10, h: 10 },
    ], metrics, null, 100, 80);
    expect(ops.map(o => o.op)).toEqual(['fillRect', 'fillRect']);
    expect(ops[0]?.args).toEqual([0, 0, 100, 80]);
    expect(ops[1]?.args).toEqual([4, 8, 6, 2]);
  });
});
