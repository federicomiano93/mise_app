import { describe, expect, it } from 'vitest';
import cardCss from './IngredientCard.module.css?raw';

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
