import { describe, expect, it } from 'vitest';
import { SPLIT_QUERY } from './split';

// The split is decided by a media query in the stylesheets and, for the attributes that must agree
// with it (the days' aria-orientation), by SPLIT_QUERY. A media query cannot read a constant, so
// this reads the stylesheets themselves and fails when they stop saying the same number.
const sheets = import.meta.glob<string>('./*.module.css', { query: '?raw', import: 'default', eager: true });
const sheet = (name: string): string => sheets[`./${name}.module.css`] ?? '';
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SPLIT_MEDIA = `@media ${SPLIT_QUERY}`;
// Every module with a split-side rule.
const SPLIT_SHEETS = ['DaysNav', 'DayPanel', 'PastryRow', 'PastriesSection'];

describe('the split breakpoint', () => {
  it('is 1000px: the lab tablet held sideways is 1024 wide, held upright 768', () => {
    expect(SPLIT_QUERY).toBe('(min-width: 1000px)');
  });

  it.each(SPLIT_SHEETS)('%s says the same breakpoint as the code', name => {
    expect(withoutComments(sheet(name))).toContain(SPLIT_MEDIA);
  });

  it('is the only min-width breakpoint Pastries\' own stylesheets use', () => {
    for (const name of [...SPLIT_SHEETS, 'PastriesSoon']) {
      const queries = [...withoutComments(sheet(name)).matchAll(/@media\s*\(\s*min-width:\s*([^)]+)\)/g)].map(m => m[1]);
      for (const width of queries) expect(width, name).toBe('1000px');
    }
  });

  // The phone-only rule sits one hair below the split, so exactly one of the two applies.
  it('hides the days on a phone below the split, never at or above it', () => {
    expect(withoutComments(sheet('PastriesSection'))).toContain('@media (max-width: 999.98px)');
  });
});

// ⚠️ EVERY PHONE-SIDE `display: none` FOR A SPLIT-ONLY ELEMENT NEEDS A `display` IN THE SPLIT, AND
// THE OTHER WAY ROUND: a rule written for one side only leaves the other blank (the project's
// tablet-CSS trap). DaysNav draws one set of buttons in both layouts, so it is the file at risk.
describe('DaysNav: each element that exists for one layout only is undone in the other', () => {
  const css = withoutComments(sheet('DaysNav'));
  const at = css.indexOf(SPLIT_MEDIA);
  const strip = css.slice(0, at);
  const split = css.slice(at);

  // The declarations of every rule whose selector list names `.cls`, in this half of the file.
  function displays(half: string, cls: string): string[] {
    const found: string[] = [];
    for (const [, selectors = '', body = ''] of half.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const names = selectors.split(',').map(s => s.trim());
      if (!names.includes(`.${cls}`)) continue;
      const display = /display:\s*([a-z-]+)/.exec(body);
      if (display?.[1]) found.push(display[1]);
    }
    return found;
  }

  it('finds the split half', () => {
    expect(at).toBeGreaterThan(0);
  });

  // Drawn in the split only: none in the strip, a real display in the split.
  it.each(['full', 'sub', 'chipTomorrow', 'chipWord'])('.%s is none in the strip and shown in the split', cls => {
    expect(displays(strip, cls)).toContain('none');
    const shown = displays(split, cls);
    expect(shown.length, cls).toBeGreaterThan(0);
    expect(shown, cls).not.toContain('none');
  });

  // Drawn in the strip only: shown by default, none in the split.
  it.each(['short', 'number', 'dot'])('.%s is shown in the strip and none in the split', cls => {
    expect(displays(strip, cls)).not.toContain('none');
    expect(displays(split, cls)).toContain('none');
  });
});
