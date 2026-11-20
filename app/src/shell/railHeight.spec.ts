import { describe, expect, it } from 'vitest';
import shellCss from './AppShell.module.css?raw';
import tokensCss from '../styles/tokens.css?raw';
import { RAIL_PLACES_SHORT, SECTIONS } from './sections';

// ⚠️ THE RAIL FITS THE LAB TABLET'S WINDOW. In landscape the tablet shows 648px under Chrome's bars (driven 13 Oct
// 2026); at 64px an item the rail needed 700 and its foot — the account — was cut. This adds the rail up the way the
// stylesheet draws it and checks it against each window it is drawn for. jsdom draws nothing, so the numbers come from
// the CSS text. Since «Cakes» (20 Nov 2026) an owner with every section sees TWELVE places in the rail: the steps for a rail
// of up to 11 are the old ones, and a rail marked `data-items="12"` has its own, one item earlier, ending in «More».
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const px = (value: string | undefined): number => Number(/(-?\d+(?:\.\d+)?)px/.exec(value ?? '')?.[1] ?? NaN);
const token = (name: string): number => px(new RegExp(`${name}:\s*([^;]+);`).exec(tokensCss)?.[1]);
const css = withoutComments(shellCss);
const itemAt = (maxHeight: number): string | undefined =>
  new RegExp(`@media\\s*\\(max-height:\\s*${maxHeight}px\\)\\s*\\{\\s*\\.railItem\\s*\\{([^}]*)\\}`).exec(css)?.[1];
const minHeight = (block: string | undefined): number => px(/min-height:\s*([^;]+);/.exec(block ?? '')?.[1]);

// ⚠️ NOBODY IS SHOWN THE CALCULATOR AND CLIENTS TOGETHER: Clients is the sales owner's, who has no Calculator (session/visibility.ts),
// so the fullest rail is every section but that one.
const mostItems = (): number => SECTIONS.filter(section => section.id !== 'clients').length;

// The rail's own padding (top + bottom), the brand (44) and its margin below (read from .mark) unless the window hides it,
// the items with the 4px gaps of the main nav (one more gap than items, counted generously), the gap to the account nav, and
// the account nav (56).
function railNeeds(itemHeight: number, { withMark = true, items = RAIL_PLACES_SHORT }: { withMark?: boolean; items?: number } = {}): number {
  const s4 = token('--s4');
  const mark = /\.mark\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const markMargin = token(/margin-bottom:\s*var\((--[\w-]+)\)/.exec(mark)?.[1] ?? '');
  // `items`: the places in the rail, Settings included (11 for a rail of up to 11, 12 for the fullest).
  return 2 * s4 + (withMark ? 44 + markMargin : 0) + items * itemHeight + (items + 1) * 4 + 4 + 56;
}

// The content of an item at a step: the 27px icon, the gap, one 13.5px label line (line-height 1.15) and the padding above and
// below. min-height only holds when the content is not taller (16 Nov 2026: bigger icons and labels).
const ICON = 27;
const LABEL_LINE = 13.5 * 1.15;
function contentAt(block: string | undefined, base: string | undefined): number {
  const gap = px(/gap:\s*([^;]+);/.exec(block ?? '')?.[1] ?? /gap:\s*([^;]+);/.exec(base ?? '')?.[1]);
  const padding = /padding:\s*([^;]+);/.exec(block ?? '')?.[1] ?? /padding:\s*([^;]+);/.exec(base ?? '')?.[1] ?? '';
  const vertical = padding.startsWith('var(--s2)') ? token('--s2') : px(padding);
  return ICON + gap + LABEL_LINE + 2 * vertical;
}

describe('the rail on a short window', () => {
  const base = /\.railItem\s*\{([^}]*)\}/.exec(css)?.[1];

  it('counts eleven places for a rail of up to 11 (the sums below count that many)', () => {
    // Since 13 Nov 2026 «Labels» follows Recipes in the rail; since 18 Nov 2026 «Bookings» follows the Home.
    expect(RAIL_PLACES_SHORT).toBe(11);
    // The fullest rail is one more: «Cakes» (20 Nov 2026), which is what the `data-items="12"` steps below are for.
    expect(mostItems()).toBe(12);
    // …and the sales owner's rail, with Clients, is shorter than that: Home, Bookings, Clients, Food cost, Cakes, Settings.
    expect(SECTIONS.length).toBe(13);
  });

  it('gives 64px above 903px, which fits any window from 904px', () => {
    expect(minHeight(base)).toBe(64);
    expect(contentAt(base, base)).toBeLessThanOrEqual(64);
    expect(railNeeds(64)).toBeLessThanOrEqual(904);
  });

  it('gives 56px up to 903px, which fits any window from 816px', () => {
    expect(minHeight(itemAt(903))).toBe(56);
    expect(contentAt(itemAt(903), base)).toBeLessThanOrEqual(56);
    expect(railNeeds(56)).toBeLessThanOrEqual(816);
  });

  it('gives 52px up to 815px without the brand letter, which fits any window from 716px', () => {
    expect(minHeight(itemAt(815))).toBe(52);
    expect(contentAt(itemAt(815), base)).toBeLessThanOrEqual(52);
    expect(/@media\s*\(max-height:\s*815px\)\s*\{[^@]*\.mark\s*\{\s*display:\s*none;\s*\}/.test(css)).toBe(true);
    expect(railNeeds(52, { withMark: false })).toBeLessThanOrEqual(716);
  });

  it('then fits the lab tablet (648px) with the rail tightened, Settings and the account included, never an item below 48px', () => {
    expect(token('--s4')).toBe(16);
    expect(token('--s2')).toBe(8);
    const step = /@media\s*\(max-height:\s*715px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const rule = (selector: string): string => new RegExp(`(?:^|\\s)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(step)?.[1] ?? '';
    const rail = rule('.rail');
    const nav = rule('.railNav');
    const item = rule('.railItem');
    expect(rail).toMatch(/padding-top:\s*var\(--s2\)/);
    expect(rail).toMatch(/padding-bottom:\s*var\(--s2\)/);
    expect(px(/gap:\s*([^;]+);/.exec(rail)?.[1])).toBe(2);
    expect(px(/gap:\s*([^;]+);/.exec(nav)?.[1])).toBe(2);
    const height = minHeight(item);
    expect(height).toBe(49);
    expect(contentAt(item, item)).toBeLessThanOrEqual(height);
    // Padding (8 + 8), the items with a 2px gap more than there are items, the 2px gap to the account nav, the account nav (56).
    const items = RAIL_PLACES_SHORT;
    const needs = 2 * token('--s2') + items * height + (items + 1) * 2 + 2 + 56;
    expect(needs).toBe(637);
    expect(needs).toBeLessThanOrEqual(648);
    // No step of the rail draws an item under 48px.
    for (const block of css.matchAll(/\.railItem\s*\{([^}]*)\}/g)) {
      if (/min-height/.test(block[1] ?? '')) expect(minHeight(block[1])).toBeGreaterThanOrEqual(48);
    }
  });
});

// ⚠️ THE FULLEST RAIL (12 places: every section but Clients). Each step moves up by one item; at 687px or less the last two sections go
// under «More» (`data-spill`), leaving 11 places. Every number comes from the stylesheet text.
describe('a rail of 12 places', () => {
  const base = /\.railItem\s*\{([^}]*)\}/.exec(css)?.[1];
  const TWELVE = 12;
  const ITEM = '.rail[data-items="12"] .railItem';
  // The body of `@media (max-height: Npx) { … }`, up to the closing brace at the start of a line.
  const stepAt = (maxHeight: number): string =>
    new RegExp(`@media\\s*\\(max-height:\\s*${maxHeight}px\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
  const escapeRe = (text: string): string => text.replace(/[.[\]"=]/g, match => `\\${match}`);
  // The declarations of one selector inside a step.
  const rule = (step: string, selector: string): string =>
    new RegExp(`(?:^|\\n)\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`).exec(step)?.[1] ?? '';
  const tightNeeds = (items: number): number => 2 * token('--s2') + items * 49 + (items + 1) * 2 + 2 + 56;

  it('is the number of places the fullest rail has, one more than the short rail holds', () => {
    expect(mostItems()).toBe(TWELVE);
    expect(TWELVE).toBe(RAIL_PLACES_SHORT + 1);
  });

  it('gives 64px above 971px (the base item), which fits any window from 972px', () => {
    expect(minHeight(base)).toBe(64);
    expect(railNeeds(64, { items: TWELVE })).toBe(972);
  });

  it('gives 56px up to 971px, which fits any window from 876px', () => {
    const item = rule(stepAt(971), ITEM);
    expect(minHeight(item)).toBe(56);
    expect(contentAt(item, base)).toBeLessThanOrEqual(56);
    expect(railNeeds(64, { items: TWELVE }) - 1).toBe(971);
    expect(railNeeds(56, { items: TWELVE })).toBe(876);
  });

  it('gives 52px up to 875px without the brand letter, which fits any window from 768px', () => {
    const step = stepAt(875);
    const item = rule(step, ITEM);
    expect(minHeight(item)).toBe(52);
    expect(contentAt(item, base)).toBeLessThanOrEqual(52);
    expect(rule(step, '.rail[data-items="12"] .mark')).toMatch(/display:\s*none/);
    expect(railNeeds(56, { items: TWELVE }) - 1).toBe(875);
    expect(railNeeds(52, { items: TWELVE, withMark: false })).toBe(768);
  });

  it('gives 49px up to 767px with the rail tightened, which fits any window from 688px', () => {
    const step = stepAt(767);
    const rail = rule(step, '.rail[data-items="12"]');
    const nav = rule(step, '.rail[data-items="12"] .railNav');
    const item = rule(step, ITEM);
    expect(rail).toMatch(/padding-top:\s*var\(--s2\)/);
    expect(rail).toMatch(/padding-bottom:\s*var\(--s2\)/);
    expect(px(/gap:\s*([^;]+);/.exec(rail)?.[1])).toBe(2);
    expect(px(/gap:\s*([^;]+);/.exec(nav)?.[1])).toBe(2);
    expect(minHeight(item)).toBe(49);
    expect(contentAt(item, item)).toBeLessThanOrEqual(49);
    expect(railNeeds(52, { items: TWELVE, withMark: false }) - 1).toBe(767);
    expect(tightNeeds(TWELVE)).toBe(688);
  });

  it('at 687px or less hides the spilled links and shows «More»: 11 places, which fit the lab tablet (648px)', () => {
    const step = stepAt(687);
    expect(rule(step, '.rail[data-items="12"] .railItem[data-spill]')).toMatch(/display:\s*none/);
    expect(rule(step, '.rail[data-items="12"] .railItem.railMore')).toMatch(/display:\s*flex/);
    // «More» is hidden at every other height, and the 49px step above is the one still in force.
    expect(/\.railItem\.railMore\s*\{\s*display:\s*none;/.test(css)).toBe(true);
    expect(tightNeeds(TWELVE) - 1).toBe(687);
    // Two links hidden and «More» shown: the rail holds RAIL_PLACES_SHORT places.
    expect(tightNeeds(RAIL_PLACES_SHORT)).toBe(637);
    expect(tightNeeds(RAIL_PLACES_SHORT)).toBeLessThanOrEqual(648);
  });

  it('never draws an item under 48px, in any step of any rail', () => {
    let seen = 0;
    for (const block of css.matchAll(/\.railItem\s*\{([^}]*)\}/g)) {
      if (!/min-height/.test(block[1] ?? '')) continue;
      seen += 1;
      expect(minHeight(block[1])).toBeGreaterThanOrEqual(48);
    }
    // The base, the three steps for up to 11 places and the three for 12.
    expect(seen).toBe(7);
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
    const base = /\.railItem\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/font-size:\s*13\.5px/);
    expect(base).toMatch(/font-weight:\s*500/);
    expect(base).toMatch(/color:\s*var\(--rail-ink-strong\)/);
  });
});
