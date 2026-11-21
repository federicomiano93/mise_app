import { describe, expect, it } from 'vitest';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import {
  CUT_ANGLE, TIER_BOARD_CM, cakeLayout, cakeShare, homeView, labelBoxFor, leaderPath, leadersCross, partAnchors, pickedPart, placeLabels,
  slotHeights, stageDecision, tapAction,
} from './cake3dModel';
import type { Anchor, LabelBox, PlacedLabel } from './cake3dModel';

const REF = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };
const FULL: Cake = {
  id: 'c1', name: 'Two tiers', diameterCm: 24, tiers: 2, discs: 3, slices: 12,
  lines: [
    { tier: 0, part: 'base', productId: 'A', grams: null },
    { tier: 0, part: 'soak', productId: 'B', grams: null },
    { tier: 0, part: 'filling', productId: 'C', grams: null },
    { tier: 0, part: 'coating', productId: 'D', grams: null },
    { tier: 1, part: 'base', productId: 'A', grams: null },
    { tier: 1, part: 'decoration', productId: 'E', grams: null },
  ],
  packaging: [], assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, ref: REF, model: 1,
};

describe('the cake in space', () => {
  const layout = cakeLayout(cakeGeometry(FULL));
  const [bottom, top] = layout.tiers;

  it('stacks the tiers, each 6 cm narrower, a thin board between them', () => {
    expect(layout.tiers).toHaveLength(2);
    expect(bottom!.radius).toBe(12);
    expect(top!.radius).toBe(9);
    expect(top!.yBase).toBeCloseTo(bottom!.yTop + TIER_BOARD_CM, 6);
  });

  it('builds a tier from discs, a soak on top of each and filling between two discs', () => {
    // 3 discs of 3 cm: base 2.34 + soak 0.66, twice a filling layer of 0.9 between.
    expect(bottom!.layers.map(l => l.kind)).toEqual(['base', 'soak', 'filling', 'base', 'soak', 'filling', 'base', 'soak']);
    expect(bottom!.stackHeight).toBeCloseTo(9 + 2 * 0.9, 6);
    for (let i = 1; i < bottom!.layers.length; i += 1) {
      const before = bottom!.layers[i - 1]!;
      expect(bottom!.layers[i]!.y0).toBeCloseTo(before.y0 + before.h, 6);
    }
    expect(bottom!.hasCoating).toBe(true);
    expect(bottom!.yTop).toBeCloseTo(bottom!.yBase + bottom!.stackHeight + 0.5, 6);
  });

  it('leaves out what has no card: a tier without filling or soak is bare discs', () => {
    expect(top!.layers.map(l => l.kind)).toEqual(['base', 'base', 'base']);
    expect(top!.hasCoating).toBe(false);
    expect(top!.hasDecoration).toBe(true);
    expect(layout.height).toBeGreaterThan(top!.yTop);
  });

  it('knows what stands on a tier, so its decoration goes on the ring of the top that is left bare', () => {
    expect(top!.upperEdge).toBeNull();
    expect(bottom!.upperEdge).toBe(9);
    const withDeco = cakeLayout(cakeGeometry({ ...FULL, lines: [...FULL.lines, { tier: 0, part: 'decoration', productId: 'E', grams: null }] }));
    const low = partAnchors(withDeco.tiers[0]!, 'cut').decoration!;
    const ring = Math.hypot(low.x, low.z);
    // Between the upper tier's edge (9) and this tier's coating (12.5): never under the tier above.
    expect(ring).toBeGreaterThan(9);
    expect(ring).toBeLessThan(12.5);
    expect(low.z).toBeGreaterThan(0);
  });

  it('puts the board wider than the bottom tier', () => {
    expect(layout.boardRadius).toBeGreaterThan(bottom!.radius + 0.5);
  });

  it('puts every anchor of the chosen tier at its part’s height, inside the cut or on the skin', () => {
    const cut = partAnchors(bottom!, 'cut');
    expect(Object.keys(cut).sort()).toEqual(['base', 'coating', 'filling', 'soak']);
    expect(cut.base!.y).toBeLessThan(cut.filling!.y);
    expect(Math.hypot(cut.base!.x, cut.base!.z)).toBeLessThan(bottom!.radius);
    // The cut face is at ±half the wedge, on the side facing the camera (+z).
    expect(cut.base!.z).toBeGreaterThan(0);
    expect(Math.atan2(cut.base!.x, cut.base!.z)).toBeCloseTo(-CUT_ANGLE / 2, 6);
    const whole = partAnchors(bottom!, 'whole');
    expect(Math.hypot(whole.base!.x, whole.base!.z)).toBeGreaterThan(bottom!.radius);
    expect(whole.filling!.y).toBeCloseTo(cut.filling!.y, 6);
    expect(Object.keys(partAnchors(top!, 'cut')).sort()).toEqual(['base', 'decoration']);
  });
});

describe('the camera’s home view', () => {
  const layout = cakeLayout(cakeGeometry(FULL));
  it('looks at the cake from the front and above, and backs off for a taller or wider cake', () => {
    const home = homeView(layout, 1.5);
    expect(home.position.z).toBeGreaterThan(0);
    expect(home.position.y).toBeGreaterThan(home.target.y);
    const one = homeView(cakeLayout(cakeGeometry({ ...FULL, tiers: 1, lines: FULL.lines.filter(l => l.tier === 0) })), 1.5);
    expect(home.distance).toBeGreaterThan(one.distance);
  });

  it('backs off when the labels leave the cake a narrow share of the stage', () => {
    expect(homeView(layout, 0.6, 0.5).distance).toBeGreaterThan(homeView(layout, 0.6, 1).distance);
    expect(homeView(layout, 0.3).distance).toBeGreaterThan(homeView(layout, 2).distance);
  });
});

describe('which part a hit is', () => {
  const part = (tier: number, name: string) => ({ object: { userData: { tier, part: name }, parent: null } });

  it('is the first visible hit, read from the mesh or from its group', () => {
    expect(pickedPart([part(1, 'filling'), part(0, 'base')])).toEqual({ tier: 1, part: 'filling' });
    const child = { object: { userData: {}, parent: { userData: { tier: 0, part: 'decoration' }, parent: null } } };
    expect(pickedPart([child])).toEqual({ tier: 0, part: 'decoration' });
    expect(pickedPart([{ object: { ...part(0, 'base').object, visible: false } }, part(0, 'soak')])).toEqual({ tier: 0, part: 'soak' });
  });

  it('is nothing for the board, for a hit with a made-up part, and for no hit', () => {
    expect(pickedPart([])).toBeNull();
    expect(pickedPart([{ object: { userData: {}, parent: null } }, part(0, 'base')])).toBeNull();
    expect(pickedPart([part(0, 'sauce')])).toBeNull();
    expect(pickedPart([{ object: { userData: { tier: '0', part: 'base' }, parent: null } }])).toBeNull();
  });

  it('chooses on the first tap and opens on a second tap on the chosen part', () => {
    expect(tapAction(null, null)).toBe('none');
    expect(tapAction({ tier: 0, part: 'base' }, null)).toBe('select');
    expect(tapAction({ tier: 0, part: 'base' }, { tier: 0, part: 'soak' })).toBe('select');
    expect(tapAction({ tier: 1, part: 'base' }, { tier: 0, part: 'base' })).toBe('select');
    expect(tapAction({ tier: 0, part: 'base' }, { tier: 0, part: 'base' })).toBe('open');
  });
});

describe('the labels', () => {
  const wide: LabelBox = labelBoxFor(900, 520);

  // A small seeded generator, so every run draws the same «random» cakes.
  const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const anchorsOf = (random: () => number, count: number, box: LabelBox): Anchor[] => Array.from({ length: count }, (_, i) => ({
    key: `p${String(i)}`,
    x: box.width * (0.3 + 0.4 * random()),
    y: box.height * (0.15 + 0.7 * random()),
  }));

  const crossings = (placed: readonly PlacedLabel[]) => {
    let n = 0;
    for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) if (leadersCross(placed[i]!, placed[j]!)) n += 1;
    return n;
  };

  it('never crosses two leader lines, whatever the anchors (two columns and one)', () => {
    const random = seeded(42);
    for (const box of [wide, labelBoxFor(1100, 600), labelBoxFor(360, 380), labelBoxFor(340, 400)]) {
      for (let trial = 0; trial < 300; trial += 1) {
        const placed = placeLabels(anchorsOf(random, 1 + (trial % 5), box), box);
        expect(placed).toHaveLength(1 + (trial % 5));
        expect(crossings(placed)).toBe(0);
      }
    }
  });

  it('keeps one label per anchor and the labels of a column in their slots without overlapping', () => {
    const random = seeded(7);
    const anchors = anchorsOf(random, 5, wide);
    const placed = placeLabels(anchors, wide);
    expect(placed.map(p => p.key).sort()).toEqual(anchors.map(a => a.key).sort());
    for (const side of ['left', 'right'] as const) {
      const ys = placed.filter(p => p.side === side).map(p => p.slot.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i += 1) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(wide.labelHeight + wide.gap - 1e-6);
      for (const y of ys) {
        expect(y - wide.labelHeight / 2).toBeGreaterThanOrEqual(0);
        expect(y + wide.labelHeight / 2).toBeLessThanOrEqual(wide.height);
      }
    }
  });

  it('puts an anchor left of the middle on the left and the others on the right; a narrow stage has one column on the right', () => {
    const placed = placeLabels([{ key: 'l', x: 300, y: 200 }, { key: 'r', x: 600, y: 250 }], wide);
    expect(placed.find(p => p.key === 'l')?.side).toBe('left');
    expect(placed.find(p => p.key === 'r')?.side).toBe('right');
    const narrow = labelBoxFor(400, 400);
    expect(narrow.columns).toBe(1);
    expect(placeLabels([{ key: 'l', x: 40, y: 100 }], narrow)[0]?.side).toBe('right');
  });

  it('gives a stage under 330px no columns at all: the cake takes the width and the labels stand in a list under it', () => {
    const stacked = labelBoxFor(260, 320);
    expect(stacked.columns).toBe(0);
    expect(placeLabels([{ key: 'a', x: 100, y: 100 }], stacked)).toEqual([]);
    expect(cakeShare(stacked)).toEqual({ share: 1, centre: 130 });
    expect(labelBoxFor(330, 380).columns).toBe(1);
  });

  it('hands labels to the other column when one would not fit the stage’s height', () => {
    const short = labelBoxFor(900, 150);
    const all = [0, 1, 2, 3, 4].map(i => ({ key: `p${String(i)}`, x: 300 + i, y: 40 + i * 10 }));
    const placed = placeLabels(all, short);
    expect(placed).toHaveLength(5);
    expect(crossings(placed)).toBe(0);
  });

  it('spreads slots in order, never closer than a label plus its gap, inside the stage', () => {
    const slots = slotHeights([100, 105, 110], wide);
    expect(slots[1]! - slots[0]!).toBeGreaterThanOrEqual(wide.labelHeight + wide.gap);
    expect(slotHeights([5, 6], wide)[0]!).toBeGreaterThanOrEqual(wide.margin + wide.labelHeight / 2);
    expect(slotHeights([wide.height, wide.height - 1], wide).at(-1)!).toBeLessThanOrEqual(wide.height - wide.margin - wide.labelHeight / 2);
    expect(slotHeights([], wide)).toEqual([]);
  });

  it('draws each leader as one smooth curve from the label to the point, with no dashes', () => {
    const [one] = placeLabels([{ key: 'a', x: 400, y: 200 }], wide);
    const path = leaderPath(one!);
    expect(path).toMatch(/^M [\d.]+ [\d.]+ C [\d. ,-]+$/);
    expect(path.endsWith('400.0 200.0')).toBe(true);
    expect(path).not.toMatch(/[LQ]/);
  });

  it('reserves a column each side on a wide stage and one on a narrow one for the cake’s share', () => {
    expect(cakeShare(labelBoxFor(900, 520)).share).toBeLessThan(0.7);
    expect(cakeShare(labelBoxFor(400, 400)).share).toBeGreaterThanOrEqual(0.3);
    const wideBox = labelBoxFor(900, 520);
    expect(cakeShare(wideBox).centre).toBeCloseTo(450, 6);
    expect(cakeShare(labelBoxFor(400, 400)).centre).toBeLessThan(200);
  });
});

describe('which drawing the stage shows', () => {
  it('is the 3D by default', () => {
    expect(stageDecision({ choice: null, reducedMotion: false, failure: null })).toEqual({ show: '3d', note: null });
  });
  it('is the simple drawing, with a note, when the device asks for less motion, and 3D is still a choice away', () => {
    expect(stageDecision({ choice: null, reducedMotion: true, failure: null })).toEqual({ show: '2d', note: 'motion' });
    expect(stageDecision({ choice: '3d', reducedMotion: true, failure: null })).toEqual({ show: '3d', note: null });
  });
  it('keeps what the person chose', () => {
    expect(stageDecision({ choice: '2d', reducedMotion: false, failure: null })).toEqual({ show: '2d', note: null });
  });
  it('falls back to the drawing, with the reason, whenever the 3D failed, whatever was chosen', () => {
    expect(stageDecision({ choice: '3d', reducedMotion: false, failure: 'webgl' })).toEqual({ show: '2d', note: 'webgl' });
    expect(stageDecision({ choice: null, reducedMotion: true, failure: 'load' })).toEqual({ show: '2d', note: 'load' });
  });
});
