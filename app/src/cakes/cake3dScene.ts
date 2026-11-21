// cake3dScene.ts — the IMPURE half of the cake's 3D view: turns a CakeLayout (cake3dModel.ts) into three.js meshes, draws on demand,
// and answers where a point of the cake is on the screen and which part is under a pointer.
//
// ⚠️ THREE IS NEVER IMPORTED HERE (threeLoading.spec.ts): the library (threeParts.ts: the few classes this file uses and the orbit
// controls) arrives as an argument, loaded by Cake3D.tsx with import(), so it stays in a chunk of its own that nobody downloads until a
// cake editor shows the 3D. Only TYPES are imported.
//
// ⚠️ RESOURCES. One renderer per scene; `dispose()` frees every geometry, material, the renderer's context and every listener.
// It draws ON DEMAND (when something changed or the camera is moving) and not at all while the tab is hidden.

import type * as T from 'three';
import type { CakePart } from '@mise/shared/cake-model';
import type { Selected } from './cakeEditorModel';
import {
  BOARD_THICKNESS_CM, COATING_CM, CUT_ANGLE, TIER_BOARD_CM, CAMERA_FOV_DEG, appearedParts, homeView, partAnchors, pickedPart,
} from './cake3dModel';
import type { Anchor, CakeLayout, StageView, TierLayout } from './cake3dModel';

export type Three = typeof import('./threeParts');

// The colours of the scene, as CSS values read from the tokens (Cake3D reads them with getComputedStyle, never typed here).
export interface SceneColours {
  base: string; soak: string; filling: string; coating: string; decoration: string; board: string;
  accent: string; backdrop: string; ground: string;
  // The hover glow (a light surface colour).
  glow: string;
}

export interface SceneHooks {
  // The camera started or stopped moving (the labels hide while it does).
  onMoving: (moving: boolean) => void;
  // It has been still for a moment: the labels may be placed again.
  onRest: () => void;
  onTap: (picked: Selected | null) => void;
  onHover: (hovered: Selected | null) => void;
  // The graphics context was lost and did not come back in time: the scene cannot draw any more.
  onGaveUp: () => void;
}

export interface CakeScene {
  build: (layout: CakeLayout, view: StageView) => void;
  setSelection: (selected: Selected | null) => void;
  resize: (width: number, height: number, share: number, centre: number) => void;
  goHome: () => void;
  // The screen position (px, in the stage) of the chosen tier's parts that can be seen from where the camera is.
  anchors: (tier: number) => Anchor[];
  dispose: () => void;
}

// The colour a CSS value stands for, as sRGB 0..255, by asking a canvas (it parses oklch and var() results alike). A value the canvas
// cannot read leaves its fill at the sentinel, and then there is no colour (null: the caller uses its grey).
const SENTINEL: readonly [number, number, number] = [1, 2, 3];
export function resolveCss(value: string, doc: Document = document): [number, number, number] | null {
  const context = doc.createElement('canvas').getContext('2d');
  if (!context || value.trim() === '') return null;
  context.fillStyle = '#010203';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  const rgb: [number, number, number] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  return rgb[0] === SENTINEL[0] && rgb[1] === SENTINEL[1] && rgb[2] === SENTINEL[2] ? null : rgb;
}

const SEGMENTS = 96;
// The wedge cut out of «Spaccato», and the smallest move that is a drag and not a tap.
const TAP_SLOP_PX = 6;
const REST_MS = 140;
// How long a lost graphics context may stay lost before the 3D is given up.
const CONTEXT_GRACE_MS = 2000;
const FLIGHT_MS = 700;

// The base's discs while the base has no card: drawn faint, so the person can count them while setting the measures.
const GHOST_OPACITY = 0.3;
// How far a disc or a berry drops from when it lands.
const DROP_CM = 16;
const BERRY_DROP_CM = 12;

// A piece of the cake an intro moves: the meshes that make it (a layer is its cylinder and the two faces of the cut), where each one
// stands when the cake is at rest, and the height of its underside (what it grows up from).
interface Unit { objects: T.Object3D[]; ys: number[]; bottom: number }
type Role = 'layer' | 'skin' | 'top' | 'berry';
interface Tween { start: number; ms: number; curve: (k: number) => number; fn: (k: number) => void }

const easeOut = (k: number) => 1 - (1 - k) ** 3;
// A drop that lands and bounces: 0 at the start, 1 at the end, never above 1.
function bounce(k: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) { const x = k - 1.5 / d; return n * x * x + 0.75; }
  if (k < 2.5 / d) { const x = k - 2.25 / d; return n * x * x + 0.9375; }
  const x = k - 2.625 / d;
  return Math.min(1, n * x * x + 0.984375);
}

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Tag = { tier: number; part: CakePart };
const tagKey = (tag: Tag) => `${String(tag.tier)}|${tag.part}`;

// ⚠️ A SCENE THAT FAILS HALF WAY GIVES THE CONTEXT BACK: the renderer already holds a WebGL context (browsers allow a handful), so a throw
// after it is made frees it before the error goes on.
export function createCakeScene(lib: Three, canvas: HTMLCanvasElement, css: SceneColours, hooks: SceneHooks): CakeScene {
  const renderer = new lib.WebGLRenderer({ canvas, antialias: true });
  try {
    return assemble(lib, renderer, canvas, css, hooks);
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
}

function assemble(lib: Three, renderer: T.WebGLRenderer, canvas: HTMLCanvasElement, css: SceneColours, hooks: SceneHooks): CakeScene {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = lib.PCFSoftShadowMap;
  renderer.toneMapping = lib.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = lib.SRGBColorSpace;

  const colourOf = (value: string): T.Color => {
    const rgb = resolveCss(value);
    const colour = new lib.Color();
    if (rgb) colour.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, lib.SRGBColorSpace);
    else colour.setRGB(0.8, 0.8, 0.8);
    return colour;
  };
  const palette = {
    base: colourOf(css.base), soak: colourOf(css.soak), filling: colourOf(css.filling), coating: colourOf(css.coating),
    decoration: colourOf(css.decoration), board: colourOf(css.board), accent: colourOf(css.accent),
    backdrop: colourOf(css.backdrop), ground: colourOf(css.ground), glow: colourOf(css.glow),
  };

  const scene = new lib.Scene();
  scene.background = palette.backdrop;
  const camera = new lib.PerspectiveCamera(CAMERA_FOV_DEG, 1, 1, 600);
  const controls = new lib.OrbitControls(camera, canvas);
  // ⚠️ ON A TOUCH SCREEN ONE FINGER SCROLLS THE PAGE (the editor is long), two fingers turn and zoom the cake: with ONE left unset the
  // controls ignore a single finger, and `pan-y` (set after the controls, which write `none`) lets the browser scroll. A tap still picks.
  controls.touches = { ONE: null, TWO: lib.TOUCH.DOLLY_ROTATE };
  canvas.style.touchAction = 'pan-y';
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enablePan = false;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.4;

  // The lights are white on purpose: they are light, not a colour of the design.
  scene.add(new lib.HemisphereLight(0xffffff, palette.ground, 1.5));
  const sun = new lib.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-26, 52, 34);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 160 });
  scene.add(sun);
  const ground = new lib.Mesh(new lib.CircleGeometry(220, 64), new lib.MeshStandardMaterial({ color: palette.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -BOARD_THICKNESS_CM - 0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── The cake ──────────────────────────────────────────────────────────────
  let cake: T.Group | null = null;
  let layoutNow: CakeLayout | null = null;
  let viewNow: StageView = 'cut';
  const materialsOf = new Map<string, T.MeshStandardMaterial[]>();
  // What an intro moves: the units of each part (a layer, the coating's skin and top, a berry), and every mesh of each tier (when the
  // tier below grows, the ones above ride up).
  let units = new Map<string, (Unit & { role: Role })[]>();
  let tierUnits = new Map<number, Unit>();
  let tweens: Tween[] = [];
  let selectedNow: Selected | null = null;
  let hoveredNow: Selected | null = null;

  const material = (colour: T.Color, extra: T.MeshStandardMaterialParameters = {}) =>
    new lib.MeshStandardMaterial({ color: colour, roughness: 0.8, side: lib.DoubleSide, ...extra });

  function disposeCake() {
    if (!cake) return;
    scene.remove(cake);
    const done = new Set<unknown>();
    cake.traverse(object => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh) return;
      if (!done.has(mesh.geometry)) { done.add(mesh.geometry); mesh.geometry.dispose(); }
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!done.has(m)) { done.add(m); m.dispose(); }
      }
    });
    cake = null;
    materialsOf.clear();
    units = new Map();
    tierUnits = new Map();
    tweens = [];
  }

  function build(layout: CakeLayout, view: StageView) {
    disposeCake();
    layoutNow = layout;
    viewNow = view;
    const group = new lib.Group();
    cake = group;
    scene.add(group);
    const whole = view === 'whole';
    const half = whole ? 0 : CUT_ANGLE / 2;
    const start = half;
    const length = Math.PI * 2 - 2 * half;
    const dirAt = (angle: number) => new lib.Vector3(Math.sin(angle), 0, Math.cos(angle));

    const track = (mat: T.MeshStandardMaterial, tag: Tag) => {
      const list = materialsOf.get(tagKey(tag)) ?? [];
      list.push(mat);
      materialsOf.set(tagKey(tag), list);
    };
    // Every mesh made while a tier is being drawn is remembered for that tier, and for the piece being drawn (see `record`).
    let currentTier = -1;
    let collecting: T.Object3D[] | null = null;
    const tierMeshes = new Map<number, T.Object3D[]>();
    const mesh = (geometry: T.BufferGeometry, mat: T.Material | T.Material[], tag: Tag | null): T.Mesh => {
      const m = new lib.Mesh(geometry, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      if (tag) m.userData = { tier: tag.tier, part: tag.part };
      if (currentTier >= 0) {
        const list = tierMeshes.get(currentTier) ?? [];
        list.push(m);
        tierMeshes.set(currentTier, list);
      }
      collecting?.push(m);
      return m;
    };
    // One piece of a part: whatever `make` adds to the cake, kept together with where it stands (positions are final when it returns).
    const record = (tag: Tag, role: Role, bottom: number, make: () => void): Unit => {
      const list: T.Object3D[] = [];
      collecting = list;
      make();
      collecting = null;
      const unit = { role, objects: list, ys: list.map(object => object.position.y), bottom };
      const key = tagKey(tag);
      units.set(key, [...(units.get(key) ?? []), unit]);
      return unit;
    };
    // The two faces a cut leaves, from `from` to `to` away from the middle.
    const cutFaces = (from: number, to: number, height: number, y: number, mat: T.Material, tag: Tag | null) => {
      if (whole) return;
      for (const angle of [half, -half]) {
        const geometry = new lib.PlaneGeometry(to - from, height);
        geometry.translate(from + (to - from) / 2, 0, 0);
        const face = mesh(geometry, mat, tag);
        face.rotation.y = angle - Math.PI / 2;
        face.position.y = y;
        group.add(face);
      }
    };
    const slab = (radius: number, height: number, y: number, mat: T.MeshStandardMaterial, tag: Tag | null) => {
      if (tag) track(mat, tag);
      const cylinder = mesh(new lib.CylinderGeometry(radius, radius, height, SEGMENTS, 1, false, start, length), mat, tag);
      cylinder.position.y = y;
      group.add(cylinder);
      cutFaces(0, radius, height, y, mat, tag);
    };

    // The board under everything, and the boards that carry the tiers above the bottom one.
    const boardMat = material(palette.board, { roughness: 0.4 });
    const underBoard = mesh(new lib.CylinderGeometry(layout.boardRadius, layout.boardRadius, BOARD_THICKNESS_CM, SEGMENTS), boardMat, null);
    underBoard.position.y = -BOARD_THICKNESS_CM / 2;
    group.add(underBoard);

    const decorationGeometry = new lib.SphereGeometry(0.6, 24, 16);
    decorationGeometry.scale(1, 0.85, 1);
    for (const tier of layout.tiers) {
      currentTier = tier.index;
      const first = tier.index === 0;
      if (!first) {
        // Cut like the tiers are, or it would hide what the cut shows of the tier below.
        slab(tier.radius + tier.coatingCm + 0.25, TIER_BOARD_CM, tier.yBase - TIER_BOARD_CM / 2, boardMat, null);
      }
      const kinds = {
        base: material(palette.base, tier.hasBase ? { roughness: 0.95 } : { roughness: 0.95, transparent: true, opacity: GHOST_OPACITY, depthWrite: false }),
        soak: material(palette.soak, { roughness: 0.9 }),
        filling: material(palette.filling, { roughness: 0.6 }),
      };
      for (const kind of ['base', 'soak', 'filling'] as const) track(kinds[kind], { tier: tier.index, part: kind });
      for (const layer of tier.layers) {
        const radius = layer.kind === 'filling' ? tier.radius + 0.04 : tier.radius;
        const tag = { tier: tier.index, part: layer.kind };
        const piece = record(tag, 'layer', tier.yBase + layer.y0, () => { slab(radius, layer.h, tier.yBase + layer.y0 + layer.h / 2, kinds[layer.kind], tag); });
        // A faint disc throws no shadow: the shadow would say it is there.
        if (layer.kind === 'base' && !tier.hasBase) for (const object of piece.objects) object.castShadow = false;
      }
      if (tier.hasCoating) {
        const tag = { tier: tier.index, part: 'coating' as const };
        const mat = material(palette.coating, { roughness: 0.75 });
        track(mat, tag);
        const outer = tier.radius + tier.coatingCm;
        const yMid = tier.yBase + tier.stackHeight / 2;
        record(tag, 'skin', tier.yBase, () => {
          const skin = mesh(new lib.CylinderGeometry(outer, outer, tier.stackHeight, SEGMENTS, 1, true, start, length), mat, tag);
          skin.position.y = yMid;
          group.add(skin);
          cutFaces(tier.radius, outer, tier.stackHeight, yMid, mat, tag);
        });
        record(tag, 'top', tier.yBase + tier.stackHeight, () => {
          slab(outer, COATING_CM, tier.yBase + tier.stackHeight + COATING_CM / 2, mat, tag);
        });
      }
      if (tier.hasDecoration) addDecoration(tier);
    }

    function addDecoration(tier: TierLayout) {
      const tag = { tier: tier.index, part: 'decoration' as const };
      const mat = material(palette.decoration, { roughness: 0.35 });
      track(mat, tag);
      const outer = tier.radius + tier.coatingCm;
      // Under another tier the berries sit on the part of the top that tier leaves bare.
      const ring = tier.upperEdge === null ? outer * 0.78 : (tier.upperEdge + outer) / 2;
      const count = Math.max(5, Math.round((Math.PI * 2 * ring) / 1.6));
      const skipped = (angle: number) => {
        if (whole) return false;
        const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        return a < half + 0.12 || a > Math.PI * 2 - half - 0.12;
      };
      const berry = (x: number, z: number) => {
        record(tag, 'berry', tier.yTop, () => {
          const m = mesh(decorationGeometry, mat, tag);
          m.position.set(x, tier.yTop + 0.42, z);
          group.add(m);
        });
      };
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        if (skipped(angle)) continue;
        const p = dirAt(angle).multiplyScalar(ring);
        berry(p.x, p.z);
      }
      // A second, smaller ring on a broad tier, and one in the middle.
      if (tier.upperEdge === null && tier.radius > 8) {
        const inner = ring * 0.5;
        const n = Math.max(4, Math.round((Math.PI * 2 * inner) / 1.8));
        for (let i = 0; i < n; i += 1) {
          const angle = ((i + 0.5) / n) * Math.PI * 2;
          if (skipped(angle)) continue;
          const p = dirAt(angle).multiplyScalar(inner);
          berry(p.x, p.z);
        }
      }
      if (tier.upperEdge === null) berry(0, 0);
    }

    for (const [index, list] of tierMeshes) tierUnits.set(index, { objects: list, ys: list.map(object => object.position.y), bottom: 0 });
    group.updateMatrixWorld(true);
    applyHighlights();
    requestRender();
  }

  // ── Intros: a part that has just got its first card comes in ─────────────────────────────────
  // Every mesh goes back exactly where the layout puts it (the end of every intro, and the proof that none is left half done).
  function settleAll() {
    for (const unit of tierUnits.values()) {
      unit.objects.forEach((object, i) => {
        object.position.y = unit.ys[i] ?? object.position.y;
        object.scale.set(1, 1, 1);
        object.visible = true;
      });
    }
  }
  const show = (unit: Unit, visible: boolean) => { for (const object of unit.objects) object.visible = visible; };
  const shift = (unit: Unit, dy: number) => { unit.objects.forEach((object, i) => { object.position.y = (unit.ys[i] ?? 0) + dy; }); };
  // Stretches a piece up from its underside: `k` 0 is flat, 1 is as it stands.
  const growUp = (unit: Unit, k: number) => {
    const grown = Math.max(0.001, k);
    unit.objects.forEach((object, i) => {
      object.scale.y = grown;
      object.position.y = unit.bottom + ((unit.ys[i] ?? 0) - unit.bottom) * grown;
    });
  };
  const unitsOf = (tier: number, part: CakePart, role?: Role) => (units.get(tagKey({ tier, part })) ?? []).filter(unit => role === undefined || unit.role === role);
  const layerMid = (layout: CakeLayout, tierIndex: number, kind: 'base' | 'soak', n: number): number | null => {
    const tier = layout.tiers[tierIndex];
    const layer = tier?.layers.filter(candidate => candidate.kind === kind)[n];
    return tier && layer ? tier.yBase + layer.y0 + layer.h / 2 : null;
  };
  function tween(delay: number, ms: number, curve: (k: number) => number, fn: (k: number) => void) {
    tweens.push({ start: performance.now() + delay, ms, curve, fn });
  }
  // The pause between pieces of a row of `count`: `each` ms, less when the row would take more than `most` to start.
  const stagger = (count: number, most: number, each: number) => (count > 1 ? Math.min(each, most / (count - 1)) : 0);

  // Plays one part's intro starting `at` ms from now; returns how long it takes. The meshes are hidden or moved to where it starts
  // NOW, so nothing shows in its final place for a moment before it comes in.
  function play(prev: CakeLayout, next: CakeLayout, tierIndex: number, part: CakePart, at: number): number {
    // The tiers above ride on this one: when it grows they start lower than they end.
    const above = [...tierUnits].filter(([index]) => index > tierIndex).map(([index, unit]) => ({ unit, dy: (prev.tiers[index]?.yBase ?? 0) - (next.tiers[index]?.yBase ?? 0) }));
    switch (part) {
      case 'base': {
        const discs = unitsOf(tierIndex, 'base');
        const soaks = unitsOf(tierIndex, 'soak');
        const fillings = unitsOf(tierIndex, 'filling');
        const step = stagger(discs.length, 500, 280);
        discs.forEach((disc, i) => {
          // The soak and the filling already on this disc come down with it.
          const together = [disc, soaks[i], fillings[i]].filter((unit): unit is NonNullable<typeof unit> => unit !== undefined);
          for (const unit of together) { show(unit, false); shift(unit, DROP_CM); }
          tween(at + i * step, 650, bounce, k => { for (const unit of together) { show(unit, true); shift(unit, DROP_CM * (1 - k)); } });
        });
        return (discs.length - 1) * step + 650;
      }
      case 'soak': {
        const soaks = unitsOf(tierIndex, 'soak');
        const step = stagger(soaks.length, 450, 250);
        soaks.forEach((soak, i) => {
          show(soak, false);
          tween(at + i * step, 600, easeOut, k => { show(soak, true); growUp(soak, k); });
        });
        return (soaks.length - 1) * step + 600;
      }
      case 'filling': {
        // The discs (and what stands on them) move apart to make room, then each layer of filling grows in the gap.
        const movers: { unit: Unit; dy: number }[] = [];
        for (const kind of ['base', 'soak'] as const) {
          unitsOf(tierIndex, kind).forEach((unit, n) => {
            const was = layerMid(prev, tierIndex, kind, n);
            const now = layerMid(next, tierIndex, kind, n);
            if (was !== null && now !== null) movers.push({ unit, dy: was - now });
          });
        }
        movers.push(...above);
        for (const { unit, dy } of movers) shift(unit, dy);
        const fillings = unitsOf(tierIndex, 'filling');
        for (const filling of fillings) show(filling, false);
        tween(at, 450, easeOut, k => { for (const { unit, dy } of movers) shift(unit, dy * (1 - k)); });
        const step = stagger(fillings.length, 400, 200);
        fillings.forEach((filling, i) => {
          tween(at + 450 + i * step, 500, easeOut, k => { show(filling, true); growUp(filling, k); });
        });
        return 450 + (fillings.length > 0 ? (fillings.length - 1) * step + 500 : 0);
      }
      case 'coating': {
        const skins = unitsOf(tierIndex, 'coating', 'skin');
        const tops = unitsOf(tierIndex, 'coating', 'top');
        for (const unit of [...skins, ...tops]) show(unit, false);
        for (const { unit, dy } of above) shift(unit, dy);
        tween(at, 800, easeOut, k => { for (const unit of skins) { show(unit, true); growUp(unit, k); } });
        tween(at + 800, 350, easeOut, k => { for (const unit of tops) { show(unit, true); growUp(unit, k); } });
        tween(at, 1150, easeOut, k => { for (const { unit, dy } of above) shift(unit, dy * (1 - k)); });
        return 1150;
      }
      case 'decoration': {
        const berries = unitsOf(tierIndex, 'decoration');
        const step = stagger(berries.length, 550, 90);
        berries.forEach((berry, i) => {
          show(berry, false);
          shift(berry, BERRY_DROP_CM);
          tween(at + i * step, 550, bounce, k => { show(berry, true); shift(berry, BERRY_DROP_CM * (1 - k)); });
        });
        return (berries.length - 1) * step + 550;
      }
    }
  }

  function startIntro(prev: CakeLayout, next: CakeLayout) {
    if (reducedMotion()) return;
    let at = 0;
    for (const appeared of appearedParts(prev, next)) at += play(prev, next, appeared.tier, appeared.part, at);
    if (tweens.length > 0) setMoving(true);
  }

  // Runs what is due; true while any intro is still going. The last frame puts every mesh back where it belongs.
  function runTweens(now: number): boolean {
    if (tweens.length === 0) return false;
    tweens = tweens.filter(item => {
      if (now < item.start) return true;
      const k = Math.min(1, (now - item.start) / item.ms);
      item.fn(item.curve(k));
      return k < 1;
    });
    if (tweens.length === 0) settleAll();
    return tweens.length > 0;
  }

  // ── Highlights ────────────────────────────────────────────────────────────
  const none = new lib.Color(0, 0, 0);
  function applyHighlights() {
    for (const [key, list] of materialsOf) {
      const chosen = selectedNow !== null && tagKey(selectedNow) === key;
      const hovered = !chosen && hoveredNow !== null && tagKey(hoveredNow) === key;
      for (const mat of list) {
        mat.emissive.copy(chosen ? palette.accent : hovered ? palette.glow : none);
        mat.emissiveIntensity = chosen ? 0.4 : hovered ? 0.2 : 0;
      }
    }
  }

  // ── Drawing on demand ─────────────────────────────────────────────────────
  let frameId = 0;
  let disposed = false;
  // A gesture that has really begun (moved past the tap slop, a second finger, the wheel): only then does the camera stop being «at home».
  let interacting = false;
  let moving = false;
  let flight: { t0: number; from: T.Vector3; fromTarget: T.Vector3; to: T.Vector3; toTarget: T.Vector3 } | null = null;
  let restTimer = 0;
  // Whether the camera is where «Vista iniziale» puts it (a resize re-frames the cake only then).
  let atHome = true;
  let size = { width: 1, height: 1, share: 1, centre: 0.5 };

  function requestRender() {
    if (disposed || frameId !== 0 || document.hidden) return;
    frameId = requestAnimationFrame(frame);
  }

  function setMoving(next: boolean) {
    if (next === moving) return;
    moving = next;
    hooks.onMoving(next);
    window.clearTimeout(restTimer);
    if (!next) restTimer = window.setTimeout(() => { if (!disposed) hooks.onRest(); }, REST_MS);
  }

  function frame(now: number) {
    frameId = 0;
    if (disposed) return;
    if (flight) {
      const k = Math.min(1, (now - flight.t0) / FLIGHT_MS);
      const e = 1 - (1 - k) ** 3;
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
      // Round the cake by spherical interpolation, so the way back never passes through it.
      const a = new lib.Spherical().setFromVector3(flight.from.clone().sub(flight.fromTarget));
      const b = new lib.Spherical().setFromVector3(flight.to.clone().sub(flight.toTarget));
      let turn = b.theta - a.theta;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      const s = new lib.Spherical(a.radius + (b.radius - a.radius) * e, a.phi + (b.phi - a.phi) * e, a.theta + turn * e);
      camera.position.setFromSpherical(s).add(controls.target);
      if (k >= 1) flight = null;
    }
    const playing = runTweens(now);
    const changed = controls.update();
    renderer.render(scene, camera);
    const busy = changed || flight !== null || interacting || playing;
    setMoving(busy);
    if (busy) requestRender();
  }

  controls.addEventListener('change', requestRender);
  // ⚠️ THE CONTROLS' 'start' FIRES ON EVERY TOUCH OF THE CANVAS, a plain tap included: a tap must not stop a return flight nor stop a
  // resize re-framing the cake, so a gesture counts only when it has MOVED (see commitGesture).
  // `held`: a drag or a pinch lasts until the controls say 'end'; a wheel turn has no end of its own (the controls fire start and end around
  // it, before this runs), so it must not leave the gesture held — the labels would never come back.
  function commitGesture(held: boolean) {
    if (held && interacting) return;
    if (held) interacting = true;
    atHome = false;
    flight = null;
    setMoving(true);
    requestRender();
  }
  controls.addEventListener('end', () => { interacting = false; requestRender(); });
  const onWheel = () => { commitGesture(false); };
  canvas.addEventListener('wheel', onWheel, { passive: true });

  const onVisibility = () => { if (!document.hidden) requestRender(); };
  document.addEventListener('visibilitychange', onVisibility);
  // A lost context is given a moment to come back (the browser may restore it); when it does not, the 3D is given up.
  let lostTimer = 0;
  const onLost = (event: Event) => {
    event.preventDefault();
    window.clearTimeout(lostTimer);
    lostTimer = window.setTimeout(() => { if (!disposed) hooks.onGaveUp(); }, CONTEXT_GRACE_MS);
  };
  const onRestored = () => { window.clearTimeout(lostTimer); requestRender(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  // ── Home view ─────────────────────────────────────────────────────────────
  function home() {
    if (!layoutNow) return null;
    const view = homeView(layoutNow, size.width / size.height, size.share);
    controls.minDistance = view.distance * 0.45;
    controls.maxDistance = view.distance * 1.8;
    return view;
  }
  function snapHome() {
    const view = home();
    if (!view) return;
    camera.position.set(view.position.x, view.position.y, view.position.z);
    controls.target.set(view.target.x, view.target.y, view.target.z);
    controls.update();
    atHome = true;
  }
  function goHome() {
    const view = home();
    if (!view) return;
    flight = {
      t0: performance.now(), from: camera.position.clone(), fromTarget: controls.target.clone(),
      to: new lib.Vector3(view.position.x, view.position.y, view.position.z), toTarget: new lib.Vector3(view.target.x, view.target.y, view.target.z),
    };
    atHome = true;
    setMoving(true);
    requestRender();
  }

  // ── Picking and hover ─────────────────────────────────────────────────────
  const raycaster = new lib.Raycaster();
  const pointer = new lib.Vector2();
  function partAt(clientX: number, clientY: number): Selected | null {
    if (!cake) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    pointer.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return pickedPart(raycaster.intersectObject(cake, true));
  }

  let down: { x: number; y: number; id: number } | null = null;
  let touches = 0;
  const onDown = (event: PointerEvent) => {
    touches += 1;
    down = touches === 1 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
    // A second finger is a turn or a pinch: a real gesture at once.
    if (touches > 1) commitGesture(true);
    setHover(null);
  };
  const onUp = (event: PointerEvent) => {
    touches = Math.max(0, touches - 1);
    const start = down;
    down = null;
    if (!start || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return;
    hooks.onTap(partAt(event.clientX, event.clientY));
  };
  const onCancel = () => { touches = 0; down = null; };
  // Hover is for a mouse only (a finger has none), one pick per frame.
  let hoverAt: { x: number; y: number } | null = null;
  const onMove = (event: PointerEvent) => {
    if (down && !interacting && Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP_PX) commitGesture(true);
    if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
    const queued = hoverAt !== null;
    hoverAt = { x: event.clientX, y: event.clientY };
    if (queued) return;
    requestAnimationFrame(() => {
      const at = hoverAt;
      hoverAt = null;
      if (at && !disposed) setHover(partAt(at.x, at.y));
    });
  };
  const onLeave = () => { setHover(null); };
  function setHover(next: Selected | null) {
    const same = (next === null && hoveredNow === null) || (next !== null && hoveredNow !== null && tagKey(next) === tagKey(hoveredNow));
    if (same) return;
    hoveredNow = next;
    canvas.style.cursor = next ? 'pointer' : '';
    applyHighlights();
    requestRender();
    hooks.onHover(next);
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  // ── What the labels need ──────────────────────────────────────────────────
  const tmp = new lib.Vector3();
  const eye = new lib.Vector3();
  function anchors(tierIndex: number): Anchor[] {
    const tier = layoutNow?.tiers[tierIndex];
    if (!tier || !cake) return [];
    camera.updateMatrixWorld();
    eye.copy(camera.position);
    const out: Anchor[] = [];
    const points = partAnchors(tier, viewNow);
    for (const part of ['decoration', 'coating', 'filling', 'soak', 'base'] as const) {
      const point = points[part];
      if (!point) continue;
      tmp.set(point.x, point.y, point.z);
      const away = tmp.distanceTo(eye);
      // Hidden behind the cake from here: no label (the parts list still names it).
      raycaster.set(eye, tmp.clone().sub(eye).normalize());
      const first = raycaster.intersectObject(cake, true).find(hit => (hit.object as T.Mesh).visible);
      if (first && first.distance < away - 0.45) continue;
      tmp.project(camera);
      if (tmp.z > 1) continue;
      out.push({ key: part, x: ((tmp.x + 1) / 2) * size.width, y: ((1 - tmp.y) / 2) * size.height });
    }
    return out;
  }

  function resize(width: number, height: number, share: number, centre: number) {
    size = { width: Math.max(1, width), height: Math.max(1, height), share, centre };
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    // The label columns take the sides: shift what the camera sees so the cake stands in the middle of what is left.
    camera.setViewOffset(size.width, size.height, -(centre - size.width / 2), 0, size.width, size.height);
    camera.updateProjectionMatrix();
    if (atHome) snapHome();
    requestRender();
  }

  let builtTiers = 0;
  return {
    build(layout, view) {
      const tiersChanged = builtTiers !== 0 && builtTiers !== layout.tiers.length;
      // Nothing plays for the scene's first build (opening a cake, a saved one).
      const before = layoutNow;
      build(layout, view);
      if (before !== null) startIntro(before, layout);
      builtTiers = layout.tiers.length;
      if (atHome) snapHome();
      if (tiersChanged && !atHome) goHome();
      setMoving(true);
      requestRender();
    },
    setSelection(next) { selectedNow = next; applyHighlights(); requestRender(); },
    resize,
    goHome,
    anchors,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(restTimer);
      tweens = [];
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.removeEventListener('wheel', onWheel);
      window.clearTimeout(lostTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      disposeCake();
      ground.geometry.dispose();
      (ground.material as T.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
