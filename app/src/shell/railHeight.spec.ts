import { describe, expect, it } from 'vitest';
import shellCss from './AppShell.module.css?raw';
import tokensCss from '../styles/tokens.css?raw';
import { RAIL_PLACES_SHORT, SECTIONS } from './sections';

// ⚠️ THE RAIL FITS THE LAB TABLET'S WINDOW. In landscape the tablet shows 648px under Chrome's bars (driven 13 Oct 2026). This adds the rail up
// the way the stylesheet draws it and checks it against each window it is drawn for. jsdom draws nothing, so the numbers come from the CSS
// text. Since «Cakes» (20 Nov 2026) an owner with every section sees TWELVE places in the rail: the steps for a rail of up to 11 are the
// first set, and a rail marked `data-items="12"` has its own, one item earlier, ending in «More».
//
// The rail of 22 Nov 2026 (the single bar) has no brand letter and no account at its foot, but a 17px rule above Settings. Its sum is
//     padding (top + bottom) + places × (item + gap) + 17
// (one gap between each pair of the nav's children: the group, the rule, Settings; the group's own gaps are the same size).
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const px = (value: string | undefined): number => Number(/(-?\d+(?:\.\d+)?)px/.exec(value ?? '')?.[1] ?? NaN);
const token = (name: string): number => px(new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss)?.[1]);
const css = withoutComments(shellCss);
const base = /\.railItem\s*\{([^}]*)\}/.exec(css)?.[1];
const minHeight = (block: string | undefined): number => px(/min-height:\s*([^;]+);/.exec(block ?? '')?.[1]);
// The body of `@media (max-height: Npx) { … }`, up to the closing brace at the start of a line.
const stepAt = (maxHeight: number): string =>
  new RegExp(`@media\\s*\\(max-height:\\s*${maxHeight}px\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
const escapeRe = (text: string): string => text.replace(/[.[\]"=]/g, match => `\\${match}`);
// The declarations of one selector inside a step (a selector list is matched by its last member too).
const rule = (step: string, selector: string): string =>
  new RegExp(`(?:^|\\n|,\\s*)\\s*${escapeRe(selector)}\\s*(?:,[^{]*)?\\{([^}]*)\\}`).exec(step)?.[1] ?? '';

// ⚠️ NOBODY IS SHOWN THE CALCULATOR AND CLIENTS TOGETHER: Clients is the sales owner's, who has no Calculator (session/visibility.ts),
// so the fullest rail is every section but that one.
const mostItems = (): number => SECTIONS.filter(section => section.id !== 'clients').length;

// The rule above Settings: 1px and its margins (read from .railRule), as the stylesheet draws it.
function ruleHeight(): number {
  const block = /\.railRule\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const margin = /margin:\s*(\d+)px\s+\d+px/.exec(block)?.[1];
  return px(/height:\s*([^;]+);/.exec(block)?.[1]) + 2 * Number(margin);
}

// What the rail needs for `places` places (Settings included), items `item` tall, with `gap` between them and `padding` at the top and bottom.
const needs = (places: number, item: number, { gap = 4, padding = 32 }: { gap?: number; padding?: number } = {}): number =>
  padding + places * (item + gap) + ruleHeight();
const TIGHT = { gap: 2, padding: 16 };

// The content of an item at a step: the 27px icon, the gap, one 13.5px label line (line-height 1.15) and the padding above and
// below. min-height only holds when the content is not taller.
const ICON = 27;
const LABEL_LINE = 13.5 * 1.15;
function contentAt(block: string | undefined): number {
  const gap = px(/gap:\s*([^;]+);/.exec(block ?? '')?.[1] ?? /gap:\s*([^;]+);/.exec(base ?? '')?.[1]);
  const padding = /padding:\s*([^;]+);/.exec(block ?? '')?.[1] ?? /padding:\s*([^;]+);/.exec(base ?? '')?.[1] ?? '';
  const vertical = padding.startsWith('var(--s2)') ? token('--s2') : px(padding);
  return ICON + gap + LABEL_LINE + 2 * vertical;
}

describe('the rail itself', () => {
  it('has no brand letter and no account at its foot', () => {
    expect(css).not.toMatch(/\.mark\b/);
    expect(css).not.toMatch(/\.avatar/);
    expect(css).not.toMatch(/\.spacer/);
  });

  it('has a 1px rule above Settings: 8px above and below, 14px at the sides, the rail-rule colour', () => {
    const block = /\.railRule\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/height:\s*1px/);
    expect(block).toMatch(/margin:\s*8px 14px/);
    expect(block).toMatch(/background:\s*var\(--rail-rule\)/);
    expect(tokensCss).toMatch(/--rail-rule:\s*oklch\(1 0 0 \/ 0\.16\)/);
    expect(ruleHeight()).toBe(17);
  });

  it('spreads its places over the full height with a group that takes what is left', () => {
    const block = /\.railGroup\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/justify-content:\s*space-between/);
    expect(block).toMatch(/display:\s*flex/);
    expect(block).toMatch(/flex:\s*1 0 auto/);
    expect(block).toMatch(/min-height:\s*0/);
  });
});

describe('the rail on a short window (up to 11 places)', () => {
  const PLACES = RAIL_PLACES_SHORT;

  it('counts eleven places for a rail of up to 11 (the sums below count that many)', () => {
    // Since 13 Nov 2026 «Labels» follows Recipes in the rail; since 18 Nov 2026 «Bookings» follows the Home.
    expect(RAIL_PLACES_SHORT).toBe(11);
    // The fullest rail is one more: «Cakes» (20 Nov 2026), which is what the `data-items="12"` steps below are for.
    expect(mostItems()).toBe(12);
    // …and the sales owner's rail, with Clients, is shorter than that: Home, Bookings, Clients, Food cost, Cakes, Settings.
    expect(SECTIONS.length).toBe(13);
  });

  it('gives 64px at the top, which needs 797px', () => {
    expect(minHeight(base)).toBe(64);
    expect(contentAt(base)).toBeLessThanOrEqual(64);
    expect(needs(PLACES, 64)).toBe(797);
  });

  it('gives 56px from 796px of height, which fits down to 709px', () => {
    const item = rule(stepAt(796), '.railItem');
    expect(minHeight(item)).toBe(56);
    expect(contentAt(item)).toBeLessThanOrEqual(56);
    expect(needs(PLACES, 64) - 1).toBe(796);
    expect(needs(PLACES, 56)).toBe(709);
  });

  it('gives 52px from 708px, which fits down to 665px', () => {
    const item = rule(stepAt(708), '.railItem');
    expect(minHeight(item)).toBe(52);
    expect(contentAt(item)).toBeLessThanOrEqual(52);
    expect(needs(PLACES, 56) - 1).toBe(708);
    expect(needs(PLACES, 52)).toBe(665);
  });

  it('then fits the lab tablet (648px) with the rail tightened, Settings included, at 49px', () => {
    expect(token('--s2')).toBe(8);
    expect(token('--s1')).toBe(4);
    const step = stepAt(664);
    expect(rule(step, '.rail')).toMatch(/padding-top:\s*var\(--s2\)/);
    expect(rule(step, '.rail')).toMatch(/padding-bottom:\s*var\(--s2\)/);
    expect(px(/gap:\s*([^;]+);/.exec(rule(step, '.railNav'))?.[1])).toBe(2);
    expect(px(/gap:\s*([^;]+);/.exec(rule(step, '.railGroup'))?.[1])).toBe(2);
    const item = rule(step, '.railItem');
    expect(minHeight(item)).toBe(49);
    expect(contentAt(item)).toBeLessThanOrEqual(49);
    expect(needs(PLACES, 52) - 1).toBe(664);
    expect(needs(PLACES, 49, TIGHT)).toBe(594);
    expect(needs(PLACES, 49, TIGHT)).toBeLessThanOrEqual(648);
  });

  it('goes to 48px from 593px, the touch target\'s floor', () => {
    expect(minHeight(rule(stepAt(593), '.railItem'))).toBe(48);
    expect(needs(PLACES, 49, TIGHT) - 1).toBe(593);
    expect(needs(PLACES, 48, TIGHT)).toBe(583);
  });
});

// ⚠️ THE FULLEST RAIL (12 places: every section but Clients). Each step moves down by one item; only below 633px do the last two sections
// go under «More» (`data-spill`), leaving 11 places. Every number comes from the stylesheet text.
describe('a rail of 12 places', () => {
  const TWELVE = 12;
  const ITEM = '.rail[data-items="12"] .railItem';

  it('is the number of places the fullest rail has, one more than the short rail holds', () => {
    expect(mostItems()).toBe(TWELVE);
    expect(TWELVE).toBe(RAIL_PLACES_SHORT + 1);
  });

  it('gives 64px at the top, which needs 865px', () => {
    expect(minHeight(base)).toBe(64);
    expect(needs(TWELVE, 64)).toBe(865);
  });

  it('gives 56px from 864px, which fits down to 769px', () => {
    const item = rule(stepAt(864), ITEM);
    expect(minHeight(item)).toBe(56);
    expect(contentAt(item)).toBeLessThanOrEqual(56);
    expect(needs(TWELVE, 64) - 1).toBe(864);
    expect(needs(TWELVE, 56)).toBe(769);
  });

  it('gives 52px from 768px, which fits down to 721px', () => {
    const item = rule(stepAt(768), ITEM);
    expect(minHeight(item)).toBe(52);
    expect(contentAt(item)).toBeLessThanOrEqual(52);
    expect(needs(TWELVE, 56) - 1).toBe(768);
    expect(needs(TWELVE, 52)).toBe(721);
  });

  it('gives 49px from 720px with the rail tightened, which fits down to 645px', () => {
    const step = stepAt(720);
    expect(rule(step, '.rail[data-items="12"]')).toMatch(/padding-top:\s*var\(--s2\)/);
    expect(rule(step, '.rail[data-items="12"]')).toMatch(/padding-bottom:\s*var\(--s2\)/);
    expect(px(/gap:\s*([^;]+);/.exec(rule(step, '.rail[data-items="12"] .railNav'))?.[1])).toBe(2);
    expect(px(/gap:\s*([^;]+);/.exec(rule(step, '.rail[data-items="12"] .railGroup'))?.[1])).toBe(2);
    const item = rule(step, ITEM);
    expect(minHeight(item)).toBe(49);
    expect(contentAt(item)).toBeLessThanOrEqual(49);
    expect(needs(TWELVE, 52) - 1).toBe(720);
    expect(needs(TWELVE, 49, TIGHT)).toBe(645);
  });

  it('shows ALL 12 places, Settings included, with no «More», in the lab tablet\'s 648px', () => {
    // 648 is under 720 (the 49px step is in force) and above the 644px step: the rail needs 645 and has 648.
    expect(needs(TWELVE, 49, TIGHT)).toBeLessThanOrEqual(648);
    expect(648).toBeGreaterThan(644);
    // The spill rule starts far below it.
    expect(stepAt(648)).toBe('');
    expect(stepAt(632)).toMatch(/data-spill/);
  });

  it('goes to 48px from 644px, which fits down to 633px', () => {
    expect(minHeight(rule(stepAt(644), ITEM))).toBe(48);
    expect(needs(TWELVE, 49, TIGHT) - 1).toBe(644);
    expect(needs(TWELVE, 48, TIGHT)).toBe(633);
  });

  it('only below what 12 places need at 48px (632px or less) hides the spilled links and shows «More»: 11 places, which need 583px', () => {
    const step = stepAt(632);
    expect(rule(step, '.rail[data-items="12"] .railItem[data-spill]')).toMatch(/display:\s*none/);
    expect(rule(step, '.rail[data-items="12"] .railItem.railMore')).toMatch(/display:\s*flex/);
    // «More» is hidden at every other height.
    expect(/\.railItem\.railMore\s*\{\s*display:\s*none;/.test(css)).toBe(true);
    expect(needs(TWELVE, 48, TIGHT) - 1).toBe(632);
    expect(needs(RAIL_PLACES_SHORT, 48, TIGHT)).toBe(583);
  });

  it('never draws an item under 48px, in any step of any rail', () => {
    let seen = 0;
    for (const block of css.matchAll(/\.railItem\s*\{([^}]*)\}/g)) {
      if (!/min-height/.test(block[1] ?? '')) continue;
      seen += 1;
      expect(minHeight(block[1])).toBeGreaterThanOrEqual(48);
    }
    // The base, the four steps for up to 11 places and the four for 12.
    expect(seen).toBe(9);
  });
});

describe('the rail made more visible (16 Nov 2026)', () => {
  it('is 104px wide, with 27px icons drawn at a 2px stroke', () => {
    expect(token('--rail-w')).toBe(104);
    const icon = /\.railItem \.railIcon\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(icon).toMatch(/width:\s*27px/);
    expect(icon).toMatch(/height:\s*27px/);
    expect(icon).toMatch(/stroke-width:\s*2;/);
  });

  it('writes its labels at 13.5px, weight 500, in the near-white ink', () => {
    expect(base).toMatch(/font-size:\s*13\.5px/);
    expect(base).toMatch(/font-weight:\s*500/);
    expect(base).toMatch(/color:\s*var\(--rail-ink-strong\)/);
  });
});
