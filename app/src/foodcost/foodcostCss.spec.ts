import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import pageCss from '../shell/Page.module.css?raw';
import detailCss from './FoodcostDetail.module.css?raw';
import settingsCss from './FoodcostSettings.module.css?raw';
import historyCss from './MarginHistory.module.css?raw';
import listCss from './FoodcostList.module.css?raw';
import editorCss from './ProductEditor.module.css?raw';
import rowCss from './ProductRow.module.css?raw';
import sectionCss from './FoodcostSection.module.css?raw';

// What a stylesheet decides and jsdom cannot see: jsdom applies no layout, so a row too short to
// tap, a card that clips the bar stuck to its top or a pane that does not scroll on its own is
// invisible to every other spec. These read the CSS text.
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

describe('the row of a product', () => {
  it('is at least as tall as a thumb\'s target, and the whole row is the button', () => {
    const row = rule(rowCss, '.row');
    expect(Number(/^(\d+)px$/.exec(declaration(row, 'min-height') ?? '')?.[1])).toBeGreaterThanOrEqual(token('--hit'));
    expect(declaration(row, 'width')).toBe('100%');
  });

  it('lets the name take what is left and wrap, instead of pushing the figure off a 296px phone', () => {
    expect(declaration(rule(rowCss, '.main'), 'flex')).toBe('1');
    expect(declaration(rule(rowCss, '.main'), 'min-width')).toBe('0');
    expect(declaration(rule(rowCss, '.name'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(rowCss, '.sub'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(rowCss, '.figure'), 'flex')).toBe('none');
  });

  it('draws a visible focus ring', () => {
    expect(declaration(rule(rowCss, '.row:focus-visible'), 'outline')).toContain('var(--accent)');
  });

  it('colours the light in three different tokens, and the unknown one quietly', () => {
    const colours = ['green', 'amber', 'red'].map(status => declaration(rule(rowCss, `.dot[data-status="${status}"]`), 'background'));
    expect(colours).toEqual(['var(--ok)', 'var(--warn)', 'var(--danger)']);
    expect(declaration(rule(rowCss, '.dot'), 'background')).toBe('var(--line-2)');
  });

  it('marks a product that cannot be costed in the to-do colour, which stays readable', () => {
    expect(declaration(rule(rowCss, '.sub[data-todo="true"]'), 'color')).toBe('var(--warn-ink)');
  });
});

describe('the frame keeps a form bar able to stick', () => {
  // The form bar of a screen sticks to the top of the scroll area only if nothing between them
  // clips. An `overflow` on any of these would turn it into an ordinary row. The one scroll area on
  // purpose, the right-hand side of the split, is pinned under «the split of the frame».
  it('has nothing that clips between a bar and the scroll area', () => {
    const clippers: string[] = [];
    const phoneSection = sectionCss.slice(0, sectionCss.indexOf('@media (min-width: 1000px)'));
    const sheets: [string, string, string[]][] = [
      ['FoodcostSection', sectionCss, ['.layout', '.list']],
      ['FoodcostSection on a phone', phoneSection, ['.detail']],
      ['FoodcostList', listCss, ['.column', '.rows']],
      ['FoodcostDetail', detailCss, ['.prompt']],
      ['ProductEditor', editorCss, ['.editor', '.body']],
      ['MarginHistory', historyCss, ['.history', '.body', '.rows']],
      ['FoodcostSettings', settingsCss, ['.settings', '.body', '.card']],
      ['Page', pageCss, ['.body']],
    ];
    for (const [name, css, selectors] of sheets) {
      for (const selector of selectors) {
        if (/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/.test(rule(css, selector))) clippers.push(`${name} ${selector}`);
      }
    }
    expect(clippers).toEqual([]);
  });
});

describe('the split of the frame', () => {
  const css = withoutComments(sectionCss);
  const at = css.indexOf('@media (min-width: 1000px)');
  const phone = css.slice(0, at);
  const split = css.slice(at);

  it('puts the list at the list width and gives the right-hand side the rest', () => {
    expect(at).toBeGreaterThan(0);
    expect(declaration(rule(split, '.layout'), 'grid-template-columns')).toBe('var(--list-w) minmax(0, 1fr)');
  });

  // A product tapped far down a long list opened at the top of the page, and its title taking the
  // focus scrolled the page back up: the place in the list was lost at every product.
  it('keeps the right-hand side on screen while the list scrolls, scrolling on its own', () => {
    const detail = rule(split, '.detail');
    expect(declaration(detail, 'position')).toBe('sticky');
    expect(declaration(detail, 'top')).toBe('var(--s4)');
    expect(declaration(detail, 'overflow-y')).toBe('auto');
    expect(declaration(detail, 'overscroll-behavior')).toBeUndefined();
    const heights = [...detail.matchAll(/max-height:\s*([^;]+);/g)].map(([, value = '']) => value.trim());
    expect(heights).toEqual([
      'calc(100vh - var(--topbar-h) - 2 * var(--s4))',
      'calc(100dvh - var(--topbar-h) - 2 * var(--s4))',
    ]);
  });

  it('makes both sides able to shrink, so a long name never pushes the figure off the screen', () => {
    expect(declaration(rule(css, '.list'), 'min-width')).toBe('0');
    expect(declaration(rule(css, '.detail'), 'min-width')).toBe('0');
  });

  it('hides, on a phone only, the prompt behind the list and the list behind a screen', () => {
    const hiddenOnPhone = [...phone.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)]
      .flatMap(([, selectors = '']) => selectors.split(',').map(s => s.trim()));
    expect(hiddenOnPhone).toContain('.layout[data-view="list"] .detail');
    expect(hiddenOnPhone).toContain('.layout[data-view="detail"] .list');
    expect(split).not.toContain('display: none');
  });
});

describe('the labour cost box', () => {
  const input = rule(settingsCss, '.input');

  it('is 48px tall and 16px or more, or iOS zooms the page in when it is focused', () => {
    expect(declaration(input, 'min-height')).toBe('var(--hit)');
    const size = /var\((--fs-[\w]+)\)/.exec(declaration(input, 'font') ?? '')?.[1] ?? '--none';
    expect(token(size)).toBeGreaterThanOrEqual(16);
  });

  it('shows a refused number in the danger colours, with the message saying it too', () => {
    expect(declaration(rule(settingsCss, '.isError'), 'border-color')).toBe('var(--danger)');
  });
});
