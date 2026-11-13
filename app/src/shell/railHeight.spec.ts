import { describe, expect, it } from 'vitest';
import shellCss from './AppShell.module.css?raw';
import tokensCss from '../styles/tokens.css?raw';
import { SECTIONS } from './sections';

// ⚠️ THE RAIL FITS THE LAB TABLET'S WINDOW. In landscape the tablet shows 648px under Chrome's bars (driven 13 Oct
// 2026); at 64px an item the rail needed 700 and its foot — the account — was cut. This adds the rail up the way the
// stylesheet draws it and checks it against each window it is drawn for. jsdom draws nothing, so the numbers come from
// the CSS text. Since «Labels» (13 Nov 2026) an owner with every section sees TEN items in the rail.
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
function railNeeds(itemHeight: number, { withMark = true }: { withMark?: boolean } = {}): number {
  const s4 = token('--s4');
  const mark = /\.mark\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const markMargin = token(/margin-bottom:\s*var\((--[\w-]+)\)/.exec(mark)?.[1] ?? '');
  const items = mostItems(); // every section anybody is shown together, Settings included
  return 2 * s4 + (withMark ? 44 + markMargin : 0) + items * itemHeight + (items + 1) * 4 + 4 + 56;
}

describe('the rail on a short window', () => {
  it('has ten items at most (the sum below counts that many)', () => {
    // Since 13 Nov 2026 «Labels» follows Recipes in the rail.
    expect(mostItems()).toBe(10);
    // …and the sales owner's rail, with Clients, is shorter than that: Home, Clients, Food cost, Settings.
    expect(SECTIONS.length).toBe(11);
  });

  it('gives 64px above 835px, which fits any window from 836px', () => {
    const base = /\.railItem\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(minHeight(base)).toBe(64);
    expect(railNeeds(64)).toBeLessThanOrEqual(836);
  });

  it('gives 56px up to 835px, which fits any window from 756px', () => {
    expect(minHeight(itemAt(835))).toBe(56);
    expect(railNeeds(56)).toBeLessThanOrEqual(756);
  });

  it('gives each item 48px up to 755px — the touch target of every other control — which fits any window from 676px', () => {
    const block = itemAt(755);
    expect(minHeight(block)).toBe(48);
    // The padding shrinks too, or the icon and the label would hold the item at 55px whatever min-height says.
    expect(px(/padding:\s*([^;]+);/.exec(block ?? '')?.[1])).toBeLessThanOrEqual(3);
    expect(railNeeds(48)).toBeLessThanOrEqual(676);
  });

  it('then fits the lab tablet (648px) by leaving out the brand letter, never by shrinking an item below 48px', () => {
    expect(token('--s4')).toBe(16);
    expect(railNeeds(48)).toBeGreaterThan(648);
    expect(/@media\s*\(max-height:\s*675px\)\s*\{\s*\.mark\s*\{\s*display:\s*none;\s*\}/.test(css)).toBe(true);
    expect(railNeeds(48, { withMark: false })).toBe(616);
    expect(railNeeds(48, { withMark: false })).toBeLessThanOrEqual(648);
    // No step of the rail draws an item under 48px.
    for (const block of css.matchAll(/\.railItem\s*\{([^}]*)\}/g)) expect(minHeight(block[1])).toBeGreaterThanOrEqual(48);
  });
});
