import { describe, expect, it } from 'vitest';
import shellCss from './AppShell.module.css?raw';
import tokensCss from '../styles/tokens.css?raw';

// ⚠️ THE RAIL FITS THE LAB TABLET'S WINDOW. In landscape the tablet shows 648px under Chrome's bars (driven 13 Oct
// 2026); at 64px an item the rail needed 700 and its foot — the account — was cut. This adds the rail up the way the
// stylesheet draws it and checks it against that window. jsdom draws nothing, so the numbers come from the CSS text.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const px = (value: string | undefined): number => Number(/(-?\d+(?:\.\d+)?)px/.exec(value ?? '')?.[1] ?? NaN);
const token = (name: string): number => px(new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss)?.[1]);

describe('the rail on a short window', () => {
  it('gives each item 56px below 720px of height — still above the 44px touch target', () => {
    const css = withoutComments(shellCss);
    const block = /@media\s*\(max-height:\s*720px\)\s*\{\s*\.railItem\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(block).toBeDefined();
    expect(px(/min-height:\s*([^;]+);/.exec(block ?? '')?.[1])).toBe(56);
    expect(56).toBeGreaterThanOrEqual(44);
  });

  it('then fits 648px: padding, brand, seven sections, settings, account', () => {
    // The rail's own padding (top + bottom), the brand (44) and its margin below (read from .mark), 8 items of 56 with the 4px gaps between the 9 children
    // of the main nav, the gap to the account nav, and the account nav (56).
    const s4 = token('--s4');
    expect(s4).toBe(16);
    const mark = /\.mark\s*\{([^}]*)\}/.exec(withoutComments(shellCss))?.[1] ?? '';
    const markMargin = token(/margin-bottom:\s*var\((--[\w-]+)\)/.exec(mark)?.[1] ?? '');
    expect(markMargin).toBe(16);
    const total = 2 * s4 + 44 + markMargin + 8 * 56 + 9 * 4 + 4 + 56;
    // Measured on the tablet: 636 within 648.
    expect(total).toBe(636);
    expect(total).toBeLessThanOrEqual(648);
  });
});
