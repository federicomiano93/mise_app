// cake3dScene.ts — the IMPURE half of the cake's 3D view: turns a CakeLayout (cake3dModel.ts) into three.js meshes, draws on demand,
// and answers where a point of the cake is on the screen and which part is under a pointer.
//
// ⚠️ THREE IS NEVER IMPORTED HERE (threeLoading.spec.ts): the library arrives as an argument, loaded by Cake3D.tsx with import(), so it
// stays in a chunk of its own that nobody downloads until a cake editor shows the 3D. Only TYPES are imported.
//
// ⚠️ RESOURCES. One renderer per scene; `dispose()` frees every geometry, material, the renderer's context and every listener.
// It draws ON DEMAND (when something changed or the camera is moving) and not at all while the tab is hidden.

import type * as T from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/addons/controls/OrbitControls.js';
import type { CakePart } from '@mise/shared/cake-model';
import type { Selected } from './cakeEditorModel';
import {
  BOARD_THICKNESS_CM, COATING_CM, CUT_ANGLE, TIER_BOARD_CM, CAMERA_FOV_DEG, homeView, partAnchors, pickedPart,
} from './cake3dModel';
import type { Anchor, CakeLayout, StageView, TierLayout } from './cake3dModel';

export type Three = typeof T;
export type OrbitControlsClass = typeof OrbitControlsType;

// The colours of the scene, as CSS values read from the tokens (Cake3D reads them with getComputedStyle, never typed here).
export interface SceneColours {
  base: string; soak: string; filling: string; coating: string; decoration: string; board: string;
  accent: string; backdrop: string; ground: string;
}

export interface SceneHooks {
  // The camera started or stopped moving (the labels hide while it does).
  onMoving: (moving: boolean) => void;
  // It has been still for a moment: the labels may be placed again.
  onRest: () => void;
  onTap: (picked: Selected | null) => void;
  onHover: (hovered: Selected | null) => void;
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

// The colour a CSS value stands for, as sRGB 0..255, by asking a canvas (it parses oklch and var() results alike).
export function resolveCss(value: string, doc: Document = document): [number, number, number] | null {
  const context = doc.createElement('canvas').getContext('2d');
  if (!context || value.trim() === '') return null;
  context.fillStyle = '#010203';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

const SEGMENTS = 96;
// The wedge cut out of «Spaccato», and the smallest move that is a drag and not a tap.
const TAP_SLOP_PX = 6;
const REST_MS = 140;
const FLIGHT_MS = 700;

type Tag = { tier: number; part: CakePart };
const tagKey = (tag: Tag) => `${String(tag.tier)}|${tag.part}`;

export function createCakeScene(lib: Three, Controls: OrbitControlsClass, canvas: HTMLCanvasElement, css: SceneColours, hooks: SceneHooks): CakeScene {
  const renderer = new lib.WebGLRenderer({ canvas, antialias: true });
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
    backdrop: colourOf(css.backdrop), ground: colourOf(css.ground),
  };

  const scene = new lib.Scene();
  scene.background = palette.backdrop;
  const camera = new lib.PerspectiveCamera(CAMERA_FOV_DEG, 1, 1, 600);
  const controls = new Controls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enablePan = false;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.4;

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
    const mesh = (geometry: T.BufferGeometry, mat: T.Material | T.Material[], tag: Tag | null): T.Mesh => {
      const m = new lib.Mesh(geometry, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      if (tag) m.userData = { tier: tag.tier, part: tag.part };
      return m;
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
    const slab = (radius: number, height: number, y: number, mat: T.MeshStandardMaterial, tag: Tag) => {
      track(mat, tag);
      const cylinder = mesh(new lib.CylinderGeometry(radius, radius, height, SEGMENTS, 1, false, start, length), mat, tag);
      cylinder.position.y = y;
      group.add(cylinder);
      cutFaces(0, radius, height, y, mat, tag);
    };

    // The board under everything, and the boards that carry the tiers above the bottom one.
    const boardMat = material(palette.board, { roughness: 0.4 });
    group.add(Object.assign(mesh(new lib.CylinderGeometry(layout.boardRadius, layout.boardRadius, BOARD_THICKNESS_CM, SEGMENTS), boardMat, null),
      { position: new lib.Vector3(0, -BOARD_THICKNESS_CM / 2, 0) }));

    const decorationGeometry = new lib.SphereGeometry(0.6, 24, 16);
    decorationGeometry.scale(1, 0.85, 1);
    for (const tier of layout.tiers) {
      const first = tier.index === 0;
      if (!first) {
        const r = tier.radius + tier.coatingCm + 0.25;
        const board = mesh(new lib.CylinderGeometry(r, r, TIER_BOARD_CM, SEGMENTS), boardMat, null);
        board.position.y = tier.yBase - TIER_BOARD_CM / 2;
        group.add(board);
      }
      const kinds = {
        base: material(palette.base, { roughness: 0.95 }),
        soak: material(palette.soak, { roughness: 0.9 }),
        filling: material(palette.filling, { roughness: 0.6 }),
      };
      for (const kind of ['base', 'soak', 'filling'] as const) track(kinds[kind], { tier: tier.index, part: kind });
      for (const layer of tier.layers) {
        const radius = layer.kind === 'filling' ? tier.radius + 0.04 : tier.radius;
        slab(radius, layer.h, tier.yBase + layer.y0 + layer.h / 2, kinds[layer.kind], { tier: tier.index, part: layer.kind });
      }
      if (tier.hasCoating) {
        const tag = { tier: tier.index, part: 'coating' as const };
        const mat = material(palette.coating, { roughness: 0.75 });
        track(mat, tag);
        const outer = tier.radius + tier.coatingCm;
        const yMid = tier.yBase + tier.stackHeight / 2;
        const skin = mesh(new lib.CylinderGeometry(outer, outer, tier.stackHeight, SEGMENTS, 1, true, start, length), mat, tag);
        skin.position.y = yMid;
        group.add(skin);
        cutFaces(tier.radius, outer, tier.stackHeight, yMid, mat, tag);
        slab(outer, COATING_CM, tier.yBase + tier.stackHeight + COATING_CM / 2, mat, tag);
      }
      if (tier.hasDecoration) addDecoration(tier);
    }

    function addDecoration(tier: TierLayout) {
      const tag = { tier: tier.index, part: 'decoration' as const };
      const mat = material(palette.decoration, { roughness: 0.35 });
      track(mat, tag);
      const ring = (tier.radius + tier.coatingCm) * 0.78;
      const count = Math.max(5, Math.round((Math.PI * 2 * ring) / 1.6));
      const skipped = (angle: number) => {
        if (whole) return false;
        const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        return a < half + 0.12 || a > Math.PI * 2 - half - 0.12;
      };
      const berry = (x: number, z: number) => {
        const m = mesh(decorationGeometry, mat, tag);
        m.position.set(x, tier.yTop + 0.42, z);
        group.add(m);
      };
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        if (skipped(angle)) continue;
        const p = dirAt(angle).multiplyScalar(ring);
        berry(p.x, p.z);
      }
      // A second, smaller ring on a broad tier, and one in the middle.
      if (tier.radius > 8) {
        const inner = ring * 0.5;
        const n = Math.max(4, Math.round((Math.PI * 2 * inner) / 1.8));
        for (let i = 0; i < n; i += 1) {
          const angle = ((i + 0.5) / n) * Math.PI * 2;
          if (skipped(angle)) continue;
          const p = dirAt(angle).multiplyScalar(inner);
          berry(p.x, p.z);
        }
      }
      berry(0, 0);
    }

    applyHighlights();
    requestRender();
  }

  // ── Highlights ────────────────────────────────────────────────────────────
  const white = new lib.Color(1, 1, 1);
  function applyHighlights() {
    for (const [key, list] of materialsOf) {
      const chosen = selectedNow !== null && tagKey(selectedNow) === key;
      const hovered = !chosen && hoveredNow !== null && tagKey(hoveredNow) === key;
      for (const mat of list) {
        mat.emissive.copy(chosen ? palette.accent : hovered ? white : new lib.Color(0, 0, 0));
        mat.emissiveIntensity = chosen ? 0.4 : hovered ? 0.2 : 0;
      }
    }
  }

  // ── Drawing on demand ─────────────────────────────────────────────────────
  let frameId = 0;
  let disposed = false;
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
    const changed = controls.update();
    renderer.render(scene, camera);
    const busy = changed || flight !== null || interacting;
    setMoving(busy);
    if (busy) requestRender();
  }

  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => { interacting = true; atHome = false; flight = null; setMoving(true); requestRender(); });
  controls.addEventListener('end', () => { interacting = false; requestRender(); });

  const onVisibility = () => { if (!document.hidden) requestRender(); };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = (event: Event) => { event.preventDefault(); };
  const onRestored = () => { requestRender(); };
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
      build(layout, view);
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
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
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
