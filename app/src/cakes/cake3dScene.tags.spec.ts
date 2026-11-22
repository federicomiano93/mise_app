import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import type * as T from 'three';
import { CUT_ANGLE, cakeLayout, pickedPart } from './cake3dModel';
import { createCakeScene } from './cake3dScene';
import type { Three } from './cake3dScene';
import { PLAIN_LOOK } from './cakeLook';
import type { DecorationKind, TierLook } from './cakeLook';

// The scene needs a graphics card only to DRAW. Its meshes are made on the processor, so with a renderer that draws nothing the whole
// build runs here, and the cake it makes can be walked.
const real = (await import('./threeParts')) as Three;

let seen: T.Scene | null = null;

class FakeRenderer {
  shadowMap = { enabled: false, type: 0 };
  toneMapping = 0;
  toneMappingExposure = 1;
  outputColorSpace = '';
  setPixelRatio() { /* nothing to draw on */ }
  setSize() { /* nothing to draw on */ }
  render() { /* nothing to draw on */ }
  dispose() { /* nothing held */ }
  forceContextLoss() { /* nothing held */ }
}
class FakePmrem {
  static made = 0;
  static fail = false;
  fromScene() {
    if (FakePmrem.fail) throw new Error('no half-float targets');
    FakePmrem.made += 1;
    return { texture: {}, dispose() { /* nothing held */ } };
  }
  dispose() { /* nothing held */ }
}
class FakeRoom { dispose() { /* nothing held */ } }
class SpyScene extends real.Scene {
  constructor() { super(); seen = this; }
}

const lib = { ...real, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePmrem, RoomEnvironment: FakeRoom, Scene: SpyScene } as unknown as Three;

const css = {
  base: '#e8c98f', soak: '#c9a36b', filling: '#f3e6c4', coating: '#f6eedd', decoration: '#b03a4a', board: '#d9d2c4',
  accent: '#285cc2', ground: '#8899aa', stageCenter: '#c9d1d9', stageEdge: '#6f7c8a', glow: '#ffffff',
};
const hooks = { onMoving() { /* unused */ }, onRest() { /* unused */ }, onTap() { /* unused */ }, onHover() { /* unused */ }, onGaveUp() { /* unused */ } };

const CAKE: Cake = {
  id: 'c1', name: 'Two tiers', diameterCm: 24, tiers: 2, discs: 3, slices: 12,
  lines: [
    { tier: 0, part: 'base', productId: 'A', grams: null },
    { tier: 0, part: 'soak', productId: 'B', grams: null },
    { tier: 0, part: 'filling', productId: 'C', grams: null },
    { tier: 0, part: 'coating', productId: 'D', grams: null },
    { tier: 0, part: 'decoration', productId: 'E', grams: null },
    { tier: 1, part: 'base', productId: 'A', grams: null },
    { tier: 1, part: 'coating', productId: 'D', grams: null },
    { tier: 1, part: 'decoration', productId: 'E', grams: null },
  ],
  packaging: [], assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, ref: null, model: 1,
};
const layout = cakeLayout(cakeGeometry(CAKE));
const KINDS: DecorationKind[] = ['plain', 'berries', 'blueberries', 'curls', 'grains', 'rosettes'];
const PARTS = ['base', 'soak', 'filling', 'coating', 'decoration'];

const looksOf = (kind: DecorationKind): TierLook[] => layout.tiers.map(() => ({
  ...PLAIN_LOOK,
  coating: { colour: '#3a1d12', glaze: true },
  decoration: { kind, colour: kind === 'plain' ? null : '#d9566e' },
}));

function meshesOfTheCake(): T.Mesh[] {
  const scene = seen!;
  const group = scene.children.find(child => (child as T.Group).isGroup);
  const found: T.Mesh[] = [];
  group?.traverse(object => { if ((object as T.Mesh).isMesh) found.push(object as T.Mesh); });
  return found;
}

let scene: ReturnType<typeof createCakeScene> | null = null;

beforeEach(() => {
  seen = null;
  FakePmrem.made = 0;
  FakePmrem.fail = false;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  scene?.dispose();
  scene = null;
  vi.restoreAllMocks();
});

describe('every mesh the scene adds carries the tag a tap reads', () => {
  for (const view of ['whole', 'cut'] as const) {
    for (const kind of KINDS) {
      it(`${view}, decoration «${kind}»: only the plate and the boards between tiers are untagged, and a pick finds the tag`, () => {
        scene = createCakeScene(lib, document.createElement('canvas'), css, hooks);
        scene.build(layout, view, looksOf(kind));
        const meshes = meshesOfTheCake();
        expect(meshes.length).toBeGreaterThan(10);
        const untagged = meshes.filter(mesh => typeof (mesh.userData as { tier?: unknown }).tier !== 'number');
        // The plate (one lathe) and the board under the upper tier (a cylinder, and the two faces of the cut).
        expect(untagged).toHaveLength(view === 'whole' ? 2 : 4);
        for (const mesh of meshes.filter(candidate => !untagged.includes(candidate))) {
          const data = mesh.userData as { tier: number; part: string };
          expect(PARTS).toContain(data.part);
          expect(pickedPart([{ object: mesh }])).toEqual({ tier: data.tier, part: data.part });
        }
        for (const tier of layout.tiers) {
          expect(meshes.some(mesh => (mesh.userData as { tier?: number; part?: string }).tier === tier.index && (mesh.userData as { part?: string }).part === 'decoration')).toBe(true);
        }
        // Tapping a board picks nothing.
        for (const mesh of untagged) expect(pickedPart([{ object: mesh }])).toBeNull();
      });
    }
  }
});

describe('the cut-away leaves nothing standing over the removed slice', () => {
  for (const kind of KINDS) {
    it(`decoration «${kind}»: no piece sits on the axis or inside the wedge`, () => {
      scene = createCakeScene(lib, document.createElement('canvas'), css, hooks);
      scene.build(layout, 'cut', looksOf(kind));
      const pieces = meshesOfTheCake().filter(mesh => {
        const data = mesh.userData as { part?: string };
        return data.part === 'decoration' && !(mesh as unknown as T.InstancedMesh).isInstancedMesh;
      });
      for (const piece of pieces) {
        const { x, z } = piece.position;
        // A piece that has a position of its own (the instanced ones carry theirs in their matrices).
        if (x === 0 && z === 0 && piece.position.y === 0) continue;
        expect(Math.hypot(x, z)).toBeGreaterThan(0.3);
        expect(Math.abs(Math.atan2(x, z))).toBeGreaterThanOrEqual(CUT_ANGLE / 2);
      }
    });
  }
});

describe('the studio reflections', () => {
  const skyOf = () => (seen!.children.find(child => (child as T.HemisphereLight).isHemisphereLight) as T.HemisphereLight).intensity;

  it('are made again when the graphics context comes back (a lost context empties them)', () => {
    const canvas = document.createElement('canvas');
    scene = createCakeScene(lib, canvas, css, hooks);
    expect(FakePmrem.made).toBe(1);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(FakePmrem.made).toBe(2);
  });

  it('where they cannot be made the hemisphere light is raised, so the cake is not darker', () => {
    scene = createCakeScene(lib, document.createElement('canvas'), css, hooks);
    const withMap = skyOf();
    scene.dispose();
    FakePmrem.fail = true;
    scene = createCakeScene(lib, document.createElement('canvas'), css, hooks);
    expect(skyOf()).toBeGreaterThan(withMap);
  });
});
