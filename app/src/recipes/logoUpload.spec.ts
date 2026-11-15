import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOGO_W } from '@mise/shared/label-image-layout';
import type { GreyImage } from '@mise/shared/label-image-raster';
import { LogoError, logoFromGrey, logoHeightFor, prepareLogo, pythonRound } from './logoUpload';

const grey = (width: number, height: number, fill: (x: number, y: number) => number): GreyImage => {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y);
  return { width, height, data };
};

describe('pythonRound', () => {
  it('rounds a half to the even neighbour, like Python 3', () => {
    expect(pythonRound(2.5)).toBe(2);
    expect(pythonRound(3.5)).toBe(4);
    expect(pythonRound(2.4999)).toBe(2);
    expect(pythonRound(2.5001)).toBe(3);
    expect(Math.abs(pythonRound(-0.5))).toBe(0);
    expect(pythonRound(-1.5)).toBe(-2);
  });
});

describe('logoFromGrey', () => {
  it('calls a blank picture blank', () => {
    expect(logoFromGrey(grey(20, 20, () => 255))).toBe('blank');
  });

  it('cuts to the ink and comes out LOGO_W wide', () => {
    // Ink 40 × 10 inside a white field: 1320 / 40 × 10 = 330.
    const result = logoFromGrey(grey(100, 80, (x, y) => (x >= 20 && x < 60 && y >= 30 && y < 40 ? 0 : 255)));
    if (typeof result === 'string') throw new Error(result);
    expect(result.width).toBe(LOGO_W);
    expect(result.height).toBe(330);
  });

  it('takes the half-even height when the ratio ends in a half', () => {
    // 5 rows of 2640 pixels: 5 × 1320 / 2640 = 2.5, which Python rounds to 2 (Math.round would say 3).
    const result = logoFromGrey(grey(2640, 5, () => 0));
    if (typeof result === 'string') throw new Error(result);
    expect(result.height).toBe(2);
  });

  it('computes the height the script would, 0 for a hair-thin picture', () => {
    expect(logoHeightFor(40, 10)).toBe(330);
    expect(logoHeightFor(3000, 1)).toBe(0);
    expect(logoHeightFor(2640, 5)).toBe(2);
  });

  it('calls a picture that rounds to no height blank, not too big', () => {
    expect(logoFromGrey(grey(3000, 1, () => 0))).toBe('blank');
  });

  it('refuses a logo taller than the label', () => {
    expect(logoFromGrey(grey(10, 40, () => 0))).toBe('too-tall');
  });
});

describe('prepareLogo', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('says undecodable when the browser cannot decode images', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(prepareLogo(new Blob(['x']))).rejects.toMatchObject({ code: 'undecodable' });
  });

  it('says undecodable when the decoder fails', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('bad')));
    const error = await prepareLogo(new Blob(['x'])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LogoError);
    expect((error as LogoError).code).toBe('undecodable');
  });

  it('says too-big for a photograph-sized picture, and lets the bitmap go', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 7000, height: 100, close }));
    await expect(prepareLogo(new Blob(['x']))).rejects.toMatchObject({ code: 'too-big' });
    expect(close).toHaveBeenCalled();
  });
});
