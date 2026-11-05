import { describe, expect, it } from 'vitest';
import { SPLIT_QUERY } from '../ui/split';

// ⚠️ EVERY PHONE-SIDE `display: none` FOR A SPLIT-ONLY ELEMENT NEEDS A `display` IN THE SPLIT, AND
// THE OTHER WAY ROUND: a rule written for one side only leaves the other blank (the project's
// tablet-CSS trap). DaysNav draws one set of buttons in both layouts, so it is the file at risk.
//
// ⚠️ AND A TAB'S WORDS ARE ITS NAME, so the elements that carry them are never `display: none`: in
// the strip they are `visually-hidden` (base.css) and the split undoes that. Only what is
// `aria-hidden` in the markup (the short label, the digits, the dot) is `display: none`.
const sheets = import.meta.glob<string>('./*.module.css', { query: '?raw', import: 'default', eager: true });
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SPLIT_MEDIA = `@media ${SPLIT_QUERY}`;

describe('DaysNav: each element that exists for one layout only is undone in the other', () => {
  const css = withoutComments(sheets['./DaysNav.module.css'] ?? '');
  const at = css.indexOf(SPLIT_MEDIA);
  const strip = css.slice(0, at);
  const split = css.slice(at);

  // The declarations of every rule whose selector list names `selector`, in this half of the file.
  function bodies(half: string, selector: string): string[] {
    const found: string[] = [];
    for (const [, selectors = '', body = ''] of half.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const names = selectors.split(',').map(s => s.trim());
      if (names.includes(selector)) found.push(body);
    }
    return found;
  }

  function displays(half: string, cls: string): string[] {
    return bodies(half, `.${cls}`).flatMap(body => {
      const display = /display:\s*([a-z-]+)/.exec(body);
      return display?.[1] ? [display[1]] : [];
    });
  }

  it('finds the split half', () => {
    expect(at).toBeGreaterThan(0);
  });

  // The words of the tab: drawn in the split only, visually hidden (not display: none) in the strip.
  describe.each(['full', 'sub', 'chipTomorrow', 'chipWord'])('.%s carries words of the tab\'s name', cls => {
    it('is never display: none, in the strip or in the split', () => {
      expect(displays(strip, cls)).not.toContain('none');
      expect(displays(split, cls)).not.toContain('none');
    });

    it('is shown in the split', () => {
      expect(displays(split, cls).length, cls).toBeGreaterThan(0);
    });

    // The recipe's own declarations, undone with two classes (order of the stylesheets must not matter).
    it('has the visually-hidden recipe undone in the split, by a selector of two classes', () => {
      const undo = bodies(split, `.tab .${cls}`).join(';');
      for (const property of ['position: static', 'overflow: visible', 'clip: auto', 'clip-path: none', 'margin: 0', 'width: auto', 'height: auto']) {
        expect(undo, `${cls}: ${property}`).toContain(property);
      }
    });
  });

  // Drawn in the strip only, and aria-hidden: shown by default, none in the split.
  it.each(['short', 'number', 'dot'])('.%s is shown in the strip and none in the split', cls => {
    expect(displays(strip, cls)).not.toContain('none');
    expect(displays(split, cls)).toContain('none');
  });
});
