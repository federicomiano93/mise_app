import { describe, expect, it } from 'vitest';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import {
  appearedParts, BAR_BAND, CUT_ANGLE, DISC_GAP_SHARE, SLOT_SPREAD_PX, TIER_BOARD_CM, cakeLayout, cakeShare, homeView, labelBoxFor, leaderPath, leadersCross, partAnchors, pickedPart, placeLabels,
  glowSource, highlightLevel, HIGHLIGHT_CHOSEN, HIGHLIGHT_HOVER, sceneSignature, slotHeights, stageDecision, tapAction, webglAvailable,
} from './cake3dModel';
import type { Anchor, LabelBox, PlacedLabel } from './cake3dModel';
import { cakeLooks, looksKey } from './cakeLook';

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
  packaging: [], assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, discHeightCm: null, ref: REF, model: 1,
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

  it('without a filling the discs stand apart by an empty gap, so the person can count them', () => {
    // 3 discs of 3 cm, two gaps of 0.75 cm: the second disc starts one disc and one gap up.
    const discs = top!.layers.filter(l => l.kind === 'base');
    expect(discs[1]!.y0 - (discs[0]!.y0 + discs[0]!.h)).toBeCloseTo(3 * DISC_GAP_SHARE, 6);
    expect(top!.stackHeight).toBeCloseTo(9 + 2 * 3 * DISC_GAP_SHARE, 6);
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

  it('a base with no card is drawn but gets no callout (nothing to name)', () => {
    const bare = cakeLayout(cakeGeometry({ ...FULL, tiers: 1, lines: [] })).tiers[0]!;
    expect(bare.layers.filter(l => l.kind === 'base')).toHaveLength(3);
    expect(partAnchors(bare, 'cut')).toEqual({});
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

  it('spaces the slots of a column EVENLY, never closer than a label plus its gap, inside the stage and clear of the total’s strip', () => {
    const slots = slotHeights([100, 105, 110], wide);
    expect(slots[1]! - slots[0]!).toBeGreaterThanOrEqual(wide.labelHeight + wide.gap);
    expect(slots[2]! - slots[1]!).toBeCloseTo(slots[1]! - slots[0]!, 6);
    expect(slots[1]! - slots[0]!).toBeLessThanOrEqual(SLOT_SPREAD_PX);
    expect(slotHeights([5, 6], wide)[0]!).toBeGreaterThanOrEqual(wide.margin + wide.labelHeight / 2);
    const lowest = wide.height - wide.margin - wide.foot - wide.labelHeight / 2;
    expect(slotHeights([wide.height, wide.height - 1], wide).at(-1)!).toBeLessThanOrEqual(lowest);
    expect(slotHeights([], wide)).toEqual([]);
  });

  it('centres a column on where its anchors are, and one label stands at its anchor’s height', () => {
    expect(slotHeights([250], wide)).toEqual([250]);
    const slots = slotHeights([200, 300], wide);
    expect((slots[0]! + slots[1]!) / 2).toBeCloseTo(250, 6);
  });

  it('leaves the strip along the bottom free for the total: no label reaches into it', () => {
    const placed = placeLabels([0, 1, 2, 3].map(i => ({ key: `p${String(i)}`, x: 300, y: 500 + i })), wide);
    for (const label of placed) expect(label.slot.y + wide.labelHeight / 2).toBeLessThanOrEqual(wide.height - wide.foot);
  });

  it('keeps the band of the view buttons free at the top: no label reaches into it, at any width', () => {
    const random = seeded(11);
    for (const width of [330, 400, 560, 800, 900, 1100, 1440]) {
      const box = labelBoxFor(width, Math.min(600, Math.max(380, width * 0.4)));
      for (let trial = 0; trial < 100; trial += 1) {
        const placed = placeLabels(anchorsOf(random, 1 + (trial % 5), box).map(a => ({ ...a, y: a.y * 0.2 })), box);
        for (const label of placed) expect(label.slot.y - box.labelHeight / 2).toBeGreaterThanOrEqual(BAR_BAND);
      }
    }
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
    expect(stageDecision({ reducedMotion: false, failure: null })).toEqual({ show: '3d', note: null });
  });
  it('is the simple drawing, with a note, when the device asks for less motion', () => {
    expect(stageDecision({ reducedMotion: true, failure: null })).toEqual({ show: '2d', note: 'motion' });
  });
  it('falls back to the drawing, with the reason, whenever the 3D failed', () => {
    expect(stageDecision({ reducedMotion: false, failure: 'webgl' })).toEqual({ show: '2d', note: 'webgl' });
    expect(stageDecision({ reducedMotion: true, failure: 'load' })).toEqual({ show: '2d', note: 'load' });
    expect(stageDecision({ reducedMotion: false, failure: 'error' })).toEqual({ show: '2d', note: 'error' });
  });
});

describe('whether the 3D can be drawn at all', () => {
  const docWith = (contexts: Record<string, object | null>, asked: string[] = []) => ({
    createElement: () => ({
      getContext: (kind: string) => { asked.push(kind); return contexts[kind] ?? null; },
    }),
  }) as unknown as Document;

  it('asks for WebGL 2 only (three.js has no WebGL 1) and says no when it is missing', () => {
    const asked: string[] = [];
    expect(webglAvailable(docWith({ webgl: {} }, asked))).toBe(false);
    expect(asked).toEqual(['webgl2']);
  });
  it('says yes for a WebGL 2 context, and gives it back at once', () => {
    const lose = { loseContext: () => { lost += 1; } };
    let lost = 0;
    expect(webglAvailable(docWith({ webgl2: { getExtension: () => lose } }))).toBe(true);
    expect(lost).toBe(1);
  });
  it('says no when asking throws', () => {
    expect(webglAvailable({ createElement: () => { throw new Error('no'); } } as unknown as Document)).toBe(false);
  });
});

describe('what the scene is rebuilt on', () => {
  const tiersOf = (change: (cake: Cake) => Cake, view: 'cut' | 'whole' = 'cut') => sceneSignature(cakeLayout(cakeGeometry(change(FULL))), view);
  const base = tiersOf(cake => cake);

  it('does not move when only grams or names change', () => {
    expect(tiersOf(cake => ({ ...cake, lines: cake.lines.map(line => ({ ...line, grams: 123 })) }))).toBe(base);
    expect(tiersOf(cake => ({ ...cake, name: 'Another name' }))).toBe(base);
  });
  it('moves with the diameter, the discs, the tiers, the view and which parts have cards', () => {
    expect(tiersOf(cake => ({ ...cake, diameterCm: 28 }))).not.toBe(base);
    expect(tiersOf(cake => ({ ...cake, discs: 2 }))).not.toBe(base);
    expect(tiersOf(cake => ({ ...cake, tiers: 1 }))).not.toBe(base);
    expect(tiersOf(cake => cake, 'whole')).not.toBe(base);
    expect(tiersOf(cake => ({ ...cake, lines: cake.lines.filter(line => line.part !== 'soak') }))).not.toBe(base);
    expect(tiersOf(cake => ({ ...cake, lines: [...cake.lines, { tier: 1, part: 'coating', productId: 'F', grams: null }] }))).not.toBe(base);
  });
});

describe('what the scene is rebuilt on: the look the names give', () => {
  const NAMES: Record<string, string> = { A: 'Pan di spagna', B: 'Bagna al rum', C: 'Crema pasticcera', D: 'Panna', E: 'Frutti di bosco' };
  // The signature the 3D view computes: the layout, the view and the looks of the names.
  const signatureOf = (cake: Cake, names: Record<string, string>) =>
    sceneSignature(cakeLayout(cakeGeometry(cake)), 'cut', looksKey(cakeLooks(cakeGeometry(cake), id => names[id] ?? '')));
  const base = signatureOf(FULL, NAMES);

  it('a recipe that looks different rebuilds: a chocolate coating instead of a cream one', () => {
    expect(signatureOf(FULL, { ...NAMES, D: 'Glassa al cioccolato' })).not.toBe(base);
    expect(signatureOf(FULL, { ...NAMES, E: 'Riccioli di cioccolato' })).not.toBe(base);
    expect(signatureOf(FULL, { ...NAMES, B: 'Bagna al caffè' })).not.toBe(base);
  });
  it('typing grams, or a rename that looks the same, does not', () => {
    expect(signatureOf({ ...FULL, lines: FULL.lines.map(line => ({ ...line, grams: 321 })) }, NAMES)).toBe(base);
    expect(signatureOf(FULL, { ...NAMES, A: 'Genoise', D: 'Chantilly' })).toBe(base);
  });
});

describe('what a change of the cake makes appear', () => {
  const withLines = (lines: Cake['lines'], extra: Partial<Cake> = {}) => cakeLayout(cakeGeometry({ ...FULL, lines, ...extra }));
  const base = { tier: 0, part: 'base' as const, productId: 'A', grams: null };
  const soak = { tier: 0, part: 'soak' as const, productId: 'B', grams: null };
  const filling = { tier: 0, part: 'filling' as const, productId: 'C', grams: null };
  const coating = { tier: 0, part: 'coating' as const, productId: 'D', grams: null };

  it('a first build never plays', () => {
    expect(appearedParts(null, withLines([base, soak]))).toEqual([]);
  });

  it('lists a part that went from no card to a card, per tier', () => {
    expect(appearedParts(withLines([]), withLines([base]))).toEqual([{ tier: 0, part: 'base' }]);
    expect(appearedParts(withLines([base]), withLines([base, soak]))).toEqual([{ tier: 0, part: 'soak' }]);
    expect(appearedParts(withLines([base]), withLines([base, filling]))).toEqual([{ tier: 0, part: 'filling' }]);
    const decoration = { tier: 1, part: 'decoration' as const, productId: 'E', grams: null };
    expect(appearedParts(withLines([base]), withLines([base, decoration]))).toEqual([{ tier: 1, part: 'decoration' }]);
  });

  it('lists several in the order a cake is built', () => {
    expect(appearedParts(withLines([]), withLines([coating, soak, base])).map(a => a.part)).toEqual(['base', 'soak', 'coating']);
  });

  it('says nothing for a second card in a part, a part that goes away, or no change', () => {
    expect(appearedParts(withLines([base]), withLines([base, { ...base, productId: 'Z' }]))).toEqual([]);
    expect(appearedParts(withLines([base, soak]), withLines([base]))).toEqual([]);
    expect(appearedParts(withLines([base, soak]), withLines([base, soak]))).toEqual([]);
  });

  it('says nothing when the shape changed (another diameter or number of discs): that is a different cake, not a part added', () => {
    expect(appearedParts(withLines([]), withLines([base], { discs: 2 }))).toEqual([]);
    expect(appearedParts(withLines([]), withLines([base], { diameterCm: 30 }))).toEqual([]);
  });

  it('a tier that did not exist before does not play', () => {
    expect(appearedParts(withLines([], { tiers: 1 }), withLines([{ tier: 1, part: 'base', productId: 'A', grams: null }]))).toEqual([]);
  });

  it('the layout knows whether the base has a card, so the discs of a base with none are drawn faint', () => {
    expect(withLines([]).tiers[0]!.hasBase).toBe(false);
    expect(withLines([]).tiers[0]!.layers.filter(l => l.kind === 'base')).toHaveLength(3);
    expect(withLines([base]).tiers[0]!.hasBase).toBe(true);
    // The signature changes with it, so the scene is rebuilt when the first base card arrives.
    expect(sceneSignature(withLines([]), 'cut')).not.toBe(sceneSignature(withLines([base]), 'cut'));
  });
});

describe('the chosen layer’s highlight', () => {
  it('lights the chosen part more than the hovered one, and nothing else', () => {
    expect(highlightLevel(true, false)).toBe(HIGHLIGHT_CHOSEN);
    expect(highlightLevel(false, true)).toBe(HIGHLIGHT_HOVER);
    expect(highlightLevel(false, false)).toBe(0);
    expect(HIGHLIGHT_CHOSEN).toBeGreaterThan(HIGHLIGHT_HOVER);
    expect(HIGHLIGHT_CHOSEN).toBeLessThan(0.5);
  });

  it('glows with the material’s own colour, its picture when it has one, and never a see-through or colourless material', () => {
    expect(glowSource({ color: {} })).toBe('colour');
    expect(glowSource({ color: {}, map: {} })).toBe('map');
    expect(glowSource({ color: {}, transparent: true })).toBe('none');
    expect(glowSource({})).toBe('none');
  });
});
