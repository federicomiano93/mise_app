import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64Of } from '@mise/shared/photo-model';
import { PhotoImageError, shrinkPhoto } from './photoImage';

// The DOM half of a photograph: decode with the EXIF flag honoured, draw at most 1568 px on the long edge (never larger than
// the photo), JPEG at 0.82 and at 0.7 BEFORE the size drops when it is over 2 MB. jsdom has no canvas and no createImageBitmap,
// so both are stubbed here and the spec reads what they were asked.

type Drawn = { width: number; height: number; quality: number };

function stubDevice({ width = 4032, height = 3024, weigh = (_quality: number): number => 1000, bitmapFails = false } = {}) {
  const close = vi.fn();
  const create = vi.fn(async (_file: Blob, _options?: ImageBitmapOptions) => {
    if (bitmapFails) throw new Error('cannot decode');
    return { width, height, close } as unknown as ImageBitmap;
  });
  vi.stubGlobal('createImageBitmap', create);
  const draws: Array<[number, number]> = [];
  const dataUrls: Drawn[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    drawImage: (_bitmap: unknown, _x: number, _y: number, w: number, h: number) => { draws.push([w, h]); },
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function toDataURL(this: HTMLCanvasElement, _type?: string, quality?: unknown) {
    dataUrls.push({ width: this.width, height: this.height, quality: Number(quality) });
    return `data:image/jpeg;base64,${'A'.repeat(weigh(Number(quality)))}`;
  });
  return { create, close, draws, dataUrls };
}

const FILE = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shrinkPhoto', () => {
  it('decodes with the EXIF rotation honoured, handing the File itself (no blob: URL is ever made)', async () => {
    const device = stubDevice();
    await shrinkPhoto(FILE);
    expect(device.create).toHaveBeenCalledWith(FILE, { imageOrientation: 'from-image' });
  });

  it('draws at most 1568 px on the long edge, the aspect kept, and gives back a JPEG data URL', async () => {
    const device = stubDevice({ width: 4032, height: 3024 });
    const url = await shrinkPhoto(FILE);
    expect(device.draws).toEqual([[1568, 1176]]);
    expect(device.dataUrls[0]).toEqual({ width: 1568, height: 1176, quality: 0.82 });
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(device.close).toHaveBeenCalledTimes(1);
  });

  it('a portrait photo is limited on its height', async () => {
    const device = stubDevice({ width: 3024, height: 4032 });
    await shrinkPhoto(FILE);
    expect(device.draws).toEqual([[1176, 1568]]);
  });

  it('⚠️ never upscales a small photo', async () => {
    const device = stubDevice({ width: 800, height: 600 });
    await shrinkPhoto(FILE);
    expect(device.draws).toEqual([[800, 600]]);
  });

  it('⚠️ over 2 MB, the QUALITY drops to 0.7 before anything else — the picture keeps its size', async () => {
    const device = stubDevice({ weigh: quality => (quality === 0.82 ? 3_000_000 : 1000) });
    const url = await shrinkPhoto(FILE);
    expect(device.dataUrls.map(drawn => drawn.quality)).toEqual([0.82, 0.7]);
    expect(device.dataUrls[1]).toMatchObject({ width: 1568, height: 1176 });
    expect(base64Of(url).length).toBe(1000);
  });

  it('under 2 MB it is drawn once', async () => {
    const device = stubDevice({ weigh: () => 2_000_000 });
    await shrinkPhoto(FILE);
    expect(device.dataUrls).toHaveLength(1);
  });

  it('⚠️ Chrome 101 refuses the word «from-image» (TypeError): decoded again with its own default, which honours EXIF', async () => {
    const device = stubDevice({ width: 3024, height: 4032 });
    const create = vi.fn(async (file: Blob, options?: ImageBitmapOptions) => {
      if (options?.imageOrientation === 'from-image') throw new TypeError("The provided value 'from-image' is not a valid enum value of type ImageOrientation.");
      return device.create(file, options);
    });
    vi.stubGlobal('createImageBitmap', create);
    const url = await shrinkPhoto(FILE);
    expect(create.mock.calls).toEqual([[FILE, { imageOrientation: 'from-image' }], [FILE]]);
    expect(device.draws).toEqual([[1176, 1568]]);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('a photo that truly cannot be decoded (DOMException) is NOT tried again', async () => {
    const create = vi.fn(async () => { throw new DOMException('The source image could not be decoded.', 'InvalidStateError'); });
    stubDevice();
    vi.stubGlobal('createImageBitmap', create);
    await expect(shrinkPhoto(FILE)).rejects.toMatchObject({ code: 'undecodable' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('a file the browser cannot decode (HEIC from the library) is «undecodable»', async () => {
    stubDevice({ bitmapFails: true });
    await expect(shrinkPhoto(FILE)).rejects.toMatchObject({ code: 'undecodable' });
  });

  it('a photograph of no size is «undecodable», and its bitmap is released', async () => {
    const device = stubDevice({ width: 0, height: 0 });
    await expect(shrinkPhoto(FILE)).rejects.toMatchObject({ code: 'undecodable' });
    expect(device.close).toHaveBeenCalledTimes(1);
  });

  it('a canvas that cannot be had, or draws nothing, is «bad-image»', async () => {
    stubDevice();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    await expect(shrinkPhoto(FILE)).rejects.toMatchObject({ code: 'bad-image' });
    vi.restoreAllMocks();
    stubDevice();
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:,');
    await expect(shrinkPhoto(FILE)).rejects.toBeInstanceOf(PhotoImageError);
  });

  it('a browser without createImageBitmap says «could not be prepared», not a format problem', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(shrinkPhoto(FILE)).rejects.toMatchObject({ code: 'bad-image' });
  });

  it('a drawing that throws is «bad-image» and the bitmap is still released', async () => {
    const device = stubDevice();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      drawImage: () => { throw new Error('out of memory'); },
    }) as unknown as CanvasRenderingContext2D);
    await expect(shrinkPhoto(FILE)).rejects.toMatchObject({ code: 'bad-image' });
    expect(device.close).toHaveBeenCalledTimes(1);
  });
});
