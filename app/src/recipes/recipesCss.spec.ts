import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import detailCss from './RecipesDetail.module.css?raw';
import listCss from './RecipesList.module.css?raw';
import sectionCss from './RecipesSection.module.css?raw';
import viewCss from './RecipeView.module.css?raw';

// What a stylesheet decides and jsdom cannot see: jsdom applies no layout, so a row too short to tap, a
// card that clips the bar stuck to its top or a pane that does not scroll on its own is invisible to
// every other spec. These read the CSS text.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of the first rule whose selector list names `selector` exactly.
function rule(css: string, selector: string): string {
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) return body;
  }
  throw new Error(`${selector} not found`);
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

function token(name: string): number {
  const value = Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(tokensCss)?.[1]);
  if (!Number.isFinite(value)) throw new Error(`${name} is not a px token`);
  return value;
}

describe('the row of a recipe', () => {
  it('is at least as tall as a thumb\'s target, and the whole row is the button', () => {
    const row = rule(listCss, '.row');
    expect(declaration(row, 'min-height')).toMatch(/^var\(--hit(-lg)?\)$/);
    expect(token('--hit')).toBeGreaterThanOrEqual(48);
    expect(declaration(row, 'width')).toBe('100%');
  });

  it('lets the name wrap instead of pushing the chevron off a 296px phone', () => {
    expect(declaration(rule(listCss, '.name'), 'min-width')).toBe('0');
    expect(declaration(rule(listCss, '.name'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(listCss, '.chevron'), 'flex')).toBe('none');
  });

  it('draws a visible focus ring, and marks the open recipe', () => {
    expect(declaration(rule(listCss, '.row:focus-visible'), 'outline')).toContain('var(--accent)');
    expect(declaration(rule(listCss, '.row[data-open="true"]'), 'background')).toBe('var(--accent-tint)');
  });

  it('centres the search icon on the box, not on the text baseline', () => {
    const search = rule(listCss, '.search');
    expect(declaration(search, 'display')).toBe('flex');
    expect(declaration(search, 'align-items')).toBe('center');
  });

  it('keeps the search box and the rows free of anything that clips', () => {
    for (const selector of ['.column', '.search', '.rows']) {
      expect(declaration(rule(listCss, selector), 'overflow')).toBeUndefined();
    }
  });
});

describe('the frame', () => {
  it('shows one pane at a time below 1000px, and keeps the list mounted behind a recipe', () => {
    const css = withoutComments(sectionCss);
    expect(css).toContain('@media (max-width: 999.98px)');
    expect(css).toContain('.layout[data-view="list"] .detail');
    expect(css).toContain('.layout[data-view="detail"] .list');
  });

  it('puts the list and the recipe side by side from 1000px, the recipe sticking and scrolling on its own', () => {
    const css = withoutComments(sectionCss);
    const split = css.slice(css.indexOf('@media (min-width: 1000px)'));
    expect(split).toContain('grid-template-columns: var(--list-w) minmax(0, 1fr)');
    expect(declaration(rule(split, '.detail'), 'position')).toBe('sticky');
    expect(declaration(rule(split, '.detail'), 'overflow-y')).toBe('auto');
    expect(split).not.toContain('overscroll-behavior');
  });

  it('never clips the chain from the scroll area to the list', () => {
    for (const selector of ['.layout', '.list']) {
      expect(declaration(rule(sectionCss, selector), 'overflow')).toBeUndefined();
    }
  });
});

describe('the recipe screen', () => {
  it('does not clip the screen, so the form bar can stick to the top', () => {
    expect(declaration(rule(viewCss, '.screen'), 'overflow')).toBeUndefined();
    expect(declaration(rule(viewCss, '.body'), 'overflow')).toBeUndefined();
  });

  it('puts the numbers right-aligned in a column of their own and the units left-aligned', () => {
    expect(declaration(rule(viewCss, '.num'), 'text-align')).toBe('right');
    expect(declaration(rule(viewCss, '.num'), 'font-variant-numeric')).toBe('tabular-nums');
    expect(declaration(rule(viewCss, '.unit'), 'text-align')).toBe('left');
  });

  it('makes the way into the full-screen view a 48px target with a visible ring', () => {
    const button = rule(viewCss, '.fullScreen');
    expect(declaration(button, 'width')).toBe('var(--hit)');
    expect(declaration(button, 'height')).toBe('var(--hit)');
    expect(declaration(rule(viewCss, '.fullScreen:focus-visible'), 'outline')).toContain('var(--accent)');
  });

  it('lines the icon of the head button up with the centre, like every icon button', () => {
    const button = rule(viewCss, '.fullScreen');
    expect(declaration(button, 'display')).toBe('flex');
    expect(declaration(button, 'align-items')).toBe('center');
  });

  it('draws the pane\'s waiting and prompt states in the same card shape', () => {
    expect(declaration(rule(detailCss, '.waiting'), 'border-radius')).toBe('var(--r-lg)');
    expect(declaration(rule(detailCss, '.prompt'), 'border')).toContain('dashed');
  });
});
