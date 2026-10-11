import { describe, expect, it } from 'vitest';
import { SPLIT_QUERY } from './split';

// The split is decided by a media query in the stylesheets and, for the attributes that must agree
// with it (the days' aria-orientation, push or replace when a product is picked), by SPLIT_QUERY. A
// media query cannot read a constant, so this reads the stylesheets themselves and fails when they
// stop saying the same number. Every section that is a split has its sheets listed here.
const sheets = import.meta.glob<string>(['../pastries/*.module.css', '../stocktake/*.module.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const sheet = (folder: string, name: string): string => sheets[`../${folder}/${name}.module.css`] ?? '';
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SPLIT_MEDIA = `@media ${SPLIT_QUERY}`;
// Every module with a split-side rule, by section.
const PASTRIES_SPLIT = ['DaysNav', 'DayPanel', 'PastryRow', 'PastriesSection', 'Editor', 'Records'];
const STOCKTAKE_SPLIT = ['StocktakeSection'];
const SPLIT_SHEETS: (readonly [string, string])[] = [
  ...PASTRIES_SPLIT.map(name => ['pastries', name] as const),
  ...STOCKTAKE_SPLIT.map(name => ['stocktake', name] as const),
];

describe('the split breakpoint', () => {
  it('is 1000px: the lab tablet held sideways is 1024 wide, held upright 768', () => {
    expect(SPLIT_QUERY).toBe('(min-width: 1000px)');
  });

  it('finds the stylesheets it reads (it is not looking at nothing)', () => {
    for (const [folder, name] of SPLIT_SHEETS) expect(sheet(folder, name), `${folder}/${name}`).not.toBe('');
  });

  it.each(SPLIT_SHEETS)('%s/%s says the same breakpoint as the code', (folder, name) => {
    expect(withoutComments(sheet(folder, name))).toContain(SPLIT_MEDIA);
  });

  it('is the only min-width breakpoint the split sections\' own stylesheets use', () => {
    for (const [folder, name] of SPLIT_SHEETS) {
      const queries = [...withoutComments(sheet(folder, name)).matchAll(/@media\s*\(\s*min-width:\s*([^)]+)\)/g)].map(m => m[1]);
      for (const width of queries) expect(width, `${folder}/${name}`).toBe('1000px');
    }
  });

  it('is the only min-width breakpoint ANY stylesheet of the Stocktake uses', () => {
    const stocktake = Object.entries(sheets).filter(([path]) => path.startsWith('../stocktake/'));
    expect(stocktake.length).toBeGreaterThan(4);
    for (const [path, css] of stocktake) {
      const queries = [...withoutComments(css).matchAll(/@media\s*\(\s*min-width:\s*([^)]+)\)/g)].map(m => m[1]);
      for (const width of queries) expect(width, path).toBe('1000px');
    }
  });

  // The phone-only rule sits one hair below the split, so exactly one of the two applies.
  it.each([['pastries', 'PastriesSection'], ['stocktake', 'StocktakeSection']])(
    '%s/%s hides the pane that is not the screen on a phone below the split, never at or above it',
    (folder, name) => {
      expect(withoutComments(sheet(folder, name))).toContain('@media (max-width: 999.98px)');
    },
  );
});
