import { describe, expect, it } from 'vitest';
import shellCss from './AppShell.module.css?raw';
import tokensCss from '../styles/tokens.css?raw';
import { SECTIONS } from './sections';

// ⚠️ THE RAIL FITS THE LAB TABLET'S WINDOW. In landscape the tablet shows 648px under Chrome's bars (driven 13 Oct
// 2026); at 64px an item the rail needed 700 and its foot — the account — was cut. This adds the rail up the way the
// stylesheet draws it and checks it against each window it is drawn for. jsdom draws nothing, so the numbers come from
// the CSS text. Since step 3g-1 (the Home) an owner with every section sees NINE items in the rail.
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

// The rail's own padding (top + bottom), the brand (44) and its margin below (read from .mark), the items with the 4px
// gaps of the main nav (one more gap than items, counted generously), the gap to the account nav, and the account nav (56).
function railNeeds(itemHeight: number): number {
  const s4 = token('--s4');
  const mark = /\.mark\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const markMargin = token(/margin-bottom:\s*var\((--[\w-]+)\)/.exec(mark)?.[1] ?? '');
  const items = mostItems(); // every section anybody is shown together, Settings included
  return 2 * s4 + 44 + markMargin + items * itemHeight + (items + 1) * 4 + 4 + 56;
}

describe('the rail on a short window', () => {
  it('has nine items at most (the sum below counts that many)', () => {
    expect(mostItems()).toBe(9);
    // …and the sales owner's rail, with Clients, is shorter than that: Home, Clients, Food cost, Settings.
    expect(SECTIONS.length).toBe(10);
  });

  it('gives each item 48px up to 720px of height — the touch target of every other control', () => {
    const block = itemAt(720);
    expect(minHeight(block)).toBe(48);
    // The padding shrinks too, or the icon and the label would hold the item at 55px whatever min-height says.
    expect(px(/padding:\s*([^;]+);/.exec(block ?? '')?.[1])).toBeLessThanOrEqual(3);
  });

  it('then fits the lab tablet (648px): padding, brand, nine items, account', () => {
    expect(token('--s4')).toBe(16);
    expect(railNeeds(48)).toBe(624);
    expect(railNeeds(48)).toBeLessThanOrEqual(648);
  });

  it('gives 56px up to 800px, which fits any window from 721px', () => {
    expect(minHeight(itemAt(800))).toBe(56);
    expect(railNeeds(56)).toBeLessThanOrEqual(721);
  });

  it('gives 64px above 800px, which fits any window from 801px', () => {
    const base = /\.railItem\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(minHeight(base)).toBe(64);
    expect(railNeeds(64)).toBeLessThanOrEqual(801);
  });
});
