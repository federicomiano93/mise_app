// The image label's pixels: Pillow's Lanczos and autocontrast, value for value (fixtures/label-image-resample.json,
// recorded from Pillow 12 by the golden harness on small fixed pictures), and the 1-bit rows a Zebra prints.

import { describe, expect, test } from 'vitest';
import resampleText from './fixtures/label-image-resample.json?raw';
import {
  autocontrast, bitmapHex, cropToInk, dotIsBlack, greyFromRgba, resizeLanczos, toBitmap,
} from './label-image-raster';

interface Case { w: number; h: number; in: number[]; ow: number; oh: number; out: number[] }
const fixture = JSON.parse(resampleText) as { lanczos: Case[]; autocontrast: { w: number; h: number; in: number[]; out: number[] } };

describe('Pillow’s resize, exactly', () => {
  test.each(fixture.lanczos.map(c => [`${c.w}×${c.h} → ${c.ow}×${c.oh}`, c] as const))('%s', (_name, c) => {
    const out = resizeLanczos({ width: c.w, height: c.h, data: Uint8Array.from(c.in) }, c.ow, c.oh);
    expect([out.width, out.height]).toEqual([c.ow, c.oh]);
    expect([...out.data]).toEqual(c.out);
  });

  test('autocontrast stretches the darkest to black and the lightest to white, as Pillow', () => {
    const a = fixture.autocontrast;
    expect([...autocontrast({ width: a.w, height: a.h, data: Uint8Array.from(a.in) }).data]).toEqual(a.out);
  });

  test('a flat picture is left alone', () => {
    const flat = { width: 2, height: 1, data: Uint8Array.from([128, 128]) };
    expect(autocontrast(flat)).toBe(flat);
  });
});

describe('from the canvas to dots', () => {
  test('grey is Pillow’s «L», and a see-through pixel is laid on white (never black)', () => {
    const g = greyFromRgba(Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0, 10, 20, 30, 255]), 3, 1);
    expect([...g.data]).toEqual([76, 255, 18]);
  });

  test('crop to ink, and nothing for a white picture', () => {
    const img = { width: 4, height: 3, data: Uint8Array.from([255, 255, 255, 255, 255, 0, 10, 255, 255, 255, 255, 255]) };
    expect(cropToInk(img)).toEqual({ width: 2, height: 1, data: Uint8Array.from([0, 10]) });
    expect(cropToInk({ width: 1, height: 1, data: Uint8Array.from([255]) })).toBeNull();
  });

  test('under 150 is black; eight dots to a byte, the leftmost in the high bit, rows padded', () => {
    const img = { width: 10, height: 2, data: Uint8Array.from([0, 149, 150, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]) };
    const b = toBitmap(img);
    expect(b.bytesPerRow).toBe(2);
    expect(bitmapHex(b)).toBe('CFC0' + '0040');
    expect(dotIsBlack(b, 1, 0)).toBe(true);
    expect(dotIsBlack(b, 2, 0)).toBe(false);
    expect(dotIsBlack(b, 9, 1)).toBe(true);
  });
});
