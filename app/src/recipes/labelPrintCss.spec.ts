import { describe, expect, it } from 'vitest';
import { LABEL_SIZES } from '@mise/shared/label-template-model';
import tokensCss from '../styles/tokens.css?raw';
import labelCss from './label-print.css?raw';

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
    expect(css).toMatch(/@page\s*\{\s*size:\s*auto;\s*margin:\s*0;\s*\}/);
  });

  // ⚠️ ONE RULE, DERIVED RATHER THAN LISTED: everything but the label host is hidden when printing.
  it('hides everything but #labelPrint when printing, with one derived rule', () => {
    expect(css).toMatch(/@media print\s*\{[\s\S]*body\s*>\s*\*:not\(#labelPrint\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
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
