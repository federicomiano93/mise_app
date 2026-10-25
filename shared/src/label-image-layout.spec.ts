// The «with logo» layout against the owner's own script. The golden file was recorded from genera_etichetta.py itself by
// algprobe/label-golden/harness.py on a FAKE corpus (its two header lines swapped for fake ones, nothing else
// touched): every text it drew, where, in which face and size, and every width it measured. Fed those same widths, the
// port must draw the same texts at the same places, to the last fraction of a pixel.

import { describe, expect, test } from 'vitest';
import { layoutLogoLabel, producedOnWord } from './label-image-layout';
import type { LabelFont, LayoutElement } from './label-image-layout';
import { measureLikePillow } from './label-image-fonts';
import { labelMetrics } from './label-image-metrics';
import { golden } from './fixtures/label-image-golden';
import type { GoldenProduct } from './fixtures/label-image-golden';

const fromScript = (p: GoldenProduct) => (text: string, font: LabelFont, px: number): number => {
  const w = p.widths[`${font}|${px}|${text}`];
  if (w === undefined) throw new Error(`the script never measured «${text}» (${font} ${px}) for ${p.id}`);
  return w;
};

const texts = (elements: readonly LayoutElement[]) =>
  elements.filter((e): e is Extract<LayoutElement, { kind: 'text' }> => e.kind === 'text')
    .map(({ x, y, text, font, px }) => ({ x, y, text, font, px }));

const input = (p: GoldenProduct) => ({
  title: p.title, ingredients: p.ingredients, header: golden.header, logo: golden.logo, producedOn: producedOnWord('it'),
});

// Bold = checked (defect a) changes which runs are bold, so that product is compared below on what it changes.
const sameAsScript = golden.products.filter(p => !p.defects.includes('a'));

describe('the «with logo» layout, against the owner’s script', () => {
  test('the corpus covers the cases that matter', () => {
    expect(sameAsScript.length).toBeGreaterThanOrEqual(15);
    expect(golden.products.some(p => p.layout.tooLong)).toBe(true);
    expect(golden.products.some(p => p.title.includes('|'))).toBe(true);
    expect(golden.products.some(p => p.layout.texts.some(t => t.font === 'title' && t.px < 128))).toBe(true);
  });

  test.each(sameAsScript.map(p => [p.id, p] as const))('%s: the same texts, at the same places, in the same faces', (_id, p) => {
    const laid = layoutLogoLabel(input(p), fromScript(p));
    expect(texts(laid.elements)).toEqual(p.layout.texts);
    expect(laid.lines.length).toBe(p.layout.lines);
    expect(laid.endY).toBe(p.layout.endY);
    expect(laid.tooLong).toBe(p.layout.tooLong);
  });

  test.each(sameAsScript.map(p => [p.id, p] as const))('%s: and the same again measured from the font table', (_id, p) => {
    const m = labelMetrics();
    const laid = layoutLogoLabel(input(p), (t, f, px) => measureLikePillow(m, t, f, px));
    expect(texts(laid.elements)).toEqual(p.layout.texts);
    expect(laid.tooLong).toBe(p.layout.tooLong);
  });

  test('(a) the nine words the script checks but did not print bold are bold now, and only those changed', () => {
    const p = golden.products.find(g => g.defects.includes('a')) as GoldenProduct;
    const m = labelMetrics();
    const laid = texts(layoutLogoLabel(input(p), (t, f, px) => measureLikePillow(m, t, f, px)).elements);
    const nine = ['SPELTA', 'ALBUME', 'TUORLO', 'SIERO', 'CASEINA', 'YOGURT', 'MANDORLA', 'NOCCIOLA', 'PISTACCHIO'];
    for (const w of nine) {
      // The script never draws the whole word bold. (It draws half of PISTACCHIO bold: «PISTACCHI» is on its list and
      // matches inside the word, «O,» stays plain.)
      expect(p.layout.texts.some(t => t.text.startsWith(w) && t.font === 'bold')).toBe(false);
      expect(laid.find(t => t.text === w)?.font).toBe('bold');
    }
    expect(p.layout.texts.filter(t => t.text.startsWith('PISTACCHI')).map(t => [t.text, t.font]))
      .toEqual([['PISTACCHI', 'bold']]);
    expect(laid.find(t => t.text === 'LATTE')?.font).toBe('bold');
    expect(p.layout.texts.find(t => t.text === 'LATTE')?.font).toBe('bold');
  });

  test('the rule, the logo and the date line sit where the script puts them', () => {
    const p = golden.products[0] as GoldenProduct;
    const laid = layoutLogoLabel(input(p), fromScript(p));
    const logoBottom = 10 + Math.floor(golden.logo.height / 4);
    expect(laid.logoBottom).toBe(logoBottom);
    expect(laid.elements).toContainEqual({ kind: 'image', x: 620, y: 40, w: 1320, h: golden.logo.height });
    expect(laid.elements).toContainEqual({ kind: 'rect', x0: 88, y0: (logoBottom + 57) * 4, x1: 2472, y1: (logoBottom + 61) * 4 });
    expect(laid.elements).toContainEqual({ kind: 'rect', x0: 640, y0: 1776, x1: 1400, y1: 1784 });
  });

  test('an empty header line keeps its place and draws nothing', () => {
    const p = golden.products[0] as GoldenProduct;
    const both = layoutLogoLabel(input(p), fromScript(p));
    const one = layoutLogoLabel({ ...input(p), header: [golden.header[0], ''] }, (t, f, px) => (t === '' ? 0 : fromScript(p)(t, f, px)));
    expect(texts(one.elements).length).toBe(texts(both.elements).length - 1);
    expect(one.titleY).toBe(both.titleY);
  });

  test('«PRODOTTO IL:» follows the country’s language, English for anything unknown', () => {
    expect(producedOnWord('it')).toBe('PRODOTTO IL:');
    expect(producedOnWord('en')).toBe('PRODUCED ON:');
    expect(producedOnWord(null)).toBe('PRODUCED ON:');
  });
});
