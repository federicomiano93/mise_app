import { describe, expect, it } from 'vitest';
import { LABEL_SIZES } from '@mise/shared/label-template-model';
import tokensCss from '../styles/tokens.css?raw';
import baseCss from '../styles/base.css?raw';
import labelCss from './label-print.css?raw';

// The two faces of Manrope exactly as the current app's root tokens.css declares them (Vite will not let a spec read
// a file outside this package, so the values are written down here, copied from it).
const MANROPE_FACES = [
  {
    file: 'manrope-latin.woff2',
    range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    file: 'manrope-latin-ext.woff2',
    range: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
] as const;

// The stylesheet of the label as a piece of paper (label-print.css), copied from the current app. It is a PLAIN
// GLOBAL stylesheet on purpose — parity doc item 110c — and the tests below read the CSS text, because jsdom
// applies no layout, no @page and no print media: a class renamed or hashed, a preset page forgotten or a token that does
// not exist would pass every other spec and show up as a wrong label on the paper.
//
// css-modules.spec.ts scans only `*.module.css`, so this file is the one stylesheet that is not under it; the
// token check it makes for modules is repeated here for this file.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = withoutComments(labelCss);

describe('label-print.css', () => {
  it('is read as real text, not as an empty string', () => {
    expect(labelCss.length).toBeGreaterThan(2000);
    expect(css).toContain('.lab-sheet');
  });

  // ⚠️ The class names are built at run time by the sheet (`lab-sheet-${role}`) and the print host
  // (`lab-print--${sizeId}`, id `labelPrint`): a CSS module would hash them and the rules would match nothing.
  it('keeps the class names the sheet builds, unhashed', () => {
    for (const selector of [
      '.lab-sheet', '.lab-sheet-block', '.lab-sheet-name', '.lab-sheet-contains', '.lab-sheet-ing--allergen',
      '.lab-print', '.lab-preview', '.lab-preview-note', '.lab-nofit', '#labelPrint',
    ]) {
      expect(css, selector).toContain(selector);
    }
  });

  it('is a plain stylesheet: it is not named, and does not read, as a CSS module', () => {
    // The module spec globs `*.module.css`; the name is what keeps the class names global.
    expect('label-print.css').not.toMatch(/\.module\.css$/);
    expect(css).not.toMatch(/:global|composes\s*:/);
  });

  it('has a named page for every preset size, with the size the model names, and an automatic one for the rest', () => {
    expect(LABEL_SIZES.length).toBeGreaterThanOrEqual(3);
    for (const size of LABEL_SIZES) {
      expect(css, size.id).toMatch(new RegExp(`@page\\s+${size.id}\\s*\\{\\s*size:\\s*${size.widthMm}mm\\s+${size.heightMm}mm;\\s*margin:\\s*0;\\s*\\}`));
      expect(css, size.id).toMatch(new RegExp(`\\.lab-print--${size.id}\\s+\\.lab-sheet\\s*\\{\\s*page:\\s*${size.id};\\s*\\}`));
    }
    // The custom size has a page of its own, selected only on a label host.
    expect(css).toMatch(/@page\s+labcustom\s*\{\s*size:\s*auto;\s*margin:\s*0;\s*\}/);
    expect(css).toMatch(/:where\(\.lab-print\)\s+\.lab-sheet\s*\{\s*page:\s*labcustom;\s*\}/);
  });

  // ⚠️ THIS FILE IS LOADED BY THE WHOLE SINGLE-PAGE APP, once the label has been opened; the current app links its
  // copy on the catalogue page alone. Anything global in it reaches every other screen and every other print.
  it('has no UNNAMED @page rule: only a label print gets margin 0', () => {
    expect(css).not.toMatch(/@page\s*\{/);
    expect(css).not.toMatch(/@page\s*:/);
    const names = [...css.matchAll(/@page\s+([\w-]+)/g)].map(match => match[1]);
    expect(names.length).toBe(LABEL_SIZES.length + 1);
    for (const name of names) expect(['labcustom', ...LABEL_SIZES.map(size => size.id)]).toContain(name);
  });

  it('lets a preset page win over the custom one by specificity, not by the order of the rules', () => {
    // :where() has no specificity: `:where(.lab-print) .lab-sheet` is (0,1,0) and a preset rule is (0,2,0).
    expect(css).not.toMatch(/(^|[}\s])\.lab-print\s+\.lab-sheet\s*\{\s*page:/);
  });

  // ⚠️ SCOPED: with no label host in the body, nothing at all is hidden when the app prints something else.
  it('never hides or restyles the body for a print that has no label host', () => {
    const printBlock = css.slice(css.indexOf('@media print'));
    // Every rule that names the body is behind the class printHost.tsx sets only while a host exists.
    const bodyRules = printBlock.match(/[^{};/]*\bbody\b[^{};]*\{/g) ?? [];
    expect(bodyRules.length).toBeGreaterThan(0);
    for (const rule of bodyRules) expect(rule.trim(), rule).toMatch(/^\.lab-printing\s+body\b/);
    expect(printBlock).toMatch(/\.lab-printing\s+body\s*\{\s*margin:\s*0;\s*background:\s*#fff;\s*\}/);
  });

  // ⚠️ NO `:has` ANYWHERE: the lab tablet was found on Chrome 101 (`:has` is 105+), where a rule using it is dropped
  // whole — the print dialog then offered the app's screen on A4 instead of the label (driven on the tablet, 13 Oct 2026).
  it('uses no selector the lab tablet’s Chrome 101 does not know', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/:has\(/);
  });

  // ⚠️ Mise 2's base.css sets `text-wrap: pretty` on <body>; the current app's catalogue page has none. A different
  // line-breaking algorithm is a different fit, and the fit gate measures this sheet.
  it('breaks lines as the current app does, not as the body of Mise 2 does', () => {
    expect(baseCss).toMatch(/text-wrap:\s*pretty/);
    const sheet = /\.lab-sheet\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(sheet).toMatch(/text-wrap:\s*wrap/);
  });

  // ⚠️ ONE RULE, DERIVED RATHER THAN LISTED: everything but the label host is hidden when printing.
  it('hides everything but #labelPrint when printing, with one derived rule', () => {
    expect(css).toMatch(/@media print\s*\{[\s\S]*\.lab-printing\s+body\s*>\s*\*:not\(#labelPrint\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
    expect(css).toMatch(/\.lab-print\s*\{\s*display:\s*none;\s*\}/);
    expect(css).toMatch(/@media print[\s\S]*\.lab-print\s*\{\s*display:\s*block;\s*\}/);
  });

  // ⚠️ The sheet clips instead of growing, or an overflow could not be detected.
  it('clips the sheet, breaks long words inside themselves and is black on white', () => {
    const sheet = /\.lab-sheet\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(sheet).toMatch(/overflow:\s*hidden/);
    expect(sheet).toMatch(/overflow-wrap:\s*anywhere/);
    expect(sheet).toMatch(/box-sizing:\s*border-box/);
    expect(sheet).toMatch(/background:\s*#fff/);
    expect(sheet).toMatch(/color:\s*#000/);
  });

  it('lets the preview sheet keep its exact height (flex-start, never stretch)', () => {
    expect(/\.lab-preview\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/align-items:\s*flex-start/);
  });

  it('keeps the allergen emphasis through a printer set to save ink', () => {
    expect(css).toMatch(/@media print[\s\S]*\.lab-sheet-ing--allergen\s*\{[^}]*print-color-adjust:\s*exact/);
    expect(/\.lab-sheet-ing--allergen\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/font-weight:\s*800[\s\S]*text-decoration:\s*underline/);
  });

  // ⚠️ THE SAME TYPEFACE AS THE CURRENT APP, or the same recipe on the same paper fits in one app and spills in
  // the other. The sheet names Manrope itself (not the screen's --font), and the two files and unicode ranges are
  // the root tokens.css's own.
  it('draws the sheet in Manrope, with the faces of the current app, not in the screen font', () => {
    const sheet = /\.lab-sheet\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(sheet).toMatch(/font-family:\s*'Manrope',/);
    expect(sheet).not.toMatch(/var\(--font/);
    const faces = (text: string) => [...withoutComments(text).matchAll(/@font-face\s*\{([^}]*Manrope[^}]*)\}/g)].map(m => m[1] ?? '');
    const ours = faces(labelCss);
    expect(ours).toHaveLength(2);
    const field = (face: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(face)?.[1]?.trim();
    ours.forEach((face, index) => {
      const expected = MANROPE_FACES[index];
      expect(field(face, 'unicode-range')).toBe(expected?.range);
      expect(field(face, 'font-weight')).toBe('400 800');
      expect(field(face, 'font-display')).toBe('swap');
      expect(field(face, 'src')).toBe(`url(../assets/fonts/${expected?.file}) format('woff2')`);
    });
  });

  it('reads only tokens that tokens.css defines', () => {
    const defined = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter(token => !defined.has(token))).toEqual([]);
  });

  it('leaves the size of the paper to the model: the sheet rule sets no width, height, padding or font size', () => {
    // They come from the model through the CSSOM (the page CSP refuses a style attribute), so this rule holds only what never changes.
    const sheet = /\.lab-sheet\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(sheet).not.toMatch(/(^|[;\s])(width|height|padding|font-size)\s*:/);
  });
});
