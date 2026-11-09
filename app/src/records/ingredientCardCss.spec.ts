import { describe, expect, it } from 'vitest';
import cardCss from './IngredientCard.module.css?raw';
import foldCss from './AllergenSections.module.css?raw';

// What a stylesheet decides and jsdom cannot see (jsdom applies no layout): the card must not clip, every target is a
// thumb-sized one, the pairs stack on a narrow phone, and an empty sentence under a box keeps its live region.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(css: string, selector: string): string {
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) return body;
  }
  throw new Error(`${selector} not found`);
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

describe('the ingredient card keeps its bar in reach', () => {
  it('nothing on the card clips, and the card is not positioned', () => {
    expect(withoutComments(cardCss)).not.toMatch(/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/);
    expect(declaration(rule(cardCss, '.screen'), 'position')).toBeUndefined();
  });

  it('⚠️ the body is the positioned ancestor of the empty sentences, or the whole page scrolls on a phone', () => {
    expect(declaration(rule(cardCss, '.quiet:empty'), 'position')).toBe('absolute');
    expect(declaration(rule(cardCss, '.body'), 'position')).toBe('relative');
  });

  it('is dimmed by ink, never by opacity', () => {
    expect(withoutComments(cardCss)).not.toMatch(/opacity:/);
  });
});

describe('every target is a thumb-sized one', () => {
  it.each([
    ['.box', cardCss, 'min-height'],
    ['.segment', cardCss, 'min-height'],
    ['.deleteIcon', cardCss, 'height'],
    ['.deleteIcon', cardCss, 'width'],
  ] as const)('IngredientCard %s %s is at least 48px (--hit)', (selector, css, property) => {
    expect(declaration(rule(css, selector), property)).toBe('var(--hit)');
  });
});

describe('the pairs stack below 360px (parity C57)', () => {
  it('are two columns, and one under 360px', () => {
    expect(declaration(rule(cardCss, '.pair'), 'grid-template-columns')).toBe('minmax(0, 1fr) minmax(0, 1fr)');
    const narrow = /@media \(max-width: 359\.98px\)\s*\{\s*\.pair\s*\{([^}]*)\}/.exec(withoutComments(cardCss));
    expect(narrow?.[1]).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
  });
});

describe('an empty sentence under a box is collapsed, never display: none', () => {
  it('.quiet:empty', () => {
    const body = rule(cardCss, '.quiet:empty');
    expect(declaration(body, 'display')).toBeUndefined();
    expect(declaration(body, 'position')).toBe('absolute');
    expect(declaration(body, 'clip-path')).toBe('inset(50%)');
  });
});

// Measured on 6 Nov 2026 at 296px: the fold head was 204px wide, and the title, the state and the chevron on one unwrapping row
// pushed the chevron 11–25px past the card's edge (all three heads in Italian, «Allergens» in English).
describe('a fold head never pushes its chevron off the card', () => {
  it('the title and the state wrap together, as a group that may shrink', () => {
    const words = rule(foldCss, '.words');
    expect(declaration(words, 'display')).toBe('flex');
    expect(declaration(words, 'flex-wrap')).toBe('wrap');
    expect(declaration(words, 'flex')).toBe('1 1 auto');
    expect(declaration(words, 'min-width')).toBe('0');
    expect(declaration(words, 'gap')).toBe('var(--s1) var(--s3)');
  });

  it('the head itself stays one row, and the chevron never shrinks', () => {
    expect(declaration(rule(foldCss, '.toggle'), 'flex-wrap')).toBeUndefined();
    expect(declaration(rule(foldCss, '.chevron'), 'flex')).toBe('none');
  });

  it('nothing in the folds clips (the card’s form bar sticks)', () => {
    expect(withoutComments(foldCss)).not.toMatch(/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/);
  });
});
