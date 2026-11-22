import { describe, expect, it } from 'vitest';
import { curlGeometry, raspberryOffsets, rosetteGeometry } from './cakeDecor';
import { rng } from './cakeTextures';
import type { Three } from './cake3dScene';

// The real three: geometry needs no graphics card.
const lib = (await import('./threeParts')) as Three;

describe('a piped rosette', () => {
  const geometry = rosetteGeometry(lib);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  it('stands on y = 0, about 1.9 cm high and 2.5 cm wide', () => {
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.9, 2);
    const width = box.max.x - box.min.x;
    expect(width).toBeGreaterThan(2.3);
    expect(width).toBeLessThan(3);
  });
  it('is centred on its axis', () => {
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.4);
    expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(0.4);
  });
  it('has finite normals (a NaN would paint it black)', () => {
    const normal = geometry.attributes.normal!;
    for (let i = 0; i < normal.count; i += 1) expect(Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i))).toBe(true);
  });
});

describe('the drupelets of a raspberry', () => {
  it('are the same number every time, whatever the random', () => {
    expect(raspberryOffsets(lib, rng(1)).length).toBe(raspberryOffsets(lib, rng(99)).length);
    expect(raspberryOffsets(lib, rng(1)).length).toBeGreaterThan(30);
  });
  it('stay within about 0.9 cm of each other, round the middle', () => {
    for (const offset of raspberryOffsets(lib, rng(5))) {
      expect(Math.hypot(offset.x, offset.z)).toBeLessThanOrEqual(0.43);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('a chocolate curl', () => {
  it('is as long as asked (plus its own thickness), winding along z', () => {
    const geometry = curlGeometry(lib, 3, 3.6);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.z - box.min.z).toBeGreaterThan(2.9);
    expect(box.max.z - box.min.z).toBeLessThan(3.4);
    expect(box.max.x - box.min.x).toBeLessThan(1.1);
  });
});
