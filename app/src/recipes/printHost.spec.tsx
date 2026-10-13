import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { LABEL_CORPUS, TEMPLATE_PROFILES } from '@mise/shared/fixtures/label-corpus';
import { resolveLabel } from '@mise/shared/label-template-model';
import { buildLabel } from '@mise/shared/recipe-label-model';
import type { SheetSource } from './LabelSheet';
import { closePrintHost, LABEL_PAGE_RULE, openPrintHost, PRINTING_CLASS } from './printHost';

// ⚠️⚠️ THE ZERO-MARGIN PAGE LIVES EXACTLY AS LONG AS THE PRINT HOST (driven on the lab tablet, Chrome 101, 14 Oct 2026).
// Without it the label went onto the browser's default page — off its corner and onto a second, blank page. Left
// behind after the label, it would give margin 0 to every other print of this single-page app.
// jsdom has constructed stylesheets but no `document.adoptedStyleSheets`; the spec gives it one, as a browser has.
function withAdoptedSheets(): () => void {
  Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true, configurable: true });
  return () => { delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets; };
}

function someSheet(): SheetSource {
  for (const entry of LABEL_CORPUS) {
    const label = buildLabel(entry.recipe, entry.tables, { shows: 'allergens' });
    if (label.ok) return resolveLabel(label, TEMPLATE_PROFILES.default, {}, 'en') as unknown as SheetSource;
  }
  throw new Error('the corpus has no printable label');
}

const pageRules = (): string[] =>
  document.adoptedStyleSheets.flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText));

describe('the print host and the label page', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    act(() => { closePrintHost(); });
    restore?.();
    restore = null;
  });

  it('adopts a zero-margin page while the host lives, and drops it with the host', () => {
    restore = withAdoptedSheets();
    const sheet = someSheet();
    act(() => { openPrintHost(sheet, sheet.fontMm, 'p76x51'); });
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(true);
    expect(pageRules().join(' ')).toMatch(/@page\s*\{[^}]*margin:\s*0/);
    expect(LABEL_PAGE_RULE).toContain('margin: 0');

    act(() => { closePrintHost(); });
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(pageRules()).toEqual([]);
  });

  it('adopts it once, however many times Print is pressed', () => {
    restore = withAdoptedSheets();
    const sheet = someSheet();
    act(() => { openPrintHost(sheet, sheet.fontMm, null); });
    act(() => { openPrintHost(sheet, sheet.fontMm, null); });
    expect(document.adoptedStyleSheets).toHaveLength(1);
  });

  it('leaves another stylesheet the page adopted alone', () => {
    restore = withAdoptedSheets();
    const other = new CSSStyleSheet();
    other.replaceSync('.x { color: red; }');
    document.adoptedStyleSheets = [other];
    const sheet = someSheet();
    act(() => { openPrintHost(sheet, sheet.fontMm, null); });
    act(() => { closePrintHost(); });
    expect(document.adoptedStyleSheets).toEqual([other]);
  });

  it('still opens the host where constructed stylesheets cannot be adopted', () => {
    const sheet = someSheet();
    act(() => { openPrintHost(sheet, sheet.fontMm, null); });
    expect(document.getElementById('labelPrint')).not.toBeNull();
  });
});
