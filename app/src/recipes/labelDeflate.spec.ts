import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageLabelZpl, readZ64 } from '@mise/shared/zpl-z64';
import { toBitmap } from '@mise/shared/label-image-raster';
import { browserDeflate, browserInflate } from './labelDeflate';

// The browser's own compression, as Node provides the same streams.

describe('labelDeflate', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('writes the zlib format (first byte 0x78)', async () => {
    const out = await browserDeflate(new Uint8Array(1000));
    expect(out[0]).toBe(0x78);
    expect(out.length).toBeLessThan(100);
  });

  it('round-trips a job through the Z64 field', async () => {
    const data = new Uint8Array(640 * 480);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 5 === 0 ? 0 : 255;
    const bitmap = toBitmap({ width: 640, height: 480, data });
    const zpl = await imageLabelZpl(bitmap, { copies: 1, rotate180: true }, browserDeflate);
    const field = /\^GFA,\d+,\d+,\d+,(:Z64:[^^]+)\^FS/.exec(zpl)?.[1] as string;
    const back = await readZ64(field, browserInflate);
    expect(back).not.toBeNull();
    expect(Array.from(back as Uint8Array)).toEqual(Array.from(bitmap.bits));
  });

  it('says no-compression when the browser has no CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    await expect(browserDeflate(new Uint8Array(4))).rejects.toThrow('no-compression');
  });
});
