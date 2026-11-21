// cakeDecor.ts — the shapes of what stands on a realistic cake (a piped rosette, a raspberry's drupelets, a chocolate curl), ported from
// the approved mockup (docs/mockups/cakes-rework/realistic-cake.html). Geometry only: the scene (cake3dScene.ts) places and paints them.
// three arrives as an argument, as everywhere in the 3D view (threeParts.ts); only types are imported.

import type * as T from 'three';
import type { Three } from './cake3dScene';

// A piped rosette: an 8-lobed, twisted lathe about 2.5 cm wide and 1.9 cm high, standing on y = 0. Segments are kept low: the cake draws
// a dozen of them and they are tested by every pick.
export function rosetteGeometry(lib: Three): T.BufferGeometry {
  const points = [new lib.Vector2(0.001, 0)];
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    points.push(new lib.Vector2(Math.max(0.001, 1.25 * Math.pow(Math.cos((t * Math.PI) / 2), 0.55)), 1.9 * t));
  }
  const geometry = new lib.LatheGeometry(points, 64);
  const position = geometry.attributes.position;
  if (!position) return geometry;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(x, z);
    const f = 1 + 0.16 * Math.sin(8 * angle + y * 3.4);
    position.setXYZ(i, x * f, y, z * f);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// The drupelets of one raspberry (about 0.9 cm across), as offsets from its middle: rings of little spheres on a rounded cone.
export function raspberryOffsets(lib: Three, random: () => number): T.Vector3[] {
  const offsets: T.Vector3[] = [];
  for (let i = 0; i < 7; i += 1) {
    const phi = 0.35 + i * 0.42;
    const ring = 0.42 * Math.sin(phi);
    const y = -0.5 * Math.cos(phi);
    const n = Math.max(4, Math.round(ring * 17));
    for (let k = 0; k < n; k += 1) {
      const angle = (k / n) * Math.PI * 2 + i * 0.4 + random() * 0.2;
      offsets.push(new lib.Vector3(Math.sin(angle) * ring, y, Math.cos(angle) * ring));
    }
  }
  return offsets;
}

// A chocolate curl: a tube winding `turns` times along z, `length` long. Few segments: it is small, and picked.
export function curlGeometry(lib: Three, length: number, turns: number): T.BufferGeometry {
  const points: T.Vector3[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    const angle = t * Math.PI * 2 * turns;
    points.push(new lib.Vector3(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, (t - 0.5) * length));
  }
  return new lib.TubeGeometry(new lib.CatmullRomCurve3(points), 64, 0.13, 6, false);
}
