import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { LABEL_CORPUS, TEMPLATE_PROFILES } from '@mise/shared/fixtures/label-corpus';
import { resolveLabel } from '@mise/shared/label-template-model';
import { buildLabel } from '@mise/shared/recipe-label-model';
import pageCss from './label-page.css?raw';
import type { SheetSource } from './LabelSheet';
import { closePrintHost, LABEL_PAGE_ID, LABEL_PAGE_OFF, LABEL_PAGE_ON, openImagePrintHost, openPrintHost, PRINTING_CLASS } from './printHost';

// ⚠️⚠️ THE ZERO-MARGIN PAGE IS ON EXACTLY AS LONG AS THE PRINT HOST (driven on the lab tablet, Chrome 101, 14 Oct 2026).
// Without it the label went onto the browser's default page — off its corner and onto a second, blank page. Left on
// after the label, it would give margin 0 to every other print of this single-page app.
function someSheet(): SheetSource {
  for (const entry of LABEL_CORPUS) {
    const label = buildLabel(entry.recipe, entry.tables, { shows: 'allergens' });
    if (label.ok) return resolveLabel(label, TEMPLATE_PROFILES.default, {}, 'en') as unknown as SheetSource;
  }
  throw new Error('the corpus has no printable label');
}

const pageLink = (): HTMLLinkElement => {
  const link = document.getElementById(LABEL_PAGE_ID);
  if (!(link instanceof HTMLLinkElement)) throw new Error('the label page stylesheet is not linked');
  return link;
};

describe('the print host and the label page', () => {
  afterEach(() => { act(() => { closePrintHost(); }); });

  it('is a static stylesheet with a zero margin, linked as soon as the module loads and switched off', () => {
    expect(pageCss.replace(/\/\*[\s\S]*?\*\//g, '')).toMatch(/@page\s*\{\s*size:\s*auto;\s*margin:\s*0;\s*\}/);
    expect(pageLink().rel).toBe('stylesheet');
    expect(pageLink().media).toBe(LABEL_PAGE_OFF);
  });

  it('switches it on while the host lives, and off with the host', () => {
    const sheet = someSheet();
    act(() => { openPrintHost(sheet, sheet.fontMm, 'p76x51'); });
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(true);
    expect(pageLink().media).toBe(LABEL_PAGE_ON);

    act(() => { closePrintHost(); });
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(pageLink().media).toBe(LABEL_PAGE_OFF);
  });

  it('builds the image label host: the 80 × 60 mm page class and the picture, removed like any other host', () => {
    const png = 'data:image/png;base64,AAAA';
    act(() => { openImagePrintHost(png); });
    const host = document.getElementById('labelPrint');
    expect(host?.parentElement).toBe(document.body);
    expect(host?.className).toBe('lab-print lab-print--p80x60');
    const image = host?.querySelector('img.lab-print-image');
    expect(image?.getAttribute('src')).toBe(png);
    expect(image?.getAttribute('alt')).toBe('');
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(true);
    expect(pageLink().media).toBe(LABEL_PAGE_ON);

    // A second Print replaces the host; closing takes it, the class and the zero-margin page away.
    act(() => { openImagePrintHost(png); });
    expect(document.querySelectorAll('#labelPrint')).toHaveLength(1);
    act(() => { closePrintHost(); });
    expect(document.getElementById('labelPrint')).toBeNull();
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(pageLink().media).toBe(LABEL_PAGE_OFF);
  });

  it('waits for the person to be back in the page after afterprint, for the image host too', () => {
    act(() => { openImagePrintHost('data:image/png;base64,AAAA'); });
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.getElementById('labelPrint')).not.toBeNull();
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    expect(document.getElementById('labelPrint')).toBeNull();
  });

  it('links it once, however many times Print is pressed', () => {
    const sheet = someSheet();
    act(() => { openPrintHost(sheet, sheet.fontMm, null); });
    act(() => { openPrintHost(sheet, sheet.fontMm, null); });
    expect(document.querySelectorAll(`#${LABEL_PAGE_ID}`)).toHaveLength(1);
    expect(pageLink().media).toBe(LABEL_PAGE_ON);
  });
});
