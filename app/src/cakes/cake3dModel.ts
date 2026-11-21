// cake3dModel.ts — the PURE half of the cake's 3D view: where every part sits in space, where the camera starts, how the labels
// are placed so no leader line crosses another, which part a hit belongs to, and which of the two drawings the stage shows.
// No three.js here (the library loads only inside Cake3D, and a spec pins that), no DOM: everything is numbers, so it is tested
// in a plain jsdom run, and the scene (cake3dScene.ts) only turns these numbers into meshes.
//
// Units: centimetres, the cake's own. y is up, the camera starts on +z looking at the cake.

import type { CakeGeometry, CakeGeometryTier, CakePart } from '@mise/shared/cake-model';
import type { Selected } from './cakeEditorModel';

// ── The shape of the cake ────────────────────────────────────────────────────

// The coating is a skin around the tiers and on top of each one.
export const COATING_CM = 0.5;
// The thin board that carries every tier above the bottom one.
export const TIER_BOARD_CM = 0.22;
// The white board under the whole cake: how far it reaches beyond the bottom tier's coating, and how thick it is.
export const BOARD_MARGIN_CM = 3.2;
export const BOARD_THICKNESS_CM = 0.5;
// The part of a disc that is soaked (its top), and the thickness of a layer of filling as a share of a disc.
export const SOAK_SHARE = 0.22;
export const FILLING_SHARE = 0.3;
export const FILLING_MIN_CM = 0.5;
// The empty gap between two discs while the filling has no card, as a share of a disc.
export const DISC_GAP_SHARE = 0.25;
// How high the decoration stands on top of a tier.
export const DECORATION_CM = 1.6;
// «Spaccato»: the wedge cut out, facing the camera, in radians (72 degrees).
export const CUT_ANGLE = (72 * Math.PI) / 180;

export type StageView = 'cut' | 'whole';

export interface LayerLayout {
  kind: 'base' | 'soak' | 'filling';
  // From the tier's own floor.
  y0: number;
  h: number;
}

export interface TierLayout {
  index: number;
  radius: number;
  // The tier's floor in the scene, and the top of its coating.
  yBase: number;
  stackHeight: number;
  coatingCm: number;
  yTop: number;
  layers: LayerLayout[];
  // Whether the part has a card. A base with none is still drawn (its discs, faint) so the person can count them while setting the
  // measures; the other parts are not drawn without one.
  hasBase: boolean;
  hasSoak: boolean;
  hasFilling: boolean;
  hasCoating: boolean;
  hasDecoration: boolean;
  // The outer edge (coating included) of the tier standing on this one; null for the top tier. A decoration on a tier with another on top
  // goes on the ring of its top that is left uncovered.
  upperEdge: number | null;
}

export interface CakeLayout {
  tiers: TierLayout[];
  // The white board's radius.
  boardRadius: number;
  // From the board's underside to the top of the highest tier, decoration included.
  height: number;
}

function hasCards(tier: CakeGeometryTier, part: CakePart): boolean {
  return tier.parts[part].productIds.length > 0;
}

// The stack of one tier: discs from the bottom, the soak on top of each, a layer of filling between two discs (only when the filling
// has a card, as the flat drawing does). Without one the discs stand apart by an empty gap, so a new cake shows how many discs it has
// at a glance (his ask, 21 Nov 2026); the flat drawing does the same.
export function tierLayout(tier: CakeGeometryTier, yBase: number): TierLayout {
  const hasBase = hasCards(tier, 'base');
  const hasSoak = hasCards(tier, 'soak');
  const hasFilling = hasCards(tier, 'filling') && tier.discs > 1;
  const hasCoating = hasCards(tier, 'coating');
  const hasDecoration = hasCards(tier, 'decoration');
  const discCm = Math.max(0.5, tier.discHeightCm);
  const soakCm = hasSoak ? discCm * SOAK_SHARE : 0;
  const fillingCm = hasFilling ? Math.max(FILLING_MIN_CM, discCm * FILLING_SHARE) : 0;
  const layers: LayerLayout[] = [];
  let y = 0;
  for (let disc = 0; disc < tier.discs; disc += 1) {
    layers.push({ kind: 'base', y0: y, h: discCm - soakCm });
    y += discCm - soakCm;
    if (hasSoak) {
      layers.push({ kind: 'soak', y0: y, h: soakCm });
      y += soakCm;
    }
    if (hasFilling && disc < tier.discs - 1) {
      layers.push({ kind: 'filling', y0: y, h: fillingCm });
      y += fillingCm;
    } else if (disc < tier.discs - 1) {
      y += discCm * DISC_GAP_SHARE;
    }
  }
  const coatingCm = hasCoating ? COATING_CM : 0;
  return {
    index: tier.index,
    radius: tier.diameterCm / 2,
    yBase,
    stackHeight: y,
    coatingCm,
    yTop: yBase + y + coatingCm,
    layers,
    hasBase,
    hasSoak,
    hasFilling,
    hasCoating,
    hasDecoration,
    upperEdge: null,
  };
}

export function cakeLayout(geometry: CakeGeometry): CakeLayout {
  const tiers: TierLayout[] = [];
  let yBase = 0;
  for (const tier of geometry.tiers) {
    if (tiers.length > 0) yBase += TIER_BOARD_CM;
    const laid = tierLayout(tier, yBase);
    const below = tiers[tiers.length - 1];
    if (below) below.upperEdge = laid.radius + laid.coatingCm;
    tiers.push(laid);
    yBase = laid.yTop;
  }
  const first = tiers[0];
  const last = tiers[tiers.length - 1];
  const coating = first ? first.coatingCm : 0;
  return {
    tiers,
    boardRadius: first ? first.radius + coating + BOARD_MARGIN_CM : 0,
    height: last ? last.yTop + (last.hasDecoration ? DECORATION_CM : 0) : 0,
  };
}

// ── What a change of the cake makes appear ────────────────────────────────────

export interface Appeared { tier: number; part: CakePart }

// The order a cake is built in: the parts that appear together play in this order.
const BUILD_ORDER: readonly CakePart[] = ['base', 'soak', 'filling', 'coating', 'decoration'];

function hasPart(tier: TierLayout, part: CakePart): boolean {
  switch (part) {
    case 'base': return tier.hasBase;
    case 'soak': return tier.hasSoak;
    case 'filling': return tier.hasFilling;
    case 'coating': return tier.hasCoating;
    case 'decoration': return tier.hasDecoration;
  }
}

const baseLayers = (tier: TierLayout): number => tier.layers.filter(layer => layer.kind === 'base').length;

// What went from «no card» to «has a card» between the layout on show and the new one, per tier (bottom first), parts in the order a cake
// is built. Nothing at all for a first build (`prev` null: opening a cake never plays), for a tier that did not exist, and for a tier whose
// shape changed (another diameter or number of discs): that is a different cake, not a part being added. A part that goes away, or stays,
// is not listed.
export function appearedParts(prev: CakeLayout | null, next: CakeLayout): Appeared[] {
  if (prev === null) return [];
  const out: Appeared[] = [];
  for (const tier of next.tiers) {
    const before = prev.tiers[tier.index];
    if (!before || before.radius !== tier.radius || baseLayers(before) !== baseLayers(tier)) continue;
    for (const part of BUILD_ORDER) {
      if (hasPart(tier, part) && !hasPart(before, part)) out.push({ tier: tier.index, part });
    }
  }
  return out;
}

// ── Where a part is, for its label ───────────────────────────────────────────

export interface Point3 { x: number; y: number; z: number }

// A direction on the floor: angle 0 is +z (towards the camera), positive towards +x.
const around = (angle: number, radius: number, y: number): Point3 => ({ x: Math.sin(angle) * radius, y, z: Math.cos(angle) * radius });

function layerMid(tier: TierLayout, kind: LayerLayout['kind'], which: 'first' | 'last'): number | null {
  const of = tier.layers.filter(layer => layer.kind === kind);
  const layer = which === 'first' ? of[0] : of[of.length - 1];
  return layer ? tier.yBase + layer.y0 + layer.h / 2 : null;
}

// The point a label's leader line ends on, per part present in the tier. «Spaccato»: on the cut face (inside the cake). «Intera»: on
// the side of the cake at the part's height (the coating's skin where there is one).
export function partAnchors(tier: TierLayout, view: StageView): Partial<Record<CakePart, Point3>> {
  const out: Partial<Record<CakePart, Point3>> = {};
  const skin = tier.radius + tier.coatingCm;
  const half = CUT_ANGLE / 2;
  const inside = (angle: number, share: number, y: number) => around(angle, tier.radius * share, y);
  const side = (angle: number, y: number) => around(angle, skin + 0.05, y);

  const base = layerMid(tier, 'base', 'first');
  if (base !== null) out.base = view === 'cut' ? inside(-half, 0.55, base) : side(-0.75, base);
  const soak = layerMid(tier, 'soak', 'last');
  if (soak !== null) out.soak = view === 'cut' ? inside(half, 0.6, soak) : side(0.5, soak);
  const filling = layerMid(tier, 'filling', 'last');
  if (filling !== null) out.filling = view === 'cut' ? inside(-half, 0.55, filling) : side(-0.75, filling);
  if (tier.hasCoating) out.coating = side(view === 'cut' ? half + 0.5 : 1.05, tier.yBase + tier.stackHeight * 0.55);
  if (tier.hasDecoration) {
    out.decoration = tier.upperEdge === null
      ? { x: 0, y: tier.yTop + 0.9, z: -tier.radius * 0.35 }
      : around(half + 0.7, (tier.upperEdge + skin) / 2, tier.yTop + 0.9);
  }
  return out;
}

// ── The camera's home view ───────────────────────────────────────────────────

export const CAMERA_FOV_DEG = 30;
// How high above the horizon the camera looks from, in radians.
const HOME_ELEVATION = (26 * Math.PI) / 180;

export interface HomeView {
  target: Point3;
  position: Point3;
  distance: number;
}

// Frames the whole cake inside `share` (0..1) of the stage's width — the rest is left to the labels — with some air around it.
export function homeView(layout: CakeLayout, aspect: number, share = 1): HomeView {
  const tanV = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const tanH = tanV * Math.max(0.2, aspect);
  const targetY = Math.max(2, layout.height * 0.42);
  // The bottom tier and a little board around it must fit the width; the board's far scalloped edge may go a little past it.
  const bottom = layout.tiers[0];
  const need = bottom ? bottom.radius + bottom.coatingCm + 1.6 : layout.boardRadius;
  const wide = (need * 1.12) / (tanH * Math.min(1, Math.max(0.2, share)));
  const high = (layout.height * 0.75 + layout.boardRadius * 0.35) / tanV;
  const distance = Math.max(wide, high, 20);
  return {
    target: { x: 0, y: targetY, z: 0 },
    position: { x: 0, y: targetY + Math.sin(HOME_ELEVATION) * distance, z: Math.cos(HOME_ELEVATION) * distance },
    distance,
  };
}

// ── Which part a hit belongs to ──────────────────────────────────────────────

// What a mesh carries in its `userData`.
export interface PartTag { tier: number; part: CakePart }

interface Hit { object: HitObject }
interface HitObject { userData?: Record<string, unknown>; parent?: HitObject | null; visible?: boolean }

const PARTS: readonly string[] = ['decoration', 'coating', 'filling', 'soak', 'base'];

function tagOf(object: HitObject | null | undefined): PartTag | null {
  for (let at = object; at; at = at.parent) {
    const data = at.userData;
    if (data && typeof data.tier === 'number' && typeof data.part === 'string' && PARTS.includes(data.part)) {
      return { tier: data.tier, part: data.part as CakePart };
    }
  }
  return null;
}

// The first visible hit that is a part of the cake (the board and the boards between tiers carry no tag: tapping one picks nothing,
// and the cake behind it is not picked through it — a hit on the board ends the search).
export function pickedPart(hits: readonly Hit[]): Selected | null {
  for (const hit of hits) {
    if (hit.object.visible === false) continue;
    const tag = tagOf(hit.object);
    return tag ? { tier: tag.tier, part: tag.part } : null;
  }
  return null;
}

// What a tap does: the first tap on a part chooses it, a second one on the chosen part opens its «Add a card».
export function tapAction(picked: Selected | null, selected: Selected | null): 'none' | 'select' | 'open' {
  if (!picked) return 'none';
  return selected !== null && selected.tier === picked.tier && selected.part === picked.part ? 'open' : 'select';
}

// ── Labels and their leader lines ────────────────────────────────────────────

export interface Anchor { key: string; x: number; y: number }
export interface PlacedLabel { key: string; side: 'left' | 'right'; anchor: { x: number; y: number }; slot: { x: number; y: number } }

export interface LabelBox {
  // The stage, in pixels.
  width: number;
  height: number;
  // One label's size and the space around the stack.
  labelWidth: number;
  labelHeight: number;
  gap: number;
  margin: number;
  // The strip kept free along the bottom, for the «raw materials so far» total: no label stands in it.
  foot: number;
  // One column on each side, one on the right only (a narrow stage), or none: a stage under STACKED_UNDER px wide has no room for the cake beside
  // its labels, so the cake takes the whole width and the labels stand in a list under it, with no leader lines.
  columns: 0 | 1 | 2;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}

// The most the labels of one column are spread apart: further than this they would stand far from the cake they name.
export const SLOT_SPREAD_PX = 110;

// Slot heights for the labels of one column: EVENLY SPACED (one step between every two, as wide as the stage allows up to
// SLOT_SPREAD_PX, never less than a label plus its gap when the stage has the room), centred on where the anchors are on average, and
// kept inside the stage. The order is the ascending order of the anchors.
export function slotHeights(wanted: readonly number[], box: LabelBox): number[] {
  const count = wanted.length;
  if (count === 0) return [];
  const low = box.margin + box.labelHeight / 2;
  const high = box.height - box.margin - box.foot - box.labelHeight / 2;
  const room = Math.max(0, high - low);
  const step = count > 1 ? Math.min(SLOT_SPREAD_PX, room / (count - 1)) : 0;
  const middle = wanted.reduce((sum, y) => sum + y, 0) / count;
  const first = Math.min(Math.max(middle - (step * (count - 1)) / 2, low), Math.max(low, high - step * (count - 1)));
  return Array.from({ length: count }, (_, i) => first + step * i);
}

// ⚠️ NO TWO LEADER LINES CROSS. A label column is a vertical line of slots; pairing the anchors with the slots so the total length of
// the lines is the shortest possible never produces a crossing (two crossing lines can always be swapped for a shorter pair), and a
// stage holds five parts at most, so every pairing is tried. Left or right: by which side of the stage's middle the anchor is on
// (all on the right in a narrow stage).
export function placeLabels(anchors: readonly Anchor[], box: LabelBox): PlacedLabel[] {
  if (box.columns === 0) return [];
  const sides: Record<'left' | 'right', Anchor[]> = { left: [], right: [] };
  for (const anchor of anchors) sides[box.columns !== 2 || anchor.x >= box.width / 2 ? 'right' : 'left'].push(anchor);
  // A column that would hold more than the stage's height allows hands its extra to the other column.
  const fits = Math.max(1, Math.floor((box.height - 2 * box.margin - box.foot + box.gap) / (box.labelHeight + box.gap)));
  if (box.columns === 2) {
    while (sides.left.length > fits || sides.right.length > fits) {
      const from = sides.left.length > fits ? 'left' : 'right';
      const to = from === 'left' ? 'right' : 'left';
      // Nowhere to hand them to (a stage too short for all of them): stack what there is.
      if (sides[to].length >= fits) break;
      const moved = sides[from].sort((a, b) => (from === 'left' ? b.x - a.x : a.x - b.x))[0];
      if (!moved) break;
      sides[from].splice(sides[from].indexOf(moved), 1);
      sides[to].push(moved);
    }
  }
  const out: PlacedLabel[] = [];
  for (const side of ['left', 'right'] as const) {
    const column = sides[side];
    if (column.length === 0) continue;
    const slotX = side === 'left' ? box.margin + box.labelWidth : box.width - box.margin - box.labelWidth;
    const ys = slotHeights(column.map(a => a.y), box);
    const slots = ys.map(y => ({ x: slotX, y }));
    let best: Anchor[] = column;
    let bestLength = Infinity;
    for (const order of permutations(column)) {
      const length = order.reduce((sum, anchor, i) => sum + distance(anchor, slots[i] as { x: number; y: number }), 0);
      if (length < bestLength - 1e-9) { bestLength = length; best = order; }
    }
    best.forEach((anchor, i) => {
      out.push({ key: anchor.key, side, anchor: { x: anchor.x, y: anchor.y }, slot: slots[i] as { x: number; y: number } });
    });
  }
  return out;
}

// A thin curve from a label's edge to the point it names: leaves the label horizontally and bends towards the anchor.
export function leaderPath(label: PlacedLabel): string {
  const { anchor, slot, side } = label;
  const sign = side === 'left' ? 1 : -1;
  const reach = Math.max(24, Math.min(90, Math.abs(anchor.x - slot.x) * 0.5));
  const fix = (n: number) => n.toFixed(1);
  return `M ${fix(slot.x)} ${fix(slot.y)} C ${fix(slot.x + sign * reach)} ${fix(slot.y)}, ${fix(anchor.x - sign * Math.min(24, reach * 0.4))} ${fix(anchor.y)}, ${fix(anchor.x)} ${fix(anchor.y)}`;
}

// True when the straight lines of two placed labels cross (the spec's check on the result of placeLabels).
export function leadersCross(a: PlacedLabel, b: PlacedLabel): boolean {
  const orient = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = orient(a.slot, a.anchor, b.slot);
  const d2 = orient(a.slot, a.anchor, b.anchor);
  const d3 = orient(b.slot, b.anchor, a.slot);
  const d4 = orient(b.slot, b.anchor, a.anchor);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// How the stage lays out its labels for a width: two columns when there is room, one on the right when there is not.
export const STACKED_UNDER = 330;

export function labelBoxFor(width: number, height: number): LabelBox {
  const columns: 0 | 1 | 2 = width < STACKED_UNDER ? 0 : width >= 560 ? 2 : 1;
  const labelWidth = columns === 2
    ? Math.round(Math.min(210, Math.max(140, width * 0.24)))
    : Math.round(Math.min(150, Math.max(112, width * 0.38)));
  return { width, height, labelWidth, labelHeight: columns === 2 ? 48 : 52, gap: 10, margin: 10, foot: 44, columns };
}

// The share of the stage's width the cake may use: what the label columns leave.
export function cakeShare(box: LabelBox): { share: number; centre: number } {
  if (box.columns === 0) return { share: 1, centre: box.width / 2 };
  const reserved = (box.columns === 2 ? 2 : 1) * (box.labelWidth + box.margin + 8);
  const left = box.columns === 2 ? box.labelWidth + box.margin + 8 : 0;
  const share = Math.max(0.3, (box.width - reserved) / box.width);
  return { share, centre: (left + (box.width - (box.labelWidth + box.margin + 8))) / 2 };
}

// ── Which drawing the stage shows ────────────────────────────────────────────

// Why the 3D cannot be drawn: no WebGL 2 on the device, the library did not arrive, or the drawing stopped working (a bug, or a graphics
// context lost for good). The first two are EXPECTED and are reported by the 3D view itself (onUnavailable), never thrown.
export type StageFailure = 'webgl' | 'load' | 'error';
export type StageNote = StageFailure | 'motion';

export interface StageDecision { show: '3d' | '2d'; note: StageNote | null }

// The 3D view is always the first choice; the simple section drawing is shown instead, with a one-line note, when the 3D cannot be
// drawn (no WebGL, the library did not load, it stopped working) or when the device asks for less motion. There is no switch between
// the two: the person cannot override either reason.
export function stageDecision(opts: { reducedMotion: boolean; failure: StageFailure | null }): StageDecision {
  if (opts.failure !== null) return { show: '2d', note: opts.failure };
  return opts.reducedMotion ? { show: '2d', note: 'motion' } : { show: '3d', note: null };
}

// Whether the browser can make a WebGL 2 context at all (asked before the library is downloaded: three.js 0.187 has no WebGL 1, so a
// device with only WebGL 1 would download half a megabyte it can never use).
export function webglAvailable(doc: Document = document): boolean {
  try {
    const gl = doc.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    (gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

// What the scene is built from, as one string: the same string means the same meshes. The layout holds only numbers that decide the
// shape (diameters, discs, which parts have cards), never grams or names, so typing a weight or renaming a card does not rebuild the
// scene (and does not make the labels dip). The view (cut-away or whole) is part of it.
export function sceneSignature(layout: CakeLayout, view: StageView): string {
  return `${view}|${JSON.stringify(layout)}`;
}
