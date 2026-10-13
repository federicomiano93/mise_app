import { describe, expect, it } from 'vitest';

// ⚠️ THE LAB TABLET HAS NO `dvh`. Its Chrome stops at 101 (measured over adb, 13 Oct 2026: the newest
// Google Play serves the SM-T550), and dvh/svh/lvh arrived in Chrome 108. A declaration the browser does
// not understand is dropped without a word, so a dialog capped at `calc(100dvh - …)` had NO height limit on
// the tablet and ran off the bottom of the screen. The build adds a fallback by itself only for plain values
// (`50dvh`), never inside calc() — so every stylesheet writes the `vh` line itself, first, and this reads them.
const sheets = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true });

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('viewport units the lab tablet does not know', () => {
  it('finds the stylesheets it reads', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(20);
    // And at least one of them really uses dvh, or this spec would pass on nothing.
    expect(Object.values(sheets).some(css => /\d(dvh|svh|lvh)\b/.test(withoutComments(css)))).toBe(true);
  });

  it('every dvh/svh/lvh declaration has a plain-vh one of the same property before it, in the same rule', () => {
    const missing: string[] = [];
    for (const [file, css] of Object.entries(sheets)) {
      for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const decls = body.split(';').map(d => d.trim()).filter(Boolean);
        decls.forEach((decl, i) => {
          if (!/\d(dvh|svh|lvh)\b/.test(decl)) return;
          const property = decl.slice(0, decl.indexOf(':')).trim();
          // ⚠️ And the fallback reads --vh100, not a bare vh: on the tablet `100vh` is 96px taller than the window
          // (shell/viewportHeight.ts sets --vh100 to the visible height there).
          const fallback = decls.slice(0, i).some(d =>
            d.slice(0, d.indexOf(':')).trim() === property && !/\d(dvh|svh|lvh)\b/.test(d) && d.includes('var(--vh100, 100vh)'));
          if (!fallback) missing.push(`${file} ${selectors.trim()} → ${decl}`);
        });
      }
    }
    expect(missing).toEqual([]);
  });
});
