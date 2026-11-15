// The browser half of the order picture (orderImage.ts): whether this browser can share a picture, and what a share() result
// means. Ported from tests/order-image.test.mjs (the canSharePhotos and sharePhoto tests); the layout half is
// shared/src/order-image.spec.ts.

import { describe, expect, it, vi } from 'vitest';
import { canSharePhotos, sharePhoto } from './orderImage';

const probe = () => new File([], 'probe.png');
const file = new File(['x'], 'order.png', { type: 'image/png' });
const named = (name: string) => Object.assign(new Error('x'), { name });

describe('canSharePhotos', () => {
  const nav = (over: object) => over as Pick<Navigator, 'share' | 'canShare'>;

  it('is true only with canShare AND share, and canShare saying yes', () => {
    const canShare = vi.fn(() => true);
    expect(canSharePhotos(nav({ canShare, share: () => Promise.resolve() }), probe)).toBe(true);
    // It asked about a file, not about nothing.
    expect(canShare).toHaveBeenCalledWith({ files: [expect.any(File)] });
  });

  it('is false with no navigator at all', () => {
    expect(canSharePhotos(null, probe)).toBe(false);
    expect(canSharePhotos(undefined, probe)).toBe(false);
  });

  it('is false without canShare', () => {
    expect(canSharePhotos(nav({ share: () => Promise.resolve() }), probe)).toBe(false);
  });

  it('is false without share', () => {
    expect(canSharePhotos(nav({ canShare: () => true }), probe)).toBe(false);
  });

  it('is false when canShare says no', () => {
    expect(canSharePhotos(nav({ canShare: () => false, share: () => Promise.resolve() }), probe)).toBe(false);
  });

  it('is false when canShare throws', () => {
    expect(canSharePhotos(nav({ canShare: () => { throw new Error('x'); }, share: () => Promise.resolve() }), probe)).toBe(false);
  });
});

describe('sharePhoto', () => {
  it('a resolved share is «shared», and hands the file to the sheet', async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await sharePhoto(file, { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file] });
  });

  it('an AbortError (the person closed the sheet) is «cancelled»', async () => {
    expect(await sharePhoto(file, { share: () => Promise.reject(named('AbortError')) })).toBe('cancelled');
  });

  it('any other error is «failed»', async () => {
    expect(await sharePhoto(file, { share: () => Promise.reject(named('NotAllowedError')) })).toBe('failed');
    expect(await sharePhoto(file, { share: () => Promise.reject(new Error('plain')) })).toBe('failed');
    expect(await sharePhoto(file, { share: () => Promise.reject(null) })).toBe('failed');
  });
});
