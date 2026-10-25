import { describe, expect, it } from 'vitest';
import listCss from './ClientList.module.css?raw';
import screenCss from './ClientScreen.module.css?raw';
import cardCss from './ProductCard.module.css?raw';

// What the stylesheets of the Clients editor decide and jsdom cannot see (it applies no layout).
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(css: string, selector: string): string {
  const bodies: string[] = [];
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) bodies.push(body);
  }
  if (bodies.length === 0) throw new Error(`${selector} not found`);
  return bodies.join(';');
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

describe('the targets of the Clients editor', () => {
  it.each([
    ['a client row', listCss, '.row', 'min-height'],
    ['the drag handle', listCss, '.handle', 'min-height'],
    ['the drag handle (width)', listCss, '.handle', 'width'],
    ['the name box', screenCss, '.input', 'min-height'],
    ['the delete-client icon', screenCss, '.del', 'min-height'],
    ['the delete-client icon (width)', screenCss, '.del', 'width'],
    ['a field of a product', cardCss, '.input', 'min-height'],
    ['a switch row of a product', cardCss, '.switchRow', 'min-height'],
    ['the delete-product icon', cardCss, '.del', 'min-height'],
    ['the delete-product icon (width)', cardCss, '.del', 'width'],
  ])('%s is at least 48px', (_name, css, selector, property) => {
    expect(declaration(rule(css, selector), property)).toBe('var(--hit)');
  });

  it('the fields are 18px or more: a smaller field makes iOS zoom the page in', () => {
    expect(declaration(rule(screenCss, '.input'), 'font')).toContain('var(--fs-lg)');
    expect(declaration(rule(cardCss, '.input'), 'font')).toContain('var(--fs-lg)');
  });

  it('a field that cannot be left blank is marked in the danger colour, and not by colour alone (aria-invalid)', () => {
    expect(declaration(rule(cardCss, '.invalid'), 'border-color')).toBe('var(--danger)');
    expect(declaration(rule(screenCss, '.invalid'), 'border-color')).toBe('var(--danger)');
  });
});

describe('the look of a list', () => {
  it('the list does not clip, so the bar above it keeps sticking', () => {
    expect(declaration(rule(listCss, '.list'), 'overflow')).toBeUndefined();
  });

  it('the handle does not scroll the page under the finger', () => {
    expect(declaration(rule(listCss, '.handle'), 'touch-action')).toBe('none');
  });
});
