import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import dialogCss from './RecipeCategoriesDialog.module.css?raw';

// What the Categories dialog's stylesheet decides and jsdom cannot see (jsdom applies no layout): at 296px the edit row's field, confirm
// button and «Cancel» side by side ran past the dialog's edge, and a long word broke in the middle («rinom / inata»).
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(css: string, selector: string): string {
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) return body;
  }
  throw new Error(`${selector} not found`);
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

const hit = Number(/--hit:\s*(\d+)px/.exec(tokensCss)?.[1]);

describe('the edit row (rename and new name)', () => {
  it('⚠️ wraps: the form takes the row\'s whole width and the field takes a whole line, so the buttons sit under it', () => {
    expect(declaration(rule(dialogCss, '.editor'), 'flex-wrap')).toBe('wrap');
    expect(declaration(rule(dialogCss, '.editor'), 'flex')).toBe('1 1 100%');
    expect(declaration(rule(dialogCss, '.editor'), 'min-width')).toBe('0');
    expect(declaration(rule(dialogCss, '.input'), 'flex')).toBe('1 1 100%');
    expect(declaration(rule(dialogCss, '.input'), 'min-width')).toBe('0');
  });

  it('keeps the buttons at least 44px a side', () => {
    expect(hit).toBeGreaterThanOrEqual(44);
    expect(declaration(rule(dialogCss, '.icon'), 'min-width')).toBe('var(--hit)');
    expect(declaration(rule(dialogCss, '.icon'), 'min-height')).toBe('var(--hit)');
  });
});

describe('the list', () => {
  it('⚠️ wraps a name at word boundaries (never `anywhere`) in a column that may shrink', () => {
    expect(declaration(rule(dialogCss, '.name'), 'overflow-wrap')).toBe('break-word');
    expect(declaration(rule(dialogCss, '.name'), 'min-width')).toBe('0');
    expect(declaration(rule(dialogCss, '.row'), 'flex-wrap')).toBe('wrap');
  });

  it('invents no colour and no custom property', () => {
    const css = withoutComments(dialogCss);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i);
    expect(css).not.toMatch(/--[a-z0-9-]+\s*:/i);
  });
});
