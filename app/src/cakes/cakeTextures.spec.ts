import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextures, rng } from './cakeTextures';
import type { Three } from './cake3dScene';

// A texture that only counts: the real one needs a graphics card to be uploaded, and nothing here does.
class FakeTexture {
  static made: FakeTexture[] = [];
  colorSpace = '';
  wrapS = 0;
  wrapT = 0;
  anisotropy = 1;
  repeat = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } };
  disposed = 0;
  constructor(public image: HTMLCanvasElement) { FakeTexture.made.push(this); }
  dispose() { this.disposed += 1; }
}

const lib = { CanvasTexture: FakeTexture, SRGBColorSpace: 'srgb', RepeatWrapping: 1000 } as unknown as Three;

beforeEach(() => {
  FakeTexture.made = [];
  // The painting already tolerates a canvas with no 2D context (a phone that refuses one): jsdom has none either.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('the textures of the realistic cake', () => {
  it('a texture the next build does not ask for is freed by sweep(), exactly once', () => {
    const textures = createTextures(lib);
    const sponge = textures.sponge('#ecca8a');
    const cream = textures.cream('#f6eedd', true);
    // The first build ends: nothing is freed, both were asked for.
    textures.sweep();
    expect(FakeTexture.made.every(texture => texture.disposed === 0)).toBe(true);
    // The next build asks for the sponge only.
    textures.sponge('#ecca8a');
    textures.sweep();
    expect((sponge.map as unknown as FakeTexture).disposed).toBe(0);
    expect((sponge.bump as unknown as FakeTexture).disposed).toBe(0);
    expect((cream.map as unknown as FakeTexture).disposed).toBe(1);
    expect((cream.bump as unknown as FakeTexture).disposed).toBe(1);
    // A later sweep never frees the same texture again.
    textures.sponge('#ecca8a');
    textures.sweep();
    textures.sponge('#ecca8a');
    textures.sweep();
    expect((cream.map as unknown as FakeTexture).disposed).toBe(1);
    expect((cream.bump as unknown as FakeTexture).disposed).toBe(1);
  });

  it('a texture asked for again is reused, not made again', () => {
    const textures = createTextures(lib);
    const first = textures.sponge('#ecca8a', 6, 1);
    const made = FakeTexture.made.length;
    expect(textures.sponge('#ecca8a', 6, 1)).toBe(first);
    expect(FakeTexture.made).toHaveLength(made);
    // It survives the sweep that follows a build that asked for it, build after build.
    for (let build = 0; build < 3; build += 1) {
      textures.sweep();
      expect(textures.sponge('#ecca8a', 6, 1)).toBe(first);
    }
    expect(FakeTexture.made).toHaveLength(made);
    expect((first.map as unknown as FakeTexture).disposed).toBe(0);
  });

  it('the same picture repeated another way is a new texture on the same canvas', () => {
    const textures = createTextures(lib);
    const face = textures.sponge('#ecca8a');
    const side = textures.sponge('#ecca8a', 6, 1);
    expect(side).not.toBe(face);
    expect(side.map.image).toBe(face.map.image);
    expect(side.map.repeat.x).toBe(6);
    expect(face.map.repeat.x).toBe(1);
    expect(face.map.colorSpace).toBe('srgb');
    // The colour map and the relief map are the same picture, read twice.
    expect(face.bump.image).toBe(face.map.image);
    // A different colour is a different picture.
    expect(textures.sponge('#7a4c30').map.image).not.toBe(face.map.image);
  });

  it('dispose() frees every texture, and asking afterwards makes a new one', () => {
    const textures = createTextures(lib);
    const set = [textures.sponge('#ecca8a'), textures.cream('#f6eedd', false), textures.coat('#3a1d12')];
    textures.sweep();
    textures.dispose();
    expect(FakeTexture.made).toHaveLength(6);
    for (const texture of FakeTexture.made) expect(texture.disposed).toBe(1);
    const again = textures.sponge('#ecca8a');
    expect(again).not.toBe(set[0]);
    // Two more: the colour map and the relief map.
    expect(FakeTexture.made).toHaveLength(8);
  });
});

describe('the repeatable random', () => {
  it('gives the same numbers for the same seed, all between 0 and 1', () => {
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 50; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(rng(8)()).not.toBe(rng(7)());
  });
});
