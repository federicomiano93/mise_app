import { describe, expect, test } from 'vitest';

// What the label's files may never contain, read from their source (the page CSP is `style-src 'self'`, so a style
// attribute written as a string is refused by the browser and the label would simply lose its size on the paper — with
// every other spec green, because jsdom does not enforce a CSP).
//
//  - no inline `style="…"` string and no `<style>` element: every variable value goes through React's `style` PROP, an
//    object, which sets it through the CSSOM (the same rule as the current app's label-print.js);
//  - nothing builds CSS at run time (`cssText`, `insertRule`, `setAttribute('style'`): the @page rules for the preset
//    sizes live in label-print.css, and a custom size falls through to `@page { size: auto }`;
//  - the print host is never the class that holds back a compulsory update (`preview-overlay`);
//  - the paper's stylesheet is imported where the sheet is drawn, as a plain file.
const sources = import.meta.glob<string>(
  ['./LabelSheet.tsx', './LabelScreen.tsx', './LabelCard.tsx', './useSheetFit.ts'],
  { query: '?raw', import: 'default', eager: true },
);

const codeOf = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const FILES = ['./LabelSheet.tsx', './LabelScreen.tsx', './LabelCard.tsx', './useSheetFit.ts'];

describe('the label\'s files and the page CSP', () => {
  test('the scan finds all four files, and reads real text', () => {
    expect(Object.keys(sources).sort()).toEqual([...FILES].sort());
    for (const file of FILES) expect(sources[file]?.length, file).toBeGreaterThan(500);
  });

  test.each(FILES)('%s has no inline style string and no <style> element', file => {
    const code = codeOf(sources[file] ?? '');
    expect(code).not.toMatch(/\bstyle\s*=\s*["'`]/);
    expect(code).not.toMatch(/\bstyle\s*=\s*\{\s*["'`]/);
    expect(code).not.toMatch(/<style[\s>]/);
    expect(code).not.toMatch(/createElement\(\s*['"]style['"]/);
  });

  test.each(FILES)('%s builds no CSS at run time', file => {
    const code = codeOf(sources[file] ?? '');
    expect(code).not.toMatch(/\.cssText\b|\binsertRule\b|setAttribute\(\s*['"]style['"]|adoptedStyleSheets/);
  });

  test.each(FILES)('%s never names the print host «preview-overlay»', file => {
    expect(codeOf(sources[file] ?? '')).not.toMatch(/preview-overlay/);
  });

  test('the sheet takes its variable values through the style PROP (an object) and imports the plain stylesheet', () => {
    const sheet = codeOf(sources['./LabelSheet.tsx'] ?? '');
    expect(sheet).toMatch(/style=\{\{/);
    expect(sheet).toMatch(/import '\.\/label-print\.css';/);
    expect(sheet).not.toMatch(/\.module\.css/);
  });

  test('the print host is built in <body> with the id the print rule hides everything else around', () => {
    const screenCode = codeOf(sources['./LabelScreen.tsx'] ?? '');
    expect(screenCode).toMatch(/id="labelPrint"/);
    expect(screenCode).toMatch(/createPortal\([\s\S]*document\.body/);
    expect(screenCode).toMatch(/addEventListener\('afterprint'/);
  });

  test('the sheet is measured by the shared loops, not by a copy of them', () => {
    const fit = codeOf(sources['./useSheetFit.ts'] ?? '');
    expect(fit).toMatch(/fitFont\(/);
    expect(fit).toMatch(/fitWidthFactor\(/);
  });
});
