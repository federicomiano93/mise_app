import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { LABEL_CORPUS, TEMPLATE_PROFILES } from '@mise/shared/fixtures/label-corpus';
import { resolveLabel } from '@mise/shared/label-template-model';
import { buildLabel } from '@mise/shared/recipe-label-model';
import { HACCP_SIZES, haccpSizeMm } from '@mise/shared/haccp-label';
import imagePageCss from './label-page-image.css?raw';
import pageCss from './label-page.css?raw';
import type { SheetSource } from './LabelSheet';
import { closePrintHost, LABEL_PAGE_ID, LABEL_PAGE_IMAGE_ID, LABEL_PAGE_OFF, LABEL_PAGE_ON, openHaccpPrintHost, openImagePrintHost, openPrintHost, PRINTING_CLASS } from './printHost';

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
const imagePageLink = (): HTMLLinkElement => {
  const link = document.getElementById(LABEL_PAGE_IMAGE_ID);
  if (!(link instanceof HTMLLinkElement)) throw new Error('the image label page stylesheet is not linked');
  return link;
};

// One static page file per HACCP size, read as text (the page CSP forbids building it at run time).
const haccpPageFiles = import.meta.glob<string>('./label-page-haccp-*.css', { query: '?raw', import: 'default', eager: true });
const haccpPageLink = (size: string): HTMLLinkElement => {
  const link = document.getElementById(`labelPageHaccp${size}`);
  if (!(link instanceof HTMLLinkElement)) throw new Error(`the HACCP ${size} page stylesheet is not linked`);
  return link;
};

describe('the HACCP label host', () => {
  afterEach(() => { act(() => { closePrintHost(); }); });

  it.each(HACCP_SIZES)('⚠️ %s has a page file of exactly its size, linked and off until the host opens', size => {
    const { width, height } = haccpSizeMm(size);
    const css = (haccpPageFiles[`./label-page-haccp-${size}.css`] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(new RegExp(String.raw`@page\s*\{\s*size:\s*${width}mm ${height}mm;\s*margin:\s*0;\s*\}`));
    expect(haccpPageLink(size).media).toBe(LABEL_PAGE_OFF);
  });

  it('switches on the page of the size asked for, and only that one, and everything off with the host', () => {
    act(() => { openHaccpPrintHost('data:image/png;base64,AAAA', '62x29'); });
    expect(haccpPageLink('62x29').media).toBe(LABEL_PAGE_ON);
    for (const size of HACCP_SIZES.filter(s => s !== '62x29')) expect(haccpPageLink(size).media).toBe(LABEL_PAGE_OFF);
    expect(pageLink().media).toBe(LABEL_PAGE_OFF);
    expect(imagePageLink().media).toBe(LABEL_PAGE_OFF);
    const host = document.getElementById('labelPrint');
    expect(host?.className).toBe('lab-print lab-print--haccp-62x29');
    expect(host?.querySelector('img.lab-print-image')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    // A second print of another size takes the first one's page off.
    act(() => { openHaccpPrintHost('data:image/png;base64,BBBB', '40x30'); });
    expect(haccpPageLink('62x29').media).toBe(LABEL_PAGE_OFF);
    expect(haccpPageLink('40x30').media).toBe(LABEL_PAGE_ON);
    act(() => { closePrintHost(); });
    for (const size of HACCP_SIZES) expect(haccpPageLink(size).media).toBe(LABEL_PAGE_OFF);
    expect(document.getElementById('labelPrint')).toBeNull();
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(false);
  });
});

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
    expect(imagePageLink().media).toBe(LABEL_PAGE_OFF);

    act(() => { closePrintHost(); });
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(pageLink().media).toBe(LABEL_PAGE_OFF);
  });

  it('⚠️ the image label has a page of its own, 80 × 60 mm for every browser, on instead of the paper sheet’s', () => {
    expect(imagePageCss.replace(/\/\*[\s\S]*?\*\//g, '')).toMatch(/@page\s*\{\s*size:\s*80mm 60mm;\s*margin:\s*0;\s*\}/);
    expect(imagePageLink().media).toBe(LABEL_PAGE_OFF);
    act(() => { openImagePrintHost('data:image/png;base64,AAAA'); });
    expect(imagePageLink().media).toBe(LABEL_PAGE_ON);
    expect(pageLink().media).toBe(LABEL_PAGE_OFF);
    act(() => { closePrintHost(); });
    expect(imagePageLink().media).toBe(LABEL_PAGE_OFF);
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
    expect(imagePageLink().media).toBe(LABEL_PAGE_ON);

    // A second Print replaces the host; closing takes it, the class and the zero-margin page away.
    act(() => { openImagePrintHost(png); });
    expect(document.querySelectorAll('#labelPrint')).toHaveLength(1);
    act(() => { closePrintHost(); });
    expect(document.getElementById('labelPrint')).toBeNull();
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(imagePageLink().media).toBe(LABEL_PAGE_OFF);
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
