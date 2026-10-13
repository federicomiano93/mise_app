import { describe, expect, it } from 'vitest';

// ⚠️ THE LAB TABLET HAS NO `dvh`. Its Chrome stops at 101 (measured over adb, 13 Oct 2026: the newest
// Google Play serves the SM-T550), and dvh/svh/lvh arrived in Chrome 108. So no stylesheet writes a dvh line:
// every one reads `var(--vh100)`, which tokens.css sets to 100vh, switches to 100dvh inside
// `@supports (height: 100dvh)`, and shell/viewportHeight.ts overrides inline on <html> with the visible height
// where dvh is unknown.
//
// ⚠️ And never a "fallback" pair whose LATER line holds var(): `max-height: calc(var(--vh100) …); max-height:
// calc(100dvh - var(--x))`. A value holding var() is accepted at parse time and thrown out only at
// computed-value time, so the property falls to its INITIAL value, not to the line above. Measured on the tablet
// on 14 Oct 2026: the recipe detail pane had a computed max-height of `none`. (fallbackTrap.spec.ts pins it.)
const sheets = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true });

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const DVH = /\d(dvh|svh|lvh)\b/;
const SUPPORTS_BLOCK = /@supports\s*\(\s*height:\s*100dvh\s*\)\s*\{\s*:root\s*\{\s*--vh100:\s*100dvh;?\s*\}\s*\}/;

describe('viewport units the lab tablet does not know', () => {
  it('finds the stylesheets it reads', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(20);
    expect(Object.values(sheets).some(css => css.includes('var(--vh100'))).toBe(true);
  });

  it('tokens.css switches --vh100 to 100dvh inside @supports, and nowhere else is dvh/svh/lvh written', () => {
    const offenders: string[] = [];
    let found = false;
    for (const [file, css] of Object.entries(sheets)) {
      let text = withoutComments(css);
      if (file.endsWith('/tokens.css')) {
        found = SUPPORTS_BLOCK.test(text);
        text = text.replace(SUPPORTS_BLOCK, '');
      }
      if (DVH.test(text)) offenders.push(file);
    }
    expect(found).toBe(true);
    expect(offenders).toEqual([]);
  });
});
