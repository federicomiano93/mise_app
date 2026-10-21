import { describe, expect, it } from 'vitest';
import pageCss from '../shell/Page.module.css?raw';
import shellCss from '../shell/AppShell.module.css?raw';
import formBarCss from '../ui/FormBar.module.css?raw';
import itemRowCss from './ItemRow.module.css?raw';
import listCss from './SuppliersList.module.css?raw';
import screenCss from './SupplierScreen.module.css?raw';
import sectionCss from './SuppliersSection.module.css?raw';
import cardCss from './SupplierCard.module.css?raw';
import settingsCss from './SuppliersSettings.module.css?raw';

// What a stylesheet decides and jsdom cannot see: jsdom applies no layout, so a head that stops sticking is invisible to
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

describe('the tabs and the search box stay on screen while the list scrolls', () => {
  const head = rule(listCss, '.head');

  it('sticks to the top of the scrolling area, on the page ground, above the rows', () => {
    expect(declaration(head, 'position')).toBe('sticky');
    expect(declaration(head, 'top')).toBe('0');
    expect(declaration(head, 'background')).toBe('var(--bg)');
    expect(declaration(head, 'z-index')).toBeDefined();
  });

  // ⚠️ THE HEAD STICKS ONLY IF NOTHING BETWEEN IT AND THE SCROLL AREA CLIPS.
  it('has nothing that clips between it and the scroll area', () => {
    const clippers: string[] = [];
    const sheets: [string, string, string[]][] = [
      ['SuppliersList', listCss, ['.column', '.head']],
      ['SuppliersSection', sectionCss, ['.layout', '.list']],
      ['Page', pageCss, ['.body']],
    ];
    for (const [name, css, selectors] of sheets) {
      for (const selector of selectors) {
        if (/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/.test(rule(css, selector))) clippers.push(`${name} ${selector}`);
      }
    }
    expect(clippers).toEqual([]);
  });

  it('scrolls inside the shell\'s main', () => {
    expect(declaration(rule(shellCss, '.content'), 'overflow')).toBe('auto');
  });
});

describe('the supplier screen keeps its bar in reach', () => {
  it('sticks the form bar to the top, and nothing on the card clips it', () => {
    expect(declaration(rule(formBarCss, '.bar'), 'position')).toBe('sticky');
    expect(withoutComments(screenCss)).not.toMatch(/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/);
    expect(withoutComments(itemRowCss)).not.toMatch(/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/);
  });
});

describe('a switched-off row is dimmed by its ink, never by opacity', () => {
  it.each([['SuppliersList', listCss], ['ItemRow', itemRowCss], ['SupplierScreen', screenCss], ['SupplierCard', cardCss], ['SuppliersSettings', settingsCss]] as const)('%s', (_name, css) => {
    expect(withoutComments(css)).not.toMatch(/opacity:/);
  });
});

describe('the supplier card and Settings keep their bar in reach', () => {
  it.each([['SupplierCard', cardCss, '.screen'], ['SuppliersSettings', settingsCss, '.screen']] as const)('%s does not clip', (_name, css, selector) => {
    expect(declaration(rule(css, selector), 'position')).toBeUndefined();
    expect(withoutComments(css)).not.toMatch(/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/);
  });
});

describe('Settings are full width at every width', () => {
  it('hides the list and leaves the right-hand side an ordinary block, on the split too', () => {
    expect(declaration(rule(sectionCss, '.layout[data-view="wide"] .list'), 'display')).toBe('none');
    const detail = rule(sectionCss, '.layout[data-view="wide"] .detail');
    expect(declaration(detail, 'position')).toBe('static');
    expect(declaration(detail, 'max-height')).toBe('none');
    expect(declaration(rule(sectionCss, '.layout[data-view="wide"]'), 'grid-template-columns')).toBe('minmax(0, 1fr)');
  });
});

describe('every target is a thumb-sized one', () => {
  it.each([
    ['SupplierCard .box', cardCss, '.box', 'min-height'],
    ['SupplierCard .tick', cardCss, '.tick', 'min-height'],
    ['SupplierScreen .deleteIcon', screenCss, '.deleteIcon', 'height'],
    ['SuppliersSettings .trash', settingsCss, '.trash', 'height'],
    ['SuppliersSettings .row', settingsCss, '.row', 'min-height'],
  ] as const)('%s is at least 48px (--hit)', (_name, css, selector, property) => {
    expect(declaration(rule(css, selector), property)).toBe('var(--hit)');
  });
});
