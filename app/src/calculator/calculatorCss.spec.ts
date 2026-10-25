import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import boxesCss from './Boxes.module.css?raw';
import orderCss from './OrderCards.module.css?raw';
import panelCss from './RecipePanel.module.css?raw';
import resultCss from './ResultCard.module.css?raw';
import sectionCss from './CalculatorSection.module.css?raw';
import tabsCss from './RecipeTabs.module.css?raw';
import fullScreenCss from './RecipeFullScreen.module.css?raw';

// What a stylesheet decides and jsdom cannot see (it applies no layout and no media query).
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of every rule whose selector list names `selector` exactly, outside any @media (or, with
// `inMedia`, inside the stylesheet's one @media block).
function rule(css: string, selector: string, inMedia = false): string {
  const text = withoutComments(css);
  const scope = inMedia ? (/@media[^{]*\{([\s\S]*)\}\s*$/.exec(text)?.[1] ?? '') : text.replace(/@media[^{]*\{[\s\S]*\}\s*$/, '');
  const bodies: string[] = [];
  for (const [, selectors = '', body = ''] of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) bodies.push(body);
  }
  if (bodies.length === 0) throw new Error(`${selector} not found`);
  return bodies.join(';');
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

function token(name: string): number {
  const value = Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(tokensCss)?.[1]);
  if (!Number.isFinite(value)) throw new Error(`${name} is not a px token`);
  return value;
}

describe('the boxes', () => {
  it('are at least as tall as a thumb\'s target', () => {
    for (const selector of ['.box', '.select']) {
      expect(declaration(rule(boxesCss, selector), 'min-height')).toBe('var(--hit)');
    }
    expect(token('--hit')).toBeGreaterThanOrEqual(48);
  });

  it('are 18px or more: a smaller field makes iOS zoom the page in', () => {
    expect(declaration(rule(boxesCss, '.box'), 'font')).toContain('var(--fs-lg)');
    expect(token('--fs-lg')).toBeGreaterThanOrEqual(16);
  });

  it('are one width, so every box ends on the same right edge', () => {
    expect(declaration(rule(boxesCss, '.box'), 'width')).toBe('96px');
    expect(declaration(rule(boxesCss, '.box'), 'flex')).toBe('none');
  });

  it('have a visible state when they are locked', () => {
    expect(rule(boxesCss, '.box:disabled')).toContain('var(--sunken)');
  });
});

describe('the tabs', () => {
  it('are a thumb\'s target tall', () => {
    expect(declaration(rule(tabsCss, '.tab'), 'min-height')).toBe('var(--hit)');
  });

  // At 296px the three names of a real venue need 289px and the strip has 264: a tab cut off at the edge is a tab
  // nobody knows is there. They wrap onto a second row instead, and a name too long for a row wraps itself.
  it('wrap onto a second row on a narrow screen and never scroll sideways', () => {
    const list = rule(tabsCss, '.list');
    expect(declaration(list, 'display')).toBe('flex');
    expect(declaration(list, 'flex-wrap')).toBe('wrap');
    expect(list).not.toMatch(/overflow/);
    expect(declaration(rule(tabsCss, '.tab'), 'flex')).toBe('1 1 auto');
    expect(declaration(rule(tabsCss, '.tab'), 'white-space')).toBeUndefined();
    expect(declaration(rule(tabsCss, '.tab'), 'overflow-wrap')).toBe('anywhere');
  });

  it('show the selected one with a frame and a tint, never a solid fill', () => {
    const selected = rule(tabsCss, '.tab[aria-selected="true"]');
    expect(declaration(selected, 'border-color')).toBe('var(--accent)');
    expect(declaration(selected, 'background')).toBe('var(--accent-tint)');
  });
});

describe('the orders', () => {
  it('let the name take what is left and wrap, instead of pushing the box off a 296px phone', () => {
    expect(declaration(rule(orderCss, '.label'), 'flex')).toBe('1');
    expect(declaration(rule(orderCss, '.label'), 'min-width')).toBe('0');
    expect(declaration(rule(orderCss, '.label'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(orderCss, '.group'), 'flex')).toBe('none');
  });

  it('keep a row a thumb\'s target tall', () => {
    expect(declaration(rule(orderCss, '.row'), 'min-height')).toBe('var(--hit)');
  });
});

describe('the result', () => {
  it('reads its figures down a column: same-width digits, right-aligned', () => {
    const figure = rule(resultCss, '.figure');
    expect(declaration(figure, 'font-variant-numeric')).toBe('tabular-nums');
    expect(declaration(figure, 'text-align')).toBe('right');
  });

  it('says a refusal in the to-check colours, never the alarm\'s', () => {
    const problem = rule(resultCss, '.problem');
    expect(declaration(problem, 'background')).toBe('var(--warn-tint)');
    expect(declaration(problem, 'color')).toBe('var(--warn-ink)');
  });
});

describe('the panel\'s layout', () => {
  it('is one column on a phone and two from 1000px', () => {
    expect(declaration(rule(panelCss, '.layout'), 'grid-template-columns')).toBeUndefined();
    expect(withoutComments(panelCss)).toContain('@media (min-width: 1000px)');
    expect(declaration(rule(panelCss, '.layout', true), 'grid-template-columns')).toBe('minmax(0, 1fr) minmax(0, 1fr)');
  });

  // The recipe comes first in the document once the dough is confirmed (the keyboard and the reading order);
  // it must not swap sides on the tablet.
  it('fixes the column of each side whichever comes first in the document', () => {
    expect(declaration(rule(panelCss, '.entries', true), 'grid-column')).toBe('1');
    expect(declaration(rule(panelCss, '.result', true), 'grid-column')).toBe('2');
    expect(declaration(rule(panelCss, '.entries', true), 'grid-row')).toBe('1');
    expect(declaration(rule(panelCss, '.result', true), 'grid-row')).toBe('1');
  });

  it('sticks the recipe to the top of the scroll area, and lets it scroll on its own', () => {
    const result = rule(panelCss, '.result', true);
    expect(declaration(result, 'position')).toBe('sticky');
    expect(declaration(result, 'overflow-y')).toBe('auto');
    expect(result).toContain('var(--topbar-h)');
  });

  // A sticky element sticks only if nothing between it and the scroll area clips.
  it('has nothing between the recipe and the scroll area that clips', () => {
    for (const [name, css] of [['panel', panelCss], ['section', sectionCss]] as const) {
      const outer = withoutComments(css).replace(/\.result\s*\{[^}]*\}/g, '');
      expect(outer, name).not.toMatch(/overflow(-x|-y)?s*:/);
    }
  });

  it('draws no gap for a recipe card that is not there', () => {
    expect(declaration(rule(panelCss, '.result:empty'), 'display')).toBe('none');
  });
});

describe('the full-screen view', () => {
  it('keeps the close and size buttons a large touch target, and the pair stops at the ends without `disabled`', () => {
    const buttons = rule(fullScreenCss, '.close');
    expect(declaration(buttons, 'width')).toBe('var(--hit-lg)');
    expect(declaration(buttons, 'height')).toBe('var(--hit-lg)');
    expect(rule(fullScreenCss, '.step[aria-disabled="true"]')).toContain('var(--ink-3)');
  });

  it('fills the screen and scrolls its rows on their own without moving the page behind', () => {
    expect(declaration(rule(fullScreenCss, '.view'), 'height')).toBe('100%');
    expect(declaration(rule(fullScreenCss, '.scroll'), 'overflow-y')).toBe('auto');
    expect(declaration(rule(fullScreenCss, '.scroll'), 'overscroll-behavior')).toBe('contain');
  });
});

describe('Confirm, Edit and Reset', () => {
  it('are the whole width and the large touch height, and Reset sits under the entries on the split', () => {
    expect(declaration(rule(panelCss, '.confirm'), 'min-height')).toBe('var(--hit-lg)');
    expect(declaration(rule(panelCss, '.confirm'), 'width')).toBe('100%');
    expect(declaration(rule(panelCss, '.reset', true), 'grid-column')).toBe('1');
    expect(declaration(rule(panelCss, '.reset', true), 'grid-row')).toBe('2');
  });

  it('give the card\'s own buttons a thumb\'s target', () => {
    for (const selector of ['.fullScreen', '.send']) expect(declaration(rule(resultCss, selector), 'width')).toBe('var(--hit)');
    expect(declaration(rule(resultCss, '.copy'), 'min-height')).toBe('var(--hit)');
  });
});

describe('the doors at the top of the work view on a phone', () => {
  const text = withoutComments(sectionCss);
  it('share one row of equal columns below the tablet rail (700px), not three stacked rows', () => {
    expect(text).toMatch(/@media \(max-width: 699\.98px\)\s*\{\s*\.top\s*\{[^}]*grid-auto-flow: column;[^}]*grid-auto-columns: minmax\(0, 1fr\);/);
  });
  it('are two columns of two when the venue shows FOUR doors, until the single row of 700px', () => {
    expect(text).toMatch(/@media \(max-width: 699\.98px\)[\s\S]*\.top\[data-doors="4"\]\s*\{[^}]*grid-auto-flow: row;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });
  it('fall back to two columns on the narrowest phones, where a third is too narrow for «Impostazioni»', () => {
    expect(text).toMatch(/@media \(max-width: 339\.98px\)\s*\{\s*\.top\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });
});
